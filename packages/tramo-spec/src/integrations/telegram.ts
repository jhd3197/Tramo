/**
 * Telegram integration pack.
 *
 * Bot-API based operations. All operations need a `botToken`; the chat
 * surface varies (group id, user id, channel @handle).
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#26a5e4';

export const DEFINITION: IntegrationDefinition = {
  id: 'telegram',
  name: 'Telegram',
  description: 'Bot messages, photos, documents, polls, edits.',
  iconBrand: 'telegram',
  color: COLOR,
  category: 'Communication',
};

export const NODES: NodeDefinition[] = [
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
