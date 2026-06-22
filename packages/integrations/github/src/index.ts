/**
 * @tramo/github — official GitHub integration pack.
 *
 * Webhook-trigger nodes (Issue / PR / Push) keep passthrough executors —
 * they're driven by the runtime's webhook router. Action nodes make real
 * REST calls against api.github.com via the shared HTTP helper.
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

const COLOR = '#24292f';
const API = 'https://api.github.com';

const DEFINITION: IntegrationDefinition = {
  id: 'github',
  name: 'GitHub',
  description: 'Issues, PRs, releases, files, dispatches.',
  iconBrand: 'github',
  color: COLOR,
  category: 'Developer',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:github:issue',
    integrationId: 'github',
    name: 'GitHub · On Issue Event',
    operationName: 'On issue event',
    category: 'trigger',
    description: 'Fires when GitHub POSTs an issue webhook (opened, closed, edited, labelled, …).',
    icon: 'CloudDownload',
    iconBrand: 'github',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/github/issues', help: 'Configure this URL in the repo\'s webhook settings.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'actions', type: 'text', label: 'Filter actions (comma-separated, blank = all)', default: 'opened,closed', optional: true },
      { key: 'secret', type: 'secret', label: 'Webhook secret', optional: true, help: 'GitHub signs payloads with X-Hub-Signature-256; set this to verify them.' },
      { key: 'signaturePreset', type: 'select', label: 'Signature scheme', default: 'github', optional: true, options: [{ label: 'GitHub', value: 'github' }] },
    ],
  },
  {
    id: 'webhook-trigger:github:pull-request',
    integrationId: 'github',
    name: 'GitHub · On Pull Request',
    operationName: 'On pull request',
    category: 'trigger',
    description: 'Fires on pull_request events (opened, ready_for_review, merged, …).',
    icon: 'CloudDownload',
    iconBrand: 'github',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/github/pulls' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'actions', type: 'text', label: 'Filter actions', default: 'opened,closed,ready_for_review', optional: true },
      { key: 'secret', type: 'secret', label: 'Webhook secret', optional: true },
      { key: 'signaturePreset', type: 'select', label: 'Signature scheme', default: 'github', optional: true, options: [{ label: 'GitHub', value: 'github' }] },
    ],
  },
  {
    id: 'webhook-trigger:github:push',
    integrationId: 'github',
    name: 'GitHub · On Push',
    operationName: 'On push',
    category: 'trigger',
    description: 'Fires when GitHub POSTs a push webhook for any branch.',
    icon: 'CloudDownload',
    iconBrand: 'github',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/github/push' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'branchFilter', type: 'text', label: 'Branch filter (regex, blank = all)', default: '^refs/heads/main$', optional: true },
      { key: 'secret', type: 'secret', label: 'Webhook secret', optional: true },
      { key: 'signaturePreset', type: 'select', label: 'Signature scheme', default: 'github', optional: true, options: [{ label: 'GitHub', value: 'github' }] },
    ],
  },
  {
    id: 'github-issue-create',
    integrationId: 'github',
    name: 'GitHub · Create Issue',
    operationName: 'Create issue',
    category: 'action',
    description: 'Open a new issue in a repository.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: 'Triggered from tramo' },
      { key: 'body', type: 'textarea', label: 'Body', default: '', optional: true },
      { key: 'labels', type: 'text', label: 'Labels (comma-separated)', default: '', optional: true },
      { key: 'assignees', type: 'text', label: 'Assignees (comma-separated)', default: '', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-issue-comment',
    integrationId: 'github',
    name: 'GitHub · Comment on Issue',
    operationName: 'Comment on issue',
    category: 'action',
    description: 'Post a comment on an existing issue or pull request.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Comment', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'issueNumber', type: 'number', label: 'Issue or PR number', default: 1 },
      { key: 'body', type: 'textarea', label: 'Comment (supports {{var}})', default: '' },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-issue-close',
    integrationId: 'github',
    name: 'GitHub · Close Issue',
    operationName: 'Close issue',
    category: 'action',
    description: 'Close an issue with an optional reason (completed / not planned).',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'issueNumber', type: 'number', label: 'Issue number', default: 1 },
      {
        key: 'reason',
        type: 'select',
        label: 'State reason',
        default: 'completed',
        options: [
          { label: 'Completed', value: 'completed' },
          { label: 'Not planned', value: 'not_planned' },
          { label: 'Reopened', value: 'reopened' },
        ],
      },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-pr-create',
    integrationId: 'github',
    name: 'GitHub · Open Pull Request',
    operationName: 'Open pull request',
    category: 'action',
    description: 'Open a pull request between two branches.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'PR', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'title', type: 'text', label: 'Title', default: 'New PR from tramo' },
      { key: 'head', type: 'text', label: 'Head branch', default: 'feature/x' },
      { key: 'base', type: 'text', label: 'Base branch', default: 'main' },
      { key: 'body', type: 'textarea', label: 'Body', default: '', optional: true },
      { key: 'draft', type: 'boolean', label: 'Draft', default: false, optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-repo-star',
    integrationId: 'github',
    name: 'GitHub · Star Repo',
    operationName: 'Star repository',
    category: 'action',
    description: 'Star a repository with the authenticated user.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-dispatch',
    integrationId: 'github',
    name: 'GitHub · Trigger Workflow',
    operationName: 'Dispatch workflow',
    category: 'action',
    description: 'Trigger a repository_dispatch event for GitHub Actions.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'eventType', type: 'text', label: 'Event type', default: 'tramo-run' },
      { key: 'payload', type: 'json', label: 'Client payload (JSON)', default: '{}', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-release-create',
    integrationId: 'github',
    name: 'GitHub · Create Release',
    operationName: 'Create release',
    category: 'action',
    description: 'Cut a release from a tag with optional release notes.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Release', type: 'object' }, { key: 'error', label: 'Error', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'tagName', type: 'text', label: 'Tag (e.g. v1.0.0)', default: 'v0.1.0' },
      { key: 'name', type: 'text', label: 'Release name', default: '', optional: true },
      { key: 'body', type: 'textarea', label: 'Release notes (supports {{var}})', default: '', optional: true },
      { key: 'draft', type: 'boolean', label: 'Draft', default: false, optional: true },
      { key: 'prerelease', type: 'boolean', label: 'Pre-release', default: false, optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'github-file-get',
    integrationId: 'github',
    name: 'GitHub · Get File Contents',
    operationName: 'Get file contents',
    category: 'action',
    description: 'Fetch a file from a repository at a given path and ref.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'File', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'path', type: 'text', label: 'File path', default: 'README.md' },
      { key: 'ref', type: 'text', label: 'Branch / tag / SHA', default: 'main', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.token ? String(ctx.config.token) : (typeof process !== 'undefined' ? process.env?.GITHUB_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const csv = (v: unknown): string[] =>
  String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tramo',
    authorization: `Bearer ${token}`,
  };
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'github-issue-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'title'], 'github-issue-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/repos/${String(ctx.config.repo)}/issues`,
      headers: ghHeaders(token),
      json: {
        title: tpl(ctx, 'title'),
        ...(ctx.config.body ? { body: tpl(ctx, 'body') } : {}),
        ...(csv(ctx.config.labels).length ? { labels: csv(ctx.config.labels) } : {}),
        ...(csv(ctx.config.assignees).length ? { assignees: csv(ctx.config.assignees) } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'github-issue-comment': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'issueNumber'], 'github-issue-comment');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/repos/${String(ctx.config.repo)}/issues/${Number(ctx.config.issueNumber)}/comments`,
      headers: ghHeaders(token),
      json: { body: tpl(ctx, 'body') },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'github-issue-close': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'issueNumber'], 'github-issue-close');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const reason = String(ctx.config.reason ?? 'completed');
    const res = await httpJson({
      method: 'PATCH',
      url: `${API}/repos/${String(ctx.config.repo)}/issues/${Number(ctx.config.issueNumber)}`,
      headers: ghHeaders(token),
      json: reason === 'reopened' ? { state: 'open' } : { state: 'closed', state_reason: reason },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'github-pr-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'title', 'head', 'base'], 'github-pr-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/repos/${String(ctx.config.repo)}/pulls`,
      headers: ghHeaders(token),
      json: {
        title: tpl(ctx, 'title'),
        head: String(ctx.config.head),
        base: String(ctx.config.base),
        ...(ctx.config.body ? { body: tpl(ctx, 'body') } : {}),
        draft: ctx.config.draft === true,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'github-repo-star': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo'], 'github-repo-star');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const res = await httpJson({
      method: 'PUT',
      url: `${API}/user/starred/${String(ctx.config.repo)}`,
      headers: { ...ghHeaders(token), 'content-length': '0' },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok ? { out: { starred: true, repo: String(ctx.config.repo) } } : toEnvelope(res);
  },

  'github-dispatch': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'eventType'], 'github-dispatch');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const payload = parseMaybeJson(ctx.config.payload);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/repos/${String(ctx.config.repo)}/dispatches`,
      headers: ghHeaders(token),
      json: {
        event_type: String(ctx.config.eventType),
        ...(payload && typeof payload === 'object' ? { client_payload: payload } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok ? { out: { dispatched: true, eventType: String(ctx.config.eventType) } } : toEnvelope(res);
  },

  'github-release-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'tagName'], 'github-release-create');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'github: token required (config.token or GITHUB_TOKEN)' } };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/repos/${String(ctx.config.repo)}/releases`,
      headers: ghHeaders(token),
      json: {
        tag_name: String(ctx.config.tagName),
        ...(ctx.config.name ? { name: tpl(ctx, 'name') } : {}),
        ...(ctx.config.body ? { body: tpl(ctx, 'body') } : {}),
        draft: ctx.config.draft === true,
        prerelease: ctx.config.prerelease === true,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'github-file-get': async (ctx) => {
    const miss = requireFields(ctx.config, ['repo', 'path'], 'github-file-get');
    if (miss) return miss;
    const token = tokenOf(ctx);
    const res = await httpJson<{ content?: string; encoding?: string; sha?: string; name?: string; path?: string }>({
      method: 'GET',
      url: `${API}/repos/${String(ctx.config.repo)}/contents/${String(ctx.config.path)}`,
      query: { ref: ctx.config.ref ? String(ctx.config.ref) : undefined },
      headers: token ? ghHeaders(token) : { accept: 'application/vnd.github+json', 'user-agent': 'tramo', 'x-github-api-version': '2022-11-28' },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    const d = res.data;
    let decoded: string | undefined;
    if (d?.content && d.encoding === 'base64') {
      try {
        decoded = typeof atob === 'function'
          ? decodeURIComponent(escape(atob(d.content.replace(/\n/g, ''))))
          : Buffer.from(d.content, 'base64').toString('utf8');
      } catch {
        decoded = undefined;
      }
    }
    return { out: { path: d?.path, name: d?.name, sha: d?.sha, content: decoded, raw: d } };
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers (and anything without a real impl) keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'github',
  name: 'GitHub',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
