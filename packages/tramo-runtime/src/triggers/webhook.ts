/**
 * Webhook trigger driver. Returns an HTTP handler that runs the workflow
 * with the incoming request as the trigger payload. Caller wires it into
 * any Node-compatible HTTP framework (`createServer`, Hono, Express, etc).
 *
 * The doc is scanned for `webhook-trigger` nodes and the handler is
 * scoped to the (method, path) declared on the matching node's config.
 */

import { run } from '../runner.js';
import type {
  ExecutorRegistry,
  RunOptions,
  RunResult,
  WorkflowDoc,
} from '../types.js';

export interface WebhookRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  query?: Record<string, string>;
}

export interface WebhookResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface WebhookTriggerHandle {
  /** Match an incoming request against the doc's webhook-trigger nodes. */
  handle: (req: WebhookRequest) => Promise<WebhookResponse>;
  /** Pretty-print the routes this doc exposes. Useful for boot logs. */
  routes: () => Array<{ method: string; path: string; nodeId: string }>;
}

export function webhook(
  doc: WorkflowDoc,
  registry: ExecutorRegistry,
  options: Omit<RunOptions, 'trigger'> = {},
): WebhookTriggerHandle {
  const webhookNodes = doc.nodes.filter((n) => n.type === 'webhook-trigger');

  const routes = webhookNodes.map((n) => ({
    method: String(n.config.method ?? 'POST').toUpperCase(),
    path: String(n.config.path ?? '/'),
    nodeId: n.id,
  }));

  return {
    routes: () => routes,
    handle: async (req) => {
      const url = new URL(req.url, 'http://placeholder');
      const match = routes.find(
        (r) => r.method === req.method.toUpperCase() && r.path === url.pathname,
      );
      if (!match) {
        return { status: 404, body: { error: 'no matching webhook trigger' } };
      }
      const trigger = {
        body: req.body,
        headers: req.headers,
        query: req.query ?? Object.fromEntries(url.searchParams),
      };
      const result: RunResult = await run(doc, registry, { ...options, trigger });
      return {
        status: result.ok ? 200 : 500,
        body: {
          ok: result.ok,
          triggeredNode: match.nodeId,
          ...(result.error ? { error: result.error } : {}),
          // Only return the leaf results — the full event log is verbose.
          results: result.nodeResults,
        },
        headers: { 'content-type': 'application/json' },
      };
    },
  };
}
