import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, BUILTIN_REGISTRY, type WorkflowNode } from '@tramo/spec';
import { diffWorkflows, summarizeDiff } from '../src/react/diff.js';
import { extractReferences, findReferences, resolveReferenceTarget } from '../src/react/references.js';
import { workflowToSvg } from '../src/react/exportSvg.js';
import { createGroup, toggleGroup, hiddenNodeIds, groupForNode, setNodeGroup } from '../src/react/groups.js';
import { deriveRunState } from '../src/react/runStatus.js';

function node(id: string, type: string, config: Record<string, unknown> = {}, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, type, config, ...extra };
}

const base = applyPatches(emptyDoc(), [
  { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":1}' }) },
  { kind: 'add-node', node: node('m', 'js-transform', { expression: 'return input;' }, { label: 'Transformer' }) },
  { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'm' } },
]).doc;

describe('diffWorkflows', () => {
  it('detects added/removed/changed nodes and edges', () => {
    const next = applyPatches(base, [
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e2', source: 'm', target: 'l' } },
      { kind: 'update-node-config', id: 'm', config: { expression: 'return input.x;' } },
      { kind: 'remove-node', id: 't' },
    ]).doc;
    const diff = diffWorkflows(base, next);
    expect(diff.addedNodes.map((n) => n.id)).toContain('l');
    expect(diff.removedNodes.map((n) => n.id)).toContain('t');
    expect(diff.changedNodes.find((c) => c.id === 'm')).toBeDefined();
    expect(diff.addedEdges.map((e) => e.id)).toContain('e2');
    // e1 removed by cascade when t was removed.
    expect(diff.removedEdges.map((e) => e.id)).toContain('e1');
    expect(diff.identical).toBe(false);
    expect(summarizeDiff(diff)).toMatch(/node/);
  });

  it('reports identical docs', () => {
    const diff = diffWorkflows(base, base);
    expect(diff.identical).toBe(true);
    expect(summarizeDiff(diff)).toBe('No changes');
  });

  it('detects node prop changes (retry)', () => {
    const next = applyPatches(base, [
      { kind: 'update-node', id: 'm', patch: { retry: { count: 3, delayMs: 100 } } },
    ]).doc;
    const diff = diffWorkflows(base, next);
    const change = diff.changedNodes.find((c) => c.id === 'm');
    expect(change?.props.some((p) => p.key === 'retry')).toBe(true);
  });
});

describe('references / go-to-definition', () => {
  const doc = applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('a', 'manual-trigger', { payload: '{}' }, { label: 'Fetch User' }) },
    { kind: 'add-node', node: node('b', 'template', { template: 'Hi {{steps.fetch_user.name}} ({{vars.count}})' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 'a', target: 'b' } },
  ]).doc;

  it('extracts step and var references from a node', () => {
    const refs = extractReferences(doc, BUILTIN_REGISTRY, 'b');
    const step = refs.find((r) => r.kind === 'step');
    expect(step?.name).toBe('fetch_user');
    expect(step?.targetNodeId).toBe('a');
    expect(refs.some((r) => r.kind === 'var' && r.name === 'count')).toBe(true);
  });

  it('finds reverse references to a node', () => {
    const refs = findReferences(doc, BUILTIN_REGISTRY, 'a');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.nodeId).toBe('b');
  });

  it('resolves a token back to its source node', () => {
    expect(resolveReferenceTarget(doc, BUILTIN_REGISTRY, '{{steps.fetch_user.name}}')).toBe('a');
    expect(resolveReferenceTarget(doc, BUILTIN_REGISTRY, '{{vars.count}}')).toBeUndefined();
  });
});

describe('workflowToSvg', () => {
  it('produces an SVG containing node labels', () => {
    const svg = workflowToSvg(base, { registry: BUILTIN_REGISTRY });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('Transformer');
    // One <rect> per node card + stripe + background.
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('handles an empty doc', () => {
    const svg = workflowToSvg(emptyDoc(), { registry: BUILTIN_REGISTRY });
    expect(svg).toContain('<svg');
  });
});

describe('node groups', () => {
  it('creates a group and finds it for a member', () => {
    const doc = createGroup(base, ['t', 'm'], 'Ingest');
    const g = groupForNode(doc, 't');
    expect(g?.label).toBe('Ingest');
    expect(g?.nodeIds).toEqual(['t', 'm']);
  });

  it('collapse hides all but the first member', () => {
    let doc = createGroup(base, ['t', 'm'], 'Ingest');
    const id = doc.meta.groups![0]!.id;
    doc = toggleGroup(doc, id);
    const hidden = hiddenNodeIds(doc);
    expect(hidden.has('m')).toBe(true);
    expect(hidden.has('t')).toBe(false);
  });

  it('moving a node out of a group prunes empty groups', () => {
    let doc = createGroup(base, ['t'], 'Solo');
    const id = doc.meta.groups![0]!.id;
    doc = setNodeGroup(doc, 't', null);
    expect(doc.meta.groups).toBeUndefined();
    void id;
  });
});

describe('deriveRunState', () => {
  it('builds per-node status and tracks the active node', () => {
    const state = deriveRunState([
      { type: 'run-start', nodeOrder: ['t', 'm'] },
      { type: 'node-start', nodeId: 't' },
      { type: 'node-success', nodeId: 't', output: { out: 1 }, durationMs: 5 },
      { type: 'node-start', nodeId: 'm' },
    ]);
    expect(state.statuses.t).toEqual({ status: 'success', output: { out: 1 }, durationMs: 5 });
    expect(state.statuses.m).toEqual({ status: 'running' });
    expect(state.activeNodeId).toBe('m');
    expect(state.done.has('t')).toBe(true);
  });

  it('accumulates streaming chunks', () => {
    const state = deriveRunState([
      { type: 'node-chunk', nodeId: 'ai', chunk: 'Hello ' },
      { type: 'node-chunk', nodeId: 'ai', chunk: 'world' },
      { type: 'run-end' },
    ]);
    expect(state.streams.ai).toBe('Hello world');
    expect(state.activeNodeId).toBeNull();
  });
});
