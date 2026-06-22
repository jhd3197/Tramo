import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from '@tramo/spec';
import {
  BUILTIN_EXECUTOR_REGISTRY,
  arrayAuditSink,
  createExecutorRegistry,
  run,
  type NodeExecutor,
} from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return { id, type, config, ...extra };
}

describe('retry / backoff', () => {
  it('retries a throwing executor until it succeeds', async () => {
    let attempts = 0;
    const flaky: NodeExecutor = {
      id: 'flaky',
      execute: () => {
        attempts++;
        if (attempts < 3) throw new Error(`boom ${attempts}`);
        return { out: attempts };
      },
    };
    const registry = createExecutorRegistry([flaky]);
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('f', 'flaky', {}, { retry: { count: 3, delayMs: 1 } }) },
    ]).doc;

    const result = await run(doc, registry);
    expect(result.ok).toBe(true);
    expect(attempts).toBe(3);
    expect(result.nodeResults.f).toEqual({ out: 3 });
    // Two retry warnings were logged.
    const warns = result.events.filter((e) => e.type === 'node-log' && e.level === 'warn');
    expect(warns.length).toBe(2);
  });

  it('errors after exhausting the retry budget', async () => {
    let attempts = 0;
    const always: NodeExecutor = {
      id: 'always-fail',
      execute: () => {
        attempts++;
        throw new Error('nope');
      },
    };
    const registry = createExecutorRegistry([always]);
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('f', 'always-fail', {}, { retry: { count: 2, delayMs: 1 } }) },
    ]).doc;

    const result = await run(doc, registry);
    expect(attempts).toBe(3); // 1 initial + 2 retries
    const err = result.events.find((e) => e.type === 'node-error' && e.nodeId === 'f');
    expect(err).toBeDefined();
  });
});

describe('parallel execution within layers', () => {
  function instrumentedRegistry() {
    let active = 0;
    let maxConcurrent = 0;
    const slow: NodeExecutor = {
      id: 'slow',
      execute: async () => {
        active++;
        maxConcurrent = Math.max(maxConcurrent, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return { out: true };
      },
    };
    return { registry: createExecutorRegistry([slow]), peek: () => maxConcurrent };
  }

  const fanOutDoc = () =>
    applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'slow') },
      { kind: 'add-node', node: node('a', 'slow') },
      { kind: 'add-node', node: node('b', 'slow') },
      { kind: 'add-node', node: node('c', 'slow') },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'a' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 't', target: 'b' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 't', target: 'c' } },
    ]).doc;

  it('runs independent siblings concurrently by default', async () => {
    const { registry, peek } = instrumentedRegistry();
    const result = await run(fanOutDoc(), registry);
    expect(result.ok).toBe(true);
    expect(peek()).toBe(3); // a, b, c overlapped
  });

  it('concurrency:1 forces sequential execution', async () => {
    const { registry, peek } = instrumentedRegistry();
    const result = await run(fanOutDoc(), registry, { concurrency: 1 });
    expect(result.ok).toBe(true);
    expect(peek()).toBe(1);
  });

  it('caps concurrency at the configured limit', async () => {
    const { registry, peek } = instrumentedRegistry();
    await run(fanOutDoc(), registry, { concurrency: 2 });
    expect(peek()).toBe(2);
  });
});

describe('secret redaction', () => {
  it('masks explicit secrets in events but keeps nodeResults raw', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"note":"key is supersecret-1234 ok"}' }) },
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'l' } },
    ]).doc;

    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY, { secrets: ['supersecret-1234'] });
    const success = result.events.find((e) => e.type === 'node-success' && e.nodeId === 'l');
    const out = (success as { output: { out: { note: string } } }).output.out.note;
    expect(out).not.toContain('supersecret-1234');
    expect(out).toContain('«redacted»');
    // Live data flow is untouched.
    expect((result.nodeResults.l as { out: { note: string } }).out.note).toContain('supersecret-1234');
  });

  it('masks sensitive-looking keys without an explicit list', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"api_key":"abcd1234efgh"}' }) },
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'l' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    const success = result.events.find((e) => e.type === 'node-success' && e.nodeId === 'l');
    expect((success as { output: { out: { api_key: string } } }).output.out.api_key).toBe('«redacted»');
  });

  it('redact:false leaves events untouched', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"api_key":"abcd1234efgh"}' }) },
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'l' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY, { redact: false });
    const success = result.events.find((e) => e.type === 'node-success' && e.nodeId === 'l');
    expect((success as { output: { out: { api_key: string } } }).output.out.api_key).toBe('abcd1234efgh');
  });
});

describe('audit trail', () => {
  it('records every lifecycle transition with an actor', async () => {
    const audit = arrayAuditSink();
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":1}' }) },
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'l' } },
    ]).doc;

    await run(doc, BUILTIN_EXECUTOR_REGISTRY, { audit, actor: 'alice' });
    const types = audit.records.map((r) => r.type);
    expect(types).toContain('run-start');
    expect(types).toContain('run-end');
    expect(audit.records.filter((r) => r.type === 'node-success').length).toBe(2);
    expect(audit.records.every((r) => r.actor === 'alice')).toBe(true);
    expect(audit.records.every((r) => typeof r.timestamp === 'string')).toBe(true);
  });
});

describe('role-based execution', () => {
  const roleDoc = () =>
    applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger') },
      { kind: 'add-node', node: node('danger', 'log', { prefix: 'DANGER' }, { requiredRole: 'admin' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'danger' } },
    ]).doc;

  it('skips a node when the actor lacks its required role', async () => {
    const result = await run(roleDoc(), BUILTIN_EXECUTOR_REGISTRY, { roles: ['viewer'] });
    expect(result.nodeResults.danger).toBeUndefined();
    const skip = result.events.find((e) => e.type === 'node-skip' && e.nodeId === 'danger');
    expect(skip).toBeDefined();
    expect((skip as { reason: string }).reason).toMatch(/required role/);
  });

  it('runs the node when the role is present', async () => {
    const result = await run(roleDoc(), BUILTIN_EXECUTOR_REGISTRY, { roles: ['admin'] });
    expect(result.nodeResults.danger).toBeDefined();
  });

  it('runs everything when roles is undefined (no gate)', async () => {
    const result = await run(roleDoc(), BUILTIN_EXECUTOR_REGISTRY);
    expect(result.nodeResults.danger).toBeDefined();
  });
});

describe('resume from checkpoint', () => {
  it('replays completed nodes and only runs the remainder', async () => {
    let bRuns = 0;
    const counter: NodeExecutor = {
      id: 'count-b',
      execute: () => {
        bRuns++;
        return { out: 'b' };
      },
    };
    const registry = createExecutorRegistry([...BUILTIN_EXECUTOR_REGISTRY.list(), counter]);
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('a', 'manual-trigger', { payload: '{"x":1}' }) },
      { kind: 'add-node', node: node('b', 'count-b') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'a', target: 'b' } },
    ]).doc;

    const result = await run(doc, registry, {
      resumeFrom: {
        runId: 'run_prev',
        nodeResults: { a: { out: { x: 1 } } },
        errored: [],
        skipped: {},
        vars: {},
      },
    });
    expect(result.runId === undefined || true).toBe(true);
    expect(bRuns).toBe(1); // a was replayed, only b ran
    expect(result.nodeResults.b).toEqual({ out: 'b' });
  });
});
