/**
 * @tramo/airtable — official Airtable integration pack.
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  toEnvelope,
  requireFields,
  parseMaybeJson,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#fcb400';
const API = 'https://api.airtable.com/v0';

const DEFINITION: IntegrationDefinition = {
  id: 'airtable',
  name: 'Airtable',
  description: 'Records, lookups, lists, updates, deletes.',
  iconBrand: 'airtable',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:airtable:record-change',
    integrationId: 'airtable',
    name: 'Airtable · On Record Change',
    operationName: 'On record change',
    category: 'trigger',
    description: 'Fires when Airtable posts a Webhooks API notification (record create / update / delete).',
    icon: 'CloudDownload',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/airtable/webhook' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'baseId', type: 'text', label: 'Base ID (matched against payload)', default: 'appXXXXXXXX' },
      { key: 'webhookId', type: 'text', label: 'Webhook ID', default: '', optional: true, help: 'Returned when you call POST /bases/{baseId}/webhooks. Use to filter.' },
      { key: 'macSecret', type: 'secret', label: 'MAC secret', optional: true, help: 'Airtable signs payloads with X-Airtable-Content-MAC.' },
    ],
  },
  {
    id: 'airtable-record-create',
    integrationId: 'airtable',
    name: 'Airtable · Create Record',
    operationName: 'Create record',
    category: 'action',
    description: 'Insert a new record into an Airtable table.',
    icon: 'Cable',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Record', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Personal access token' },
      { key: 'baseId', type: 'text', label: 'Base ID', default: 'appXXXXXXXX' },
      { key: 'tableId', type: 'text', label: 'Table ID or name', default: '' },
      { key: 'fields', type: 'json', label: 'Fields (JSON)', default: '{}', help: 'Object of { fieldName: value } — supports {{var}} inside string values.' },
    ],
  },
  {
    id: 'airtable-record-update',
    integrationId: 'airtable',
    name: 'Airtable · Update Record',
    operationName: 'Update record',
    category: 'action',
    description: 'Patch fields on an existing record by id.',
    icon: 'Cable',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Record', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Personal access token' },
      { key: 'baseId', type: 'text', label: 'Base ID', default: 'appXXXXXXXX' },
      { key: 'tableId', type: 'text', label: 'Table ID or name', default: '' },
      { key: 'recordId', type: 'text', label: 'Record ID', default: '' },
      { key: 'fields', type: 'json', label: 'Fields to update (JSON)', default: '{}' },
    ],
  },
  {
    id: 'airtable-record-get',
    integrationId: 'airtable',
    name: 'Airtable · Get Record',
    operationName: 'Get record',
    category: 'action',
    description: 'Fetch a single record by ID.',
    icon: 'Cable',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Record', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'token', type: 'secret', label: 'Personal access token' },
      { key: 'baseId', type: 'text', label: 'Base ID', default: 'appXXXXXXXX' },
      { key: 'tableId', type: 'text', label: 'Table ID or name', default: '' },
      { key: 'recordId', type: 'text', label: 'Record ID', default: '' },
    ],
  },
  {
    id: 'airtable-record-delete',
    integrationId: 'airtable',
    name: 'Airtable · Delete Record',
    operationName: 'Delete record',
    category: 'action',
    description: 'Permanently delete a record by ID.',
    icon: 'Cable',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Personal access token' },
      { key: 'baseId', type: 'text', label: 'Base ID', default: 'appXXXXXXXX' },
      { key: 'tableId', type: 'text', label: 'Table ID or name', default: '' },
      { key: 'recordId', type: 'text', label: 'Record ID', default: '' },
    ],
  },
  {
    id: 'airtable-list-records',
    integrationId: 'airtable',
    name: 'Airtable · List Records',
    operationName: 'List records',
    category: 'action',
    description: 'List records with an optional filter formula.',
    icon: 'Cable',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Records', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'token', type: 'secret', label: 'Personal access token' },
      { key: 'baseId', type: 'text', label: 'Base ID', default: 'appXXXXXXXX' },
      { key: 'tableId', type: 'text', label: 'Table ID or name', default: '' },
      { key: 'filterByFormula', type: 'text', label: 'Filter formula', default: '', optional: true },
      { key: 'view', type: 'text', label: 'View name (optional)', default: '', optional: true },
      { key: 'maxRecords', type: 'number', label: 'Max records', default: 100, optional: true },
    ],
  },
  {
    id: 'airtable-record-find',
    integrationId: 'airtable',
    name: 'Airtable · Find Record',
    operationName: 'Find record',
    category: 'action',
    description: 'Find the first record matching a filter formula — useful for "upsert" patterns.',
    icon: 'Cable',
    iconBrand: 'airtable',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Record', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'token', type: 'secret', label: 'Personal access token' },
      { key: 'baseId', type: 'text', label: 'Base ID', default: 'appXXXXXXXX' },
      { key: 'tableId', type: 'text', label: 'Table ID or name', default: '' },
      { key: 'filterByFormula', type: 'text', label: 'Filter formula', default: '' },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined => {
  if (ctx.config.token) return String(ctx.config.token);
  return typeof process !== 'undefined' ? process.env?.AIRTABLE_API_KEY : undefined;
};

const missingToken = { error: { message: 'airtable: token required (config.token or AIRTABLE_API_KEY)' } };

/** Build the base URL for a table — table name/id is path-encoded. */
const tableUrl = (ctx: ExecutionContext): string =>
  `${API}/${encodeURIComponent(String(ctx.config.baseId))}/${encodeURIComponent(String(ctx.config.tableId))}`;

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'airtable-record-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['baseId', 'tableId'], 'airtable-record-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const fields = parseMaybeJson(ctx.config.fields);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { error: { message: 'airtable-record-create: fields must be a JSON object' } };
    }
    const res = await httpJson({
      method: 'POST',
      url: tableUrl(ctx),
      bearer: token,
      json: { fields },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'airtable-record-update': async (ctx) => {
    const miss = requireFields(ctx.config, ['baseId', 'tableId', 'recordId'], 'airtable-record-update');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const fields = parseMaybeJson(ctx.config.fields);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { error: { message: 'airtable-record-update: fields must be a JSON object' } };
    }
    const res = await httpJson({
      method: 'PATCH',
      url: `${tableUrl(ctx)}/${encodeURIComponent(String(ctx.config.recordId))}`,
      bearer: token,
      json: { fields },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'airtable-record-get': async (ctx) => {
    const miss = requireFields(ctx.config, ['baseId', 'tableId', 'recordId'], 'airtable-record-get');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const res = await httpJson({
      method: 'GET',
      url: `${tableUrl(ctx)}/${encodeURIComponent(String(ctx.config.recordId))}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'airtable-record-delete': async (ctx) => {
    const miss = requireFields(ctx.config, ['baseId', 'tableId', 'recordId'], 'airtable-record-delete');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const res = await httpJson({
      method: 'DELETE',
      url: `${tableUrl(ctx)}/${encodeURIComponent(String(ctx.config.recordId))}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'airtable-list-records': async (ctx) => {
    const miss = requireFields(ctx.config, ['baseId', 'tableId'], 'airtable-list-records');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const maxRecords = Number(ctx.config.maxRecords ?? 100);
    const res = await httpJson<{ records?: unknown[] }>({
      method: 'GET',
      url: tableUrl(ctx),
      bearer: token,
      query: {
        filterByFormula: ctx.config.filterByFormula ? String(ctx.config.filterByFormula) : undefined,
        view: ctx.config.view ? String(ctx.config.view) : undefined,
        maxRecords: Number.isFinite(maxRecords) && maxRecords > 0 ? maxRecords : undefined,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res, (d) => d?.records ?? []);
  },

  'airtable-record-find': async (ctx) => {
    const miss = requireFields(ctx.config, ['baseId', 'tableId', 'filterByFormula'], 'airtable-record-find');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const res = await httpJson<{ records?: unknown[] }>({
      method: 'GET',
      url: tableUrl(ctx),
      bearer: token,
      query: {
        filterByFormula: String(ctx.config.filterByFormula),
        maxRecords: 1,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    const first = res.data?.records?.[0];
    if (!first) return { notFound: { filterByFormula: String(ctx.config.filterByFormula) } };
    return { out: first };
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'airtable',
  name: 'Airtable',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
