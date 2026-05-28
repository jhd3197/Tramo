/**
 * Notion integration pack.
 *
 * Internal-integration token based. Database ids are the long hex from the
 * URL with dashes stripped or kept — Notion accepts both.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#000000';

export const DEFINITION: IntegrationDefinition = {
  id: 'notion',
  name: 'Notion',
  description: 'Pages, database rows, blocks, search.',
  iconBrand: 'notion',
  color: COLOR,
  category: 'Productivity',
};

export const NODES: NodeDefinition[] = [
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
