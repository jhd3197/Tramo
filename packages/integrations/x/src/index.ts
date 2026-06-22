/**
 * @tramo/x — official X (Twitter) integration pack.
 * Post tweets, delete tweets, lookup users, and search via X API v2.
 * Auth: OAuth 2.0 bearer or user-context token supplied per node.
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

const COLOR = '#000000';
const API = 'https://api.twitter.com/2';

const DEFINITION: IntegrationDefinition = {
  id: 'x',
  name: 'X',
  description: 'Post tweets, search, lookup users.',
  iconBrand: 'x',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'x-post-tweet',
    integrationId: 'x',
    name: 'X · Post Tweet',
    operationName: 'Post tweet',
    category: 'action',
    description: 'Publish a new tweet, optionally as a reply or with pre-uploaded media.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Tweet', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token', help: 'X API v2 OAuth 2.0 bearer or user-context token' },
      { key: 'text', type: 'textarea', label: 'Text (supports {{var}})', default: '', help: 'Up to 280 chars (4000 for X Premium)' },
      { key: 'replyToTweetId', type: 'text', label: 'Reply to tweet ID', default: '', optional: true, help: 'Reply target tweet ID' },
      { key: 'mediaIds', type: 'json', label: 'Media IDs', default: '[]', optional: true, help: 'JSON array of pre-uploaded media IDs' },
    ],
  },
  {
    id: 'x-delete-tweet',
    integrationId: 'x',
    name: 'X · Delete Tweet',
    operationName: 'Delete tweet',
    category: 'action',
    description: 'Delete a tweet owned by the authenticated user.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token' },
      { key: 'tweetId', type: 'text', label: 'Tweet ID', default: '' },
    ],
  },
  {
    id: 'x-get-user',
    integrationId: 'x',
    name: 'X · Get User',
    operationName: 'Get user',
    category: 'action',
    description: 'Look up an X user by handle.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'User', type: 'object' },
      { key: 'notFound', label: 'Not Found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token' },
      { key: 'handle', type: 'text', label: 'Handle', default: '', help: 'Handle without the @, e.g. elonmusk' },
    ],
  },
  {
    id: 'x-search-tweets',
    integrationId: 'x',
    name: 'X · Search Tweets',
    operationName: 'Search tweets',
    category: 'action',
    description: 'Search recent tweets using X search syntax.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Tweets', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token' },
      { key: 'query', type: 'text', label: 'Query (supports {{var}})', default: '', help: 'X search syntax, e.g. from:user lang:en' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 10, optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.bearerToken
    ? String(ctx.config.bearerToken)
    : (typeof process !== 'undefined' ? process.env?.X_BEARER_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const NO_TOKEN = { error: { message: 'x: bearer token required (config.bearerToken or X_BEARER_TOKEN)' } };

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'x-post-tweet': async (ctx) => {
    const miss = requireFields(ctx.config, ['text'], 'x-post-tweet');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return NO_TOKEN;
    const mediaIds = parseMaybeJson(ctx.config.mediaIds);
    const replyTo = ctx.config.replyToTweetId ? String(ctx.config.replyToTweetId) : '';
    const res = await httpJson({
      method: 'POST',
      url: `${API}/tweets`,
      bearer: token,
      json: {
        text: tpl(ctx, 'text'),
        ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
        ...(Array.isArray(mediaIds) && mediaIds.length
          ? { media: { media_ids: mediaIds.map((m) => String(m)) } }
          : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'x-delete-tweet': async (ctx) => {
    const miss = requireFields(ctx.config, ['tweetId'], 'x-delete-tweet');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return NO_TOKEN;
    const res = await httpJson({
      method: 'DELETE',
      url: `${API}/tweets/${String(ctx.config.tweetId)}`,
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'x-get-user': async (ctx) => {
    const miss = requireFields(ctx.config, ['handle'], 'x-get-user');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return NO_TOKEN;
    const handle = tpl(ctx, 'handle').replace(/^@/, '');
    const res = await httpJson<{ data?: unknown; errors?: unknown[] }>({
      method: 'GET',
      url: `${API}/users/by/username/${encodeURIComponent(handle)}`,
      query: { 'user.fields': 'description,public_metrics,profile_image_url,verified,created_at' },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    if (!res.data?.data) return { notFound: { handle } };
    return { out: res.data.data };
  },

  'x-search-tweets': async (ctx) => {
    const miss = requireFields(ctx.config, ['query'], 'x-search-tweets');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return NO_TOKEN;
    const res = await httpJson<{ data?: unknown[] }>({
      method: 'GET',
      url: `${API}/tweets/search/recent`,
      query: {
        query: tpl(ctx, 'query'),
        max_results: Number(ctx.config.maxResults ?? 10),
        'tweet.fields': 'created_at,author_id,public_metrics',
      },
      bearer: token,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    return { out: Array.isArray(res.data.data) ? res.data.data : [] };
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'x',
  name: 'X',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
