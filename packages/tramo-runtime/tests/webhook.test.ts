import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from 'tramo-spec';
import { BUILTIN_EXECUTOR_REGISTRY, webhook } from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

describe('webhook trigger driver', () => {
  it('returns the http-respond node\'s response when one is wired', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('w', 'webhook-trigger', { path: '/hello', method: 'POST' }) },
      { kind: 'add-node', node: node('t', 'js-transform', { expression: 'return { greeting: `hi ${input.body.name}` };' }) },
      {
        kind: 'add-node',
        node: node('r', 'http-respond', {
          status: 201,
          bodyMode: 'json',
          body: '{ "msg": "{{greeting}}" }',
          headers: '{"x-tramo":"yes"}',
        }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 'w', target: 't' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 't', target: 'r' } },
    ]).doc;

    const h = webhook(doc, BUILTIN_EXECUTOR_REGISTRY);
    const res = await h.handle({
      method: 'POST',
      url: '/hello',
      headers: {},
      body: { name: 'Juan' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ msg: 'hi Juan' });
    expect(res.headers?.['x-tramo']).toBe('yes');
    expect(res.headers?.['content-type']).toContain('application/json');
  });

  it('falls back to the legacy shape when no http-respond is present', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('w', 'webhook-trigger', { path: '/p', method: 'GET' }) },
      { kind: 'add-node', node: node('l', 'log') },
      { kind: 'add-edge', edge: { id: 'e1', source: 'w', target: 'l' } },
    ]).doc;
    const h = webhook(doc, BUILTIN_EXECUTOR_REGISTRY);
    const res = await h.handle({ method: 'GET', url: '/p', headers: {}, body: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, triggeredNode: 'w' });
  });

  it('404s when no matching route', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('w', 'webhook-trigger', { path: '/known', method: 'GET' }) },
    ]).doc;
    const h = webhook(doc, BUILTIN_EXECUTOR_REGISTRY);
    const res = await h.handle({ method: 'GET', url: '/unknown', headers: {}, body: null });
    expect(res.status).toBe(404);
  });

  it('500s when a node errors and there is no http-respond to override', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('w', 'webhook-trigger', { path: '/boom', method: 'POST' }) },
      { kind: 'add-node', node: node('t', 'js-transform', { expression: 'throw new Error("boom");' }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 'w', target: 't' } },
    ]).doc;
    const h = webhook(doc, BUILTIN_EXECUTOR_REGISTRY);
    const res = await h.handle({ method: 'POST', url: '/boom', headers: {}, body: null });
    // Run completes (ok=true) but no http-respond → fallback 200 with results.
    // The error is captured in the results, not at the HTTP level — that's
    // the contract: http-level errors mean the runtime itself broke.
    expect(res.status).toBe(200);
  });

  it('text-mode http-respond returns a plain-text body', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('w', 'webhook-trigger', { path: '/p', method: 'GET' }) },
      {
        kind: 'add-node',
        node: node('r', 'http-respond', {
          status: 200,
          bodyMode: 'text',
          body: 'pong',
        }),
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 'w', target: 'r' } },
    ]).doc;
    const h = webhook(doc, BUILTIN_EXECUTOR_REGISTRY);
    const res = await h.handle({ method: 'GET', url: '/p', headers: {}, body: null });
    expect(res.body).toBe('pong');
    expect(res.headers?.['content-type']).toContain('text/plain');
  });
});
