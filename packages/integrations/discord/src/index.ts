/**
 * @tramo/discord — official Discord integration pack.
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

const COLOR = '#5865f2';

const DEFINITION: IntegrationDefinition = {
  id: 'discord',
  name: 'Discord',
  description: 'Webhooks, bot messages, embeds, threads, reactions.',
  iconBrand: 'discord',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:discord:interaction',
    integrationId: 'discord',
    name: 'Discord · On Interaction',
    operationName: 'On interaction',
    category: 'trigger',
    description: 'Fires on slash-command / button / modal interactions from Discord.',
    icon: 'CloudDownload',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/discord/interactions', help: 'Set this URL as the Interactions Endpoint in your Discord application.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'publicKey', type: 'secret', label: 'Application public key', optional: true, help: 'Used to verify the Ed25519 signature on incoming interactions.' },
    ],
  },
  {
    id: 'discord-webhook-send',
    integrationId: 'discord',
    name: 'Discord · Send Message (Webhook)',
    operationName: 'Send message (webhook)',
    category: 'action',
    description: 'Send a plain message via a Discord webhook.',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'webhook', type: 'url', label: 'Webhook URL', default: '' },
      { key: 'content', type: 'textarea', label: 'Content (supports {{var}})', default: 'Hello from tramo' },
      { key: 'username', type: 'text', label: 'Username override', default: 'tramo', optional: true },
      { key: 'avatarUrl', type: 'url', label: 'Avatar URL override', default: '', optional: true },
    ],
  },
  {
    id: 'discord-webhook-embed',
    integrationId: 'discord',
    name: 'Discord · Send Embed',
    operationName: 'Send embed',
    category: 'action',
    description: 'Send a rich embed via a Discord webhook.',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'webhook', type: 'url', label: 'Webhook URL', default: '' },
      { key: 'title', type: 'text', label: 'Embed title (supports {{var}})', default: '' },
      { key: 'description', type: 'textarea', label: 'Embed description', default: '' },
      { key: 'colorHex', type: 'text', label: 'Color (hex, e.g. #5865f2)', default: '#5865f2', optional: true },
      { key: 'url', type: 'url', label: 'Embed link URL', default: '', optional: true },
    ],
  },
  {
    id: 'discord-thread-create',
    integrationId: 'discord',
    name: 'Discord · Create Thread',
    operationName: 'Create thread',
    category: 'action',
    description: 'Start a thread from a webhook message in a forum or text channel.',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Thread', type: 'object' }],
    fields: [
      { key: 'webhook', type: 'url', label: 'Webhook URL', default: '' },
      { key: 'threadName', type: 'text', label: 'Thread name', default: 'tramo run' },
      { key: 'content', type: 'textarea', label: 'First message', default: '' },
    ],
  },
  {
    id: 'discord-bot-send',
    integrationId: 'discord',
    name: 'Discord · Send Channel Message (Bot)',
    operationName: 'Send channel message (bot)',
    category: 'action',
    description: 'Send a message to a channel using a bot token (instead of a webhook).',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Message', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'channelId', type: 'text', label: 'Channel ID', default: '' },
      { key: 'content', type: 'textarea', label: 'Content (supports {{var}})', default: '' },
      { key: 'tts', type: 'boolean', label: 'Text-to-speech', default: false, optional: true },
    ],
  },
  {
    id: 'discord-dm-send',
    integrationId: 'discord',
    name: 'Discord · Send Direct Message',
    operationName: 'Send DM',
    category: 'action',
    description: 'Open or reuse a DM channel with a user and send a message via bot.',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Message', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'userId', type: 'text', label: 'Recipient user ID', default: '' },
      { key: 'content', type: 'textarea', label: 'Content (supports {{var}})', default: '' },
    ],
  },
  {
    id: 'discord-react',
    integrationId: 'discord',
    name: 'Discord · Add Reaction',
    operationName: 'Add reaction',
    category: 'action',
    description: 'Add an emoji reaction to a message in a channel.',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'channelId', type: 'text', label: 'Channel ID', default: '' },
      { key: 'messageId', type: 'text', label: 'Message ID', default: '' },
      { key: 'emoji', type: 'text', label: 'Emoji (Unicode char or name:id)', default: '👍' },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const API = 'https://discord.com/api/v10';

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.botToken ? String(ctx.config.botToken) : env('DISCORD_BOT_TOKEN');

const botHeaders = (token: string): Record<string, string> => ({
  authorization: `Bot ${token}`,
  'user-agent': 'tramo',
});

/** Parse a `#rrggbb` / `rrggbb` hex string into Discord's integer color, or undefined. */
function hexToInt(hex: unknown): number | undefined {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? '').trim());
  return m ? parseInt(m[1], 16) : undefined;
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'discord-webhook-send': async (ctx) => {
    const miss = requireFields(ctx.config, ['webhook', 'content'], 'discord-webhook-send');
    if (miss) return miss;
    const res = await httpJson({
      method: 'POST',
      url: `${String(ctx.config.webhook)}?wait=true`,
      json: {
        content: tpl(ctx, 'content'),
        ...(ctx.config.username ? { username: String(ctx.config.username) } : {}),
        ...(ctx.config.avatarUrl ? { avatar_url: String(ctx.config.avatarUrl) } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'discord-webhook-embed': async (ctx) => {
    const miss = requireFields(ctx.config, ['webhook'], 'discord-webhook-embed');
    if (miss) return miss;
    const color = hexToInt(ctx.config.colorHex);
    const embed: Record<string, unknown> = {
      ...(ctx.config.title ? { title: tpl(ctx, 'title') } : {}),
      ...(ctx.config.description ? { description: tpl(ctx, 'description') } : {}),
      ...(ctx.config.url ? { url: String(ctx.config.url) } : {}),
      ...(color != null ? { color } : {}),
    };
    const res = await httpJson({
      method: 'POST',
      url: `${String(ctx.config.webhook)}?wait=true`,
      json: { embeds: [embed] },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'discord-thread-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['webhook', 'threadName'], 'discord-thread-create');
    if (miss) return miss;
    const res = await httpJson({
      method: 'POST',
      url: `${String(ctx.config.webhook)}?wait=true`,
      json: {
        thread_name: String(ctx.config.threadName),
        ...(ctx.config.content ? { content: tpl(ctx, 'content') } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'discord-bot-send': async (ctx) => {
    const miss = requireFields(ctx.config, ['channelId', 'content'], 'discord-bot-send');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'discord-bot-send: botToken required (config.botToken or DISCORD_BOT_TOKEN)' } };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/channels/${encodeURIComponent(String(ctx.config.channelId))}/messages`,
      headers: botHeaders(token),
      json: {
        content: tpl(ctx, 'content'),
        tts: ctx.config.tts === true,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'discord-dm-send': async (ctx) => {
    const miss = requireFields(ctx.config, ['userId', 'content'], 'discord-dm-send');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'discord-dm-send: botToken required (config.botToken or DISCORD_BOT_TOKEN)' } };
    // Open (or reuse) a DM channel with the recipient, then post into it.
    const dm = await httpJson<{ id?: string }>({
      method: 'POST',
      url: `${API}/users/@me/channels`,
      headers: botHeaders(token),
      json: { recipient_id: String(ctx.config.userId) },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!dm.ok || !dm.data?.id) return toEnvelope(dm);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/channels/${encodeURIComponent(dm.data.id)}/messages`,
      headers: botHeaders(token),
      json: { content: tpl(ctx, 'content') },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'discord-react': async (ctx) => {
    const miss = requireFields(ctx.config, ['channelId', 'messageId', 'emoji'], 'discord-react');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'discord-react: botToken required (config.botToken or DISCORD_BOT_TOKEN)' } };
    const emoji = encodeURIComponent(String(ctx.config.emoji));
    const res = await httpJson({
      method: 'PUT',
      url: `${API}/channels/${encodeURIComponent(String(ctx.config.channelId))}/messages/${encodeURIComponent(String(ctx.config.messageId))}/reactions/${emoji}/@me`,
      headers: { ...botHeaders(token), 'content-length': '0' },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok
      ? { out: { reacted: true, emoji: String(ctx.config.emoji), messageId: String(ctx.config.messageId) } }
      : toEnvelope(res);
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers (and anything without a real impl) keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'discord',
  name: 'Discord',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
