/**
 * useWorkflow — the htmlstudio `useVisualEdit` equivalent for tramo.
 *
 * Holds the WorkflowDoc state, exposes XYFlow-ready `nodes` / `edges`
 * derived from it, and provides handlers that translate XYFlow callbacks
 * (drag, connect, delete) into typed Patches applied to the doc.
 *
 *   1. loadDoc()          → initial doc (sync or async).
 *   2. saveDoc(doc)       → called debounced after every patch (optional).
 *   3. visual handlers    → translate XYFlow events into patches.
 *   4. applyPatch(patch)  → direct programmatic mutation (also used by the agent layer).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Connection,
  Edge as XYEdge,
  EdgeChange,
  Node as XYNode,
  NodeChange,
} from '@xyflow/react';
import { applyPatch, emptyDoc } from '../patches.js';
import { newEdgeId } from '../ids.js';
import type {
  NodeDefinition,
  Patch,
  WorkflowDoc,
  WorkflowEdge,
  WorkflowNode,
} from '../types.js';
import type { NodeRegistry } from '../nodes.js';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface SaveState {
  status: SaveStatus;
  error: string | null;
  savedAt?: number;
}

export interface UseWorkflowOptions {
  /** Returns the initial doc. Called once per `key` change. */
  loadDoc: () => Promise<WorkflowDoc> | WorkflowDoc;
  /** Persist the doc. Called after a debounce on every patch. */
  saveDoc?: (doc: WorkflowDoc) => Promise<void> | void;
  /** Node registry — used to look up display data for canvas rendering. */
  registry: NodeRegistry;
  /** When false, the hook is a no-op (doc stays null). */
  enabled?: boolean;
  /** Change this to force a reload. */
  key?: string | number | null;
  /** Debounce ms before saveDoc fires. Default 600. */
  saveDebounceMs?: number;
}

/**
 * The XYFlow node data attached to each rendered node. We keep the canonical
 * doc node here so custom node renderers can reach into it without a second
 * lookup.
 */
export interface TramoNodeData {
  /** Discriminator so XYFlow's data type checks pass. */
  [key: string]: unknown;
  node: WorkflowNode;
  definition: NodeDefinition | undefined;
}

export type TramoXYNode = XYNode<TramoNodeData, 'tramo'>;

export interface WorkflowHandle {
  doc: WorkflowDoc | null;
  /** XYFlow-shaped nodes derived from the doc. */
  nodes: TramoXYNode[];
  /** XYFlow-shaped edges derived from the doc. */
  edges: XYEdge[];

  /** Currently-selected node id (single selection, like htmlstudio). */
  selection: WorkflowNode | null;
  setSelection: (id: string | null) => void;
  clearSelection: () => void;

  /** Programmatic single-patch entry point. */
  applyPatch: (patch: Patch) => void;
  /** Replace the entire doc. */
  setDoc: (doc: WorkflowDoc) => void;

  /* XYFlow handlers — wire these directly to <ReactFlow /> props. */
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  ready: boolean;
  saveState: SaveState;
}

export function useWorkflow({
  loadDoc,
  saveDoc,
  registry,
  enabled = true,
  key = null,
  saveDebounceMs = 600,
}: UseWorkflowOptions): WorkflowHandle {
  const [doc, setDocState] = useState<WorkflowDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle', error: null });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- load ---------- */

  useEffect(() => {
    if (!enabled) {
      setDocState(null);
      setSelectedId(null);
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    Promise.resolve(loadDoc())
      .then((d) => {
        if (cancelled) return;
        setDocState(d);
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('useWorkflow: loadDoc failed', err);
        setReady(false);
      });
    return () => {
      cancelled = true;
    };
    // loadDoc deliberately omitted — change `key` to force reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  /* ---------- persist ---------- */

  const scheduleSave = useCallback(
    (next: WorkflowDoc) => {
      if (!saveDoc) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState({ status: 'pending', error: null });
      saveTimer.current = setTimeout(async () => {
        setSaveState({ status: 'saving', error: null });
        try {
          await saveDoc(next);
          setSaveState({ status: 'saved', error: null, savedAt: Date.now() });
        } catch (err) {
          setSaveState({ status: 'error', error: (err as Error).message });
        }
      }, saveDebounceMs);
    },
    [saveDoc, saveDebounceMs],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /* ---------- patch entry point ---------- */

  const applyPatchInternal = useCallback(
    (patch: Patch) => {
      setDocState((current) => {
        if (!current) return current;
        const r = applyPatch(current, patch);
        if (!r.ok) {
          console.warn('tramo patch failed:', r.error, patch);
          return current;
        }
        scheduleSave(r.doc);
        return r.doc;
      });
    },
    [scheduleSave],
  );

  const setDoc = useCallback(
    (next: WorkflowDoc) => {
      applyPatchInternal({ kind: 'set-full-doc', doc: next });
    },
    [applyPatchInternal],
  );

  /* ---------- XYFlow-shaped derivations ---------- */

  const xyNodes = useMemo<TramoXYNode[]>(() => {
    if (!doc) return [];
    return doc.nodes.map((n) => ({
      id: n.id,
      type: 'tramo',
      position: n.position,
      data: { node: n, definition: registry.get(n.type) },
      selected: n.id === selectedId,
    }));
  }, [doc, selectedId, registry]);

  const xyEdges = useMemo<XYEdge[]>(() => {
    if (!doc) return [];
    return doc.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      type: 'default',
    }));
  }, [doc]);

  /* ---------- XYFlow callbacks → patches ---------- */

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          applyPatchInternal({
            kind: 'move-node',
            id: change.id,
            position: change.position,
          });
        } else if (change.type === 'remove') {
          applyPatchInternal({ kind: 'remove-node', id: change.id });
          setSelectedId((s) => (s === change.id ? null : s));
        } else if (change.type === 'select') {
          setSelectedId(change.selected ? change.id : null);
        }
      }
    },
    [applyPatchInternal],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          applyPatchInternal({ kind: 'remove-edge', id: change.id });
        }
      }
    },
    [applyPatchInternal],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const edge: WorkflowEdge = {
        id: newEdgeId(),
        source: connection.source,
        target: connection.target,
        ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
        ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
      };
      applyPatchInternal({ kind: 'add-edge', edge });
    },
    [applyPatchInternal],
  );

  /* ---------- selection ---------- */

  const setSelection = useCallback((id: string | null) => setSelectedId(id), []);
  const clearSelection = useCallback(() => setSelectedId(null), []);

  const selection = useMemo<WorkflowNode | null>(() => {
    if (!doc || !selectedId) return null;
    return doc.nodes.find((n) => n.id === selectedId) ?? null;
  }, [doc, selectedId]);

  return {
    doc,
    nodes: xyNodes,
    edges: xyEdges,
    selection,
    setSelection,
    clearSelection,
    applyPatch: applyPatchInternal,
    setDoc,
    onNodesChange,
    onEdgesChange,
    onConnect,
    ready,
    saveState,
  };
}
