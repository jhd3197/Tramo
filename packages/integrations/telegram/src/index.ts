/**
 * @tramo/telegram — official Telegram bot-API integration pack.
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

const COLOR = '#26a5e4';

const DEFINITION: IntegrationDefinition = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Bot messages, photos, documents, polls, edits.',
  iconBrand: 'telegram',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:telegram:update',
    integrationId: 'telegram',
    name: 'Telegram · On Bot Update',
    operationName: 'On bot update',
    category: 'trigger',
    description: 'Fires when Telegram delivers a bot update (message, callback_query, edited_message, …).',
    icon: 'CloudDownload',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/telegram/updates', help: 'Register this URL via setWebhook against the Telegram Bot API.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'secretToken', type: 'secret', label: 'Secret token (X-Telegram-Bot-Api-Secret-Token)', optional: true },
      { key: 'updateKinds', type: 'text', label: 'Filter update kinds (e.g. message,callback_query)', default: 'message', optional: true },
    ],
  },
  {
    id: 'telegram-send-message',
    integrationId: 'telegram',
    name: 'Telegram · Send Message',
    operationName: 'Send message',
    category: 'action',
    description: 'Send a text message via a Telegram bot.',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID or @channel', default: '' },
      { key: 'text', type: 'textarea', label: 'Message (supports {{var}})', default: 'Hello from tramo' },
      {
        key: 'parseMode',
        type: 'select',
        label: 'Parse mode',
        default: 'none',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Markdown', value: 'MarkdownV2' },
          { label: 'HTML', value: 'HTML' },
        ],
      },
    ],
  },
  {
    id: 'telegram-send-photo',
    integrationId: 'telegram',
    name: 'Telegram · Send Photo',
    operationName: 'Send photo',
    category: 'action',
    description: 'Send a photo by URL via a Telegram bot.',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID or @channel', default: '' },
      { key: 'photoUrl', type: 'url', label: 'Photo URL', default: '' },
      { key: 'caption', type: 'textarea', label: 'Caption (supports {{var}})', default: '', optional: true },
    ],
  },
  {
    id: 'telegram-send-document',
    integrationId: 'telegram',
    name: 'Telegram · Send Document',
    operationName: 'Send document',
    category: 'action',
    description: 'Send a file by URL — PDF, ZIP, audio, video, anything Telegram fetches.',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID or @channel', default: '' },
      { key: 'documentUrl', type: 'url', label: 'Document URL', default: '' },
      { key: 'caption', type: 'textarea', label: 'Caption (supports {{var}})', default: '', optional: true },
    ],
  },
  {
    id: 'telegram-edit-message',
    integrationId: 'telegram',
    name: 'Telegram · Edit Message',
    operationName: 'Edit message',
    category: 'action',
    description: 'Edit the text of a previously-sent bot message.',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Edited', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID', default: '' },
      { key: 'messageId', type: 'number', label: 'Message ID', default: 0 },
      { key: 'text', type: 'textarea', label: 'New text', default: '' },
    ],
  },
  {
    id: 'telegram-delete-message',
    integrationId: 'telegram',
    name: 'Telegram · Delete Message',
    operationName: 'Delete message',
    category: 'action',
    description: 'Delete a bot-sent message (or any message within bot privileges).',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID', default: '' },
      { key: 'messageId', type: 'number', label: 'Message ID', default: 0 },
    ],
  },
  {
    id: 'telegram-send-poll',
    integrationId: 'telegram',
    name: 'Telegram · Send Poll',
    operationName: 'Send poll',
    category: 'action',
    description: 'Send a poll with up to 10 options.',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Poll', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID or @channel', default: '' },
      { key: 'question', type: 'text', label: 'Question', default: '' },
      { key: 'options', type: 'json', label: 'Options (JSON array of strings)', default: '["Yes","No"]' },
      { key: 'anonymous', type: 'boolean', label: 'Anonymous', default: true, optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.botToken ? String(ctx.config.botToken) : env('TELEGRAM_BOT_TOKEN');

const apiUrl = (token: string, method: string): string =>
  `https://api.telegram.org/bot${token}/${method}`;

/**
 * Call a Bot API method. Telegram replies `{ ok, result }` on success and
 * `{ ok: false, description }` on failure — unwrap to the standard envelope.
 */
async function callTelegram(
  ctx: ExecutionContext,
  id: string,
  method: string,
  body: Record<string, unknown>,
): Promise<NodeExecutionResult> {
  const token = tokenOf(ctx);
  if (!token) return { error: { message: `${id}: botToken required (config.botToken or TELEGRAM_BOT_TOKEN)` } };
  const res = await httpJson<{ ok?: boolean; result?: unknown; description?: string; error_code?: number }>({
    method: 'POST',
    url: apiUrl(token, method),
    json: body,
    signal: ctx.signal,
    timeoutMs: 20000,
  });
  if (res.ok && res.data?.ok) return { out: res.data.result };
  const message = res.data?.description ?? `HTTP ${res.status}`;
  return { error: { message, status: res.data?.error_code ?? res.status, data: res.data } };
}

const parseMode = (ctx: ExecutionContext): Record<string, string> => {
  const mode = String(ctx.config.parseMode ?? 'none');
  return mode && mode !== 'none' ? { parse_mode: mode } : {};
};

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'telegram-send-message': async (ctx) => {
    const miss = requireFields(ctx.config, ['chatId', 'text'], 'telegram-send-message');
    if (miss) return miss;
    return callTelegram(ctx, 'telegram-send-message', 'sendMessage', {
      chat_id: String(ctx.config.chatId),
      text: tpl(ctx, 'text'),
      ...parseMode(ctx),
    });
  },

  'telegram-send-photo': async (ctx) => {
    const miss = requireFields(ctx.config, ['chatId', 'photoUrl'], 'telegram-send-photo');
    if (miss) return miss;
    return callTelegram(ctx, 'telegram-send-photo', 'sendPhoto', {
      chat_id: String(ctx.config.chatId),
      photo: String(ctx.config.photoUrl),
      ...(ctx.config.caption ? { caption: tpl(ctx, 'caption') } : {}),
    });
  },

  'telegram-send-document': async (ctx) => {
    const miss = requireFields(ctx.config, ['chatId', 'documentUrl'], 'telegram-send-document');
    if (miss) return miss;
    return callTelegram(ctx, 'telegram-send-document', 'sendDocument', {
      chat_id: String(ctx.config.chatId),
      document: String(ctx.config.documentUrl),
      ...(ctx.config.caption ? { caption: tpl(ctx, 'caption') } : {}),
    });
  },

  'telegram-edit-message': async (ctx) => {
    const miss = requireFields(ctx.config, ['chatId', 'messageId', 'text'], 'telegram-edit-message');
    if (miss) return miss;
    return callTelegram(ctx, 'telegram-edit-message', 'editMessageText', {
      chat_id: String(ctx.config.chatId),
      message_id: Number(ctx.config.messageId),
      text: tpl(ctx, 'text'),
    });
  },

  'telegram-delete-message': async (ctx) => {
    const miss = requireFields(ctx.config, ['chatId', 'messageId'], 'telegram-delete-message');
    if (miss) return miss;
    return callTelegram(ctx, 'telegram-delete-message', 'deleteMessage', {
      chat_id: String(ctx.config.chatId),
      message_id: Number(ctx.config.messageId),
    });
  },

  'telegram-send-poll': async (ctx) => {
    const miss = requireFields(ctx.config, ['chatId', 'question', 'options'], 'telegram-send-poll');
    if (miss) return miss;
    const parsed = parseMaybeJson(ctx.config.options);
    const options = Array.isArray(parsed) ? parsed.map((o) => String(o)) : [];
    if (options.length < 2) {
      return { error: { message: 'telegram-send-poll: options must be a JSON array of at least 2 strings' } };
    }
    return callTelegram(ctx, 'telegram-send-poll', 'sendPoll', {
      chat_id: String(ctx.config.chatId),
      question: tpl(ctx, 'question'),
      options,
      is_anonymous: ctx.config.anonymous !== false,
    });
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers (and anything without a real impl) keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'telegram',
  name: 'Telegram',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
