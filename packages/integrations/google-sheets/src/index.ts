/**
 * @tramo/google-sheets — official Google Sheets integration pack.
 *
 * Spreadsheet operations (read, append, update, find, clear, create sheet)
 * with stub executors. Auth model: per-node OAuth2 bearer token (secret field).
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#0f9d58';

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

export default defineNodePack({
  id: 'google-sheets',
  name: 'Google Sheets',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
