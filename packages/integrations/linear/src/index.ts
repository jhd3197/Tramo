/**
 * @tramo/linear — official Linear integration pack.
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  requireFields,
  renderTemplate,
  parseMaybeJson,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#5e6ad2';
const API = 'https://api.linear.app/graphql';

const DEFINITION: IntegrationDefinition = {
  id: 'linear',
  name: 'Linear',
  description: 'Tickets, comments, projects, search.',
  iconBrand: 'linear',
  color: COLOR,
  category: 'Developer',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:linear:issue-change',
    integrationId: 'linear',
    name: 'Linear · On Issue Change',
    operationName: 'On issue change',
    category: 'trigger',
    description: 'Fires when Linear posts an Issue webhook (create / update / remove).',
    icon: 'CloudDownload',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/linear/issues', help: 'Configure this URL in Linear → Settings → API → Webhooks.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'actions', type: 'text', label: 'Filter actions (create, update, remove)', default: '', optional: true },
      { key: 'secret', type: 'secret', label: 'Signing secret', optional: true, help: 'Linear sends `Linear-Signature`; validate downstream.' },
    ],
  },
  {
    id: 'linear-issue-create',
    integrationId: 'linear',
    name: 'Linear · Create Issue',
    operationName: 'Create issue',
    category: 'action',
    description: 'Open a new issue (ticket) in a Linear team.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'teamId', type: 'text', label: 'Team ID', default: '' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: 'New issue from tramo' },
      { key: 'description', type: 'textarea', label: 'Description', default: '', optional: true },
      { key: 'priority', type: 'number', label: 'Priority (0 none, 1 urgent, 4 low)', default: 0, optional: true },
      { key: 'assigneeId', type: 'text', label: 'Assignee user ID', default: '', optional: true },
      { key: 'projectId', type: 'text', label: 'Project ID', default: '', optional: true },
    ],
  },
  {
    id: 'linear-issue-comment',
    integrationId: 'linear',
    name: 'Linear · Comment on Issue',
    operationName: 'Comment on issue',
    category: 'action',
    description: 'Post a comment on an existing Linear issue.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Comment', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'issueId', type: 'text', label: 'Issue ID', default: '' },
      { key: 'body', type: 'textarea', label: 'Comment (supports {{var}})', default: '' },
    ],
  },
  {
    id: 'linear-issue-update',
    integrationId: 'linear',
    name: 'Linear · Update Issue',
    operationName: 'Update issue',
    category: 'action',
    description: 'Change the status, assignee, or labels of an existing issue.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'issueId', type: 'text', label: 'Issue ID', default: '' },
      { key: 'stateId', type: 'text', label: 'State ID (optional)', default: '', optional: true },
      { key: 'assigneeId', type: 'text', label: 'Assignee user ID (optional)', default: '', optional: true },
      { key: 'labelIds', type: 'json', label: 'Label IDs (JSON array)', default: '[]', optional: true },
      { key: 'priority', type: 'number', label: 'Priority (optional)', default: 0, optional: true },
    ],
  },
  {
    id: 'linear-issue-search',
    integrationId: 'linear',
    name: 'Linear · Search Issues',
    operationName: 'Search issues',
    category: 'action',
    description: 'Search issues by text query or by team/state filters.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Issues', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'query', type: 'text', label: 'Text query (supports {{var}})', default: '', optional: true },
      { key: 'teamId', type: 'text', label: 'Team ID filter', default: '', optional: true },
      { key: 'stateName', type: 'text', label: 'State name filter (e.g. "In Progress")', default: '', optional: true },
      { key: 'limit', type: 'number', label: 'Max results', default: 25, optional: true },
    ],
  },
  {
    id: 'linear-project-create',
    integrationId: 'linear',
    name: 'Linear · Create Project',
    operationName: 'Create project',
    category: 'action',
    description: 'Create a project under one or more teams.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Project', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'teamIds', type: 'json', label: 'Team IDs (JSON array)', default: '[]' },
      { key: 'name', type: 'text', label: 'Project name', default: 'Project from tramo' },
      { key: 'description', type: 'textarea', label: 'Description', default: '', optional: true },
      { key: 'targetDate', type: 'text', label: 'Target date (YYYY-MM-DD)', default: '', optional: true },
    ],
  },
  {
    id: 'linear-comment-list',
    integrationId: 'linear',
    name: 'Linear · List Comments',
    operationName: 'List comments',
    category: 'action',
    description: 'List comments on an issue, ordered most recent first.',
    icon: 'Cable',
    iconBrand: 'linear',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Comments', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'issueId', type: 'text', label: 'Issue ID', default: '' },
      { key: 'limit', type: 'number', label: 'Max comments', default: 50, optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors — Linear is a GraphQL API.                               */
/* Auth: the raw personal API key in the `authorization` header (no Bearer)*/
/* ---------------------------------------------------------------------- */

const keyOf = (ctx: ExecutionContext): string | undefined => {
  if (ctx.config.apiKey) return String(ctx.config.apiKey);
  return typeof process !== 'undefined' ? process.env?.LINEAR_API_KEY : undefined;
};

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const missingKey = { error: { message: 'linear: API key required (config.apiKey or LINEAR_API_KEY)' } };

interface GqlBody {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message?: string }>;
}

/**
 * Run a GraphQL query against Linear and normalise the result into a tramo
 * envelope. Linear returns 200 even for GraphQL errors, so inspect `errors`.
 */
async function gql(
  ctx: ExecutionContext,
  key: string,
  query: string,
  variables: Record<string, unknown>,
  pick: (data: Record<string, unknown>) => unknown,
): Promise<NodeExecutionResult> {
  const res = await httpJson<GqlBody>({
    method: 'POST',
    url: API,
    headers: { authorization: key, 'content-type': 'application/json' },
    json: { query, variables },
    signal: ctx.signal,
    timeoutMs: 20000,
  });
  if (!res.ok) {
    const msg = res.data?.errors?.[0]?.message ?? `HTTP ${res.status}`;
    return { error: { message: msg, status: res.status, data: res.data } };
  }
  if (res.data?.errors && res.data.errors.length) {
    return { error: { message: res.data.errors[0]?.message ?? 'GraphQL error', status: res.status, data: res.data.errors } };
  }
  return { out: pick(res.data?.data ?? {}) };
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'linear-issue-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['teamId', 'title'], 'linear-issue-create');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return missingKey;
    const priority = Number(ctx.config.priority ?? 0);
    const input: Record<string, unknown> = {
      teamId: String(ctx.config.teamId),
      title: tpl(ctx, 'title'),
      ...(ctx.config.description ? { description: tpl(ctx, 'description') } : {}),
      ...(Number.isFinite(priority) && priority > 0 ? { priority } : {}),
      ...(ctx.config.assigneeId ? { assigneeId: String(ctx.config.assigneeId) } : {}),
      ...(ctx.config.projectId ? { projectId: String(ctx.config.projectId) } : {}),
    };
    const query = `mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier title url state { name } }
  }
}`;
    return gql(ctx, key, query, { input }, (d) => (d.issueCreate as { issue?: unknown })?.issue ?? d.issueCreate);
  },

  'linear-issue-comment': async (ctx) => {
    const miss = requireFields(ctx.config, ['issueId', 'body'], 'linear-issue-comment');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return missingKey;
    const input = { issueId: String(ctx.config.issueId), body: tpl(ctx, 'body') };
    const query = `mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body url createdAt }
  }
}`;
    return gql(ctx, key, query, { input }, (d) => (d.commentCreate as { comment?: unknown })?.comment ?? d.commentCreate);
  },

  'linear-issue-update': async (ctx) => {
    const miss = requireFields(ctx.config, ['issueId'], 'linear-issue-update');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return missingKey;
    const labelIds = parseMaybeJson(ctx.config.labelIds);
    const priority = Number(ctx.config.priority ?? 0);
    const input: Record<string, unknown> = {
      ...(ctx.config.stateId ? { stateId: String(ctx.config.stateId) } : {}),
      ...(ctx.config.assigneeId ? { assigneeId: String(ctx.config.assigneeId) } : {}),
      ...(Array.isArray(labelIds) && labelIds.length ? { labelIds } : {}),
      ...(Number.isFinite(priority) && priority > 0 ? { priority } : {}),
    };
    const query = `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) {
    success
    issue { id identifier title url state { name } }
  }
}`;
    return gql(ctx, key, query, { id: String(ctx.config.issueId), input }, (d) => (d.issueUpdate as { issue?: unknown })?.issue ?? d.issueUpdate);
  },

  'linear-issue-search': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return missingKey;
    const term = tpl(ctx, 'query');
    const limit = Number(ctx.config.limit ?? 25);
    const filter: Record<string, unknown> = {};
    if (ctx.config.teamId) filter.team = { id: { eq: String(ctx.config.teamId) } };
    if (ctx.config.stateName) filter.state = { name: { eq: String(ctx.config.stateName) } };
    // Linear deprecated the dedicated text-search root; use `issues(filter:)`
    // and add a title contains filter when a text query is provided.
    if (term) filter.title = { containsIgnoreCase: term };
    const query = `query IssueSearch($filter: IssueFilter, $first: Int) {
  issues(filter: $filter, first: $first) {
    nodes { id identifier title url priority state { name } assignee { name } }
  }
}`;
    return gql(
      ctx,
      key,
      query,
      {
        filter: Object.keys(filter).length ? filter : undefined,
        first: Number.isFinite(limit) && limit > 0 ? limit : 25,
      },
      (d) => (d.issues as { nodes?: unknown[] })?.nodes ?? [],
    );
  },

  'linear-project-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['name'], 'linear-project-create');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return missingKey;
    const teamIds = parseMaybeJson(ctx.config.teamIds);
    if (!Array.isArray(teamIds) || teamIds.length === 0) {
      return { error: { message: 'linear-project-create: teamIds must be a non-empty JSON array' } };
    }
    const input: Record<string, unknown> = {
      teamIds,
      name: tpl(ctx, 'name'),
      ...(ctx.config.description ? { description: tpl(ctx, 'description') } : {}),
      ...(ctx.config.targetDate ? { targetDate: String(ctx.config.targetDate) } : {}),
    };
    const query = `mutation ProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) {
    success
    project { id name url state }
  }
}`;
    return gql(ctx, key, query, { input }, (d) => (d.projectCreate as { project?: unknown })?.project ?? d.projectCreate);
  },

  'linear-comment-list': async (ctx) => {
    const miss = requireFields(ctx.config, ['issueId'], 'linear-comment-list');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return missingKey;
    const limit = Number(ctx.config.limit ?? 50);
    const query = `query IssueComments($id: String!, $first: Int) {
  issue(id: $id) {
    comments(first: $first) {
      nodes { id body url createdAt user { name } }
    }
  }
}`;
    return gql(
      ctx,
      key,
      query,
      { id: String(ctx.config.issueId), first: Number.isFinite(limit) && limit > 0 ? limit : 50 },
      (d) => ((d.issue as { comments?: { nodes?: unknown[] } })?.comments?.nodes ?? []),
    );
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'linear',
  name: 'Linear',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
