import { useCallback, useMemo, useState } from 'react';
import {
  applyPatches,
  emptyDoc,
  newEdgeId,
  newNodeId,
  type Patch,
  type WorkflowDoc,
} from 'tramo/spec';
import { AgentChat, Canvas, RightRail, useWorkflow, type FlowRef, type NodeRunStatus } from 'tramo/react';
import { BUILTIN_PACK, combinePacks, run, type RunEvent } from 'tramo/runtime';
import GMAIL from 'tramo/integrations/gmail';
import GITHUB from 'tramo/integrations/github';
import TELEGRAM from 'tramo/integrations/telegram';
import DISCORD from 'tramo/integrations/discord';
import NOTION from 'tramo/integrations/notion';
import OPENAI from 'tramo/integrations/openai';
import ANTHROPIC from 'tramo/integrations/anthropic';
import LINEAR from 'tramo/integrations/linear';
import AIRTABLE from 'tramo/integrations/airtable';
import STRIPE from 'tramo/integrations/stripe';
import CLOUDFLARE from 'tramo/integrations/cloudflare';
import { SAMPLE_DOC, SUBFLOW_DOUBLER, SUBFLOW_GREETER } from './sample.js';

/* Demo-only sub-flow catalog. A real host might persist these to a
 * folder of WorkflowDoc JSON files and watch the directory. The demo
 * just hardcodes two so the call-flow node has something to point at. */
const DEMO_SUBFLOWS: Record<string, WorkflowDoc> = {
  doubler: SUBFLOW_DOUBLER,
  greeter: SUBFLOW_GREETER,
};
const DEMO_FLOW_REFS: FlowRef[] = [
  { id: 'doubler', name: 'Doubler', description: 'Returns { doubled: value * 2 }.' },
  { id: 'greeter', name: 'Greeter', description: 'Returns "Hello, {name}!".' },
];

const STORAGE_KEY = 'tramo:demo:doc';
const PACKS_STORAGE_KEY = 'tramo:demo:enabled-packs';

/* All toggleable brand packs. BUILTIN_PACK is always on; only these
 * are exposed in the picker so users can shrink the palette to what
 * they care about. */
const BRAND_PACKS = [
  { id: 'gmail',     name: 'Gmail',     pack: GMAIL },
  { id: 'github',    name: 'GitHub',    pack: GITHUB },
  { id: 'telegram',  name: 'Telegram',  pack: TELEGRAM },
  { id: 'discord',   name: 'Discord',   pack: DISCORD },
  { id: 'notion',    name: 'Notion',    pack: NOTION },
  { id: 'openai',    name: 'OpenAI',    pack: OPENAI },
  { id: 'anthropic', name: 'Anthropic', pack: ANTHROPIC },
  { id: 'linear',    name: 'Linear',    pack: LINEAR },
  { id: 'airtable',  name: 'Airtable',  pack: AIRTABLE },
  { id: 'stripe',    name: 'Stripe',    pack: STRIPE },
  { id: 'cloudflare', name: 'Cloudflare', pack: CLOUDFLARE },
] as const;

function loadEnabledPacks(): Set<string> {
  try {
    const raw = localStorage.getItem(PACKS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // fall through
  }
  return new Set(BRAND_PACKS.map((p) => p.id));
}

function loadInitialDoc(): WorkflowDoc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as WorkflowDoc;
  } catch {
    // fall through to sample
  }
  return SAMPLE_DOC;
}

export function App() {
  const [resetCounter, setResetCounter] = useState(0);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<Record<string, unknown>>({});
  const [enabledPacks, setEnabledPacks] = useState<Set<string>>(loadEnabledPacks);
  const [packPickerOpen, setPackPickerOpen] = useState(false);

  // Pack-based loading: each brand integration is its own @tramo/<brand>
  // npm package. The Packs button in the header lets users toggle which
  // brand tiles are loaded — the editor and runtime each derive their
  // registry from the combined set, so unchecking Stripe removes both the
  // tile and the executor with no other plumbing.
  const { nodes, executors } = useMemo(
    () => combinePacks([
      BUILTIN_PACK,
      ...BRAND_PACKS.filter((p) => enabledPacks.has(p.id)).map((p) => p.pack),
    ]),
    [enabledPacks],
  );

  const toggleBrandPack = useCallback((id: string) => {
    setEnabledPacks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try {
        localStorage.setItem(PACKS_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  }, []);

  const workflow = useWorkflow({
    registry: nodes,
    loadDoc: loadInitialDoc,
    saveDoc: (doc) => localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)),
    key: resetCounter,
  });

  const runFlow = useCallback(async () => {
    if (!workflow.doc) return;
    setEvents([]);
    setRunResults({});
    setRunning(true);
    try {
      const result = await run(workflow.doc, executors, {
        onEvent: (e) => setEvents((prev) => [...prev, e]),
        workflows: DEMO_SUBFLOWS,
      });
      // Strip `{ out: value }` wrappers down to the bare value where present,
      // matching how downstream nodes receive the data.
      const flattened: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(result.nodeResults)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && 'out' in v && Object.keys(v).length === 1) {
          flattened[k] = (v as Record<string, unknown>).out;
        } else {
          flattened[k] = v;
        }
      }
      setRunResults(flattened);
    } finally {
      setRunning(false);
    }
  }, [workflow.doc, executors]);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEvents([]);
    setRunResults({});
    setResetCounter((n) => n + 1);
  }, []);

  const loadExample = useCallback(() => {
    workflow.setDoc(buildExampleDoc());
  }, [workflow]);

  // Derive per-node status from the streamed RunEvents. Recomputed on
  // every event push — cheap because events are O(nodes·iterations) and
  // we only build a small map.
  const runStatus = useMemo(() => {
    const map: Record<string, NodeRunStatus> = {};
    for (const e of events) {
      switch (e.type) {
        case 'node-start':
          map[e.nodeId] = { status: 'running' };
          break;
        case 'node-success': {
          // Flatten `{ out: value }` so the chip shows the bare value users
          // see downstream — matches the runResults flattening above.
          const raw = e.output;
          let output: unknown = raw;
          if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'out' in raw && Object.keys(raw).length === 1) {
            output = (raw as Record<string, unknown>).out;
          }
          map[e.nodeId] = { status: 'success', output, durationMs: e.durationMs };
          break;
        }
        case 'node-error':
          map[e.nodeId] = { status: 'error', error: e.error, durationMs: e.durationMs };
          break;
        case 'node-skip':
          map[e.nodeId] = { status: 'skip', reason: e.reason };
          break;
      }
    }
    return map;
  }, [events]);

  return (
    <div className="demo-app">
      <header className="demo-header">
        <div className="demo-header__brand">
          <div className="demo-header__logo">t</div>
          <span className="demo-header__title">tramo</span>
          <span className="demo-header__tag">demo</span>
          <span className="demo-header__tagline">
            workflow-document-of-truth · node editor + runtime
          </span>
        </div>
        <div className="demo-header__actions">
          <button
            type="button"
            className="tr-btn tr-btn--ghost"
            onClick={workflow.undo}
            disabled={!workflow.canUndo}
            title="Undo (Ctrl/⌘ + Z)"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="tr-btn tr-btn--ghost"
            onClick={workflow.redo}
            disabled={!workflow.canRedo}
            title="Redo (Ctrl/⌘ + Shift + Z)"
          >
            ↷ Redo
          </button>
          <div className="demo-packs">
            <button
              type="button"
              className="tr-btn tr-btn--ghost"
              onClick={() => setPackPickerOpen((o) => !o)}
              title="Toggle which integration packs are loaded"
            >
              ⚙ Packs ({enabledPacks.size}/{BRAND_PACKS.length})
            </button>
            {packPickerOpen ? (
              <PackPicker
                enabled={enabledPacks}
                onToggle={toggleBrandPack}
                onClose={() => setPackPickerOpen(false)}
              />
            ) : null}
          </div>
          <button type="button" className="tr-btn tr-btn--ghost" onClick={loadExample}>
            Load example
          </button>
          <button type="button" className="tr-btn tr-btn--ghost" onClick={reset}>
            Reset
          </button>
          <button type="button" className="tr-btn" onClick={runFlow} disabled={running}>
            {running ? 'Running…' : '▶ Run'}
          </button>
        </div>
      </header>

      <div className="demo-body">
        <main className="demo-stage">
          <Canvas workflow={workflow} runResults={runResults} runStatus={runStatus} />
          {events.length > 0 ? <RunLog events={events} /> : null}
        </main>

        <RightRail
          selection={workflow.selection}
          registry={nodes}
          onApply={workflow.applyPatch}
          onClose={workflow.clearSelection}
          saveState={workflow.saveState}
          doc={workflow.doc}
          runResults={runResults}
          flowRefs={DEMO_FLOW_REFS}
          tabs={[
            {
              id: 'agent',
              label: 'Agent',
              render: () => (
                <AgentChat
                  doc={workflow.doc}
                  registry={nodes}
                  applyPatch={workflow.applyPatch}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Pack picker — toggle which brand integration packs are loaded            */
/* ====================================================================== */

function PackPicker({
  enabled,
  onToggle,
  onClose,
}: {
  enabled: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="demo-packs__scrim" onClick={onClose} />
      <div className="demo-packs__panel" onClick={(e) => e.stopPropagation()}>
        <div className="demo-packs__head">Integration packs</div>
        <div className="demo-packs__hint">
          Each brand ships as its own <code>@tramo/&lt;brand&gt;</code> npm package.
          Toggle off to drop the tile from the picker and the executor from the
          runtime — bundle drops it too in a real app.
        </div>
        <ul className="demo-packs__list">
          {BRAND_PACKS.map((p) => {
            const on = enabled.has(p.id);
            const opCount = p.pack.entries.length;
            return (
              <li key={p.id}>
                <label className="demo-packs__row">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(p.id)}
                  />
                  <span className="demo-packs__name">{p.name}</span>
                  <span className="demo-packs__count">{opCount} ops</span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/* ====================================================================== */
/* Run log panel                                                            */
/* ====================================================================== */

function RunLog({ events }: { events: RunEvent[] }) {
  return (
    <div className="demo-runlog">
      <div className="demo-runlog__head">Run log ({events.length} events)</div>
      {events.map((e, i) => (
        <div key={i} className={`demo-runlog__row demo-runlog__row--${rowKind(e)}`}>
          {formatEvent(e)}
        </div>
      ))}
    </div>
  );
}

function rowKind(e: RunEvent): string {
  switch (e.type) {
    case 'node-success': return 'success';
    case 'node-error':   return 'error';
    case 'node-skip':    return 'skip';
    case 'node-log':     return 'log';
    default:             return 'meta';
  }
}

function formatEvent(e: RunEvent): string {
  switch (e.type) {
    case 'run-start':    return `→ run start (${e.nodeOrder.length} nodes)`;
    case 'run-end':      return e.ok ? `✓ run end` : `✗ run end: ${e.error}`;
    case 'node-start':   return `  ${e.nodeId} … starting`;
    case 'node-success': return `  ${e.nodeId} ✓ ${e.durationMs}ms · ${shortJSON(e.output)}`;
    case 'node-error':   return `  ${e.nodeId} ✗ ${e.error}`;
    case 'node-skip':    return `  ${e.nodeId} — skipped (${e.reason})`;
    case 'node-log':     return `    ${e.nodeId} [${e.level}] ${e.message}${e.data !== undefined ? ` · ${shortJSON(e.data)}` : ''}`;
  }
}

function shortJSON(v: unknown): string {
  if (v === undefined) return 'undefined';
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return String(v);
  }
}

/* ====================================================================== */
/* "Load example" — a non-trivial workflow that shows the runtime working   */
/* ====================================================================== */

function buildExampleDoc(): WorkflowDoc {
  const triggerId = newNodeId();
  const fetchId = newNodeId();
  const extractId = newNodeId();
  const ifId = newNodeId();
  const gmailId = newNodeId();
  const telegramId = newNodeId();

  // Demonstrates cross-node steps.* refs: Gmail and Telegram both pull
  // `name` / `followers` / `repos` from the JS transform that sits BEHIND
  // the If, even though only the If is wired directly to them.
  const seeded = applyPatches(emptyDoc(), [
    {
      kind: 'add-node',
      node: {
        id: triggerId,
        type: 'manual-trigger',
        label: 'Run with sample user',
        config: { payload: '{"user":"jhd3197"}' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: fetchId,
        type: 'http-request',
        label: 'Fetch GitHub user',
        config: {
          url: 'https://api.github.com/users/{{user}}',
          method: 'GET',
          headers: '{}',
          body: '',
          timeoutMs: 8000,
        },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: extractId,
        type: 'js-transform',
        label: 'Extract stats',
        config: {
          expression: [
            'const u = input.data;',
            'return {',
            '  login: u.login,',
            '  name: u.name || u.login,',
            '  followers: u.followers,',
            '  repos: u.public_repos,',
            '  profile: u.html_url,',
            '};',
          ].join('\n'),
        },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: ifId,
        type: 'if',
        label: 'Has 10+ followers?',
        config: { condition: 'input.followers >= 10' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: gmailId,
        type: 'gmail-send',
        label: 'Email celebration',
        config: {
          oauthToken: '',
          to: 'team@example.com',
          cc: '',
          bcc: '',
          subject: '🎉 {{steps.extract_stats.name}} hit {{steps.extract_stats.followers}} followers!',
          body: [
            'Hey team,',
            '',
            '{{steps.extract_stats.name}} ({{steps.extract_stats.login}}) just crossed 10 followers on GitHub.',
            '',
            'Followers: {{steps.extract_stats.followers}}',
            'Public repos: {{steps.extract_stats.repos}}',
            'Profile: {{steps.extract_stats.profile}}',
          ].join('\n'),
          bodyFormat: 'text',
        },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: telegramId,
        type: 'telegram-send-message',
        label: 'Telegram nudge',
        config: {
          botToken: '',
          chatId: '',
          text: '{{steps.extract_stats.name}} is at {{steps.extract_stats.followers}} followers ({{steps.extract_stats.repos}} repos) — small but mighty 💪',
          parseMode: 'none',
        },
      },
    },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: triggerId, target: fetchId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: fetchId,   target: extractId, sourceHandle: 'out' } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: extractId, target: ifId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: ifId,      target: gmailId,    sourceHandle: 'yes' } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: ifId,      target: telegramId, sourceHandle: 'no' } },
  ] satisfies Patch[]);

  return seeded.doc;
}
