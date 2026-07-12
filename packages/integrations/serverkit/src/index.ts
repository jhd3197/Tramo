/**
 * @tramo/serverkit — official ServerKit panel integration pack.
 *
 * Drive a ServerKit control panel from a workflow: react to panel events
 * (webhook trigger), start/stop/restart managed apps, trigger deploys and
 * backups, and fan panel notifications out through `notify.send`.
 *
 * Every action calls the panel REST API with an `X-API-Key` header. The base
 * URL and key are read from the node's config, falling back to the
 * `SERVERKIT_URL` (default `http://127.0.0.1:5000`) and `SERVERKIT_API_KEY`
 * environment variables so a self-hosted @tramo/server next to the panel needs
 * no per-node secrets.
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  requireFields,
  renderTemplate,
  parseMaybeJson,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition, NodeField } from '@tramo/spec';

const COLOR = '#2f6fed';

const DEFINITION: IntegrationDefinition = {
  id: 'serverkit',
  name: 'ServerKit',
  description: 'Control apps, deploy, back up, and notify via the ServerKit panel.',
  iconBrand: 'serverfault',
  icon: 'Server',
  color: COLOR,
  category: 'DevOps',
};

/**
 * Connection fields shared by every action node. `apiKey` falls back to
 * `SERVERKIT_API_KEY`; `baseUrl` falls back to `SERVERKIT_URL` (then to
 * `http://127.0.0.1:5000`), so both may be left blank when the server runs
 * alongside the panel.
 */
const CONN_FIELDS: NodeField[] = [
  { key: 'baseUrl', type: 'text', label: 'Panel base URL', default: '', optional: true, help: 'Defaults to $SERVERKIT_URL or http://127.0.0.1:5000.' },
  { key: 'apiKey', type: 'secret', label: 'API key (X-API-Key)', optional: true, help: 'Defaults to $SERVERKIT_API_KEY.' },
];

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:serverkit:event',
    integrationId: 'serverkit',
    name: 'ServerKit · On Panel Event',
    operationName: 'On panel event',
    category: 'trigger',
    description: 'Fires when the ServerKit panel POSTs an event (deploy, backup, alert, …) to this webhook.',
    icon: 'CloudDownload',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Event', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/sk/events', help: 'Register this URL as an EventSubscription target in the ServerKit panel.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'secretToken', type: 'secret', label: 'Shared secret (X-ServerKit-Token)', optional: true },
      { key: 'eventKinds', type: 'text', label: 'Filter event kinds (e.g. deploy.finished,backup.run)', default: '', optional: true },
    ],
  },
  {
    id: 'serverkit:app-list',
    integrationId: 'serverkit',
    name: 'ServerKit · List Apps',
    operationName: 'List apps',
    category: 'action',
    description: 'List every app managed by the panel.',
    icon: 'List',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Apps', type: 'object' }],
    fields: [...CONN_FIELDS],
  },
  {
    id: 'serverkit:app-get',
    integrationId: 'serverkit',
    name: 'ServerKit · Get App',
    operationName: 'Get app',
    category: 'action',
    description: 'Fetch one app by id (status, ports, domains, …).',
    icon: 'Info',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'App', type: 'object' }],
    fields: [
      { key: 'app', type: 'text', label: 'App id (supports {{var}})', default: '' },
      ...CONN_FIELDS,
    ],
  },
  {
    id: 'serverkit:app-control',
    integrationId: 'serverkit',
    name: 'ServerKit · Control App',
    operationName: 'Control app',
    category: 'action',
    description: 'Start, stop, or restart a managed app.',
    icon: 'Power',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'app', type: 'text', label: 'App id (supports {{var}})', default: '' },
      {
        key: 'action',
        type: 'select',
        label: 'Action',
        default: 'restart',
        options: [
          { label: 'Start', value: 'start' },
          { label: 'Stop', value: 'stop' },
          { label: 'Restart', value: 'restart' },
        ],
      },
      ...CONN_FIELDS,
    ],
  },
  {
    id: 'serverkit:app-deploy',
    integrationId: 'serverkit',
    name: 'ServerKit · Deploy App',
    operationName: 'Deploy app',
    category: 'action',
    description: 'Trigger a deploy for a managed app (optionally at a specific git ref).',
    icon: 'Rocket',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Deploy', type: 'object' }],
    fields: [
      { key: 'app', type: 'text', label: 'App id (supports {{var}})', default: '' },
      { key: 'ref', type: 'text', label: 'Git ref / branch (supports {{var}})', default: '', optional: true },
      ...CONN_FIELDS,
    ],
  },
  {
    id: 'serverkit:backup-run',
    integrationId: 'serverkit',
    name: 'ServerKit · Run Backup',
    operationName: 'Run backup',
    category: 'action',
    description: 'Kick off a backup run — for one app, or the whole panel when left blank.',
    icon: 'DatabaseBackup',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Backup', type: 'object' }],
    fields: [
      { key: 'app', type: 'text', label: 'App id (supports {{var}}) — blank = all', default: '', optional: true },
      ...CONN_FIELDS,
    ],
  },
  {
    id: 'serverkit:notify-send',
    integrationId: 'serverkit',
    name: 'ServerKit · Send Notification',
    operationName: 'Send notification',
    category: 'action',
    description: 'Emit a panel notification via notify.send(event, to, data).',
    icon: 'Bell',
    iconBrand: 'serverfault',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'event', type: 'text', label: 'Event name (supports {{var}})', default: 'workflow.notify' },
      { key: 'to', type: 'text', label: 'Recipient (user id, email, or @channel; supports {{var}})', default: '', optional: true },
      { key: 'data', type: 'json', label: 'Data (JSON object)', default: '{}', optional: true },
      ...CONN_FIELDS,
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const DEFAULT_BASE_URL = 'http://127.0.0.1:5000';

const baseUrlOf = (ctx: ExecutionContext): string => {
  const raw = ctx.config.baseUrl ? String(ctx.config.baseUrl).trim() : '';
  const url = raw || env('SERVERKIT_URL') || DEFAULT_BASE_URL;
  return url.replace(/\/+$/, '');
};

const keyOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.apiKey ? String(ctx.config.apiKey) : env('SERVERKIT_API_KEY');

/**
 * Call the panel REST API. Defensive: never throws — network errors and
 * non-2xx responses come back as a structured `{ error }` envelope, and a
 * missing API key is reported up front.
 */
async function callServerKit(
  ctx: ExecutionContext,
  id: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<NodeExecutionResult> {
  const key = keyOf(ctx);
  if (!key) return { error: { message: `${id}: API key required (config.apiKey or SERVERKIT_API_KEY)` } };
  const url = `${baseUrlOf(ctx)}${path}`;
  try {
    const res = await httpJson<unknown>({
      method,
      url,
      headers: { 'X-API-Key': key },
      json: body,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    if (res.ok) return { out: res.data };
    const message = extractMessage(res.data) ?? `HTTP ${res.status}`;
    return { error: { message: `${id}: ${message}`, status: res.status, data: res.data } };
  } catch (err) {
    return { error: { message: `${id}: ${(err as Error).message}` } };
  }
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return typeof data === 'string' ? data : undefined;
  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string') return d.error;
  if (typeof d.message === 'string') return d.message;
  return undefined;
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'serverkit:app-list': async (ctx) =>
    callServerKit(ctx, 'serverkit:app-list', 'GET', '/api/v1/apps'),

  'serverkit:app-get': async (ctx) => {
    const miss = requireFields(ctx.config, ['app'], 'serverkit:app-get');
    if (miss) return miss;
    const app = encodeURIComponent(tpl(ctx, 'app'));
    return callServerKit(ctx, 'serverkit:app-get', 'GET', `/api/v1/apps/${app}`);
  },

  'serverkit:app-control': async (ctx) => {
    const miss = requireFields(ctx.config, ['app', 'action'], 'serverkit:app-control');
    if (miss) return miss;
    const action = String(ctx.config.action);
    if (!['start', 'stop', 'restart'].includes(action)) {
      return { error: { message: `serverkit:app-control: action must be start|stop|restart (got "${action}")` } };
    }
    const app = encodeURIComponent(tpl(ctx, 'app'));
    return callServerKit(ctx, 'serverkit:app-control', 'POST', `/api/v1/apps/${app}/${action}`);
  },

  'serverkit:app-deploy': async (ctx) => {
    const miss = requireFields(ctx.config, ['app'], 'serverkit:app-deploy');
    if (miss) return miss;
    const app = encodeURIComponent(tpl(ctx, 'app'));
    const ref = tpl(ctx, 'ref');
    return callServerKit(
      ctx,
      'serverkit:app-deploy',
      'POST',
      `/api/v1/apps/${app}/deploy`,
      ref ? { ref } : {},
    );
  },

  'serverkit:backup-run': async (ctx) => {
    const app = tpl(ctx, 'app');
    return callServerKit(ctx, 'serverkit:backup-run', 'POST', '/api/v1/backups', app ? { app } : {});
  },

  'serverkit:notify-send': async (ctx) => {
    const miss = requireFields(ctx.config, ['event'], 'serverkit:notify-send');
    if (miss) return miss;
    const parsed = parseMaybeJson(ctx.config.data);
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const to = tpl(ctx, 'to');
    return callServerKit(ctx, 'serverkit:notify-send', 'POST', '/api/v1/notifications/send', {
      event: tpl(ctx, 'event'),
      ...(to ? { to } : {}),
      data,
    });
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers (and anything without a real impl) keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'serverkit',
  name: 'ServerKit',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
