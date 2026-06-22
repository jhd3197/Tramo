/**
 * @tramo/google-sheets — official Google Sheets integration pack.
 *
 * Spreadsheet operations (read, append, update, find, clear, create sheet)
 * with stub executors. Auth model: per-node OAuth2 bearer token (secret field).
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

const COLOR = '#0f9d58';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

const DEFINITION: IntegrationDefinition = {
  id: 'google-sheets',
  name: 'Google Sheets',
  description: 'Read rows, append, update cells, find rows.',
  iconBrand: 'googlesheets',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'google-sheets-read-rows',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Read Rows',
    operationName: 'Read rows',
    category: 'action',
    description: 'Read rows from a sheet range and optionally map them via a header row.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Rows', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'range', type: 'text', label: 'Range', default: 'Sheet1!A:Z', help: 'A1 notation, e.g. Sheet1!A1:C10' },
      { key: 'headerRow', type: 'boolean', label: 'First row is header', default: true, optional: true },
    ],
  },
  {
    id: 'google-sheets-append-row',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Append Row',
    operationName: 'Append row',
    category: 'action',
    description: 'Append a single row of values to the end of a range.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'UpdateResult', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'range', type: 'text', label: 'Range', default: 'Sheet1!A:Z' },
      { key: 'values', type: 'json', label: 'Values', default: '[]', help: 'Array of cell values for one row, supports {{var}}' },
      {
        key: 'valueInputOption',
        type: 'select',
        label: 'Value input option',
        default: 'USER_ENTERED',
        options: [
          { label: 'USER_ENTERED', value: 'USER_ENTERED' },
          { label: 'RAW', value: 'RAW' },
        ],
      },
    ],
  },
  {
    id: 'google-sheets-update-row',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Update Row',
    operationName: 'Update row',
    category: 'action',
    description: 'Overwrite the cells inside a specific range with new values.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'UpdateResult', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'range', type: 'text', label: 'Range', default: '' },
      { key: 'values', type: 'json', label: 'Values', default: '[]' },
      {
        key: 'valueInputOption',
        type: 'select',
        label: 'Value input option',
        default: 'USER_ENTERED',
        options: [
          { label: 'USER_ENTERED', value: 'USER_ENTERED' },
          { label: 'RAW', value: 'RAW' },
        ],
      },
    ],
  },
  {
    id: 'google-sheets-get-cell',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Get Cell',
    operationName: 'Get cell',
    category: 'action',
    description: 'Read the value of a single cell by A1 reference.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Cell', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'cell', type: 'text', label: 'Cell', default: 'Sheet1!A1' },
    ],
  },
  {
    id: 'google-sheets-set-cell',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Set Cell',
    operationName: 'Set cell',
    category: 'action',
    description: 'Write a single value into a single cell.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'UpdateResult', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'cell', type: 'text', label: 'Cell', default: 'Sheet1!A1' },
      { key: 'value', type: 'text', label: 'Value (supports {{var}})', default: '' },
    ],
  },
  {
    id: 'google-sheets-find-row',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Find Row',
    operationName: 'Find row',
    category: 'action',
    description: 'Find the first row where a column equals a given value.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Row', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'range', type: 'text', label: 'Range', default: 'Sheet1!A:Z' },
      { key: 'columnName', type: 'text', label: 'Column name', default: '', help: 'Header name when headerRow is true' },
      { key: 'value', type: 'text', label: 'Value (supports {{var}})', default: '' },
    ],
  },
  {
    id: 'google-sheets-clear-range',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Clear Range',
    operationName: 'Clear range',
    category: 'action',
    description: 'Clear all values from the cells in a range.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'range', type: 'text', label: 'Range', default: '' },
    ],
  },
  {
    id: 'google-sheets-create-sheet',
    integrationId: 'google-sheets',
    name: 'Google Sheets · Create Sheet (Tab)',
    operationName: 'Create sheet',
    category: 'action',
    description: 'Add a new sheet tab to an existing spreadsheet.',
    icon: 'Cable',
    iconBrand: 'googlesheets',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sheet', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token' },
      { key: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID', default: '' },
      { key: 'title', type: 'text', label: 'Title', default: '' },
      { key: 'rowCount', type: 'number', label: 'Row count', default: 1000, optional: true },
      { key: 'columnCount', type: 'number', label: 'Column count', default: 26, optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.oauthToken
    ? String(ctx.config.oauthToken)
    : (typeof process !== 'undefined' ? process.env?.GOOGLE_OAUTH_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const missingToken = (id: string) => ({
  error: { message: `${id}: OAuth token required (config.oauthToken or GOOGLE_OAUTH_TOKEN)` },
});

const valuesUrl = (spreadsheetId: string, range: string): string =>
  `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;

/** Render the `values` field (which may carry {{var}}), then parse it into a 2-D array of cells. */
function renderRow(ctx: ExecutionContext): unknown[] {
  const rendered = tpl(ctx, 'values');
  const parsed = parseMaybeJson(rendered);
  if (Array.isArray(parsed)) return parsed;
  return parsed == null ? [] : [parsed];
}

/** Map a values matrix to objects using the first row as header keys. */
function mapWithHeader(values: unknown[][]): Record<string, unknown>[] {
  if (values.length === 0) return [];
  const header = (values[0] ?? []).map((h) => String(h));
  return values.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    header.forEach((key, i) => { obj[key] = row[i]; });
    return obj;
  });
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'google-sheets-read-rows': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'range'], 'google-sheets-read-rows');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-read-rows');
    const res = await httpJson<{ values?: unknown[][] }>({
      method: 'GET',
      url: valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.range)),
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    if (!res.ok) return toEnvelope(res);
    const values = res.data?.values ?? [];
    const header = ctx.config.headerRow === undefined ? true : ctx.config.headerRow === true;
    return { out: header ? mapWithHeader(values as unknown[][]) : values };
  },

  'google-sheets-append-row': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'range'], 'google-sheets-append-row');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-append-row');
    const res = await httpJson({
      method: 'POST',
      url: `${valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.range))}:append`,
      query: {
        valueInputOption: String(ctx.config.valueInputOption ?? 'USER_ENTERED'),
        insertDataOption: 'INSERT_ROWS',
        includeValuesInResponse: true,
      },
      bearer: token,
      json: { values: [renderRow(ctx)] },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-sheets-update-row': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'range'], 'google-sheets-update-row');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-update-row');
    const res = await httpJson({
      method: 'PUT',
      url: valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.range)),
      query: {
        valueInputOption: String(ctx.config.valueInputOption ?? 'USER_ENTERED'),
        includeValuesInResponse: true,
      },
      bearer: token,
      json: { range: String(ctx.config.range), values: [renderRow(ctx)] },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-sheets-get-cell': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'cell'], 'google-sheets-get-cell');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-get-cell');
    const res = await httpJson<{ values?: unknown[][]; range?: string }>({
      method: 'GET',
      url: valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.cell)),
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    if (!res.ok) return toEnvelope(res);
    const value = res.data?.values?.[0]?.[0] ?? null;
    return { out: { cell: String(ctx.config.cell), range: res.data?.range, value } };
  },

  'google-sheets-set-cell': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'cell'], 'google-sheets-set-cell');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-set-cell');
    const res = await httpJson({
      method: 'PUT',
      url: valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.cell)),
      query: { valueInputOption: 'USER_ENTERED', includeValuesInResponse: true },
      bearer: token,
      json: { range: String(ctx.config.cell), values: [[tpl(ctx, 'value')]] },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-sheets-find-row': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'range', 'columnName'], 'google-sheets-find-row');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-find-row');
    const res = await httpJson<{ values?: unknown[][] }>({
      method: 'GET',
      url: valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.range)),
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    if (!res.ok) return toEnvelope(res);
    const values = (res.data?.values ?? []) as unknown[][];
    const target = tpl(ctx, 'value');
    const columnName = String(ctx.config.columnName);
    const header = (values[0] ?? []).map((h) => String(h));
    const colIndex = header.indexOf(columnName);
    if (colIndex === -1) {
      return { notFound: { reason: `column "${columnName}" not found in header`, columnName } };
    }
    for (let i = 1; i < values.length; i++) {
      const row = values[i] ?? [];
      if (String(row[colIndex] ?? '') === target) {
        const obj: Record<string, unknown> = {};
        header.forEach((key, idx) => { obj[key] = row[idx]; });
        return { out: { rowNumber: i + 1, row: obj } };
      }
    }
    return { notFound: { columnName, value: target } };
  },

  'google-sheets-clear-range': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'range'], 'google-sheets-clear-range');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-clear-range');
    const res = await httpJson({
      method: 'POST',
      url: `${valuesUrl(String(ctx.config.spreadsheetId), String(ctx.config.range))}:clear`,
      bearer: token,
      json: {},
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-sheets-create-sheet': async (ctx) => {
    const miss = requireFields(ctx.config, ['spreadsheetId', 'title'], 'google-sheets-create-sheet');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-sheets-create-sheet');
    const res = await httpJson({
      method: 'POST',
      url: `${API}/${encodeURIComponent(String(ctx.config.spreadsheetId))}:batchUpdate`,
      bearer: token,
      json: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tpl(ctx, 'title'),
                gridProperties: {
                  rowCount: ctx.config.rowCount != null ? Number(ctx.config.rowCount) : 1000,
                  columnCount: ctx.config.columnCount != null ? Number(ctx.config.columnCount) : 26,
                },
              },
            },
          },
        ],
      },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res, (d) => {
      const reply = (d as { replies?: Array<{ addSheet?: { properties?: unknown } }> })?.replies?.[0]?.addSheet?.properties;
      return reply ?? d;
    });
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'google-sheets',
  name: 'Google Sheets',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
