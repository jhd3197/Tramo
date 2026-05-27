import { useCallback, useState } from 'react';
import {
  BUILTIN_REGISTRY,
  applyPatches,
  emptyDoc,
  newEdgeId,
  newNodeId,
  type Patch,
  type WorkflowDoc,
} from 'tramo-spec';
import { Canvas, RightRail, useWorkflow } from 'tramo/react';
import { BUILTIN_EXECUTOR_REGISTRY, run, type RunEvent } from 'tramo-runtime';
import { SAMPLE_DOC } from './sample.js';

const STORAGE_KEY = 'tramo:demo:doc';

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

  const workflow = useWorkflow({
    registry: BUILTIN_REGISTRY,
    loadDoc: loadInitialDoc,
    saveDoc: (doc) => localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)),
    key: resetCounter,
  });

  const runFlow = useCallback(async () => {
    if (!workflow.doc) return;
    setEvents([]);
    setRunning(true);
    try {
      await run(workflow.doc, BUILTIN_EXECUTOR_REGISTRY, {
        onEvent: (e) => setEvents((prev) => [...prev, e]),
      });
    } finally {
      setRunning(false);
    }
  }, [workflow.doc]);

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEvents([]);
    setResetCounter((n) => n + 1);
  }, []);

  const loadExample = useCallback(() => {
    workflow.setDoc(buildExampleDoc());
  }, [workflow]);

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
          <Canvas workflow={workflow} />
          {events.length > 0 ? <RunLog events={events} /> : null}
        </main>

        <RightRail
          selection={workflow.selection}
          registry={BUILTIN_REGISTRY}
          onApply={workflow.applyPatch}
          onClose={workflow.clearSelection}
          saveState={workflow.saveState}
        />
      </div>
    </div>
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
  const tId = newNodeId();
  const httpId = newNodeId();
  const pickId = newNodeId();
  const tplId = newNodeId();
  const logId = newNodeId();

  const seeded = applyPatches(emptyDoc(), [
    {
      kind: 'add-node',
      node: {
        id: tId,
        type: 'manual-trigger',
        config: { payload: '{"user":"juan"}' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: httpId,
        type: 'http-request',
        label: 'Fetch GitHub user {{user}}',
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
        id: pickId,
        type: 'js-transform',
        label: 'Pick name + public repos',
        config: { expression: 'return { name: input.data.name, repos: input.data.public_repos };' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: tplId,
        type: 'template',
        label: 'Render greeting for {{name}}',
        config: { template: '{{name}} has {{repos}} public repos.' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: logId,
        type: 'log',
        label: 'Print {{name}}',
        config: { level: 'info', prefix: 'github:' },
      },
    },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: tId,    target: httpId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: httpId, target: pickId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: pickId, target: tplId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: tplId,  target: logId } },
  ] satisfies Patch[]);

  return seeded.doc;
}
