/**
 * HTTP helper for integration packs.
 *
 * A thin, dependency-free wrapper over `fetch` that handles the boilerplate
 * every real API executor repeats: URL + query building, auth headers, JSON
 * / form bodies, timeouts (composed with the run's abort signal), and
 * response parsing. It never throws on a non-2xx — it returns the status so
 * the caller decides — but `toEnvelope` turns a result into the standard
 * tramo `{ out }` / `{ error }` node shape.
 */

export interface HttpRequest {
  method?: string;
  url: string;
  /** Query params appended to the URL. `undefined`/`null` values are dropped. */
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  /** Body serialized as JSON (sets content-type application/json). */
  json?: unknown;
  /** Body serialized as application/x-www-form-urlencoded. */
  form?: Record<string, string | number | boolean | undefined>;
  /** Raw string body (you set content-type via headers). */
  body?: string;
  /** Adds `Authorization: Bearer <token>`. */
  bearer?: string;
  /** Adds HTTP Basic auth from `user:pass`. */
  basic?: { user: string; pass: string };
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResult<T = unknown> {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  data: T;
}

export class HttpError extends Error {
  readonly status: number;
  readonly data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;
  }
}

function buildUrl(url: string, query?: HttpRequest['query']): string {
  if (!query) return url;
  const entries = Object.entries(query).filter(([, v]) => v != null);
  if (entries.length === 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  return `${url}${sep}${qs}`;
}

function b64(s: string): string {
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'utf8').toString('base64');
}

/** Perform an HTTP request and parse the response. Never throws on non-2xx. */
export async function httpJson<T = unknown>(req: HttpRequest): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...(req.headers ?? {}) };
  let body: BodyInit | undefined;

  if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
  } else if (req.form !== undefined) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.form)) if (v != null) params.append(k, String(v));
    body = params.toString();
    if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (req.body !== undefined) {
    body = req.body;
  }

  if (req.bearer) headers.authorization = `Bearer ${req.bearer}`;
  if (req.basic) headers.authorization = `Basic ${b64(`${req.basic.user}:${req.basic.pass}`)}`;

  const signals: AbortSignal[] = [];
  if (req.signal) signals.push(req.signal);
  if (req.timeoutMs && req.timeoutMs > 0) signals.push(AbortSignal.timeout(req.timeoutMs));
  const signal = signals.length === 0 ? undefined : signals.length === 1 ? signals[0] : AbortSignal.any(signals);

  const res = await fetch(buildUrl(req.url, req.query), {
    method: req.method ?? (body !== undefined ? 'POST' : 'GET'),
    headers,
    body,
    signal,
  });

  const ct = res.headers.get('content-type') ?? '';
  const data = (ct.includes('application/json') || ct.includes('+json'))
    ? await res.json().catch(() => null)
    : await res.text();

  const headerOut: Record<string, string> = {};
  res.headers.forEach((v, k) => { headerOut[k] = v; });

  return { ok: res.ok, status: res.status, headers: headerOut, data: data as T };
}

/**
 * Convert an HttpResult into the standard tramo node envelope. 2xx → `{ out }`,
 * otherwise `{ error }` carrying the status + parsed body. `pick` optionally
 * reshapes the success payload.
 */
export function toEnvelope<T>(
  result: HttpResult<T>,
  pick?: (data: T, result: HttpResult<T>) => unknown,
): { out: unknown } | { error: { message: string; status: number; data: unknown } } {
  if (result.ok) {
    return { out: pick ? pick(result.data, result) : result.data };
  }
  const message = extractMessage(result.data) ?? `HTTP ${result.status}`;
  return { error: { message, status: result.status, data: result.data } };
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.message === 'string') return d.message;
  if (typeof d.error === 'string') return d.error;
  if (d.error && typeof d.error === 'object' && typeof (d.error as { message?: unknown }).message === 'string') {
    return (d.error as { message: string }).message;
  }
  return undefined;
}

/** Guard for required config fields — returns an error envelope when missing. */
export function requireFields(
  config: Record<string, unknown>,
  fields: string[],
  label: string,
): { error: { message: string } } | null {
  const missing = fields.filter((f) => {
    const v = config[f];
    return v == null || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length === 0) return null;
  return { error: { message: `${label}: missing required field(s): ${missing.join(', ')}` } };
}
