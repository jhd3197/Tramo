import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from 'tramo-spec';
import { BUILTIN_EXECUTOR_REGISTRY, run } from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

describe('run()', () => {
  it('runs a manual → js-transform → log chain and pipes data along', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":2}' }) },
      { kind: 'add-node', node: node('m', 'js-transform', { expression: 'return { y: input.x * 21 };' }) },
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'm' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'm', target: 'l' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.l).toEqual({ out: { y: 42 } });
  });

  it('routes through the "true" port of an `if` node and skips the false branch', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"go":true}' }) },
      { kind: 'add-node', node: node('cond', 'if', { condition: 'input.go === true' }) },
      { kind: 'add-node', node: node('yes', 'log', { prefix: 'YES' }) },
      { kind: 'add-node', node: node('no', 'log', { prefix: 'NO' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'cond' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'cond', target: 'yes', sourceHandle: 'yes' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'cond', target: 'no', sourceHandle: 'no' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.yes).toBeDefined();
    expect(result.nodeResults.no).toBeUndefined();

    // The "no" branch must be skipped, not errored.
    const skip = result.events.find((e) => e.type === 'node-skip' && e.nodeId === 'no');
    expect(skip).toBeDefined();
  });

  it('accepts a legacy function-body condition (pre-0.2 back-compat)', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"go":true}' }) },
      { kind: 'add-node', node: node('cond', 'if', { condition: 'return input.go === true;' }) },
      { kind: 'add-node', node: node('yes', 'log', { prefix: 'YES' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'cond' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'cond', target: 'yes', sourceHandle: 'yes' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.yes).toBeDefined();
  });

  it('evaluates a rule tree (AND of two conditions) on the if node', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"age":21,"country":"US"}' }) },
      {
        kind: 'add-node',
        node: node('cond', 'if', {
          rules: {
            kind: 'group',
            combinator: 'and',
            rules: [
              { kind: 'condition', left: 'input.age', op: '>=', right: 18 },
              { kind: 'condition', left: 'input.country', op: 'in', right: ['US', 'CA'] },
            ],
          },
        }),
      },
      { kind: 'add-node', node: node('yes', 'log', { prefix: 'YES' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'cond' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'cond', target: 'yes', sourceHandle: 'yes' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.yes).toBeDefined();
  });

  it('rule tree: OR group, regex match, and per-row negation', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"email":"x@y.org","plan":"free"}' }) },
      {
        kind: 'add-node',
        node: node('cond', 'if', {
          rules: {
            kind: 'group',
            combinator: 'and',
            rules: [
              { kind: 'condition', left: 'input.email', op: 'matches', right: '@y\\.(com|org)$' },
              { kind: 'condition', left: 'input.plan', op: '=', right: 'pro', not: true },
            ],
          },
        }),
      },
      { kind: 'add-node', node: node('yes', 'log', { prefix: 'YES' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'cond' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'cond', target: 'yes', sourceHandle: 'yes' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.yes).toBeDefined();
  });

  it('emits node-error and continues for downstream skips when a node throws', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('boom', 'js-transform', { expression: 'throw new Error("nope");' }) },
      { kind: 'add-node', node: node('after', 'log') },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'boom' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'boom', target: 'after' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true); // run finished, but a node failed
    const err = result.events.find((e) => e.type === 'node-error' && e.nodeId === 'boom');
    expect(err).toBeDefined();
    const skip = result.events.find((e) => e.type === 'node-skip' && e.nodeId === 'after');
    expect(skip).toBeDefined();
  });

  it('rejects cycles before running anything', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('a', 'log') },
      { kind: 'add-node', node: node('b', 'log') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'a', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'b', target: 'a' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cycle/i);
  });

  it('uses options.trigger as the root node input', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('echo', 'js-transform', { expression: 'return input;' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'echo' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY, { trigger: { hello: 'world' } });
    expect(result.nodeResults.echo).toEqual({ out: { hello: 'world' } });
  });

  it('template node interpolates {{path.to.value}}', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"user":{"name":"Juan"}}' }) },
      { kind: 'add-node', node: node('tpl', 'template', { template: 'Hi {{user.name}}!' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'tpl' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.nodeResults.tpl).toEqual({ out: 'Hi Juan!' });
  });
});
