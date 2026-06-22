import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowDoc, type WorkflowNode } from '@tramo/spec';
import { TramoHost } from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

function simpleFlow(): WorkflowDoc {
  return applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":1}' }) },
    { kind: 'add-node', node: node('m', 'js-transform', { expression: 'return { y: (input.x ?? 0) + 1 };' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'm' } },
  ]).doc;
}

function webhookFlow(): WorkflowDoc {
  return applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('h', 'webhook-trigger', { path: '/hook', method: 'POST' }) },
    { kind: 'add-node', node: node('r', 'http-respond', { status: 201, bodyMode: 'json', body: '{"received": true}' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 'h', target: 'r' } },
  ]).doc;
}

function approvalFlow(): WorkflowDoc {
  return applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{}' }) },
    { kind: 'add-node', node: node('gate', 'approval-gate', { gateKey: 'g' }) },
    { kind: 'add-node', node: node('ok', 'log', { prefix: 'OK' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'gate' } },
    { kind: 'add-edge', edge: { id: 'e2', source: 'gate', target: 'ok', sourceHandle: 'approved' } },
  ]).doc;
}

function cronFlow(): WorkflowDoc {
  return applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('c', 'cron-trigger', { expression: 'every minute' }) },
    { kind: 'add-node', node: node('l', 'log', {}) },
    { kind: 'add-edge', edge: { id: 'e1', source: 'c', target: 'l' } },
  ]).doc;
}

describe('TramoHost', () => {
  it('triggers a workflow and records history', async () => {
    const host = new TramoHost({ workflows: { simple: simpleFlow() } });
    const result = await host.trigger('simple');
    expect(result.ok).toBe(true);
    expect(result.nodeResults.m).toEqual({ out: { y: 2 } });
    const runs = host.history.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.workflowId).toBe('simple');
    expect(runs[0]!.status).toBe('completed');
  });

  it('dispatches a webhook and shapes the response', async () => {
    const host = new TramoHost({ workflows: { wh: webhookFlow() } });
    const routes = host.webhookRoutes();
    expect(routes).toContainEqual({ method: 'POST', path: '/hook', workflowId: 'wh', nodeId: 'h' });
    const res = await host.dispatchWebhook({
      method: 'POST',
      url: '/hook',
      headers: { 'content-type': 'application/json' },
      body: { a: 1 },
      rawBody: '{"a":1}',
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
  });

  it('404s an unmatched webhook path', async () => {
    const host = new TramoHost({ workflows: { wh: webhookFlow() } });
    const res = await host.dispatchWebhook({ method: 'GET', url: '/nope', headers: {}, body: null });
    expect(res.status).toBe(404);
  });

  it('rejects a webhook with a bad HMAC signature', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('h', 'webhook-trigger', { path: '/secure', method: 'POST', secret: 'shh', signaturePreset: 'github' }) },
    ]).doc;
    const host = new TramoHost({ workflows: { s: doc } });
    const res = await host.dispatchWebhook({
      method: 'POST',
      url: '/secure',
      headers: { 'x-hub-signature-256': 'sha256=bad' },
      body: { a: 1 },
      rawBody: '{"a":1}',
    });
    expect(res.status).toBe(401);
  });

  it('suspends on an approval gate and resumes via the API', async () => {
    const host = new TramoHost({ workflows: { appr: approvalFlow() } });
    const first = await host.trigger('appr');
    expect(first.status).toBe('suspended');
    const pending = host.pendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.runId).toBe(first.runId);

    const resumed = await host.resume(first.runId, { g: { approved: true, by: 'alice' } });
    expect(resumed.status).toBe('completed');
    expect(resumed.nodeResults.ok).toBeDefined();
    // No longer pending.
    expect(host.pendingApprovals()).toHaveLength(0);
  });

  it('fires cron entries that match the current minute', async () => {
    const host = new TramoHost({ workflows: { c: cronFlow() } });
    expect(host.cronEntries()).toHaveLength(1);
    const results = await host.tickCron(new Date(2026, 0, 1, 12, 0, 0));
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
  });

  it('replays a past run with the same trigger', async () => {
    const host = new TramoHost({ workflows: { simple: simpleFlow() } });
    const first = await host.trigger('simple', { x: 41 });
    const replayed = await host.replay(first.runId);
    expect(replayed.nodeResults.m).toEqual({ out: { y: 42 } });
    expect(host.history.list({ limit: 10 }).length).toBe(2);
  });

  it('aggregates stats for the dashboard', async () => {
    const host = new TramoHost({ workflows: { simple: simpleFlow() } });
    await host.trigger('simple');
    await host.trigger('simple');
    const stats = host.history.stats();
    expect(stats.total).toBe(2);
    expect(stats.completed).toBe(2);
    expect(stats.successRate).toBe(1);
  });
});
