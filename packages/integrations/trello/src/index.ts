/**
 * @tramo/trello — official Trello integration pack.
 * Webhook trigger (card events) + REST actions for boards, lists, cards, comments.
 * Auth model: Trello API key + token pair (per-node secret fields).
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

const COLOR = '#0079bf';
const API = 'https://api.trello.com/1';

const DEFINITION: IntegrationDefinition = {
  id: 'trello',
  name: 'Trello',
  description: 'Boards, lists, cards, comments, webhooks.',
  iconBrand: 'trello',
  color: COLOR,
  category: 'Productivity',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:trello:card-event',
    integrationId: 'trello',
    name: 'Trello · On Card Event',
    operationName: 'On card event',
    category: 'trigger',
    description: 'Fires when Trello POSTs a webhook for a watched board, list, or card.',
    icon: 'CloudDownload',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/trello/cards', help: 'Configure this URL via POST /webhooks against a model (board/list/card) ID.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'actionTypes', type: 'text', label: 'Filter action types', default: '', optional: true, help: 'Filter by action types like createCard,updateCard, comma-separated. Blank = all.' },
      { key: 'callbackSecret', type: 'secret', label: 'Callback secret', optional: true, help: 'Trello signs payloads with X-Trello-Webhook. Validation is a downstream step.' },
    ],
  },
  {
    id: 'trello-create-card',
    integrationId: 'trello',
    name: 'Trello · Create Card',
    operationName: 'Create card',
    category: 'action',
    description: 'Create a new card on a Trello list.',
    icon: 'Cable',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Card', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'listId', type: 'text', label: 'List ID', default: '' },
      { key: 'name', type: 'text', label: 'Name (supports {{var}})', default: 'New card from tramo' },
      { key: 'desc', type: 'textarea', label: 'Description (supports {{var}})', default: '', optional: true },
      { key: 'due', type: 'text', label: 'Due date', default: '', optional: true, help: 'ISO 8601 timestamp' },
      { key: 'labelIds', type: 'json', label: 'Label IDs', default: '[]', optional: true },
    ],
  },
  {
    id: 'trello-update-card',
    integrationId: 'trello',
    name: 'Trello · Update Card',
    operationName: 'Update card',
    category: 'action',
    description: 'Update fields on an existing Trello card.',
    icon: 'Cable',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Card', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'cardId', type: 'text', label: 'Card ID', default: '' },
      { key: 'name', type: 'text', label: 'Name (supports {{var}})', default: '', optional: true },
      { key: 'desc', type: 'textarea', label: 'Description', default: '', optional: true },
      { key: 'listId', type: 'text', label: 'List ID', default: '', optional: true, help: 'New list — moves the card' },
      { key: 'due', type: 'text', label: 'Due date', default: '', optional: true },
      { key: 'closed', type: 'boolean', label: 'Closed', default: false, optional: true, help: 'True = archive' },
    ],
  },
  {
    id: 'trello-archive-card',
    integrationId: 'trello',
    name: 'Trello · Archive Card',
    operationName: 'Archive card',
    category: 'action',
    description: 'Archive (close) a Trello card.',
    icon: 'Cable',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Card', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'cardId', type: 'text', label: 'Card ID', default: '' },
    ],
  },
  {
    id: 'trello-list-cards',
    integrationId: 'trello',
    name: 'Trello · List Cards on Board/List',
    operationName: 'List cards',
    category: 'action',
    description: 'List cards on a Trello board or list.',
    icon: 'Cable',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Cards', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'boardOrListId', type: 'text', label: 'Board or List ID', default: '' },
      {
        key: 'kind',
        type: 'select',
        label: 'Kind',
        default: 'board',
        options: [
          { label: 'Board', value: 'board' },
          { label: 'List', value: 'list' },
        ],
        help: 'Whether boardOrListId is a board or a list',
      },
    ],
  },
  {
    id: 'trello-list-boards',
    integrationId: 'trello',
    name: 'Trello · List My Boards',
    operationName: 'List my boards',
    category: 'action',
    description: 'List boards visible to the authenticated user.',
    icon: 'Cable',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Boards', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'apiToken', type: 'secret', label: 'API token' },
      {
        key: 'filter',
        type: 'select',
        label: 'Filter',
        default: 'open',
        optional: true,
        options: [
          { label: 'All', value: 'all' },
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
        ],
      },
    ],
  },
  {
    id: 'trello-add-comment',
    integrationId: 'trello',
    name: 'Trello · Add Comment',
    operationName: 'Add comment',
    category: 'action',
    description: 'Post a comment on a Trello card.',
    icon: 'Cable',
    iconBrand: 'trello',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Action', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'apiToken', type: 'secret', label: 'API token' },
      { key: 'cardId', type: 'text', label: 'Card ID', default: '' },
      { key: 'text', type: 'textarea', label: 'Comment (supports {{var}})', default: '' },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* Auth: Trello takes `key` + `token` as query params (not headers).       */
/* ---------------------------------------------------------------------- */

interface TrelloAuth {
  key: string;
  token: string;
}

function authOf(ctx: ExecutionContext): TrelloAuth | null {
  const key = ctx.config.apiKey
    ? String(ctx.config.apiKey)
    : (typeof process !== 'undefined' ? process.env?.TRELLO_KEY : undefined);
  const token = ctx.config.apiToken
    ? String(ctx.config.apiToken)
    : (typeof process !== 'undefined' ? process.env?.TRELLO_TOKEN : undefined);
  if (!key || !token) return null;
  return { key, token };
}

const missingAuth = {
  error: { message: 'trello: key + token required (config.apiKey/apiToken or TRELLO_KEY/TRELLO_TOKEN)' },
};

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'trello-create-card': async (ctx) => {
    const miss = requireFields(ctx.config, ['listId', 'name'], 'trello-create-card');
    if (miss) return miss;
    const auth = authOf(ctx);
    if (!auth) return missingAuth;
    const labelIds = parseMaybeJson(ctx.config.labelIds);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/cards`,
      query: {
        ...auth,
        idList: String(ctx.config.listId),
        name: tpl(ctx, 'name'),
        desc: ctx.config.desc ? tpl(ctx, 'desc') : undefined,
        due: ctx.config.due ? String(ctx.config.due) : undefined,
        idLabels: Array.isArray(labelIds) && labelIds.length ? labelIds.join(',') : undefined,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'trello-update-card': async (ctx) => {
    const miss = requireFields(ctx.config, ['cardId'], 'trello-update-card');
    if (miss) return miss;
    const auth = authOf(ctx);
    if (!auth) return missingAuth;
    const res = await httpJson({
      method: 'PUT',
      url: `${API}/cards/${encodeURIComponent(String(ctx.config.cardId))}`,
      query: {
        ...auth,
        name: ctx.config.name ? tpl(ctx, 'name') : undefined,
        desc: ctx.config.desc ? tpl(ctx, 'desc') : undefined,
        idList: ctx.config.listId ? String(ctx.config.listId) : undefined,
        due: ctx.config.due ? String(ctx.config.due) : undefined,
        closed: ctx.config.closed === true ? true : undefined,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'trello-archive-card': async (ctx) => {
    const miss = requireFields(ctx.config, ['cardId'], 'trello-archive-card');
    if (miss) return miss;
    const auth = authOf(ctx);
    if (!auth) return missingAuth;
    const res = await httpJson({
      method: 'PUT',
      url: `${API}/cards/${encodeURIComponent(String(ctx.config.cardId))}`,
      query: { ...auth, closed: true },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'trello-list-cards': async (ctx) => {
    const miss = requireFields(ctx.config, ['boardOrListId'], 'trello-list-cards');
    if (miss) return miss;
    const auth = authOf(ctx);
    if (!auth) return missingAuth;
    const kind = String(ctx.config.kind ?? 'board');
    const segment = kind === 'list' ? 'lists' : 'boards';
    const res = await httpJson({
      method: 'GET',
      url: `${API}/${segment}/${encodeURIComponent(String(ctx.config.boardOrListId))}/cards`,
      query: { ...auth },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'trello-list-boards': async (ctx) => {
    const auth = authOf(ctx);
    if (!auth) return missingAuth;
    const filter = String(ctx.config.filter ?? 'open');
    const res = await httpJson({
      method: 'GET',
      url: `${API}/members/me/boards`,
      query: { ...auth, filter },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'trello-add-comment': async (ctx) => {
    const miss = requireFields(ctx.config, ['cardId', 'text'], 'trello-add-comment');
    if (miss) return miss;
    const auth = authOf(ctx);
    if (!auth) return missingAuth;
    const res = await httpJson({
      method: 'POST',
      url: `${API}/cards/${encodeURIComponent(String(ctx.config.cardId))}/actions/comments`,
      query: { ...auth, text: tpl(ctx, 'text') },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'trello',
  name: 'Trello',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
