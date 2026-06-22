import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, resolveOutputs, BUILTIN_REGISTRY, type WorkflowNode } from '@tramo/spec';
import { BUILTIN_EXECUTOR_REGISTRY, run } from '../src/index.js';
import { toCron, cronMatches } from '../src/triggers/index.js';
import { verifyWebhookSignature, hmacHex } from '../src/crypto.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

describe('persona node', () => {
  it('drives an ai-prompt via the persona port', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"text":"hi"}' }) },
      { kind: 'add-node', node: node('p', 'persona', { provider: 'mock', model: 'persona-model', system: 'Be terse.' }) },
      { kind: 'add-node', node: node('ai', 'ai-prompt', { provider: 'anthropic', model: 'should-be-overridden', prompt: '{{text}}' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'ai' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'p', target: 'ai', targetHandle: 'persona' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.ok).toBe(true);
    // Persona forced provider=mock and model=persona-model.
    expect(result.nodeResults.ai).toEqual({ out: '[mock:persona-model] hi' });
  });
});

describe('llm-switch (LLM router)', () => {
  it('resolveOutputs derives a port per route plus other', () => {
    const def = BUILTIN_REGISTRY.get('llm-switch')!;
    const n = node('r', 'llm-switch', { routes: [{ key: 'billing' }, { key: 'support' }] });
    const ports = resolveOutputs(def, n).map((p) => p.key);
    expect(ports).toEqual(['billing', 'support', 'other']);
  });

  it('routes via the mock keyword heuristic', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"msg":"I need a refund for my invoice"}' }) },
      {
        kind: 'add-node',
        node: node('r', 'llm-switch', {
          provider: 'mock',
          input: 'input.msg',
          routes: [
            { key: 'billing', description: 'invoices refunds charges' },
            { key: 'support', description: 'technical problems' },
          ],
        }),
      },
      { kind: 'add-node', node: node('b', 'log', { prefix: 'BILLING' }) },
      { kind: 'add-node', node: node('s', 'log', { prefix: 'SUPPORT' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'r' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'r', target: 'b', sourceHandle: 'billing' } },
      { kind: 'add-edge', edge: { id: 'e3', source: 'r', target: 's', sourceHandle: 'support' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.nodeResults.b).toBeDefined();
    expect(result.nodeResults.s).toBeUndefined();
  });
});

describe('health-check node', () => {
  it('routes to healthy when all checks pass', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"n":5}' }) },
      {
        kind: 'add-node',
        node: node('hc', 'health-check', {
          checks: [
            { name: 'positive', type: 'expression', expr: 'input.n > 0' },
            { name: 'env shell', type: 'env', var: 'PATH' },
          ],
        }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'hc' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    const r = result.nodeResults.hc as { healthy?: { ok: boolean } };
    expect(r.healthy?.ok).toBe(true);
  });

  it('routes to unhealthy when a check fails', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"n":-1}' }) },
      {
        kind: 'add-node',
        node: node('hc', 'health-check', { checks: [{ name: 'positive', type: 'expression', expr: 'input.n > 0' }] }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'hc' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    const r = result.nodeResults.hc as { unhealthy?: { ok: boolean } };
    expect(r.unhealthy?.ok).toBe(false);
  });
});

describe('natural-language cron', () => {
  it('converts common phrases to cron', () => {
    expect(toCron('every 30 minutes')).toBe('*/30 * * * *');
    expect(toCron('every minute')).toBe('* * * * *');
    expect(toCron('hourly')).toBe('0 * * * *');
    expect(toCron('every 2 hours')).toBe('0 */2 * * *');
    expect(toCron('daily at 9am')).toBe('0 9 * * *');
    expect(toCron('daily at 9:30am')).toBe('30 9 * * *');
    expect(toCron('weekdays at 5pm')).toBe('0 17 * * 1-5');
    expect(toCron('every monday at 09:00')).toBe('0 9 * * 1');
    expect(toCron('at midnight')).toBe('0 0 * * *');
  });

  it('passes through real cron expressions unchanged', () => {
    expect(toCron('*/5 * * * *')).toBe('*/5 * * * *');
    expect(toCron('0 0 1 * *')).toBe('0 0 1 * *');
  });

  it('cronMatches works with NL', () => {
    const noon = new Date(2026, 0, 1, 12, 0, 0);
    expect(cronMatches('daily at noon', noon)).toBe(true);
    expect(cronMatches('daily at 9am', noon)).toBe(false);
  });
});

describe('webhook HMAC verification', () => {
  it('accepts a valid GitHub signature and rejects a bad one', async () => {
    const secret = 'topsecret';
    const body = '{"action":"opened"}';
    const sig = `sha256=${await hmacHex(secret, body, 'sha256')}`;
    const good = await verifyWebhookSignature('github', secret, body, { 'x-hub-signature-256': sig });
    expect(good.ok).toBe(true);
    const bad = await verifyWebhookSignature('github', secret, body, { 'x-hub-signature-256': 'sha256=deadbeef' });
    expect(bad.ok).toBe(false);
  });

  it('rejects when the signature header is missing', async () => {
    const r = await verifyWebhookSignature('github', 's', 'body', {});
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/missing/);
  });
});
