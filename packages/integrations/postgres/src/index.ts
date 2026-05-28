/**
 * @tramo/postgres — official PostgreSQL integration pack.
 *
 * Query / write / upsert nodes against a Postgres database.
 * Auth: a single connection string per node (postgres://user:pass@host:port/db).
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#336791';

const DEFINITION: IntegrationDefinition = {
  id: 'postgres',
  name: 'PostgreSQL',
  description: 'Query, insert, update, delete, upsert.',
  iconBrand: 'postgresql',
  color: COLOR,
  category: 'Developer',
};

const NODES: NodeDefinition[] = [
  {
    id: 'postgres-query',
    integrationId: 'postgres',
    name: 'Postgres · Query',
    operationName: 'Query (SELECT)',
    category: 'action',
    description: 'Run a parameterised SELECT and return the resulting rows.',
    icon: 'Cable',
    iconBrand: 'postgresql',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Rows', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'connectionString', type: 'secret', label: 'Connection string', help: 'postgres://user:pass@host:port/db' },
      { key: 'sql', type: 'textarea', label: 'SQL', default: 'SELECT * FROM users WHERE created_at > $1 LIMIT $2', help: 'Parameterised SQL; use $1, $2…' },
      { key: 'params', type: 'json', label: 'Params', default: '[]', help: 'JSON array of values for $1, $2…' },
    ],
  },
  {
    id: 'postgres-exec',
    integrationId: 'postgres',
    name: 'Postgres · Execute',
    operationName: 'Execute (DDL / write)',
    category: 'action',
    description: 'Run a DDL statement or write that does not return rows.',
    icon: 'Cable',
    iconBrand: 'postgresql',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Result', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'connectionString', type: 'secret', label: 'Connection string', help: 'postgres://user:pass@host:port/db' },
      { key: 'sql', type: 'textarea', label: 'SQL', default: 'CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY)' },
      { key: 'params', type: 'json', label: 'Params', default: '[]', optional: true, help: 'JSON array of values for $1, $2…' },
    ],
  },
  {
    id: 'postgres-insert',
    integrationId: 'postgres',
    name: 'Postgres · Insert Row',
    operationName: 'Insert row',
    category: 'action',
    description: 'Insert a single row into a table and return the inserted record.',
    icon: 'Cable',
    iconBrand: 'postgresql',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Row', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'connectionString', type: 'secret', label: 'Connection string', help: 'postgres://user:pass@host:port/db' },
      { key: 'table', type: 'text', label: 'Table' },
      { key: 'values', type: 'json', label: 'Values', default: '{}', help: 'Object of { column: value }; supports {{var}} in string values' },
      { key: 'returning', type: 'text', label: 'Returning', default: '*', optional: true, help: 'RETURNING clause' },
    ],
  },
  {
    id: 'postgres-update',
    integrationId: 'postgres',
    name: 'Postgres · Update Rows',
    operationName: 'Update rows',
    category: 'action',
    description: 'Update rows matching a WHERE clause.',
    icon: 'Cable',
    iconBrand: 'postgresql',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'connectionString', type: 'secret', label: 'Connection string', help: 'postgres://user:pass@host:port/db' },
      { key: 'table', type: 'text', label: 'Table' },
      { key: 'values', type: 'json', label: 'Values', default: '{}', help: 'Columns to set' },
      { key: 'where', type: 'textarea', label: 'Where', default: 'id = $1', help: 'WHERE clause with $1…$N positional params' },
      { key: 'whereParams', type: 'json', label: 'Where params', default: '[]' },
    ],
  },
  {
    id: 'postgres-delete',
    integrationId: 'postgres',
    name: 'Postgres · Delete Rows',
    operationName: 'Delete rows',
    category: 'action',
    description: 'Delete rows matching a WHERE clause.',
    icon: 'Cable',
    iconBrand: 'postgresql',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'connectionString', type: 'secret', label: 'Connection string', help: 'postgres://user:pass@host:port/db' },
      { key: 'table', type: 'text', label: 'Table' },
      { key: 'where', type: 'textarea', label: 'Where', default: 'id = $1' },
      { key: 'whereParams', type: 'json', label: 'Where params', default: '[]' },
    ],
  },
  {
    id: 'postgres-upsert',
    integrationId: 'postgres',
    name: 'Postgres · Upsert Row',
    operationName: 'Upsert row',
    category: 'action',
    description: 'Insert a row or update it on conflict with the given unique columns.',
    icon: 'Cable',
    iconBrand: 'postgresql',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Row', type: 'object' }],
    fields: [
      { key: 'connectionString', type: 'secret', label: 'Connection string', help: 'postgres://user:pass@host:port/db' },
      { key: 'table', type: 'text', label: 'Table' },
      { key: 'values', type: 'json', label: 'Values', default: '{}' },
      { key: 'conflictColumns', type: 'text', label: 'Conflict columns', default: 'id', help: 'Comma-separated unique columns for ON CONFLICT' },
      { key: 'updateOnConflict', type: 'boolean', label: 'Update on conflict', default: true, optional: true, help: 'False = DO NOTHING' },
    ],
  },
];

export default defineNodePack({
  id: 'postgres',
  name: 'PostgreSQL',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
