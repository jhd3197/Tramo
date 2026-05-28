/**
 * Discord integration pack.
 *
 * Webhook-based operations (no OAuth required). Bot-API operations can be
 * added later by appending entries here + executors in tramo-runtime.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#5865f2';

export const DEFINITION: IntegrationDefinition = {
  id: 'discord',
  name: 'Discord',
  description: 'Webhook messages, embeds, threads.',
  iconBrand: 'discord',
  color: COLOR,
  category: 'Communication',
};

export const NODES: NodeDefinition[] = [
  {
    id: 'discord-webhook-send',
    integrationId: 'discord',
    name: 'Discord · Send Message',
    operationName: 'Send message',
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
];
