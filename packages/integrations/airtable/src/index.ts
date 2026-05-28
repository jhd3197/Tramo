/**
 * @tramo/airtable — official Airtable integration pack.
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#fcb400';

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

export default defineNodePack({
  id: 'airtable',
  name: 'Airtable',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
