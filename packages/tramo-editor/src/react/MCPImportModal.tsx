/**
 * MCPImportModal — small "Add MCP server" dialog mounted from the picker.
 *
 * The modal takes a server URL + display name, POSTs a JSON-RPC tools/list
 * request, and emits a populated MCPServerRef once the user confirms. The
 * caller (Canvas) is responsible for dispatching the upsert-mcp-server
 * patch — the modal stays pure UI so it can be reused later from a
 * settings surface.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plug, X } from 'lucide-react';
import type { MCPServerRef, MCPToolRef } from 'tramo-spec';

export interface MCPImportModalProps {
  /** Pre-fill when editing an existing server. Pass `undefined` to add new. */
  initial?: MCPServerRef;
  onClose: () => void;
  onConfirm: (server: MCPServerRef) => void;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; tools: MCPToolRef[] }
  | { status: 'error'; message: string };

const SLUG_RE = /[^a-z0-9-]+/g;

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(SLUG_RE, '-').replace(/^-+|-+$/g, '') || 'mcp-server';
}

export function MCPImportModal({ initial, onClose, onConfirm }: MCPImportModalProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [authToken, setAuthToken] = useState(initial?.authToken ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [fetch, setFetch] = useState<FetchState>(
    initial?.tools && initial.tools.length > 0
      ? { status: 'ok', tools: initial.tools }
      : { status: 'idle' },
  );

  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canFetch = url.trim().length > 0 && fetch.status !== 'loading';
  const canSave =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    fetch.status === 'ok' &&
    fetch.tools.length > 0;

  const runFetch = useCallback(async () => {
    if (!url.trim()) return;
    setFetch({ status: 'loading' });
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      if (authToken.trim()) headers.authorization = `Bearer ${authToken.trim()}`;
      const res = await window.fetch(url.trim(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/list',
        }),
      });
      if (!res.ok) {
        setFetch({ status: 'error', message: `HTTP ${res.status}: ${await res.text()}` });
        return;
      }
      const contentType = res.headers.get('content-type') ?? '';
      let payload: unknown;
      if (contentType.includes('text/event-stream')) {
        const text = await res.text();
        const lines = text.split(/\r?\n/).filter((l) => l.startsWith('data:'));
        const last = lines[lines.length - 1]?.slice(5).trim();
        if (!last) {
          setFetch({ status: 'error', message: 'Empty SSE stream' });
          return;
        }
        payload = JSON.parse(last);
      } else {
        payload = await res.json();
      }
      const rpc = payload as { result?: { tools?: unknown }; error?: { message?: string } };
      if (rpc.error) {
        setFetch({ status: 'error', message: rpc.error.message ?? 'Server returned an error' });
        return;
      }
      const rawTools = Array.isArray(rpc.result?.tools) ? (rpc.result?.tools as unknown[]) : [];
      const tools: MCPToolRef[] = rawTools
        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
        .map((t) => {
          const tool: MCPToolRef = { name: String(t.name ?? '') };
          if (typeof t.description === 'string') tool.description = t.description;
          if (t.inputSchema !== undefined) tool.inputSchema = t.inputSchema;
          return tool;
        })
        .filter((t) => t.name);
      setFetch({ status: 'ok', tools });
    } catch (err) {
      setFetch({ status: 'error', message: (err as Error).message || String(err) });
    }
  }, [url, authToken]);

  const handleSave = useCallback(() => {
    if (fetch.status !== 'ok') return;
    const id = initial?.id ?? slugify(name);
    const server: MCPServerRef = {
      id,
      name: name.trim(),
      url: url.trim(),
      tools: fetch.tools,
      fetchedAt: Date.now(),
    };
    if (authToken.trim()) server.authToken = authToken.trim();
    if (description.trim()) server.description = description.trim();
    onConfirm(server);
  }, [authToken, description, fetch, initial, name, onConfirm, url]);

  return (
    <div className="tr-mcp-modal-scrim" onClick={onClose}>
      <div
        className="tr-mcp-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import MCP server"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tr-mcp-modal__head">
          <span className="tr-mcp-modal__head-icon" aria-hidden>
            <Plug size={16} />
          </span>
          <div className="tr-mcp-modal__title">
            {initial ? 'Edit MCP server' : 'Import MCP server'}
          </div>
          <button
            type="button"
            className="tr-mcp-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <div className="tr-mcp-modal__body">
          <label className="tr-mcp-modal__field">
            <span className="tr-mcp-modal__label">Name</span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Brave Search"
            />
          </label>

          <label className="tr-mcp-modal__field">
            <span className="tr-mcp-modal__label">Server URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://localhost:3000/mcp"
              spellCheck={false}
            />
          </label>

          <label className="tr-mcp-modal__field">
            <span className="tr-mcp-modal__label">
              Bearer token <span className="tr-mcp-modal__optional">(optional)</span>
            </span>
            <input
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Sent as Authorization: Bearer …"
              spellCheck={false}
            />
          </label>

          <label className="tr-mcp-modal__field">
            <span className="tr-mcp-modal__label">
              Description <span className="tr-mcp-modal__optional">(optional)</span>
            </span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Shown under the tile name in the picker"
            />
          </label>

          <div className="tr-mcp-modal__fetch-row">
            <button
              type="button"
              className="tr-mcp-modal__fetch"
              disabled={!canFetch}
              onClick={runFetch}
            >
              {fetch.status === 'loading' ? (
                <>
                  <Loader2 size={14} className="tr-spin" /> Fetching…
                </>
              ) : (
                'Fetch tools'
              )}
            </button>
            {fetch.status === 'ok' ? (
              <span className="tr-mcp-modal__fetch-ok">
                {fetch.tools.length} tool{fetch.tools.length === 1 ? '' : 's'} discovered
              </span>
            ) : null}
            {fetch.status === 'error' ? (
              <span className="tr-mcp-modal__fetch-err">{fetch.message}</span>
            ) : null}
          </div>

          {fetch.status === 'ok' && fetch.tools.length > 0 ? (
            <div className="tr-mcp-modal__tools">
              {fetch.tools.map((t) => (
                <div key={t.name} className="tr-mcp-modal__tool">
                  <span className="tr-mcp-modal__tool-name">{t.name}</span>
                  {t.description ? (
                    <span className="tr-mcp-modal__tool-desc">{t.description}</span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="tr-mcp-modal__foot">
          <button type="button" className="tr-mcp-modal__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="tr-mcp-modal__btn tr-mcp-modal__btn--primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            {initial ? 'Save changes' : 'Import server'}
          </button>
        </div>
      </div>
    </div>
  );
}
