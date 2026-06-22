/**
 * @tramo/youtube — official YouTube integration pack.
 *
 * Read-only operations against the YouTube Data API v3 (video metadata,
 * search, comments, playlist items). Auth: API key passed per node.
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

const COLOR = '#ff0000';
const API = 'https://www.googleapis.com/youtube/v3';

const DEFINITION: IntegrationDefinition = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Video metadata, search, comments, playlists.',
  iconBrand: 'youtube',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'youtube-get-video',
    integrationId: 'youtube',
    name: 'YouTube · Get Video',
    operationName: 'Get video',
    category: 'action',
    description: 'Fetch metadata for a single video by ID.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Video metadata', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'videoId', type: 'text', label: 'Video ID', default: '' },
    ],
  },
  {
    id: 'youtube-search-videos',
    integrationId: 'youtube',
    name: 'YouTube · Search Videos',
    operationName: 'Search videos',
    category: 'action',
    description: 'Search YouTube for videos matching a query.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Results', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'query', type: 'text', label: 'Query (supports {{var}})', default: '' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 10, optional: true },
      {
        key: 'order',
        type: 'select',
        label: 'Order',
        default: 'relevance',
        optional: true,
        options: [
          { label: 'Relevance', value: 'relevance' },
          { label: 'Date', value: 'date' },
          { label: 'Rating', value: 'rating' },
          { label: 'View count', value: 'viewCount' },
        ],
      },
    ],
  },
  {
    id: 'youtube-list-comments',
    integrationId: 'youtube',
    name: 'YouTube · List Video Comments',
    operationName: 'List video comments',
    category: 'action',
    description: 'List top-level comments on a video.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Comments', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'videoId', type: 'text', label: 'Video ID', default: '' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 20, optional: true },
      {
        key: 'order',
        type: 'select',
        label: 'Order',
        default: 'time',
        optional: true,
        options: [
          { label: 'Time', value: 'time' },
          { label: 'Relevance', value: 'relevance' },
        ],
      },
    ],
  },
  {
    id: 'youtube-list-playlist-items',
    integrationId: 'youtube',
    name: 'YouTube · List Playlist Items',
    operationName: 'List playlist items',
    category: 'action',
    description: 'List videos in a YouTube playlist.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Items', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'playlistId', type: 'text', label: 'Playlist ID', default: '' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 25, optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const apiKeyOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.apiKey
    ? String(ctx.config.apiKey)
    : (typeof process !== 'undefined' ? process.env?.YOUTUBE_API_KEY : undefined);

const oauthOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.oauthToken
    ? String(ctx.config.oauthToken)
    : (typeof process !== 'undefined' ? process.env?.YOUTUBE_OAUTH_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

/** Resolve auth for a read-only call: an OAuth bearer wins, else an API key query param. */
function readAuth(ctx: ExecutionContext): { bearer?: string; key?: string } | { error: { message: string } } {
  const oauth = oauthOf(ctx);
  if (oauth) return { bearer: oauth };
  const key = apiKeyOf(ctx);
  if (key) return { key };
  return { error: { message: 'youtube: an API key (config.apiKey or YOUTUBE_API_KEY) or OAuth token (YOUTUBE_OAUTH_TOKEN) is required' } };
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'youtube-get-video': async (ctx) => {
    const miss = requireFields(ctx.config, ['videoId'], 'youtube-get-video');
    if (miss) return miss;
    const auth = readAuth(ctx);
    if ('error' in auth) return auth;
    const res = await httpJson<{ items?: unknown[] }>({
      method: 'GET',
      url: `${API}/videos`,
      query: {
        part: 'snippet,contentDetails,statistics',
        id: tpl(ctx, 'videoId'),
        key: auth.key,
      },
      bearer: auth.bearer,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    const items = Array.isArray(res.data.items) ? res.data.items : [];
    if (items.length === 0) return { notFound: { videoId: tpl(ctx, 'videoId') } };
    return { out: items[0] };
  },

  'youtube-search-videos': async (ctx) => {
    const miss = requireFields(ctx.config, ['query'], 'youtube-search-videos');
    if (miss) return miss;
    const auth = readAuth(ctx);
    if ('error' in auth) return auth;
    const res = await httpJson<{ items?: unknown[] }>({
      method: 'GET',
      url: `${API}/search`,
      query: {
        part: 'snippet',
        type: 'video',
        q: tpl(ctx, 'query'),
        maxResults: Number(ctx.config.maxResults ?? 10),
        order: ctx.config.order ? String(ctx.config.order) : undefined,
        key: auth.key,
      },
      bearer: auth.bearer,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    return { out: Array.isArray(res.data.items) ? res.data.items : [] };
  },

  'youtube-list-comments': async (ctx) => {
    const miss = requireFields(ctx.config, ['videoId'], 'youtube-list-comments');
    if (miss) return miss;
    const auth = readAuth(ctx);
    if ('error' in auth) return auth;
    const res = await httpJson<{ items?: unknown[] }>({
      method: 'GET',
      url: `${API}/commentThreads`,
      query: {
        part: 'snippet',
        videoId: tpl(ctx, 'videoId'),
        maxResults: Number(ctx.config.maxResults ?? 20),
        order: ctx.config.order ? String(ctx.config.order) : undefined,
        key: auth.key,
      },
      bearer: auth.bearer,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    return { out: Array.isArray(res.data.items) ? res.data.items : [] };
  },

  'youtube-list-playlist-items': async (ctx) => {
    const miss = requireFields(ctx.config, ['playlistId'], 'youtube-list-playlist-items');
    if (miss) return miss;
    const auth = readAuth(ctx);
    if ('error' in auth) return auth;
    const res = await httpJson<{ items?: unknown[] }>({
      method: 'GET',
      url: `${API}/playlistItems`,
      query: {
        part: 'snippet,contentDetails',
        playlistId: tpl(ctx, 'playlistId'),
        maxResults: Number(ctx.config.maxResults ?? 25),
        key: auth.key,
      },
      bearer: auth.bearer,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    return { out: Array.isArray(res.data.items) ? res.data.items : [] };
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'youtube',
  name: 'YouTube',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
