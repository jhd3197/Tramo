import { describe, expect, it } from 'vitest';
import {
  applyPatches,
  emptyDoc,
  getDownstream,
  getLeaves,
  getRoots,
  getUpstream,
  topoSort,
  type WorkflowNode,
} from '../src/index.js';

function n(id: string): WorkflowNode {
  return { id, type: 'log', config: {} };
}

function chain(ids: string[]) {
  return applyPatches(emptyDoc(), [
    ...ids.map((id) => ({ kind: 'add-node' as const, node: n(id) })),
    ...ids.slice(1).map((id, i) => ({
      kind: 'add-edge' as const,
      edge: { id: `e${i}`, source: ids[i]!, target: id },
    })),
  ]).doc;
}

describe('topoSort', () => {
  it('orders a simple chain', () => {
    const doc = chain(['a', 'b', 'c', 'd']);
    const r = topoSort(doc);
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(['a', 'b', 'c', 'd']);
  });

  it('detects cycles and reports participants', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: n('a') },
      { kind: 'add-node', node: n('b') },
      { kind: 'add-node', node: n('c') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'a', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'b', target: 'c' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'c', target: 'a' } },
    ]).doc;
    const r = topoSort(doc);
    expect(r.ok).toBe(false);
    expect(r.cycle).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('handles a diamond and respects dependencies', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: n('a') },
      { kind: 'add-node', node: n('b') },
      { kind: 'add-node', node: n('c') },
      { kind: 'add-node', node: n('d') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'a', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'a', target: 'c' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'b', target: 'd' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'c', target: 'd' } },
    ]).doc;
    const r = topoSort(doc);
    expect(r.ok).toBe(true);
    const idx = (id: string) => r.order.indexOf(id);
    expect(idx('a')).toBeLessThan(idx('b'));
    expect(idx('a')).toBeLessThan(idx('c'));
    expect(idx('b')).toBeLessThan(idx('d'));
    expect(idx('c')).toBeLessThan(idx('d'));
  });
});

describe('graph queries', () => {
  it('roots, leaves, downstream, upstream', () => {
    const doc = chain(['a', 'b', 'c']);
    expect(getRoots(doc).map((x) => x.id)).toEqual(['a']);
    expect(getLeaves(doc).map((x) => x.id)).toEqual(['c']);
    expect(getDownstream(doc, 'b').map((x) => x.id)).toEqual(['c']);
    expect(getUpstream(doc, 'b').map((x) => x.id)).toEqual(['a']);
  });
});
