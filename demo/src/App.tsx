import { useCallback, useMemo, useState, type DragEvent } from 'react';
import {
  BUILTIN_NODES,
  BUILTIN_REGISTRY,
  applyPatches,
  emptyDoc,
  newEdgeId,
  newNodeId,
  type NodeDefinition,
  type Patch,
  type WorkflowDoc,
} from 'tramo';
import {
  NodesPanel,
  RightRail,
  WorkflowCanvas,
  useWorkflow,
  DRAG_MIME,
} from 'tramo/react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
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
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const [resetCounter, setResetCounter] = useState(0);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [running, setRunning] = useState(false);

  const workflow = useWorkflow({
    registry: BUILTIN_REGISTRY,
    loadDoc: loadInitialDoc,
    saveDoc: (doc) => localStorage.setItem(STORAGE_KEY, JSON.stringify(doc)),
    key: resetCounter,
  });

  const rf = useReactFlow();

  /* ---------- palette → canvas drag/drop ---------- */

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      let payload: { tramoNodeType?: string } = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!payload.tramoNodeType) return;
      const def = BUILTIN_NODES.find((d) => d.id === payload.tramoNodeType);
      if (!def) return;
      const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      insertNode(def, position);
    },
    [rf],
  );

  const insertNode = useCallback(
    (def: NodeDefinition, position: { x: number; y: number }) => {
      const config: Record<string, unknown> = {};
      for (const f of def.fields) {
        if (f.default !== undefined) config[f.key] = f.default;
      }
      workflow.applyPatch({
        kind: 'add-node',
        node: {
          id: newNodeId(),
          type: def.id,
          position,
          config,
        },
      });
    },
    [workflow],
  );

  /* ---------- palette click → insert at viewport center ---------- */

  const onInsertFromPalette = useCallback(
    (def: NodeDefinition) => {
      const viewport = rf.getViewport();
      const { width, height } = rf.toObject() as unknown as { width?: number; height?: number };
      // Fallback if width/height aren't published (older XYFlow): use a fixed offset.
      const cx = ((width ?? 800) / 2 - viewport.x) / viewport.zoom;
      const cy = ((height ?? 500) / 2 - viewport.y) / viewport.zoom;
      insertNode(def, { x: cx, y: cy });
    },
    [insertNode, rf],
  );

  /* ---------- Run! ---------- */

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

  /* ---------- reset to sample ---------- */

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEvents([]);
    setResetCounter((n) => n + 1);
  }, []);

  /* ---------- bonus: load a non-trivial example ---------- */

  const loadExample = useCallback(() => {
    const example = buildExampleDoc();
    workflow.setDoc(example);
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
        <NodesPanel registry={BUILTIN_REGISTRY} onInsert={onInsertFromPalette} />

        <main className="demo-stage" onDragOver={onDragOver} onDrop={onDrop}>
          <WorkflowCanvas workflow={workflow} />
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
        position: { x: 0, y: 120 },
        config: { payload: '{"user":"juan"}' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: httpId,
        type: 'http-request',
        position: { x: 280, y: 120 },
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
        position: { x: 560, y: 120 },
        config: { expression: 'return { name: input.data.name, repos: input.data.public_repos };' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: tplId,
        type: 'template',
        position: { x: 840, y: 120 },
        config: { template: '{{name}} has {{repos}} public repos.' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: logId,
        type: 'log',
        position: { x: 1120, y: 120 },
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
