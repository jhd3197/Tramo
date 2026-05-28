/**
 * AgentChat — right-rail chat surface for talking to Claude about the
 * current workflow. The agent's only channel is the `apply_patch` tool
 * (see tramo/agent), so when it wants to change the workflow, it emits
 * a patch we feed back through `applyPatch` — the same surface humans use.
 *
 * Browser-direct call to the Anthropic API. The API key is persisted to
 * localStorage; clear it via the gear icon.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  NodeRegistry,
  Patch,
  WorkflowDoc,
} from 'tramo-spec';
import {
  PATCH_TOOL_NAME,
  TWEAK_SYSTEM_PROMPT,
  buildPatchToolSpec,
  formatDocContext,
  parsePatch,
} from '../agent/index.js';

const API_KEY_STORAGE = 'tramo:agent:anthropic-key';
const MODEL_STORAGE = 'tramo:agent:anthropic-model';
const DEFAULT_MODEL = 'claude-opus-4-7';
const API_URL = 'https://api.anthropic.com/v1/messages';

export interface AgentChatProps {
  doc: WorkflowDoc | null;
  registry: NodeRegistry;
  applyPatch: (patch: Patch) => void;
  /** Override the default Claude model. */
  model?: string;
}

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  role: ChatRole;
  /** Display text for the bubble. Tool calls render an extra patch row. */
  text: string;
  /** Patches emitted by an assistant message, if any. */
  patches?: Patch[];
  /** Patches the user rejected — they don't reapply on rerender. */
  appliedCount?: number;
}

export function AgentChat({
  doc,
  registry,
  applyPatch,
  model: modelProp,
}: AgentChatProps) {
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(API_KEY_STORAGE) ?? '';
    } catch {
      return '';
    }
  });
  const [model, setModel] = useState<string>(() => {
    try {
      return modelProp ?? localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL;
    } catch {
      return modelProp ?? DEFAULT_MODEL;
    }
  });
  const [editingKey, setEditingKey] = useState(false);
  const [draftKey, setDraftKey] = useState('');

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toolSpec = useMemo(() => buildPatchToolSpec(registry).anthropic, [registry]);

  useEffect(() => {
    // Autoscroll to the bottom on new messages or while a request is pending.
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  const persistKey = useCallback((next: string) => {
    setApiKey(next);
    try {
      if (next) localStorage.setItem(API_KEY_STORAGE, next);
      else localStorage.removeItem(API_KEY_STORAGE);
    } catch {
      // localStorage may be unavailable — fine.
    }
  }, []);

  const persistModel = useCallback((next: string) => {
    setModel(next);
    try {
      localStorage.setItem(MODEL_STORAGE, next);
    } catch {
      // ignore
    }
  }, []);

  const send = useCallback(async () => {
    const userText = input.trim();
    if (!userText || pending) return;
    if (!apiKey) {
      setError('Add your Anthropic API key first.');
      setEditingKey(true);
      return;
    }
    if (!doc) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', text: userText },
    ];
    setMessages(nextMessages);
    setInput('');
    setPending(true);
    setError(null);

    try {
      const body = {
        model,
        max_tokens: 1024,
        system: `${TWEAK_SYSTEM_PROMPT}\n\nCurrent workflow:\n${formatDocContext(doc)}`,
        tools: [toolSpec],
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.text,
        })),
      };

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await safeReadText(res);
        throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      }

      const payload = (await res.json()) as AnthropicResponse;
      const { text, patches } = extractFromResponse(payload);

      const validPatches: Patch[] = [];
      const errors: string[] = [];
      for (const raw of patches) {
        const r = parsePatch(raw);
        if (r.ok) validPatches.push(r.patch);
        else errors.push(r.error);
      }
      for (const p of validPatches) applyPatch(p);

      const displayText = (text || '').trim() || (validPatches.length > 0 ? 'Applied patches.' : '(no output)');
      const assistant: ChatMessage = {
        role: 'assistant',
        text: errors.length > 0 ? `${displayText}\n\nPatch errors: ${errors.join('; ')}` : displayText,
        patches: validPatches,
        appliedCount: validPatches.length,
      };
      setMessages((prev) => [...prev, assistant]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }, [apiKey, applyPatch, doc, input, messages, model, pending, toolSpec]);

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return (
    <div className="tr-agent">
      <div className="tr-agent__head">
        <div className="tr-agent__title">Agent</div>
        <div className="tr-agent__head-actions">
          <button
            type="button"
            className="tr-btn tr-btn--ghost"
            onClick={reset}
            disabled={messages.length === 0}
            title="Clear chat"
          >
            Clear
          </button>
          <button
            type="button"
            className="tr-btn tr-btn--ghost"
            onClick={() => {
              setDraftKey(apiKey);
              setEditingKey((s) => !s);
            }}
            title="API key & model"
          >
            ⚙
          </button>
        </div>
      </div>

      {editingKey ? (
        <div className="tr-agent__settings">
          <label className="tr-field__label">Anthropic API key</label>
          <input
            type="password"
            className="tr-input"
            value={draftKey}
            placeholder="sk-ant-…"
            onChange={(e) => setDraftKey(e.target.value)}
            autoComplete="off"
          />
          <label className="tr-field__label" style={{ marginTop: 8 }}>Model</label>
          <input
            type="text"
            className="tr-input"
            value={model}
            onChange={(e) => persistModel(e.target.value)}
          />
          <div className="tr-agent__settings-actions">
            <button
              type="button"
              className="tr-btn tr-btn--ghost"
              onClick={() => {
                persistKey('');
                setDraftKey('');
              }}
            >
              Forget
            </button>
            <button
              type="button"
              className="tr-btn"
              onClick={() => {
                persistKey(draftKey.trim());
                setEditingKey(false);
              }}
            >
              Save
            </button>
          </div>
          <p className="tr-agent__hint">
            Key is stored in this browser's localStorage and sent directly to
            the Anthropic API. Treat the demo as a developer-only surface.
          </p>
        </div>
      ) : null}

      <div className="tr-agent__messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="tr-agent__empty">
            <p>Ask the agent to build or edit this workflow.</p>
            <p className="tr-agent__empty-hint">
              e.g. <em>“Add a Log step after the HTTP request that prints the
              response body.”</em>
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <Message key={i} message={m} />
          ))
        )}
        {pending ? (
          <div className="tr-agent__row tr-agent__row--assistant">
            <div className="tr-agent__bubble tr-agent__bubble--pending">…</div>
          </div>
        ) : null}
      </div>

      {error ? <div className="tr-agent__error">{error}</div> : null}

      <div className="tr-agent__composer">
        <textarea
          className="tr-input tr-input--area"
          rows={2}
          placeholder={apiKey ? 'Describe a change…' : 'Add your API key (⚙) to start.'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={pending || !apiKey}
        />
        <button
          type="button"
          className="tr-btn"
          onClick={send}
          disabled={pending || !input.trim() || !apiKey}
        >
          {pending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  return (
    <div className={`tr-agent__row tr-agent__row--${message.role}`}>
      <div className="tr-agent__bubble">
        {message.text.split('\n').map((line, i) => (
          <div key={i}>{line || ' '}</div>
        ))}
        {message.patches && message.patches.length > 0 ? (
          <div className="tr-agent__patches">
            {message.patches.map((p, i) => (
              <code key={i} className="tr-agent__patch">{summarizePatch(p)}</code>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function summarizePatch(p: Patch): string {
  switch (p.kind) {
    case 'add-node':         return `+ add-node ${p.node.type} (${p.node.id})`;
    case 'remove-node':      return `– remove-node ${p.id}`;
    case 'update-node-config': return `~ update-config ${p.id}`;
    case 'update-node':      return `~ update-node ${p.id}`;
    case 'add-edge':         return `+ add-edge ${p.edge.source}→${p.edge.target}`;
    case 'remove-edge':      return `– remove-edge ${p.id}`;
    case 'set-full-doc':     return `↻ replace doc (${p.doc.nodes.length} nodes)`;
    case 'upsert-mcp-server': return `+ mcp server ${p.server.id} (${p.server.tools.length} tools)`;
    case 'remove-mcp-server': return `– mcp server ${p.id}`;
  }
}

/* ---------- Anthropic response shape (minimal) ---------- */

interface AnthropicContentText {
  type: 'text';
  text: string;
}

interface AnthropicContentToolUse {
  type: 'tool_use';
  name: string;
  input: unknown;
}

type AnthropicContentBlock = AnthropicContentText | AnthropicContentToolUse | { type: string };

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

function extractFromResponse(payload: AnthropicResponse): { text: string; patches: unknown[] } {
  const out = { text: '', patches: [] as unknown[] };
  const blocks = payload.content ?? [];
  for (const b of blocks) {
    if ('type' in b && b.type === 'text') {
      out.text += (b as AnthropicContentText).text;
    } else if ('type' in b && b.type === 'tool_use') {
      const tu = b as AnthropicContentToolUse;
      if (tu.name === PATCH_TOOL_NAME) {
        out.patches.push(tu.input);
      }
    }
  }
  return out;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
