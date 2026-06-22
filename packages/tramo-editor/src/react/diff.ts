/**
 * Structural diff between two WorkflowDocs. Used to review changes — most
 * importantly when an LLM agent edits the doc through apply_patch and the
 * user wants to see exactly what moved before accepting. Pure + testable.
 */

import type { WorkflowDoc, WorkflowNode } from '@tramo/spec';

export interface FieldChange {
  key: string;
  before: unknown;
  after: unknown;
}

export interface NodeChange {
  id: string;
  type: string;
  label?: string;
  /** Changed config keys (added/removed/modified). */
  fields: FieldChange[];
  /** Non-config node props that changed (label, runAfter, retry, …). */
  props: FieldChange[];
}

export interface EdgeChange {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowDiff {
  addedNodes: WorkflowNode[];
  removedNodes: WorkflowNode[];
  changedNodes: NodeChange[];
  addedEdges: EdgeChange[];
  removedEdges: EdgeChange[];
  metaChanged: FieldChange[];
  /** True when the docs are structurally identical. */
  identical: boolean;
}

const NODE_PROP_KEYS: Array<keyof WorkflowNode> = ['label', 'runAfter', 'retry', 'sensitive', 'requiredRole'];

export function diffWorkflows(prev: WorkflowDoc, next: WorkflowDoc): WorkflowDiff {
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const nextNodes = new Map(next.nodes.map((n) => [n.id, n]));

  const addedNodes: WorkflowNode[] = [];
  const removedNodes: WorkflowNode[] = [];
  const changedNodes: NodeChange[] = [];

  for (const n of next.nodes) if (!prevNodes.has(n.id)) addedNodes.push(n);
  for (const n of prev.nodes) if (!nextNodes.has(n.id)) removedNodes.push(n);

  for (const n of next.nodes) {
    const before = prevNodes.get(n.id);
    if (!before) continue;
    const fields = diffRecords(before.config ?? {}, n.config ?? {});
    const props: FieldChange[] = [];
    for (const key of NODE_PROP_KEYS) {
      if (!deepEqual(before[key], n[key])) {
        props.push({ key: String(key), before: before[key], after: n[key] });
      }
    }
    if (fields.length > 0 || props.length > 0) {
      changedNodes.push({ id: n.id, type: n.type, label: n.label, fields, props });
    }
  }

  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));
  const nextEdges = new Map(next.edges.map((e) => [e.id, e]));
  const addedEdges: EdgeChange[] = [];
  const removedEdges: EdgeChange[] = [];
  for (const e of next.edges) if (!prevEdges.has(e.id)) addedEdges.push(e);
  for (const e of prev.edges) if (!nextEdges.has(e.id)) removedEdges.push(e);

  const metaChanged = diffRecords(
    prev.meta as Record<string, unknown>,
    next.meta as Record<string, unknown>,
  );

  const identical =
    addedNodes.length === 0 &&
    removedNodes.length === 0 &&
    changedNodes.length === 0 &&
    addedEdges.length === 0 &&
    removedEdges.length === 0 &&
    metaChanged.length === 0;

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, metaChanged, identical };
}

/** One-line human summary, e.g. "+2 nodes, −1 edge, 3 changed". */
export function summarizeDiff(diff: WorkflowDiff): string {
  if (diff.identical) return 'No changes';
  const bits: string[] = [];
  if (diff.addedNodes.length) bits.push(`+${diff.addedNodes.length} node${plural(diff.addedNodes.length)}`);
  if (diff.removedNodes.length) bits.push(`−${diff.removedNodes.length} node${plural(diff.removedNodes.length)}`);
  if (diff.changedNodes.length) bits.push(`${diff.changedNodes.length} changed`);
  if (diff.addedEdges.length) bits.push(`+${diff.addedEdges.length} edge${plural(diff.addedEdges.length)}`);
  if (diff.removedEdges.length) bits.push(`−${diff.removedEdges.length} edge${plural(diff.removedEdges.length)}`);
  if (diff.metaChanged.length) bits.push('meta');
  return bits.join(', ');
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

function diffRecords(a: Record<string, unknown>, b: Record<string, unknown>): FieldChange[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: FieldChange[] = [];
  for (const key of keys) {
    if (!deepEqual(a?.[key], b?.[key])) out.push({ key, before: a?.[key], after: b?.[key] });
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
