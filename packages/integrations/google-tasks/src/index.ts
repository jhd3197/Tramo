/**
 * @tramo/google-tasks — official Google Tasks integration pack.
 * Create, complete, list, and delete tasks via the Google Tasks API.
 * Auth: OAuth 2.0 access token supplied per-node as a secret field.
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  toEnvelope,
  requireFields,
  renderTemplate,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#4285f4';
const API = 'https://tasks.googleapis.com/tasks/v1';

const DEFINITION: IntegrationDefinition = {
  id: 'google-tasks',
  name: 'Google Tasks',
  description: 'Create, complete, list, and delete tasks.',
  iconBrand: 'googletasks',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'google-tasks-create',
    integrationId: 'google-tasks',
    name: 'Google Tasks · Create Task',
    operationName: 'Create task',
    category: 'action',
    description: 'Create a new task in the specified task list.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Task', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: '' },
      { key: 'notes', type: 'textarea', label: 'Notes', default: '', optional: true },
      { key: 'due', type: 'text', label: 'Due', default: '', optional: true, help: 'RFC 3339 timestamp, e.g. 2026-06-01T00:00:00Z' },
    ],
  },
  {
    id: 'google-tasks-complete',
    integrationId: 'google-tasks',
    name: 'Google Tasks · Complete Task',
    operationName: 'Complete task',
    category: 'action',
    description: 'Mark an existing task as completed.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Task', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'taskId', type: 'text', label: 'Task ID', default: '' },
    ],
  },
  {
    id: 'google-tasks-list',
    integrationId: 'google-tasks',
    name: 'Google Tasks · List Tasks',
    operationName: 'List tasks',
    category: 'action',
    description: 'List tasks from the specified task list.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Tasks', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'showCompleted', type: 'boolean', label: 'Show completed', default: false, optional: true },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 50, optional: true },
    ],
  },
  {
    id: 'google-tasks-delete',
    integrationId: 'google-tasks',
    name: 'Google Tasks · Delete Task',
    operationName: 'Delete task',
    category: 'action',
    description: 'Delete a task from the specified task list.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'taskListId', type: 'text', label: 'Task list ID', default: '@default' },
      { key: 'taskId', type: 'text', label: 'Task ID', default: '' },
    ],
  },
  {
    id: 'google-tasks-list-tasklists',
    integrationId: 'google-tasks',
    name: 'Google Tasks · List Task Lists',
    operationName: 'List task lists',
    category: 'action',
    description: 'List all task lists for the authenticated user.',
    icon: 'Cable',
    iconBrand: 'googletasks',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Task Lists', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 20, optional: true },
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

const listId = (ctx: ExecutionContext): string =>
  String(ctx.config.taskListId ?? '@default').trim() || '@default';

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'google-tasks-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['title'], 'google-tasks-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-tasks-create');
    const due = String(ctx.config.due ?? '').trim();
    const res = await httpJson({
      method: 'POST',
      url: `${API}/lists/${encodeURIComponent(listId(ctx))}/tasks`,
      bearer: token,
      json: {
        title: tpl(ctx, 'title'),
        ...(ctx.config.notes ? { notes: tpl(ctx, 'notes') } : {}),
        ...(due ? { due } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-tasks-complete': async (ctx) => {
    const miss = requireFields(ctx.config, ['taskId'], 'google-tasks-complete');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-tasks-complete');
    const res = await httpJson({
      method: 'PATCH',
      url: `${API}/lists/${encodeURIComponent(listId(ctx))}/tasks/${encodeURIComponent(String(ctx.config.taskId))}`,
      bearer: token,
      json: { status: 'completed', completed: new Date().toISOString() },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res);
  },

  'google-tasks-list': async (ctx) => {
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-tasks-list');
    const res = await httpJson<{ items?: unknown[] }>({
      method: 'GET',
      url: `${API}/lists/${encodeURIComponent(listId(ctx))}/tasks`,
      query: {
        showCompleted: ctx.config.showCompleted === true,
        showHidden: ctx.config.showCompleted === true,
        maxResults: ctx.config.maxResults != null ? Number(ctx.config.maxResults) : 50,
      },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res, (d) => (d?.items ?? []));
  },

  'google-tasks-delete': async (ctx) => {
    const miss = requireFields(ctx.config, ['taskId'], 'google-tasks-delete');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-tasks-delete');
    const taskId = String(ctx.config.taskId);
    const res = await httpJson({
      method: 'DELETE',
      url: `${API}/lists/${encodeURIComponent(listId(ctx))}/tasks/${encodeURIComponent(taskId)}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return res.ok ? { out: { deleted: true, taskId } } : toEnvelope(res);
  },

  'google-tasks-list-tasklists': async (ctx) => {
    const token = tokenOf(ctx);
    if (!token) return missingToken('google-tasks-list-tasklists');
    const res = await httpJson<{ items?: unknown[] }>({
      method: 'GET',
      url: `${API}/users/@me/lists`,
      query: { maxResults: ctx.config.maxResults != null ? Number(ctx.config.maxResults) : 20 },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    return toEnvelope(res, (d) => (d?.items ?? []));
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'google-tasks',
  name: 'Google Tasks',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
