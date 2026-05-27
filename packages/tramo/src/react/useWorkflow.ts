/**
 * useWorkflow — the htmlstudio `useVisualEdit` equivalent for tramo.
 *
 * Owns the WorkflowDoc state, tracks the currently-selected node, and
 * persists changes (debounced) to a host-provided saveDoc callback. The
 * canvas engine reads `doc` directly and computes layout from it; this
 * hook deliberately does NOT shape the data for any canvas library.
 *
 *   1. loadDoc()          → initial doc (sync or async).
 *   2. saveDoc(doc)       → called debounced after every patch (optional).
 *   3. applyPatch(patch)  → only mutation entry point (humans and agents
 *                           call this through the same channel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyPatch, emptyDoc } from '../patches.js';
import type {
  Patch,
  WorkflowDoc,
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
  /** Node registry — exposed so callers can look up definitions for the
   *  currently-selected node without a second prop. */
  registry: NodeRegistry;
  /** When false, the hook is a no-op (doc stays null). */
  enabled?: boolean;
  /** Change this to force a reload. */
  key?: string | number | null;
  /** Debounce ms before saveDoc fires. Default 600. */
  saveDebounceMs?: number;
}

export interface WorkflowHandle {
  doc: WorkflowDoc | null;

  /** Currently-selected node (single selection, like htmlstudio). */
  selection: WorkflowNode | null;
  selectedId: string | null;
  setSelection: (id: string | null) => void;
  clearSelection: () => void;

  /** Programmatic single-patch entry point. */
  applyPatch: (patch: Patch) => void;
  /** Replace the entire doc. */
  setDoc: (doc: WorkflowDoc) => void;

  registry: NodeRegistry;
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
        setDocState(d ?? emptyDoc());
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
      // If we just removed the selected node, drop the selection.
      if (patch.kind === 'remove-node') {
        setSelectedId((s) => (s === patch.id ? null : s));
      }
    },
    [scheduleSave],
  );

  const setDoc = useCallback(
    (next: WorkflowDoc) => {
      applyPatchInternal({ kind: 'set-full-doc', doc: next });
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
    selection,
    selectedId,
    setSelection,
    clearSelection,
    applyPatch: applyPatchInternal,
    setDoc,
    registry,
    ready,
    saveState,
  };
}
