import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from 'tramo-spec';
import { layoutWorkflow } from '../src/react/layout.js';

function node(id: string, type = 'log', config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

const NODE_WIDTH = 240;
const COLUMN_GAP = 40;
const SLOT = NODE_WIDTH + COLUMN_GAP; // 280

describe('layoutWorkflow', () => {
  it('places a single chain along x=0', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('a') },
      { kind: 'add-node', node: node('b') },
      { kind: 'add-node', node: node('c') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'a', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'b', target: 'c' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    expect(r.positions.get('a')?.x).toBe(0);
    expect(r.positions.get('b')?.x).toBe(0);
    expect(r.positions.get('c')?.x).toBe(0);
    expect(r.positions.get('a')?.row).toBe(0);
    expect(r.positions.get('b')?.row).toBe(1);
    expect(r.positions.get('c')?.row).toBe(2);
  });

  it('centres two siblings around their shared parent', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('p') },
      { kind: 'add-node', node: node('a') },
      { kind: 'add-node', node: node('b') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'p', target: 'a' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'p', target: 'b' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    expect(r.positions.get('p')?.x).toBe(0);
    expect(r.positions.get('a')?.x).toBe(-SLOT / 2);
    expect(r.positions.get('b')?.x).toBe(SLOT / 2);
  });

  it('fans 3 siblings to -SW, 0, +SW under their parent', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('p') },
      { kind: 'add-node', node: node('a') },
      { kind: 'add-node', node: node('b') },
      { kind: 'add-node', node: node('c') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'p', target: 'a' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'p', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'p', target: 'c' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    expect(r.positions.get('p')?.x).toBe(0);
    const xs = ['a', 'b', 'c'].map((id) => r.positions.get(id)!.x).sort((x, y) => x - y);
    expect(xs).toEqual([-SLOT, 0, SLOT]);
  });

  it('keeps an inserted node\'s child aligned under the inserted node (regression)', () => {
    // Reproduces the bug: a parent P with two children N and C; N has its
    // own child B. With per-row recentering, B used to snap back to x=0
    // even though N was offset to one side. Absolute-x must keep B under N.
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('p') },
      { kind: 'add-node', node: node('n') }, // "newly inserted" node
      { kind: 'add-node', node: node('c') }, // sibling that pushed N off centre
      { kind: 'add-node', node: node('b') }, // N's child
      { kind: 'add-edge', edge: { id: 'e1', source: 'p', target: 'n' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'p', target: 'c' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'n', target: 'b' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    const nx = r.positions.get('n')!.x;
    const bx = r.positions.get('b')!.x;
    expect(bx).toBe(nx); // <-- the bug: bx used to be 0 while nx was -SLOT/2
  });

  it('fan-in node sits at the midpoint of its parents', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('p') },
      { kind: 'add-node', node: node('a') },
      { kind: 'add-node', node: node('b') },
      { kind: 'add-node', node: node('join') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'p', target: 'a' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'p', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'a', target: 'join' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'b', target: 'join' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    const ax = r.positions.get('a')!.x;
    const bx = r.positions.get('b')!.x;
    expect(r.positions.get('join')!.x).toBeCloseTo((ax + bx) / 2, 6);
  });

  it('pulls a fan-in source down to sit one row above the join (no L-bend)', () => {
    // Mirrors the screenshot:
    //   T → http → pick → set → render
    //   T → print → set
    // ASAP alone would put `print` at row 1 while `set` is at row 3,
    // producing a 2-row vertical descent then a horizontal hop into set.
    // The hybrid pull-down should drop `print` to row 2 (adjacent to set).
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t') },
      { kind: 'add-node', node: node('http') },
      { kind: 'add-node', node: node('pick') },
      { kind: 'add-node', node: node('set') },
      { kind: 'add-node', node: node('render') },
      { kind: 'add-node', node: node('print') },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'http' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'http', target: 'pick' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'pick', target: 'set' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'set', target: 'render' } },
      { kind: 'add-edge', edge: { id: 'e5', source: 't', target: 'print' } },
      { kind: 'add-edge', edge: { id: 'e6', source: 'print', target: 'set' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    expect(r.positions.get('t')?.row).toBe(0);
    expect(r.positions.get('http')?.row).toBe(1);
    expect(r.positions.get('pick')?.row).toBe(2);
    expect(r.positions.get('print')?.row).toBe(2); // <-- the key fix
    expect(r.positions.get('set')?.row).toBe(3);
    expect(r.positions.get('render')?.row).toBe(4);
  });

  it('leaves without children stay near their producer (not dragged to the bottom)', () => {
    // Pure ALAP would push `leaf` all the way to row 4 (alongside render)
    // even though `leaf` only depends on T. Hybrid keeps it at row 1.
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t') },
      { kind: 'add-node', node: node('a') },
      { kind: 'add-node', node: node('b') },
      { kind: 'add-node', node: node('c') },
      { kind: 'add-node', node: node('d') },
      { kind: 'add-node', node: node('leaf') },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'a' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'a', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'b', target: 'c' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'c', target: 'd' } },
      { kind: 'add-edge', edge: { id: 'e5', source: 't', target: 'leaf' } },
    ]).doc;
    const r = layoutWorkflow(doc);
    expect(r.positions.get('leaf')?.row).toBe(1);
  });

  it('multiple roots distribute around 0', () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('a') },
      { kind: 'add-node', node: node('b') },
    ]).doc;
    const r = layoutWorkflow(doc);
    expect(r.positions.get('a')?.x).toBe(-SLOT / 2);
    expect(r.positions.get('b')?.x).toBe(SLOT / 2);
  });
});
