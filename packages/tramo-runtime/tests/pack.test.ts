import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type NodeDefinition } from 'tramo-spec';
import {
  BUILTIN_EXECUTORS,
  BUILTIN_PACK,
  combinePacks,
  defineNodePack,
  run,
  type NodeExecutor,
} from '../src/index.js';

const uppercaseDef: NodeDefinition = {
  id: 'test-uppercase',
  name: 'Uppercase',
  category: 'transform',
  description: 'Upper-case a string input.',
  icon: 'Type',
  inputs: [{ key: 'in', label: 'In', type: 'string' }],
  outputs: [{ key: 'out', label: 'Out', type: 'string' }],
  fields: [],
};

const uppercaseExec: NodeExecutor = {
  id: 'test-uppercase',
  execute: (ctx) => ({ out: String(ctx.inputs.in ?? '').toUpperCase() }),
};

describe('defineNodePack', () => {
  it('returns a frozen pack with the entries it was given', () => {
    const pack = defineNodePack({
      id: 'test',
      name: 'Test pack',
      version: '0.0.1',
      entries: [{ definition: uppercaseDef, executor: uppercaseExec }],
    });
    expect(pack.id).toBe('test');
    expect(pack.entries.length).toBe(1);
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.entries)).toBe(true);
  });

  it('accepts a namespaced id', () => {
    const pack = defineNodePack({
      id: 'my-org/slack',
      name: 'Slack pack',
      version: '1.0.0',
      entries: [],
    });
    expect(pack.id).toBe('my-org/slack');
  });

  it('rejects invalid pack ids', () => {
    expect(() =>
      defineNodePack({ id: 'Bad Id', name: 'x', version: '0', entries: [] }),
    ).toThrow(/slug/);
    expect(() =>
      defineNodePack({ id: '@scoped', name: 'x', version: '0', entries: [] }),
    ).toThrow(/slug/);
  });

  it('throws when an entry has mismatched definition.id vs executor.id', () => {
    expect(() =>
      defineNodePack({
        id: 'mismatch',
        name: 'x',
        version: '0',
        entries: [
          {
            definition: { ...uppercaseDef, id: 'a' },
            executor: { ...uppercaseExec, id: 'b' },
          },
        ],
      }),
    ).toThrow(/mismatched ids/);
  });

  it('throws on duplicate ids within a pack', () => {
    expect(() =>
      defineNodePack({
        id: 'dupes',
        name: 'x',
        version: '0',
        entries: [
          { definition: uppercaseDef, executor: uppercaseExec },
          { definition: uppercaseDef, executor: uppercaseExec },
        ],
      }),
    ).toThrow(/duplicate node id/);
  });
});

describe('BUILTIN_PACK', () => {
  it('exposes every built-in executor through the pack convention', () => {
    // Every base executor must appear as a pack-entry definition id, either
    // directly or as the prefix of a brand-namespaced id (e.g.
    // `webhook-trigger` is reached by `webhook-trigger:github:issue`). This
    // guarantees no executor ships orphaned without a pack entry that can
    // dispatch to it.
    expect(BUILTIN_PACK.id).toBe('builtin');
    expect(BUILTIN_PACK.entries.length).toBeGreaterThanOrEqual(BUILTIN_EXECUTORS.length);
    const packIds = new Set(BUILTIN_PACK.entries.map((e) => e.definition.id));
    for (const exec of BUILTIN_EXECUTORS) {
      const reached = packIds.has(exec.id) ||
        [...packIds].some((id) => id.startsWith(`${exec.id}:`));
      expect(reached).toBe(true);
    }
  });
});

describe('combinePacks', () => {
  it('merges packs into editor + runtime registries', () => {
    const myPack = defineNodePack({
      id: 'my-pack',
      name: 'My pack',
      version: '0.1.0',
      entries: [{ definition: uppercaseDef, executor: uppercaseExec }],
    });
    const { nodes, executors, source } = combinePacks([BUILTIN_PACK, myPack]);
    expect(nodes.get('log')).toBeDefined();
    expect(nodes.get('test-uppercase')).toBeDefined();
    expect(executors.get('test-uppercase')).toBeDefined();
    expect(source.get('test-uppercase')).toBe('my-pack');
    expect(source.get('log')).toBe('builtin');
  });

  it('throws when two packs define the same node id', () => {
    const a = defineNodePack({
      id: 'a',
      name: 'A',
      version: '0',
      entries: [{ definition: uppercaseDef, executor: uppercaseExec }],
    });
    const b = defineNodePack({
      id: 'b',
      name: 'B',
      version: '0',
      entries: [{ definition: uppercaseDef, executor: uppercaseExec }],
    });
    expect(() => combinePacks([a, b])).toThrow(/provided by both/);
  });

  it('runs a workflow using a custom pack node end-to-end', async () => {
    const myPack = defineNodePack({
      id: 'demo',
      name: 'Demo',
      version: '0',
      entries: [{ definition: uppercaseDef, executor: uppercaseExec }],
    });
    const { executors } = combinePacks([BUILTIN_PACK, myPack]);

    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: { id: 't', type: 'manual-trigger', config: { payload: '"hello"' } } },
      { kind: 'add-node', node: { id: 'u', type: 'test-uppercase', config: {} } },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'u' } },
    ]).doc;

    const result = await run(doc, executors);
    expect(result.ok).toBe(true);
    expect(result.nodeResults.u).toEqual({ out: 'HELLO' });
  });
});
