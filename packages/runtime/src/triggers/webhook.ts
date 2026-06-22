/**
 * Webhook trigger driver. Returns an HTTP handler that runs the workflow
 * with the incoming request as the trigger payload. Caller wires it into
 * any Node-compatible HTTP framework (`createServer`, Hono, Express, etc).
 *
 * The doc is scanned for `webhook-trigger` nodes and the handler is
 * scoped to the (method, path) declared on the matching node's config.
 */

import { topoSort } from '@tramo/spec';
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
  // Match the bare `webhook-trigger` node as well as the brand-prefixed
  // variants (`webhook-trigger:github:issue`, `webhook-trigger:stripe:event`,
  // …) — those reuse this executor via the prefix-fallback dispatch in
  // createExecutorRegistry. The router has to know about the same
  // convention so brand triggers actually receive their HTTP requests.
  const webhookNodes = doc.nodes.filter(
    (n) => n.type === 'webhook-trigger' || n.type.startsWith('webhook-trigger:'),
  );

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
      if (!result.ok) {
        return {
          status: 500,
          body: { ok: false, triggeredNode: match.nodeId, error: result.error ?? 'run failed' },
          headers: { 'content-type': 'application/json' },
        };
      }

      // If the workflow placed an http-respond node, that's the response.
      // Pick the LAST one in topo order so a "default" upstream node can be
      // overridden by a more specific downstream one.
      const shaped = pickShapedResponse(doc, result);
      if (shaped) return shaped;

      // Fallback: legacy shape — useful when the user hasn't wired an
      // http-respond yet but still wants to ping the endpoint.
      return {
        status: 200,
        body: {
          ok: true,
          triggeredNode: match.nodeId,
          results: result.nodeResults,
        },
        headers: { 'content-type': 'application/json' },
      };
    },
  };
}

function pickShapedResponse(doc: WorkflowDoc, result: RunResult): WebhookResponse | null {
  const responders = doc.nodes.filter((n) => n.type === 'http-respond');
  if (responders.length === 0) return null;
  const topo = topoSort(doc);
  const order = topo.ok ? topo.order : doc.nodes.map((n) => n.id);
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  responders.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

  for (let i = responders.length - 1; i >= 0; i--) {
    const r = result.nodeResults[responders[i].id];
    if (r && typeof r === 'object' && 'response' in r) {
      const resp = (r as Record<string, unknown>).response;
      if (resp && typeof resp === 'object') {
        const { status, body, headers } = resp as { status?: number; body?: unknown; headers?: Record<string, string> };
        return {
          status: typeof status === 'number' ? status : 200,
          body,
          headers: headers ?? {},
        };
      }
    }
  }
  return null;
}
