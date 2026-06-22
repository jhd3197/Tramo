/**
 * @tramo/cloudflare — official Cloudflare integration pack.
 *
 * Covers the high-leverage automation surface: Workers deploy/invoke,
 * KV reads & writes, R2 object storage, and DNS record management. Also
 * ships one webhook-trigger preset for Cloudflare's Notifications API so
 * R2 events, security alerts, etc. can start workflows.
 *
 * Every operation expects an API token. R2 ops use the S3-compatible
 * endpoint and need an access-key/secret pair; everything else uses a
 * bearer token from dash.cloudflare.com → My Profile → API Tokens.
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  toEnvelope,
  requireFields,
  renderTemplate,
  parseMaybeJson,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#f38020';
const API = 'https://api.cloudflare.com/client/v4';

const DEFINITION: IntegrationDefinition = {
  id: 'cloudflare',
  name: 'Cloudflare',
  description: 'Workers, KV, R2, DNS, notifications.',
  iconBrand: 'cloudflare',
  color: COLOR,
  category: 'Developer',
};

const NODES: NodeDefinition[] = [
  /* ---------- trigger ---------- */
  {
    id: 'webhook-trigger:cloudflare:notification',
    integrationId: 'cloudflare',
    name: 'Cloudflare · On Notification',
    operationName: 'On notification',
    category: 'trigger',
    description: 'Fires when Cloudflare POSTs a Notifications webhook (R2 event, security alert, billing, …).',
    icon: 'CloudDownload',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/cloudflare/notify', help: 'Configure this URL as a Webhook in Dash → Notifications.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'alertTypes', type: 'text', label: 'Filter alert_type (comma-separated)', default: '', optional: true, help: 'e.g. r2_event,billing_usage_alert. Blank = all.' },
      { key: 'secret', type: 'secret', label: 'HMAC secret', optional: true, help: 'Cloudflare signs with cf-webhook-auth. Validation is a downstream step.' },
    ],
  },

  /* ---------- Workers ---------- */
  {
    id: 'cloudflare-workers-deploy',
    integrationId: 'cloudflare',
    name: 'Cloudflare · Deploy Worker',
    operationName: 'Deploy worker',
    category: 'action',
    description: 'Upload (PUT) a Worker script to an account. Replaces the existing script with the same name.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Worker', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'scriptName', type: 'text', label: 'Script name', default: 'my-worker' },
      { key: 'code', type: 'textarea', label: 'Worker code (supports {{var}})', default: 'export default { async fetch(req) { return new Response("hello from tramo"); } };' },
      {
        key: 'compatibilityDate',
        type: 'text',
        label: 'Compatibility date (YYYY-MM-DD)',
        default: '2025-01-01',
        optional: true,
      },
    ],
  },
  {
    id: 'cloudflare-workers-invoke',
    integrationId: 'cloudflare',
    name: 'Cloudflare · Invoke Worker',
    operationName: 'Invoke worker',
    category: 'action',
    description: 'Call a Worker route (workers.dev subdomain or custom domain) with an arbitrary method + body.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Response', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'url', type: 'url', label: 'Worker URL', default: 'https://my-worker.example.workers.dev/' },
      {
        key: 'method',
        type: 'select',
        label: 'Method',
        default: 'POST',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'PATCH', value: 'PATCH' },
          { label: 'DELETE', value: 'DELETE' },
        ],
      },
      { key: 'headers', type: 'json', label: 'Headers (JSON)', default: '{}', optional: true },
      { key: 'body', type: 'json', label: 'Body (JSON, supports {{var}})', default: '{}', optional: true },
    ],
  },

  /* ---------- KV ---------- */
  {
    id: 'cloudflare-kv-put',
    integrationId: 'cloudflare',
    name: 'Cloudflare · KV Put',
    operationName: 'KV put',
    category: 'action',
    description: 'Write a value under a key in a KV namespace.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'namespaceId', type: 'text', label: 'Namespace ID', default: '' },
      { key: 'key', type: 'text', label: 'Key (supports {{var}})', default: '' },
      { key: 'value', type: 'textarea', label: 'Value (supports {{var}})', default: '' },
      { key: 'expirationTtl', type: 'number', label: 'Expiration TTL (seconds)', default: 0, optional: true, help: '0 = no expiration. Minimum 60 if set.' },
      { key: 'metadata', type: 'json', label: 'Metadata (JSON)', default: '{}', optional: true },
    ],
  },
  {
    id: 'cloudflare-kv-get',
    integrationId: 'cloudflare',
    name: 'Cloudflare · KV Get',
    operationName: 'KV get',
    category: 'action',
    description: 'Read the value (and optional metadata) for a key in a KV namespace.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Value', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'namespaceId', type: 'text', label: 'Namespace ID', default: '' },
      { key: 'key', type: 'text', label: 'Key (supports {{var}})', default: '' },
      { key: 'includeMetadata', type: 'boolean', label: 'Include metadata', default: false, optional: true },
    ],
  },
  {
    id: 'cloudflare-kv-delete',
    integrationId: 'cloudflare',
    name: 'Cloudflare · KV Delete',
    operationName: 'KV delete',
    category: 'action',
    description: 'Delete a key from a KV namespace.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'namespaceId', type: 'text', label: 'Namespace ID', default: '' },
      { key: 'key', type: 'text', label: 'Key', default: '' },
    ],
  },
  {
    id: 'cloudflare-kv-list',
    integrationId: 'cloudflare',
    name: 'Cloudflare · KV List Keys',
    operationName: 'KV list keys',
    category: 'action',
    description: 'List keys in a KV namespace, optionally filtered by prefix.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Keys', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'namespaceId', type: 'text', label: 'Namespace ID', default: '' },
      { key: 'prefix', type: 'text', label: 'Prefix filter', default: '', optional: true },
      { key: 'limit', type: 'number', label: 'Max keys', default: 100, optional: true },
    ],
  },

  /* ---------- R2 ---------- */
  {
    id: 'cloudflare-r2-put',
    integrationId: 'cloudflare',
    name: 'Cloudflare · R2 Put Object',
    operationName: 'R2 put object',
    category: 'action',
    description: 'Upload an object to an R2 bucket via the S3-compatible API.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Object', type: 'object' }],
    fields: [
      { key: 'accessKeyId', type: 'secret', label: 'Access key ID' },
      { key: 'secretAccessKey', type: 'secret', label: 'Secret access key' },
      { key: 'accountId', type: 'text', label: 'Account ID (for endpoint host)', default: '' },
      { key: 'bucket', type: 'text', label: 'Bucket name', default: '' },
      { key: 'key', type: 'text', label: 'Object key (supports {{var}})', default: '' },
      { key: 'body', type: 'textarea', label: 'Body (supports {{var}})', default: '' },
      { key: 'contentType', type: 'text', label: 'Content-Type', default: 'application/octet-stream', optional: true },
    ],
  },
  {
    id: 'cloudflare-r2-get',
    integrationId: 'cloudflare',
    name: 'Cloudflare · R2 Get Object',
    operationName: 'R2 get object',
    category: 'action',
    description: 'Fetch an object\'s metadata and body from an R2 bucket.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Object', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'accessKeyId', type: 'secret', label: 'Access key ID' },
      { key: 'secretAccessKey', type: 'secret', label: 'Secret access key' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'bucket', type: 'text', label: 'Bucket name', default: '' },
      { key: 'key', type: 'text', label: 'Object key', default: '' },
    ],
  },
  {
    id: 'cloudflare-r2-delete',
    integrationId: 'cloudflare',
    name: 'Cloudflare · R2 Delete Object',
    operationName: 'R2 delete object',
    category: 'action',
    description: 'Delete an object from an R2 bucket.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'accessKeyId', type: 'secret', label: 'Access key ID' },
      { key: 'secretAccessKey', type: 'secret', label: 'Secret access key' },
      { key: 'accountId', type: 'text', label: 'Account ID', default: '' },
      { key: 'bucket', type: 'text', label: 'Bucket name', default: '' },
      { key: 'key', type: 'text', label: 'Object key', default: '' },
    ],
  },

  /* ---------- DNS ---------- */
  {
    id: 'cloudflare-dns-create',
    integrationId: 'cloudflare',
    name: 'Cloudflare · DNS Create Record',
    operationName: 'DNS create record',
    category: 'action',
    description: 'Create a DNS record on a zone (A, AAAA, CNAME, TXT, MX, …).',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Record', type: 'object' }],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'zoneId', type: 'text', label: 'Zone ID', default: '' },
      {
        key: 'recordType',
        type: 'select',
        label: 'Type',
        default: 'A',
        options: [
          { label: 'A', value: 'A' },
          { label: 'AAAA', value: 'AAAA' },
          { label: 'CNAME', value: 'CNAME' },
          { label: 'TXT', value: 'TXT' },
          { label: 'MX', value: 'MX' },
          { label: 'NS', value: 'NS' },
          { label: 'SRV', value: 'SRV' },
        ],
      },
      { key: 'name', type: 'text', label: 'Name (e.g. www or @)', default: '' },
      { key: 'content', type: 'text', label: 'Content (supports {{var}})', default: '' },
      { key: 'ttl', type: 'number', label: 'TTL (seconds, 1 = auto)', default: 1, optional: true },
      { key: 'proxied', type: 'boolean', label: 'Proxied (orange-cloud)', default: false, optional: true },
    ],
  },
  {
    id: 'cloudflare-dns-update',
    integrationId: 'cloudflare',
    name: 'Cloudflare · DNS Update Record',
    operationName: 'DNS update record',
    category: 'action',
    description: 'Patch an existing DNS record by ID.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Record', type: 'object' }],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'zoneId', type: 'text', label: 'Zone ID', default: '' },
      { key: 'recordId', type: 'text', label: 'Record ID', default: '' },
      { key: 'content', type: 'text', label: 'New content (supports {{var}})', default: '', optional: true },
      { key: 'ttl', type: 'number', label: 'TTL (seconds, 1 = auto)', default: 1, optional: true },
      { key: 'proxied', type: 'boolean', label: 'Proxied', default: false, optional: true },
    ],
  },
  {
    id: 'cloudflare-dns-delete',
    integrationId: 'cloudflare',
    name: 'Cloudflare · DNS Delete Record',
    operationName: 'DNS delete record',
    category: 'action',
    description: 'Delete a DNS record from a zone.',
    icon: 'Cable',
    iconBrand: 'cloudflare',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'zoneId', type: 'text', label: 'Zone ID', default: '' },
      { key: 'recordId', type: 'text', label: 'Record ID', default: '' },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.apiToken ? String(ctx.config.apiToken) : (typeof process !== 'undefined' ? process.env?.CLOUDFLARE_API_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const noToken = { error: { message: 'cloudflare: API token required (config.apiToken or CLOUDFLARE_API_TOKEN)' } } as const;

interface CfEnvelope<T = unknown> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: unknown[];
}

/**
 * Unwrap Cloudflare's { success, result, errors } envelope. On a 2xx with
 * success:false (rare but possible), surface the errors array as a failure.
 */
function cfEnvelope<T>(
  res: Awaited<ReturnType<typeof httpJson<CfEnvelope<T>>>>,
): NodeExecutionResult {
  if (!res.ok) {
    const msg = res.data?.errors?.map((e) => e.message).filter(Boolean).join('; ');
    return { error: { message: msg || `HTTP ${res.status}`, status: res.status, data: res.data } };
  }
  if (res.data && res.data.success === false) {
    const msg = res.data.errors?.map((e) => e.message).filter(Boolean).join('; ');
    return { error: { message: msg || 'Cloudflare reported success: false', status: res.status, data: res.data } };
  }
  return { out: res.data?.result ?? res.data };
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'cloudflare-workers-deploy': async (ctx) => {
    const miss = requireFields(ctx.config, ['accountId', 'scriptName', 'code'], 'cloudflare-workers-deploy');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const code = tpl(ctx, 'code');
    const compatDate = ctx.config.compatibilityDate ? String(ctx.config.compatibilityDate) : undefined;
    const metadata = {
      main_module: 'worker.js',
      ...(compatDate ? { compatibility_date: compatDate } : {}),
    };
    const form = new FormData();
    form.append(
      'worker.js',
      new Blob([code], { type: 'application/javascript+module' }),
      'worker.js',
    );
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    // FormData sets its own multipart content-type with boundary; pass via raw fetch
    // is unnecessary because httpJson lets us hand it a body only as a string. Use the
    // module-syntax PUT with multipart through fetch directly here.
    const url = `${API}/accounts/${String(ctx.config.accountId)}/workers/scripts/${encodeURIComponent(String(ctx.config.scriptName))}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      body: form,
      signal: ctx.signal,
    });
    const data = (await res.json().catch(() => null)) as CfEnvelope<unknown> | null;
    return cfEnvelope({ ok: res.ok, status: res.status, headers: {}, data: data as CfEnvelope<unknown> });
  },

  'cloudflare-workers-invoke': async (ctx) => {
    const miss = requireFields(ctx.config, ['url'], 'cloudflare-workers-invoke');
    if (miss) return miss;
    const headers = parseMaybeJson(ctx.config.headers);
    const bodyRaw = ctx.config.body != null ? tpl(ctx, 'body') : '';
    const method = String(ctx.config.method ?? 'POST').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD' && bodyRaw.trim() !== '' && bodyRaw.trim() !== '{}';
    const res = await httpJson({
      method,
      url: String(ctx.config.url),
      headers: headers && typeof headers === 'object' ? (headers as Record<string, string>) : undefined,
      ...(hasBody ? { body: bodyRaw } : {}),
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return { out: { status: res.status, ok: res.ok, headers: res.headers, body: res.data } };
  },

  'cloudflare-kv-put': async (ctx) => {
    const miss = requireFields(ctx.config, ['accountId', 'namespaceId', 'key'], 'cloudflare-kv-put');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const key = tpl(ctx, 'key');
    const value = tpl(ctx, 'value');
    const meta = parseMaybeJson(ctx.config.metadata);
    const ttl = Number(ctx.config.expirationTtl ?? 0);
    const query: Record<string, string | number | undefined> = {};
    if (ttl >= 60) query.expiration_ttl = ttl;
    const base = `${API}/accounts/${String(ctx.config.accountId)}/storage/kv/namespaces/${String(ctx.config.namespaceId)}/values/${encodeURIComponent(key)}`;
    // KV value PUT is raw text; metadata requires the bulk/metadata form. Keep it simple: plain value.
    const url = base + (query.expiration_ttl != null ? `?expiration_ttl=${query.expiration_ttl}` : '');
    if (meta && typeof meta === 'object' && Object.keys(meta as object).length > 0) {
      // metadata requires multipart form with `value` + `metadata` parts
      const form = new FormData();
      form.append('value', value);
      form.append('metadata', JSON.stringify(meta));
      const res = await fetch(url, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        body: form,
        signal: ctx.signal,
      });
      const data = (await res.json().catch(() => null)) as CfEnvelope<unknown> | null;
      return cfEnvelope({ ok: res.ok, status: res.status, headers: {}, data: data as CfEnvelope<unknown> });
    }
    const res = await httpJson<CfEnvelope<unknown>>({
      method: 'PUT',
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
      body: value,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return cfEnvelope(res);
  },

  'cloudflare-kv-get': async (ctx) => {
    const miss = requireFields(ctx.config, ['accountId', 'namespaceId', 'key'], 'cloudflare-kv-get');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const key = tpl(ctx, 'key');
    const url = `${API}/accounts/${String(ctx.config.accountId)}/storage/kv/namespaces/${String(ctx.config.namespaceId)}/values/${encodeURIComponent(key)}`;
    const res = await httpJson<string>({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}` },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (res.status === 404) return { notFound: { key } };
    if (!res.ok) return toEnvelope(res);
    let metadata: unknown;
    if (ctx.config.includeMetadata === true) {
      const metaRes = await httpJson<CfEnvelope<unknown>>({
        method: 'GET',
        url: `${API}/accounts/${String(ctx.config.accountId)}/storage/kv/namespaces/${String(ctx.config.namespaceId)}/metadata/${encodeURIComponent(key)}`,
        headers: { authorization: `Bearer ${token}` },
        signal: ctx.signal,
        timeoutMs: 20000,
      });
      if (metaRes.ok) metadata = metaRes.data?.result;
    }
    return { out: { key, value: res.data, ...(metadata !== undefined ? { metadata } : {}) } };
  },

  'cloudflare-kv-delete': async (ctx) => {
    const miss = requireFields(ctx.config, ['accountId', 'namespaceId', 'key'], 'cloudflare-kv-delete');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson<CfEnvelope<unknown>>({
      method: 'DELETE',
      url: `${API}/accounts/${String(ctx.config.accountId)}/storage/kv/namespaces/${String(ctx.config.namespaceId)}/values/${encodeURIComponent(String(ctx.config.key))}`,
      headers: { authorization: `Bearer ${token}` },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok ? { out: { deleted: true, key: String(ctx.config.key) } } : cfEnvelope(res);
  },

  'cloudflare-kv-list': async (ctx) => {
    const miss = requireFields(ctx.config, ['accountId', 'namespaceId'], 'cloudflare-kv-list');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson<CfEnvelope<Array<{ name: string }>>>({
      method: 'GET',
      url: `${API}/accounts/${String(ctx.config.accountId)}/storage/kv/namespaces/${String(ctx.config.namespaceId)}/keys`,
      query: {
        prefix: ctx.config.prefix ? String(ctx.config.prefix) : undefined,
        limit: ctx.config.limit != null ? Number(ctx.config.limit) : undefined,
      },
      headers: { authorization: `Bearer ${token}` },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok || res.data?.success === false) return cfEnvelope(res);
    return { out: res.data?.result ?? [] };
  },

  'cloudflare-dns-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['zoneId', 'recordType', 'name', 'content'], 'cloudflare-dns-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson<CfEnvelope<unknown>>({
      method: 'POST',
      url: `${API}/zones/${String(ctx.config.zoneId)}/dns_records`,
      bearer: token,
      json: {
        type: String(ctx.config.recordType),
        name: String(ctx.config.name),
        content: tpl(ctx, 'content'),
        ttl: Number(ctx.config.ttl ?? 1),
        proxied: ctx.config.proxied === true,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return cfEnvelope(res);
  },

  'cloudflare-dns-update': async (ctx) => {
    const miss = requireFields(ctx.config, ['zoneId', 'recordId'], 'cloudflare-dns-update');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const patch: Record<string, unknown> = {
      ttl: Number(ctx.config.ttl ?? 1),
      proxied: ctx.config.proxied === true,
    };
    if (ctx.config.content) patch.content = tpl(ctx, 'content');
    const res = await httpJson<CfEnvelope<unknown>>({
      method: 'PATCH',
      url: `${API}/zones/${String(ctx.config.zoneId)}/dns_records/${String(ctx.config.recordId)}`,
      bearer: token,
      json: patch,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return cfEnvelope(res);
  },

  'cloudflare-dns-delete': async (ctx) => {
    const miss = requireFields(ctx.config, ['zoneId', 'recordId'], 'cloudflare-dns-delete');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return noToken;
    const res = await httpJson<CfEnvelope<{ id?: string }>>({
      method: 'DELETE',
      url: `${API}/zones/${String(ctx.config.zoneId)}/dns_records/${String(ctx.config.recordId)}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok && res.data?.success !== false
      ? { out: { deleted: true, id: res.data?.result?.id ?? String(ctx.config.recordId) } }
      : cfEnvelope(res);
  },

  // R2 object ops (put/get/delete) target the S3-compatible endpoint, which
  // requires AWS SigV4 request signing — out of scope for the dependency-free
  // HTTP helper — so they fall through to the passthrough stub below.
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers and the SigV4-signed R2 ops keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'cloudflare',
  name: 'Cloudflare',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
