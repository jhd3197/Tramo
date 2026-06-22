/**
 * Node grouping — pure operations over `doc.meta.groups`. The editor calls
 * these and persists the result via a `set-full-doc` patch (groups live in
 * meta, so no new patch kind is needed). The runtime ignores groups entirely.
 *
 * A group is a named set of node ids that can be collapsed. `hiddenNodeIds`
 * tells the canvas which members to fold away when a group is collapsed.
 */

import type { NodeGroup, WorkflowDoc } from '@tramo/spec';

let counter = 0;
function newGroupId(): string {
  // Deterministic-ish, unique within a session.
  counter += 1;
  return `grp_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function listGroups(doc: WorkflowDoc): NodeGroup[] {
  return doc.meta.groups ?? [];
}

export function groupForNode(doc: WorkflowDoc, nodeId: string): NodeGroup | undefined {
  return listGroups(doc).find((g) => g.nodeIds.includes(nodeId));
}

function withGroups(doc: WorkflowDoc, groups: NodeGroup[]): WorkflowDoc {
  return { ...doc, meta: { ...doc.meta, groups: groups.length ? groups : undefined } };
}

/** Create a group from node ids. Members already in another group are moved. */
export function createGroup(doc: WorkflowDoc, nodeIds: string[], label = 'Group', color?: string): WorkflowDoc {
  const ids = nodeIds.filter((id) => doc.nodes.some((n) => n.id === id));
  if (ids.length === 0) return doc;
  const idSet = new Set(ids);
  const existing = listGroups(doc).map((g) => ({ ...g, nodeIds: g.nodeIds.filter((n) => !idSet.has(n)) }));
  const group: NodeGroup = { id: newGroupId(), label, nodeIds: ids, collapsed: false, ...(color ? { color } : {}) };
  return withGroups(doc, [...existing.filter((g) => g.nodeIds.length > 0), group]);
}

export function removeGroup(doc: WorkflowDoc, groupId: string): WorkflowDoc {
  return withGroups(doc, listGroups(doc).filter((g) => g.id !== groupId));
}

export function renameGroup(doc: WorkflowDoc, groupId: string, label: string): WorkflowDoc {
  return withGroups(doc, listGroups(doc).map((g) => (g.id === groupId ? { ...g, label } : g)));
}

export function setGroupCollapsed(doc: WorkflowDoc, groupId: string, collapsed: boolean): WorkflowDoc {
  return withGroups(doc, listGroups(doc).map((g) => (g.id === groupId ? { ...g, collapsed } : g)));
}

export function toggleGroup(doc: WorkflowDoc, groupId: string): WorkflowDoc {
  return withGroups(doc, listGroups(doc).map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));
}

/** Add/remove a node from a group. */
export function setNodeGroup(doc: WorkflowDoc, nodeId: string, groupId: string | null): WorkflowDoc {
  let groups = listGroups(doc).map((g) => ({ ...g, nodeIds: g.nodeIds.filter((n) => n !== nodeId) }));
  if (groupId) {
    groups = groups.map((g) => (g.id === groupId ? { ...g, nodeIds: [...g.nodeIds, nodeId] } : g));
  }
  return withGroups(doc, groups.filter((g) => g.nodeIds.length > 0));
}

/**
 * Node ids the canvas should hide because their collapsed group folds them
 * away. The first member of a collapsed group is kept as the placeholder
 * anchor so the group still occupies a slot.
 */
export function hiddenNodeIds(doc: WorkflowDoc): Set<string> {
  const hidden = new Set<string>();
  for (const g of listGroups(doc)) {
    if (!g.collapsed) continue;
    g.nodeIds.slice(1).forEach((id) => hidden.add(id));
  }
  return hidden;
}
