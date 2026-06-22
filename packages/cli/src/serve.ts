import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  BUILTIN_EXECUTOR_REGISTRY,
  webhook,
  type WebhookRequest,
} from '@tramo/runtime';
import type { WorkflowDoc } from '@tramo/spec';
import { makeFormatter } from './format.js';
import type { CommandIO } from './io.js';

export interface ServeOptions {
  file: string;
  port: number;
  host: string;
  io: CommandIO;
  /** Internal hook for tests: resolves once the server is listening. */
  onListening?: (port: number) => void;
}

/**
 * `tramo serve <file> [--port N] [--host H]` — boot an HTTP server that
 * dispatches every request through the doc's webhook-trigger nodes.
 *
 * Uses node:http directly so the CLI dep tree stays at zero beyond
 * @tramo/runtime and @tramo/spec — same constraint as `run` and `validate`.
 * If you want fancier routing, body parsers, TLS, etc., wrap the
 * `webhook()` driver in your own server.
 */
export async function serveCommand(opts: ServeOptions): Promise<number> {
  const { file, port, host, io } = opts;
  const fmt = makeFormatter(io.color);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    io.stderr(`${fmt.paint('error:', 'red')} cannot read ${file}: ${(err as Error).message}`);
    return 1;
  }

  let doc: WorkflowDoc;
  try {
    doc = JSON.parse(raw) as WorkflowDoc;
  } catch (err) {
    io.stderr(`${fmt.paint('error:', 'red')} ${file} is not valid JSON: ${(err as Error).message}`);
    return 1;
  }

  const handle = webhook(doc, BUILTIN_EXECUTOR_REGISTRY);
  const routes = handle.routes();
  if (routes.length === 0) {
    io.stderr(`${fmt.paint('error:', 'red')} no webhook-trigger nodes in ${file} — nothing to serve.`);
    return 1;
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = await readRequestBody(req);
      const wreq: WebhookRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: flattenHeaders(req.headers),
        body: parseRequestBody(req.headers['content-type'] ?? '', body),
        rawBody: body,
      };
      const wres = await handle.handle(wreq);
      writeResponse(res, wres);
      io.stdout(
        `${fmt.paint(`[${new Date().toISOString()}]`, 'gray')} ${wreq.method} ${wreq.url} ${fmt.paint(String(wres.status), wres.status < 400 ? 'green' : 'red')}`,
      );
    } catch (err) {
      const message = (err as Error).message || String(err);
      io.stderr(`${fmt.paint('error:', 'red')} handler crashed: ${message}`);
      try {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: message }));
      } catch {
        // headers already sent — nothing we can do.
      }
    }
  });

  return new Promise<number>((resolve) => {
    server.on('error', (err) => {
      io.stderr(`${fmt.paint('error:', 'red')} server failed: ${(err as Error).message}`);
      resolve(1);
    });
    server.listen(port, host, () => {
      const addr = server.address();
      const boundPort = addr && typeof addr === 'object' ? addr.port : port;
      io.stdout(`tramo serve — listening on ${fmt.paint(`http://${host}:${boundPort}`, 'cyan')}`);
      for (const r of routes) {
        io.stdout(`  ${fmt.paint(r.method.padEnd(6), 'cyan')} ${r.path}  ${fmt.paint(`→ ${r.nodeId}`, 'gray')}`);
      }
      opts.onListening?.(boundPort);
    });
    // The CLI lives as long as the server does; resolve happens via
    // `error` (above) or external signal handlers (SIGINT/SIGTERM).
    const stop = (signal: string) => {
      io.stdout(`\nreceived ${signal}, shutting down…`);
      server.close(() => resolve(0));
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseRequestBody(contentType: string, raw: string): unknown {
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
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
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

function writeResponse(res: ServerResponse, wres: { status: number; body: unknown; headers?: Record<string, string> }) {
  res.statusCode = wres.status;
  const headers = wres.headers ?? {};
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (wres.body == null) {
    res.end();
    return;
  }
  const contentType = (headers['content-type'] ?? headers['Content-Type'] ?? '').toLowerCase();
  if (typeof wres.body === 'string') {
    res.end(wres.body);
    return;
  }
  if (contentType.includes('json') || typeof wres.body === 'object') {
    res.end(JSON.stringify(wres.body));
    return;
  }
  res.end(String(wres.body));
}
