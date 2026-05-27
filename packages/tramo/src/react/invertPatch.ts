/**
 * invertPatch — given the doc *before* a Patch is applied, return the
 * Patch(es) that would reverse it. Used by useWorkflow to build the
 * undo/redo history stack.
 *
 * A single user patch may invert into multiple patches: `remove-node`
 * cascades into edge removal, so its inverse is "re-add the node plus
 * every removed edge."
 */

import type { Patch, WorkflowDoc } from 'tramo-spec';

export function invertPatch(prevDoc: WorkflowDoc, patch: Patch): Patch[] {
  switch (patch.kind) {
    case 'add-node':
      return [{ kind: 'remove-node', id: patch.node.id }];

    case 'remove-node': {
      const node = prevDoc.nodes.find((n) => n.id === patch.id);
      if (!node) return [];
      const touched = prevDoc.edges.filter(
        (e) => e.source === patch.id || e.target === patch.id,
      );
      const out: Patch[] = [{ kind: 'add-node', node: { ...node, config: { ...node.config } } }];
      for (const e of touched) out.push({ kind: 'add-edge', edge: { ...e } });
      return out;
    }

    case 'add-edge':
      return [{ kind: 'remove-edge', id: patch.edge.id }];

    case 'remove-edge': {
      const edge = prevDoc.edges.find((e) => e.id === patch.id);
      if (!edge) return [];
      return [{ kind: 'add-edge', edge: { ...edge } }];
    }

    case 'update-node-config': {
      const node = prevDoc.nodes.find((n) => n.id === patch.id);
      if (!node) return [];
      return [
        {
          kind: 'update-node-config',
          id: patch.id,
          config: { ...node.config },
          replace: true,
        },
      ];
    }

    case 'update-node': {
      const node = prevDoc.nodes.find((n) => n.id === patch.id);
      if (!node) return [];
      const inverse: Patch = {
        kind: 'update-node',
        id: patch.id,
        patch: {},
      };
      if ('label' in patch.patch) inverse.patch.label = node.label;
      if ('runAfter' in patch.patch) inverse.patch.runAfter = node.runAfter;
      return [inverse];
    }

    case 'set-full-doc':
      return [{ kind: 'set-full-doc', doc: cloneDoc(prevDoc) }];
  }
}

function cloneDoc(doc: WorkflowDoc): WorkflowDoc {
  return {
    version: doc.version,
    nodes: doc.nodes.map((n) => ({ ...n, config: { ...n.config } })),
    edges: doc.edges.map((e) => ({ ...e })),
    meta: { ...doc.meta, tags: doc.meta.tags ? [...doc.meta.tags] : undefined },
  };
}
