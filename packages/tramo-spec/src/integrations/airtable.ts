/**
 * Airtable integration pack.
 *
 * Sibling to the notion pack for tabular data. Uses Airtable's REST API
 * via a personal access token (replaces the deprecated API keys).
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#fcb400';

export const DEFINITION: IntegrationDefinition = {
  id: 'airtable',
  name: 'Airtable',
  description: 'Records, fields, table queries.',
  iconBrand: 'airtable',
  color: COLOR,
  category: 'Productivity',
};

export const NODES: NodeDefinition[] = [
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
      { key: 'maxRecords', type: 'number', label: 'Max records', default: 100, optional: true },
    ],
  },
];
