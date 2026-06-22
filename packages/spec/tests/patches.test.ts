import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  applyPatches,
  emptyDoc,
  newEdgeId,
  newNodeId,
  type WorkflowDoc,
  type WorkflowNode,
} from '../src/index.js';

function n(id: string, type = 'log'): WorkflowNode {
  return { id, type, config: {} };
}

describe('applyPatch', () => {
  it('set-full-doc replaces the entire doc', () => {
    const doc = emptyDoc();
    const replacement: WorkflowDoc = {
      version: 1,
      nodes: [n('n1')],
      edges: [],
      meta: { name: 'replaced' },
    };
    const r = applyPatch(doc, { kind: 'set-full-doc', doc: replacement });
    expect(r.ok).toBe(true);
    expect(r.doc.nodes).toHaveLength(1);
    expect(r.doc.meta.name).toBe('replaced');
  });

  it('add-node appends and rejects duplicates', () => {
    let r = applyPatch(emptyDoc(), { kind: 'add-node', node: n('n1') });
    expect(r.ok).toBe(true);
    expect(r.doc.nodes).toHaveLength(1);

    r = applyPatch(r.doc, { kind: 'add-node', node: n('n1') });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already exists/);
  });

  it('update-node-config merges by default and replaces with replace=true', () => {
    const initial = applyPatch(emptyDoc(), {
      kind: 'add-node',
      node: { id: 'n1', type: 'log', config: { a: 1, b: 2 } },
    });
    const merged = applyPatch(initial.doc, {
      kind: 'update-node-config',
      id: 'n1',
      config: { b: 9, c: 3 },
    });
    expect(merged.doc.nodes[0]!.config).toEqual({ a: 1, b: 9, c: 3 });

    const replaced = applyPatch(initial.doc, {
      kind: 'update-node-config',
      id: 'n1',
      config: { only: true },
      replace: true,
    });
    expect(replaced.doc.nodes[0]!.config).toEqual({ only: true });
  });

  it('remove-node cascades and drops connected edges', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: n('n1') },
      { kind: 'add-node', node: n('n2') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'n1', target: 'n2' } },
    ]).doc;

    const removed = applyPatch(doc, { kind: 'remove-node', id: 'n1' });
    expect(removed.doc.nodes).toHaveLength(1);
    expect(removed.doc.nodes[0]!.id).toBe('n2');
    expect(removed.doc.edges).toHaveLength(0);
  });

  it('add-edge rejects self-loops, unknown endpoints, and duplicates', () => {
    const seeded = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: n('n1') },
      { kind: 'add-node', node: n('n2') },
    ]).doc;

    expect(
      applyPatch(seeded, { kind: 'add-edge', edge: { id: 'e1', source: 'n1', target: 'n1' } })
        .error,
    ).toMatch(/self-loop/i);
    expect(
      applyPatch(seeded, { kind: 'add-edge', edge: { id: 'e1', source: 'n1', target: 'nope' } })
        .error,
    ).toMatch(/target not found/i);
    expect(
      applyPatch(seeded, { kind: 'add-edge', edge: { id: 'e1', source: 'nope', target: 'n2' } })
        .error,
    ).toMatch(/source not found/i);

    const withEdge = applyPatch(seeded, {
      kind: 'add-edge',
      edge: { id: 'e1', source: 'n1', target: 'n2' },
    });
    expect(withEdge.ok).toBe(true);
    const dup = applyPatch(withEdge.doc, {
      kind: 'add-edge',
      edge: { id: 'e1', source: 'n1', target: 'n2' },
    });
    expect(dup.ok).toBe(false);
  });

  it('remove-edge removes by id', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: n('n1') },
      { kind: 'add-node', node: n('n2') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'n1', target: 'n2' } },
    ]).doc;
    const r = applyPatch(doc, { kind: 'remove-edge', id: 'e1' });
    expect(r.doc.edges).toHaveLength(0);
  });

  it('does not mutate the input doc', () => {
    const original = applyPatch(emptyDoc(), { kind: 'add-node', node: n('n1') }).doc;
    const before = JSON.parse(JSON.stringify(original));
    applyPatch(original, {
      kind: 'update-node-config',
      id: 'n1',
      config: { changed: true },
    });
    expect(original).toEqual(before);
  });
});

describe('id helpers', () => {
  it('generates distinct node and edge ids', () => {
    const a = new Set(Array.from({ length: 50 }, () => newNodeId()));
    expect(a.size).toBe(50);
    const e = new Set(Array.from({ length: 50 }, () => newEdgeId()));
    expect(e.size).toBe(50);
    expect(Array.from(a)[0]!.startsWith('n_')).toBe(true);
    expect(Array.from(e)[0]!.startsWith('e_')).toBe(true);
  });
});
