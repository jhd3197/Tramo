/**
 * @tramo/discord — official Discord integration pack.
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

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

export default defineNodePack({
  id: 'discord',
  name: 'Discord',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
