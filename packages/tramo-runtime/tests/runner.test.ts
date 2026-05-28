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

  it('rule tree: rightIsExpr compares against a workflow var', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"score":42}' }) },
      { kind: 'add-node', node: node('seed', 'set-var', { name: 'threshold', value: '40' }) },
      {
        kind: 'add-node',
        node: node('cond', 'if', {
          rules: {
            kind: 'group',
            combinator: 'and',
            rules: [
              { kind: 'condition', left: 'input.score', op: '>', right: 'vars.threshold', rightIsExpr: true },
            ],
          },
        }),
      },
      { kind: 'add-node', node: node('yes', 'log', { prefix: 'YES' }) },
      { kind: 'add-edge', edge: { id: 'e0', source: 't', target: 'seed' } },
      { kind: 'add-edge', edge: { id: 'e1', source: 'seed', target: 'cond' } },
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

  it('set-var → increment-var → template reads {{vars.counter}}', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('set', 'set-var', { name: 'counter', value: '0' }) },
      { kind: 'add-node', node: node('inc1', 'increment-var', { name: 'counter', by: 1 }) },
      { kind: 'add-node', node: node('inc2', 'increment-var', { name: 'counter', by: 5 }) },
      { kind: 'add-node', node: node('tpl', 'template', { template: 'count={{vars.counter}}' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'set' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'set', target: 'inc1' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'inc1', target: 'inc2' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'inc2', target: 'tpl' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.tpl).toEqual({ out: 'count=6' });
  });

  it('append-var collects values from upstream into an array', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"name":"a"}' }) },
      { kind: 'add-node', node: node('a1', 'append-var', { name: 'items', value: '{{name}}' }) },
      { kind: 'add-node', node: node('a2', 'append-var', { name: 'items', value: 'b' }) },
      { kind: 'add-node', node: node('tpl', 'template', { template: '{{vars.items}}' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'a1' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'a1', target: 'a2' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'a2', target: 'tpl' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.tpl).toEqual({ out: '["a","b"]' });
  });

  it('js-transform can read and mutate vars', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('set', 'set-var', { name: 'n', value: '10' }) },
      {
        kind: 'add-node',
        node: node('js', 'js-transform', {
          expression: 'vars.n = vars.n * 2; return { doubled: vars.n };',
        }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'set' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'set', target: 'js' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.js).toEqual({ out: { doubled: 20 } });
  });

  it('for-each map mode collects body returns into an array', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":[1,2,3]}' }) },
      {
        kind: 'add-node',
        node: node('loop', 'for-each', {
          source: 'input.items',
          mode: 'map',
          body: 'return item * 10;',
        }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'loop' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.loop).toEqual({ out: [10, 20, 30] });
  });

  it('for-each filter mode keeps items whose body returns truthy', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":[1,2,3,4,5]}' }) },
      {
        kind: 'add-node',
        node: node('loop', 'for-each', {
          source: 'input.items',
          mode: 'filter',
          body: 'return item % 2 === 0;',
        }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'loop' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.nodeResults.loop).toEqual({ out: [2, 4] });
  });

  it('for-each reduce-into-var appends to a workflow variable across iterations', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":["a","b","c"]}' }) },
      {
        kind: 'add-node',
        node: node('loop', 'for-each', {
          source: 'input.items',
          mode: 'reduce-into-var',
          varName: 'collected',
          body: 'return item.toUpperCase();',
        }),
      },
      { kind: 'add-node', node: node('tpl', 'template', { template: '{{vars.collected}}' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'loop' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'loop', target: 'tpl' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.tpl).toEqual({ out: '["A","B","C"]' });
  });

  it('for-each emits an error port when the source is not an array', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":42}' }) },
      {
        kind: 'add-node',
        node: node('loop', 'for-each', { source: 'input.x', mode: 'map', body: 'return item;' }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'loop' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    const out = result.nodeResults.loop as { error?: { message: string } } | undefined;
    expect(out?.error?.message).toMatch(/did not resolve to an array/);
  });

  it('loop-start / loop-end runs a body subgraph per item and collects results', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":[1,2,3]}' }) },
      { kind: 'add-node', node: node('ls', 'loop-start', { loopId: 'outer', source: 'input.items' }) },
      { kind: 'add-node', node: node('body', 'js-transform', { expression: 'return input * 10;' }) },
      { kind: 'add-node', node: node('le', 'loop-end', { loopId: 'outer', mode: 'map' }) },
      { kind: 'add-node', node: node('after', 'log', { prefix: 'collected' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ls' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'ls', target: 'body' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'body', target: 'le' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'le', target: 'after' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.le).toEqual({ out: [10, 20, 30] });
    expect(result.nodeResults.after).toEqual({ out: [10, 20, 30] });
  });

  it('loop in filter mode keeps only iterations whose body returns truthy', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":[1,2,3,4]}' }) },
      { kind: 'add-node', node: node('ls', 'loop-start', { loopId: 'f', source: 'input.items' }) },
      { kind: 'add-node', node: node('body', 'js-transform', { expression: 'return input % 2 === 0 ? input : null;' }) },
      { kind: 'add-node', node: node('le', 'loop-end', { loopId: 'f', mode: 'filter' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ls' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'ls', target: 'body' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'body', target: 'le' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.le).toEqual({ out: [2, 4] });
  });

  it('errors when a loop-start has no matching loop-end', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":[1]}' }) },
      { kind: 'add-node', node: node('ls', 'loop-start', { loopId: 'orphan', source: 'input.items' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ls' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no matching loop-end/);
  });

  it('errors when a body node leaks an edge to a node outside the loop', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"items":[1]}' }) },
      { kind: 'add-node', node: node('ls', 'loop-start', { loopId: 'leak', source: 'input.items' }) },
      { kind: 'add-node', node: node('body', 'js-transform', { expression: 'return input;' }) },
      { kind: 'add-node', node: node('le', 'loop-end', { loopId: 'leak', mode: 'map' }) },
      { kind: 'add-node', node: node('outside', 'log') },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ls' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'ls', target: 'body' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'body', target: 'le' } },
      // body leaks to "outside" — should be rejected at plan time.
      { kind: 'add-edge', edge: { id: 'e4', source: 'body', target: 'outside' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/outside loop/);
  });

  it('supports nested loops — outer item × inner item', async () => {
    // Outer iterates [1,2]; inner iterates ['a','b'] each pass, building `${n}${ch}`.
    // Final collected: [['1a','1b'], ['2a','2b']].
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"nums":[1,2],"chars":["a","b"]}' }) },
      {
        kind: 'add-node',
        node: node('init', 'js-transform', {
          expression: 'vars.chars = input.chars; return input;',
        }),
      },
      { kind: 'add-node', node: node('outer', 'loop-start', { loopId: 'O', source: 'input.nums' }) },
      // Capture the outer's current item into vars so the inner body can see it.
      {
        kind: 'add-node',
        node: node('capture', 'js-transform', {
          expression: 'vars.cur = input; return input;',
        }),
      },
      { kind: 'add-node', node: node('inner', 'loop-start', { loopId: 'I', source: 'vars.chars' }) },
      {
        kind: 'add-node',
        node: node('combine', 'js-transform', {
          expression: 'return `${vars.cur}${input}`;',
        }),
      },
      { kind: 'add-node', node: node('innerEnd', 'loop-end', { loopId: 'I', mode: 'map' }) },
      { kind: 'add-node', node: node('outerEnd', 'loop-end', { loopId: 'O', mode: 'map' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'init' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'init', target: 'outer' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'outer', target: 'capture' } },
      { kind: 'add-edge', edge: { id: 'e4', source: 'capture', target: 'inner' } },
      { kind: 'add-edge', edge: { id: 'e5', source: 'inner', target: 'combine' } },
      { kind: 'add-edge', edge: { id: 'e6', source: 'combine', target: 'innerEnd' } },
      { kind: 'add-edge', edge: { id: 'e7', source: 'innerEnd', target: 'outerEnd' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    if (!result.ok) console.log('nested loop failed:', result.error);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.outerEnd).toEqual({ out: [['1a', '1b'], ['2a', '2b']] });
  });

  it('delay node forwards its input after waiting and respects abort', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":7}' }) },
      { kind: 'add-node', node: node('d', 'delay', { ms: 20 }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'd' } },
    ]).doc;

    const t0 = Date.now();
    const ok = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(ok.ok).toBe(true);
    expect(ok.nodeResults.d).toEqual({ out: { x: 7 } });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15); // accounting for timer slack

    // Abort path: an already-aborted signal should make the node error out
    // immediately rather than waiting.
    const aborted = new AbortController();
    aborted.abort();
    const longDoc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('d', 'delay', { ms: 5000 }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'd' } },
    ]).doc;
    const start = Date.now();
    const aborted2 = await run(longDoc, BUILTIN_EXECUTOR_REGISTRY, { signal: aborted.signal });
    expect(Date.now() - start).toBeLessThan(500);
    expect(aborted2.events.some((e) => e.type === 'node-skip' || e.type === 'node-error')).toBe(true);
  });

  it('vars reset between separate run() invocations', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('inc', 'increment-var', { name: 'counter', by: 1 }) },
      { kind: 'add-node', node: node('tpl', 'template', { template: '{{vars.counter}}' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'inc' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'inc', target: 'tpl' } },
    ]).doc;

    const first = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    const second = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(first.nodeResults.tpl).toEqual({ out: '1' });
    expect(second.nodeResults.tpl).toEqual({ out: '1' });
  });
});
