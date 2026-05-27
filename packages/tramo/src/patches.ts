import type { Patch, PatchResult, WorkflowDoc, WorkflowEdge, WorkflowNode } from './types.js';

/**
 * Apply one Patch to a WorkflowDoc. Pure — returns a new doc, never
 * mutates the input. Mirrors htmlstudio's `applyPatch` shape and contract.
 */
export function applyPatch(doc: WorkflowDoc, patch: Patch): PatchResult {
  switch (patch.kind) {
    case 'set-full-doc':
      return { ok: true, doc: cloneDoc(patch.doc) };

    case 'add-node': {
      if (findNode(doc, patch.node.id)) {
        return { ok: false, doc, error: `Node already exists: ${patch.node.id}` };
      }
      return {
        ok: true,
        doc: { ...doc, nodes: [...doc.nodes, cloneNode(patch.node)] },
      };
    }

    case 'update-node-config': {
      const node = findNode(doc, patch.id);
      if (!node) return { ok: false, doc, error: `Node not found: ${patch.id}` };
      const nextConfig = patch.replace
        ? { ...patch.config }
        : { ...node.config, ...patch.config };
      return {
        ok: true,
        doc: {
          ...doc,
          nodes: doc.nodes.map((n) =>
            n.id === patch.id ? { ...n, config: nextConfig } : n,
          ),
        },
      };
    }

    case 'move-node': {
      const node = findNode(doc, patch.id);
      if (!node) return { ok: false, doc, error: `Node not found: ${patch.id}` };
      return {
        ok: true,
        doc: {
          ...doc,
          nodes: doc.nodes.map((n) =>
            n.id === patch.id ? { ...n, position: { ...patch.position } } : n,
          ),
        },
      };
    }

    case 'remove-node': {
      const node = findNode(doc, patch.id);
      if (!node) return { ok: false, doc, error: `Node not found: ${patch.id}` };
      return {
        ok: true,
        doc: {
          ...doc,
          nodes: doc.nodes.filter((n) => n.id !== patch.id),
          // cascade: drop any edges touching this node
          edges: doc.edges.filter(
            (e) => e.source !== patch.id && e.target !== patch.id,
          ),
        },
      };
    }

    case 'add-edge': {
      if (findEdge(doc, patch.edge.id)) {
        return { ok: false, doc, error: `Edge already exists: ${patch.edge.id}` };
      }
      if (!findNode(doc, patch.edge.source)) {
        return { ok: false, doc, error: `Edge source not found: ${patch.edge.source}` };
      }
      if (!findNode(doc, patch.edge.target)) {
        return { ok: false, doc, error: `Edge target not found: ${patch.edge.target}` };
      }
      if (patch.edge.source === patch.edge.target) {
        return { ok: false, doc, error: 'Self-loops are not allowed.' };
      }
      return {
        ok: true,
        doc: { ...doc, edges: [...doc.edges, cloneEdge(patch.edge)] },
      };
    }

    case 'remove-edge': {
      const edge = findEdge(doc, patch.id);
      if (!edge) return { ok: false, doc, error: `Edge not found: ${patch.id}` };
      return {
        ok: true,
        doc: { ...doc, edges: doc.edges.filter((e) => e.id !== patch.id) },
      };
    }
  }
}

export function applyPatches(doc: WorkflowDoc, patches: Patch[]): PatchResult {
  let current = doc;
  for (const p of patches) {
    const r = applyPatch(current, p);
    if (!r.ok) return r;
    current = r.doc;
  }
  return { ok: true, doc: current };
}

export function emptyDoc(): WorkflowDoc {
  return { version: 1, nodes: [], edges: [], meta: {} };
}

/* ------------------------------ helpers ------------------------------ */

function findNode(doc: WorkflowDoc, id: string): WorkflowNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}

function findEdge(doc: WorkflowDoc, id: string): WorkflowEdge | undefined {
  return doc.edges.find((e) => e.id === id);
}

function cloneDoc(doc: WorkflowDoc): WorkflowDoc {
  return {
    version: doc.version,
    nodes: doc.nodes.map(cloneNode),
    edges: doc.edges.map(cloneEdge),
    meta: { ...doc.meta, tags: doc.meta.tags ? [...doc.meta.tags] : undefined },
  };
}

function cloneNode(n: WorkflowNode): WorkflowNode {
  return {
    id: n.id,
    type: n.type,
    position: { ...n.position },
    config: { ...n.config },
    ...(n.label !== undefined ? { label: n.label } : {}),
  };
}

function cloneEdge(e: WorkflowEdge): WorkflowEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
  };
}
