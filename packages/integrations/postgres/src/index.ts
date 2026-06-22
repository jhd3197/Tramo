/**
 * @tramo/postgres — official PostgreSQL integration pack.
 *
 * Query / write / upsert nodes against a Postgres database.
 * Auth: a single connection string per node (postgres://user:pass@host:port/db).
 */

import {
  defineNodePack,
  defineStubExecutor,
  requireFields,
  renderTemplate,
  parseMaybeJson,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

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

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

interface PgRunResult {
  rows: unknown[];
  rowCount: number | null;
}

interface PgClient {
  connect: () => Promise<void>;
  query: (text: string, params?: unknown[]) => Promise<PgRunResult>;
  end: () => Promise<void>;
}

/** Resolve a pg connection config from the node fields or PG-prefixed / DATABASE_URL env. */
function connConfig(ctx: ExecutionContext): { config: Record<string, unknown> } | { error: { message: string } } {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const connectionString =
    (ctx.config.connectionString ? String(ctx.config.connectionString) : '') ||
    (env?.DATABASE_URL ?? '') ||
    (env?.PG_CONNECTION_STRING ?? '');
  if (connectionString) return { config: { connectionString } };

  const host = (ctx.config.host ? String(ctx.config.host) : '') || (env?.PGHOST ?? '');
  if (host) {
    return {
      config: {
        host,
        port: ctx.config.port ? Number(ctx.config.port) : (env?.PGPORT ? Number(env.PGPORT) : 5432),
        user: (ctx.config.user ? String(ctx.config.user) : '') || (env?.PGUSER ?? undefined),
        password: (ctx.config.password ? String(ctx.config.password) : '') || (env?.PGPASSWORD ?? undefined),
        database: (ctx.config.database ? String(ctx.config.database) : '') || (env?.PGDATABASE ?? undefined),
      },
    };
  }
  return {
    error: {
      message:
        'postgres: a connection is required — set config.connectionString (or host/port/user/password/database), or env DATABASE_URL / PGHOST',
    },
  };
}

/** Acquire a connected pg Client, or return an error envelope. */
async function getClient(
  ctx: ExecutionContext,
): Promise<{ client: PgClient } | { error: { message: string } }> {
  // pg is an optional peer dependency — loaded lazily so the pack installs without it.
  // @ts-expect-error optional dep: 'pg' may not be installed / typed in this workspace.
  const pg: any = await import('pg').catch(() => null);
  if (!pg) {
    return { error: { message: 'postgres: the "pg" package is not installed — run `npm i pg`' } };
  }
  const cfg = connConfig(ctx);
  if ('error' in cfg) return cfg;
  const Client = pg.default?.Client ?? pg.Client;
  const client: PgClient = new Client(cfg.config);
  try {
    await client.connect();
  } catch (e) {
    return { error: { message: `postgres: failed to connect — ${e instanceof Error ? e.message : String(e)}` } };
  }
  return { client };
}

/** Render {{var}} inside string values of a { column: value } object. */
function renderValues(ctx: ExecutionContext, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = typeof v === 'string' ? renderTemplate(v, ctx.inputs.in, ctx.vars, ctx.steps) : v;
  }
  return out;
}

const asArray = (v: unknown): unknown[] => {
  const parsed = parseMaybeJson(v);
  return Array.isArray(parsed) ? parsed : [];
};

const ident = (name: string): string => `"${String(name).replace(/"/g, '""')}"`;

async function withClient(
  ctx: ExecutionContext,
  run: (client: PgClient) => Promise<NodeExecutionResult>,
): Promise<NodeExecutionResult> {
  const got = await getClient(ctx);
  if ('error' in got) return got;
  const { client } = got;
  try {
    return await run(client);
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore close errors */
    }
  }
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'postgres-query': async (ctx) => {
    const miss = requireFields(ctx.config, ['sql'], 'postgres-query');
    if (miss) return miss;
    return withClient(ctx, async (client) => {
      const res = await client.query(String(ctx.config.sql), asArray(ctx.config.params));
      return { out: { rows: res.rows, rowCount: res.rowCount } };
    });
  },

  'postgres-exec': async (ctx) => {
    const miss = requireFields(ctx.config, ['sql'], 'postgres-exec');
    if (miss) return miss;
    return withClient(ctx, async (client) => {
      const res = await client.query(String(ctx.config.sql), asArray(ctx.config.params));
      return { out: { rows: res.rows, rowCount: res.rowCount } };
    });
  },

  'postgres-insert': async (ctx) => {
    const miss = requireFields(ctx.config, ['table'], 'postgres-insert');
    if (miss) return miss;
    const values = renderValues(ctx, parseMaybeJson(ctx.config.values));
    const cols = Object.keys(values);
    if (cols.length === 0) return { error: { message: 'postgres-insert: values object is empty' } };
    return withClient(ctx, async (client) => {
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const returning = ctx.config.returning ? String(ctx.config.returning) : '*';
      const sql = `INSERT INTO ${ident(String(ctx.config.table))} (${cols.map(ident).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${returning}`;
      const res = await client.query(sql, cols.map((c) => values[c]));
      return { out: { rows: res.rows, rowCount: res.rowCount, row: res.rows[0] ?? null } };
    });
  },

  'postgres-update': async (ctx) => {
    const miss = requireFields(ctx.config, ['table', 'where'], 'postgres-update');
    if (miss) return miss;
    const values = renderValues(ctx, parseMaybeJson(ctx.config.values));
    const cols = Object.keys(values);
    if (cols.length === 0) return { error: { message: 'postgres-update: values object is empty' } };
    const whereParams = asArray(ctx.config.whereParams);
    return withClient(ctx, async (client) => {
      const setClause = cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ');
      // Shift WHERE's $1..$N up past the SET params so positional refs stay consistent.
      const offset = cols.length;
      const where = String(ctx.config.where).replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
      const sql = `UPDATE ${ident(String(ctx.config.table))} SET ${setClause} WHERE ${where} RETURNING *`;
      const res = await client.query(sql, [...cols.map((c) => values[c]), ...whereParams]);
      return { out: { rows: res.rows, rowCount: res.rowCount } };
    });
  },

  'postgres-delete': async (ctx) => {
    const miss = requireFields(ctx.config, ['table', 'where'], 'postgres-delete');
    if (miss) return miss;
    const whereParams = asArray(ctx.config.whereParams);
    return withClient(ctx, async (client) => {
      const sql = `DELETE FROM ${ident(String(ctx.config.table))} WHERE ${String(ctx.config.where)} RETURNING *`;
      const res = await client.query(sql, whereParams);
      return { out: { rows: res.rows, rowCount: res.rowCount } };
    });
  },

  'postgres-upsert': async (ctx) => {
    const miss = requireFields(ctx.config, ['table', 'conflictColumns'], 'postgres-upsert');
    if (miss) return miss;
    const values = renderValues(ctx, parseMaybeJson(ctx.config.values));
    const cols = Object.keys(values);
    if (cols.length === 0) return { error: { message: 'postgres-upsert: values object is empty' } };
    const conflictCols = String(ctx.config.conflictColumns).split(',').map((s) => s.trim()).filter(Boolean);
    if (conflictCols.length === 0) return { error: { message: 'postgres-upsert: conflictColumns is empty' } };
    const updateOnConflict = ctx.config.updateOnConflict !== false;
    return withClient(ctx, async (client) => {
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const updatable = cols.filter((c) => !conflictCols.includes(c));
      const onConflict = updateOnConflict && updatable.length
        ? `DO UPDATE SET ${updatable.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}`
        : 'DO NOTHING';
      const sql = `INSERT INTO ${ident(String(ctx.config.table))} (${cols.map(ident).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflictCols.map(ident).join(', ')}) ${onConflict} RETURNING *`;
      const res = await client.query(sql, cols.map((c) => values[c]));
      return { out: { rows: res.rows, rowCount: res.rowCount, row: res.rows[0] ?? null } };
    });
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'postgres',
  name: 'PostgreSQL',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
