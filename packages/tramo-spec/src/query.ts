import type { WorkflowDoc, WorkflowEdge, WorkflowNode } from './types.js';

/**
 * Read-only structural queries over a WorkflowDoc.
 *
 * Same role as htmlstudio/query: lookups and traversals for inspection
 * and runtime planning. Nothing here mutates.
 */

export function findNodeById(doc: WorkflowDoc, id: string): WorkflowNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

export function findEdgeById(doc: WorkflowDoc, id: string): WorkflowEdge | undefined {
  return doc.edges.find((e) => e.id === id);
}

/** Edges leaving `nodeId` (i.e. `nodeId` is the source). */
export function getOutgoingEdges(doc: WorkflowDoc, nodeId: string): WorkflowEdge[] {
  return doc.edges.filter((e) => e.source === nodeId);
}

/** Edges entering `nodeId` (i.e. `nodeId` is the target). */
export function getIncomingEdges(doc: WorkflowDoc, nodeId: string): WorkflowEdge[] {
  return doc.edges.filter((e) => e.target === nodeId);
}

/** Immediate downstream nodes (one hop along outgoing edges). */
export function getDownstream(doc: WorkflowDoc, nodeId: string): WorkflowNode[] {
  const targets = new Set(getOutgoingEdges(doc, nodeId).map((e) => e.target));
  return doc.nodes.filter((n) => targets.has(n.id));
}

/** Immediate upstream nodes (one hop along incoming edges). */
export function getUpstream(doc: WorkflowDoc, nodeId: string): WorkflowNode[] {
  const sources = new Set(getIncomingEdges(doc, nodeId).map((e) => e.source));
  return doc.nodes.filter((n) => sources.has(n.id));
}

/** Nodes with no incoming edges — the workflow's entry points. */
export function getRoots(doc: WorkflowDoc): WorkflowNode[] {
  const hasIncoming = new Set(doc.edges.map((e) => e.target));
  return doc.nodes.filter((n) => !hasIncoming.has(n.id));
}

/** Nodes with no outgoing edges — the workflow's sinks. */
export function getLeaves(doc: WorkflowDoc): WorkflowNode[] {
  const hasOutgoing = new Set(doc.edges.map((e) => e.source));
  return doc.nodes.filter((n) => !hasOutgoing.has(n.id));
}

export interface TopoResult {
  ok: boolean;
  /** Node ids in execution order. Empty when `ok` is false. */
  order: string[];
  /** When `ok` is false, the node ids participating in a cycle. */
  cycle?: string[];
  error?: string;
}

/**
 * Kahn's algorithm topological sort. Returns the node ids in an order
 * such that every edge points from an earlier id to a later one.
 *
 * Used by tramo-runtime to schedule node execution.
 */
export function topoSort(doc: WorkflowDoc): TopoResult {
  const indegree = new Map<string, number>();
  for (const n of doc.nodes) indegree.set(n.id, 0);
  for (const e of doc.edges) {
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of doc.edges) {
      if (e.source !== id) continue;
      const next = (indegree.get(e.target) ?? 0) - 1;
      indegree.set(e.target, next);
      if (next === 0) queue.push(e.target);
    }
  }

  if (order.length !== doc.nodes.length) {
    const cycle = doc.nodes
      .map((n) => n.id)
      .filter((id) => (indegree.get(id) ?? 0) > 0);
    return {
      ok: false,
      order: [],
      cycle,
      error: `Cycle detected in workflow (${cycle.length} nodes participating).`,
    };
  }

  return { ok: true, order };
}
