import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from '@tramo/spec';
import {
  BUILTIN_EXECUTOR_REGISTRY,
  createExecutorRegistry,
  estimateCost,
  run,
  runStream,
  type NodeExecutor,
  type RunEvent,
  type RunResult,
} from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

describe('token / cost tracking', () => {
  it('aggregates usage reported by executors and estimates cost', async () => {
    const llm: NodeExecutor = {
      id: 'fake-llm',
      execute: (ctx) => {
        ctx.reportUsage({ provider: 'anthropic', model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 500 });
        return { out: 'hi' };
      },
    };
    const registry = createExecutorRegistry([llm]);
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('a', 'fake-llm') },
      { kind: 'add-node', node: node('b', 'fake-llm') },
    ]).doc;

    const result = await run(doc, registry);
    expect(result.usage).toBeDefined();
    expect(result.usage!.inputTokens).toBe(2000);
    expect(result.usage!.outputTokens).toBe(1000);
    expect(result.usage!.totalTokens).toBe(3000);
    // opus-4: $15/1M in, $75/1M out → per node 0.015 + 0.0375 = 0.0525, ×2
    expect(result.usage!.costUsd).toBeCloseTo(0.105, 6);
    expect(result.usage!.byModel['anthropic/claude-opus-4-8']).toBeDefined();
    expect(Object.keys(result.usage!.byNode)).toEqual(['a', 'b']);
  });

  it('mock ai-prompt reports usage with zero cost', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"text":"hello world"}' }) },
      { kind: 'add-node', node: node('ai', 'ai-prompt', { provider: 'mock', prompt: 'Echo: {{text}}' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ai' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.usage).toBeDefined();
    expect(result.usage!.costUsd).toBe(0);
    expect(result.usage!.totalTokens).toBeGreaterThan(0);
  });

  it('no usage means no usage object', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{}' }) },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.usage).toBeUndefined();
  });

  it('estimateCost falls back to 0 for unknown models', () => {
    expect(estimateCost('totally-unknown-model', 1000, 1000)).toBe(0);
    expect(estimateCost('gpt-4o', 1_000_000, 0)).toBeCloseTo(2.5, 6);
  });
});

describe('streaming run', () => {
  it('yields events live and returns the final RunResult', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":1}' }) },
      { kind: 'add-node', node: node('l', 'log', {}) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'l' } },
    ]).doc;

    const gen = runStream(doc, BUILTIN_EXECUTOR_REGISTRY);
    const types: string[] = [];
    let result: RunResult | undefined;
    let next = await gen.next();
    while (!next.done) {
      types.push((next.value as RunEvent).type);
      next = await gen.next();
    }
    result = next.value;
    expect(types[0]).toBe('run-start');
    expect(types).toContain('node-success');
    expect(types[types.length - 1]).toBe('run-end');
    expect(result?.ok).toBe(true);
    expect(result?.nodeResults.l).toEqual({ out: { x: 1 } });
  });

  it('streams chunk events from a streaming mock ai-prompt', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"text":"one two three"}' }) },
      { kind: 'add-node', node: node('ai', 'ai-prompt', { provider: 'mock', prompt: '{{text}}', stream: true }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ai' } },
    ]).doc;

    const chunks: string[] = [];
    const gen = runStream(doc, BUILTIN_EXECUTOR_REGISTRY);
    let next = await gen.next();
    while (!next.done) {
      const e = next.value as RunEvent;
      if (e.type === 'node-chunk') chunks.push(e.chunk);
      next = await gen.next();
    }
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toContain('one two three');
  });
});
