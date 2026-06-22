/**
 * HTTP layer over a TramoHost.
 *
 * Serves a JSON management API under a prefix (default `/api`) and routes
 * every other path to the host's webhook dispatcher. Uses node:http directly
 * — zero deps beyond @tramo/runtime + @tramo/spec.
 *
 * Management API:
 *   GET  /api/health                  liveness + counts
 *   GET  /api/stats                   dashboard aggregates
 *   GET  /api/workflows               list workflows
 *   GET  /api/workflows/:id           one workflow (doc)
 *   POST /api/workflows/:id/run       trigger a run (body = trigger payload)
 *   GET  /api/runs[?limit&workflowId&status]   recent runs
 *   GET  /api/runs/:runId             one run record
 *   POST /api/runs/:runId/replay      re-run with the recorded trigger
 *   POST /api/runs/:runId/approve     resume a suspended run
 *   GET  /api/approvals               pending approvals
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { RunResult, ApprovalDecision } from '@tramo/runtime';
import { TramoHost, type TramoHostOptions, type WebhookLikeRequest } from './host.js';

export interface TramoServerOptions extends TramoHostOptions {
  /** Management API path prefix. Default `/api`. */
  apiPrefix?: string;
  /** Bearer token required on management routes. Webhooks are unaffected. */
  apiKey?: string;
  /** Start the cron ticker when listening. Default true. */
  cron?: boolean;
}

export interface TramoServer {
  host: TramoHost;
  httpServer: Server;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createTramoServer(options: TramoServerOptions): TramoServer {
  const host = new TramoHost(options);
  const prefix = options.apiPrefix ?? '/api';
  const enableCron = options.cron !== false;

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, error: (err as Error).message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://placeholder');
    const path = url.pathname;

    if (path === prefix || path.startsWith(prefix + '/')) {
      if (options.apiKey && !authorized(req, options.apiKey)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      }
      return handleApi(method, path.slice(prefix.length) || '/', url, req, res);
    }

    // Everything else → webhook dispatch.
    const rawBody = await readBody(req);
    const wreq: WebhookLikeRequest = {
      method,
      url: req.url ?? '/',
      headers: flattenHeaders(req.headers),
      body: parseBody(req.headers['content-type'] ?? '', rawBody),
      rawBody,
      query: Object.fromEntries(url.searchParams),
    };
    const wres = await host.dispatchWebhook(wreq);
    res.statusCode = wres.status;
    for (const [k, v] of Object.entries(wres.headers ?? {})) res.setHeader(k, v);
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json');
    res.end(typeof wres.body === 'string' ? wres.body : JSON.stringify(wres.body));
  }

  async function handleApi(method: string, sub: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    // sub is the path after the prefix, e.g. "/workflows/foo/run".
    const parts = sub.split('/').filter(Boolean);

    if (method === 'GET' && sub === '/health') {
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - host.startedAt,
        workflows: host.listWorkflows().length,
        runs: host.history.list({ limit: 1 }).length > 0 ? host.history.stats().total : 0,
      });
    }
    if (method === 'GET' && sub === '/stats') {
      return sendJson(res, 200, { ok: true, stats: host.history.stats() });
    }
    if (method === 'GET' && sub === '/workflows') {
      return sendJson(res, 200, { ok: true, workflows: host.listWorkflows() });
    }
    if (method === 'GET' && parts[0] === 'workflows' && parts.length === 2) {
      const doc = host.getWorkflow(decodeURIComponent(parts[1]!));
      if (!doc) return sendJson(res, 404, { ok: false, error: 'not found' });
      return sendJson(res, 200, { ok: true, workflow: doc });
    }
    if (method === 'POST' && parts[0] === 'workflows' && parts[2] === 'run' && parts.length === 3) {
      const id = decodeURIComponent(parts[1]!);
      if (!host.getWorkflow(id)) return sendJson(res, 404, { ok: false, error: 'not found' });
      const trigger = await readJson(req);
      const result = await host.trigger(id, trigger, 'api');
      return sendJson(res, result.ok ? 200 : 500, { ok: result.ok, ...summary(result) });
    }
    if (method === 'GET' && sub === '/runs') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const workflowId = url.searchParams.get('workflowId') ?? undefined;
      return sendJson(res, 200, { ok: true, runs: host.history.list({ limit, workflowId }) });
    }
    if (method === 'GET' && parts[0] === 'runs' && parts.length === 2) {
      const rec = host.history.get(decodeURIComponent(parts[1]!));
      if (!rec) return sendJson(res, 404, { ok: false, error: 'not found' });
      return sendJson(res, 200, { ok: true, run: rec });
    }
    if (method === 'POST' && parts[0] === 'runs' && parts[2] === 'replay' && parts.length === 3) {
      try {
        const result = await host.replay(decodeURIComponent(parts[1]!));
        return sendJson(res, 200, { ok: result.ok, ...summary(result) });
      } catch (err) {
        return sendJson(res, 404, { ok: false, error: (err as Error).message });
      }
    }
    if (method === 'POST' && parts[0] === 'runs' && parts[2] === 'approve' && parts.length === 3) {
      const runId = decodeURIComponent(parts[1]!);
      const body = (await readJson(req)) as {
        key?: string;
        approved?: boolean;
        by?: string;
        comment?: string;
        approvals?: Record<string, ApprovalDecision>;
      };
      // Accept either a full approvals map or a single decision keyed by `key`.
      let approvals: Record<string, ApprovalDecision> | undefined = body.approvals;
      if (!approvals) {
        const rec = host.history.get(runId);
        const pending = rec?.pendingApprovals ?? [];
        const decision: ApprovalDecision = { approved: body.approved === true, by: body.by, comment: body.comment, at: Date.now() };
        approvals = {};
        if (body.key) approvals[body.key] = decision;
        else for (const p of pending) approvals[p.key] = decision; // decide all pending the same way
      }
      try {
        const result = await host.resume(runId, approvals);
        return sendJson(res, 200, { ok: result.ok, ...summary(result) });
      } catch (err) {
        return sendJson(res, 404, { ok: false, error: (err as Error).message });
      }
    }
    if (method === 'GET' && sub === '/approvals') {
      return sendJson(res, 200, { ok: true, pending: host.pendingApprovals() });
    }

    return sendJson(res, 404, { ok: false, error: `no such endpoint: ${method} ${prefix}${sub}` });
  }

  return {
    host,
    httpServer,
    listen(port: number, hostname = '0.0.0.0'): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, hostname, () => {
          if (enableCron) host.startCron();
          const addr = httpServer.address();
          resolve(addr && typeof addr === 'object' ? addr.port : port);
        });
      });
    },
    close(): Promise<void> {
      host.stopCron();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function summary(result: RunResult) {
  return {
    runId: result.runId,
    status: result.status,
    error: result.error,
    usage: result.usage,
    pendingApprovals: result.pendingApprovals,
  };
}

function authorized(req: IncomingMessage, key: string): boolean {
  const auth = req.headers.authorization ?? '';
  return auth === `Bearer ${key}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseBody(contentType: string, raw: string): unknown {
  if (raw === '') return null;
  const lower = contentType.toLowerCase();
  if (lower.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (lower.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  return raw;
}

function flattenHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) out[k] = v.join(', ');
    else if (v != null) out[k] = String(v);
  }
  return out;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
