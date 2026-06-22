import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from '@tramo/spec';
import { createTramoServer, type TramoServer } from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

const flows = {
  echo: applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"x":1}' }) },
    { kind: 'add-node', node: node('m', 'js-transform', { expression: 'return { y: (input.x ?? 0) + 1 };' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'm' } },
  ]).doc,
  hook: applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('h', 'webhook-trigger', { path: '/wh', method: 'POST' }) },
    { kind: 'add-node', node: node('r', 'http-respond', { status: 200, bodyMode: 'json', body: '{"pong": true}' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 'h', target: 'r' } },
  ]).doc,
};

let server: TramoServer;
let base: string;

beforeAll(async () => {
  server = createTramoServer({ workflows: flows, cron: false });
  const port = await server.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
});

describe('@tramo/server HTTP', () => {
  it('GET /api/health', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.workflows).toBe(2);
  });

  it('GET /api/workflows', async () => {
    const res = await fetch(`${base}/api/workflows`);
    const body = await res.json();
    expect(body.workflows.map((w: { id: string }) => w.id).sort()).toEqual(['echo', 'hook']);
  });

  it('POST /api/workflows/:id/run', async () => {
    const res = await fetch(`${base}/api/workflows/echo/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 41 }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('completed');
    expect(typeof body.runId).toBe('string');
  });

  it('dispatches a webhook by path', async () => {
    const res = await fetch(`${base}/wh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  it('records runs in history', async () => {
    const res = await fetch(`${base}/api/runs?limit=50`);
    const body = await res.json();
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
  });

  it('404s an unknown api endpoint', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });
});

describe('@tramo/server bearer auth', () => {
  it('rejects unauthenticated API calls when apiKey is set', async () => {
    const secured = createTramoServer({ workflows: flows, cron: false, apiKey: 'sekret' });
    const port = await secured.listen(0, '127.0.0.1');
    try {
      const unauth = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(unauth.status).toBe(401);
      const auth = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { authorization: 'Bearer sekret' },
      });
      expect(auth.status).toBe(200);
    } finally {
      await secured.close();
    }
  });
});
