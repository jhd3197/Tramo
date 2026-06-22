/**
 * @tramo/notion — official Notion integration pack.
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

const COLOR = '#000000';
const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

const DEFINITION: IntegrationDefinition = {
  id: 'notion',
  name: 'Notion',
  description: 'Pages, database rows, blocks, search.',
  iconBrand: 'notion',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'notion-page-create',
    integrationId: 'notion',
    name: 'Notion · Create Page',
    operationName: 'Create page',
    category: 'action',
    description: 'Create a new page inside a parent page or database.',
    icon: 'Cable',
    iconBrand: 'notion',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Page', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Internal integration token' },
      { key: 'parentId', type: 'text', label: 'Parent page or database ID', default: '' },
      {
        key: 'parentKind',
        type: 'select',
        label: 'Parent type',
        default: 'page_id',
        options: [
          { label: 'Page', value: 'page_id' },
          { label: 'Database', value: 'database_id' },
        ],
      },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: 'New page from tramo' },
      { key: 'properties', type: 'json', label: 'Extra properties (JSON)', default: '{}', optional: true },
    ],
  },
  {
    id: 'notion-page-update',
    integrationId: 'notion',
    name: 'Notion · Update Page',
    operationName: 'Update page',
    category: 'action',
    description: 'Patch properties (and optionally archive) on an existing page.',
    icon: 'Cable',
    iconBrand: 'notion',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Page', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Internal integration token' },
      { key: 'pageId', type: 'text', label: 'Page ID', default: '' },
      { key: 'properties', type: 'json', label: 'Properties to set (JSON)', default: '{}' },
      { key: 'archived', type: 'boolean', label: 'Archive page', default: false, optional: true },
    ],
  },
  {
    id: 'notion-page-get',
    integrationId: 'notion',
    name: 'Notion · Get Page',
    operationName: 'Get page',
    category: 'action',
    description: 'Retrieve a page (properties + metadata) by ID.',
    icon: 'Cable',
    iconBrand: 'notion',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Page', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Internal integration token' },
      { key: 'pageId', type: 'text', label: 'Page ID', default: '' },
    ],
  },
  {
    id: 'notion-database-query',
    integrationId: 'notion',
    name: 'Notion · Query Database',
    operationName: 'Query database',
    category: 'action',
    description: 'Run a filter+sort query against a Notion database.',
    icon: 'Cable',
    iconBrand: 'notion',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Rows', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'token', type: 'secret', label: 'Internal integration token' },
      { key: 'databaseId', type: 'text', label: 'Database ID', default: '' },
      { key: 'filter', type: 'json', label: 'Filter (JSON)', default: '{}', optional: true },
      { key: 'sorts', type: 'json', label: 'Sorts (JSON array)', default: '[]', optional: true },
      { key: 'pageSize', type: 'number', label: 'Page size', default: 50, optional: true },
    ],
  },
  {
    id: 'notion-block-append',
    integrationId: 'notion',
    name: 'Notion · Append Blocks',
    operationName: 'Append blocks',
    category: 'action',
    description: 'Append child blocks (paragraphs, headings, todos) to a page.',
    icon: 'Cable',
    iconBrand: 'notion',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'token', type: 'secret', label: 'Internal integration token' },
      { key: 'pageId', type: 'text', label: 'Page ID', default: '' },
      { key: 'blocks', type: 'json', label: 'Blocks (JSON array)', default: '[]' },
    ],
  },
  {
    id: 'notion-search',
    integrationId: 'notion',
    name: 'Notion · Search Workspace',
    operationName: 'Search workspace',
    category: 'action',
    description: 'Search pages and databases visible to the integration token.',
    icon: 'Cable',
    iconBrand: 'notion',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Results', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'token', type: 'secret', label: 'Internal integration token' },
      { key: 'query', type: 'text', label: 'Query (supports {{var}})', default: '', optional: true },
      {
        key: 'filter',
        type: 'select',
        label: 'Filter',
        default: 'all',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Pages only', value: 'page' },
          { label: 'Databases only', value: 'database' },
        ],
      },
      { key: 'pageSize', type: 'number', label: 'Page size', default: 25, optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined => {
  const fromConfig = ctx.config.token ?? ctx.config.apiKey;
  if (fromConfig) return String(fromConfig);
  return typeof process !== 'undefined' ? process.env?.NOTION_TOKEN : undefined;
};

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

function notionHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'notion-version': NOTION_VERSION,
    'content-type': 'application/json',
  };
}

const missingToken = { error: { message: 'notion: token required (config.token or NOTION_TOKEN)' } };

/** Build a Notion `title` property value from a plain string. */
function titleProp(text: string): unknown {
  return { title: [{ type: 'text', text: { content: text } }] };
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'notion-page-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['parentId'], 'notion-page-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const parentKind = String(ctx.config.parentKind ?? 'page_id');
    const parent = parentKind === 'database_id'
      ? { database_id: String(ctx.config.parentId) }
      : { page_id: String(ctx.config.parentId) };
    const extra = parseMaybeJson(ctx.config.properties);
    const title = tpl(ctx, 'title');
    const properties: Record<string, unknown> = {
      ...(title ? { title: titleProp(title) } : {}),
      ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {}),
    };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/pages`,
      headers: notionHeaders(token),
      json: { parent, properties },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'notion-page-update': async (ctx) => {
    const miss = requireFields(ctx.config, ['pageId'], 'notion-page-update');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const props = parseMaybeJson(ctx.config.properties);
    const res = await httpJson({
      method: 'PATCH',
      url: `${API}/pages/${String(ctx.config.pageId)}`,
      headers: notionHeaders(token),
      json: {
        ...(props && typeof props === 'object' ? { properties: props } : {}),
        ...(ctx.config.archived === true ? { archived: true } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'notion-page-get': async (ctx) => {
    const miss = requireFields(ctx.config, ['pageId'], 'notion-page-get');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const res = await httpJson({
      method: 'GET',
      url: `${API}/pages/${String(ctx.config.pageId)}`,
      headers: notionHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'notion-database-query': async (ctx) => {
    const miss = requireFields(ctx.config, ['databaseId'], 'notion-database-query');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const filter = parseMaybeJson(ctx.config.filter);
    const sorts = parseMaybeJson(ctx.config.sorts);
    const pageSize = Number(ctx.config.pageSize ?? 50);
    const res = await httpJson<{ results?: unknown[] }>({
      method: 'POST',
      url: `${API}/databases/${String(ctx.config.databaseId)}/query`,
      headers: notionHeaders(token),
      json: {
        ...(filter && typeof filter === 'object' && Object.keys(filter as object).length ? { filter } : {}),
        ...(Array.isArray(sorts) && sorts.length ? { sorts } : {}),
        ...(Number.isFinite(pageSize) && pageSize > 0 ? { page_size: pageSize } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res, (d) => d?.results ?? []);
  },

  'notion-block-append': async (ctx) => {
    const miss = requireFields(ctx.config, ['pageId'], 'notion-block-append');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const blocks = parseMaybeJson(ctx.config.blocks);
    if (!Array.isArray(blocks)) {
      return { error: { message: 'notion-block-append: blocks must be a JSON array' } };
    }
    const res = await httpJson({
      method: 'PATCH',
      url: `${API}/blocks/${String(ctx.config.pageId)}/children`,
      headers: notionHeaders(token),
      json: { children: blocks },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'notion-search': async (ctx) => {
    const token = tokenOf(ctx);
    if (!token) return missingToken;
    const query = tpl(ctx, 'query');
    const filterSel = String(ctx.config.filter ?? 'all');
    const pageSize = Number(ctx.config.pageSize ?? 25);
    const res = await httpJson<{ results?: unknown[] }>({
      method: 'POST',
      url: `${API}/search`,
      headers: notionHeaders(token),
      json: {
        ...(query ? { query } : {}),
        ...(filterSel === 'page' || filterSel === 'database'
          ? { filter: { property: 'object', value: filterSel } }
          : {}),
        ...(Number.isFinite(pageSize) && pageSize > 0 ? { page_size: pageSize } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res, (d) => d?.results ?? []);
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'notion',
  name: 'Notion',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
