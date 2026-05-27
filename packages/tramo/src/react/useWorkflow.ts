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
import {
  applyPatch,
  applyPatches,
  emptyDoc,
  type NodeRegistry,
  type Patch,
  type WorkflowDoc,
  type WorkflowNode,
} from 'tramo-spec';
import { invertPatch } from './invertPatch.js';

/** One undo/redo frame. `forward` re-does, `inverse` undoes (applied in order). */
interface HistoryFrame {
  forward: Patch[];
  inverse: Patch[];
}

const HISTORY_LIMIT = 100;

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

  /** Undo the most recent applyPatch (no-op if history is empty). */
  undo: () => void;
  /** Redo the most recently undone change. */
  redo: () => void;
  /** Whether undo/redo can fire — useful for disabling toolbar buttons. */
  canUndo: boolean;
  canRedo: boolean;

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

  /* ---------- history ---------- */
  const undoStack = useRef<HistoryFrame[]>([]);
  const redoStack = useRef<HistoryFrame[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);
  const inHistoryReplay = useRef(false);

  /* ---------- load ---------- */

  useEffect(() => {
    if (!enabled) {
      setDocState(null);
      setSelectedId(null);
      setReady(false);
      undoStack.current = [];
      redoStack.current = [];
      bumpHistory();
      return;
    }
    let cancelled = false;
    setReady(false);
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
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
        if (!inHistoryReplay.current) {
          const inverse = invertPatch(current, patch);
          undoStack.current.push({ forward: [patch], inverse });
          if (undoStack.current.length > HISTORY_LIMIT) {
            undoStack.current.splice(0, undoStack.current.length - HISTORY_LIMIT);
          }
          redoStack.current = [];
          bumpHistory();
        }
        scheduleSave(r.doc);
        return r.doc;
      });
      // If we just removed the selected node, drop the selection.
      if (patch.kind === 'remove-node') {
        setSelectedId((s) => (s === patch.id ? null : s));
      }
    },
    [scheduleSave, bumpHistory],
  );

  const undo = useCallback(() => {
    const frame = undoStack.current.pop();
    if (!frame) return;
    setDocState((current) => {
      if (!current) return current;
      const r = applyPatches(current, frame.inverse);
      if (!r.ok) {
        console.warn('tramo undo failed:', r.error);
        return current;
      }
      scheduleSave(r.doc);
      return r.doc;
    });
    redoStack.current.push(frame);
    bumpHistory();
  }, [scheduleSave, bumpHistory]);

  const redo = useCallback(() => {
    const frame = redoStack.current.pop();
    if (!frame) return;
    setDocState((current) => {
      if (!current) return current;
      const r = applyPatches(current, frame.forward);
      if (!r.ok) {
        console.warn('tramo redo failed:', r.error);
        return current;
      }
      scheduleSave(r.doc);
      return r.doc;
    });
    undoStack.current.push(frame);
    bumpHistory();
  }, [scheduleSave, bumpHistory]);

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

  /* ---------- keyboard shortcuts (Cmd/Ctrl-Z, Cmd/Ctrl-Shift-Z) ---------- */

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      // Let native undo run inside editable surfaces.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }
      const wantsRedo = key === 'y' || (key === 'z' && e.shiftKey);
      e.preventDefault();
      if (wantsRedo) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, undo, redo]);

  // historyVersion is read so canUndo/canRedo trigger consumer rerenders.
  void historyVersion;

  return {
    doc,
    selection,
    selectedId,
    setSelection,
    clearSelection,
    applyPatch: applyPatchInternal,
    setDoc,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    registry,
    ready,
    saveState,
  };
}
