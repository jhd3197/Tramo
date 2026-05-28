/**
 * Gmail integration pack.
 *
 * OAuth-based. The token field stays a `secret` here; the runtime wires
 * the actual refresh-flow on send.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#ea4335';

export const DEFINITION: IntegrationDefinition = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Send, draft, label and search messages.',
  iconBrand: 'gmail',
  color: COLOR,
  category: 'Communication',
};

export const NODES: NodeDefinition[] = [
  {
    id: 'gmail-send',
    integrationId: 'gmail',
    name: 'Gmail · Send Email',
    operationName: 'Send email',
    category: 'action',
    description: 'Send an email from the authenticated account.',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'to', type: 'text', label: 'To (comma-separated)', default: '' },
      { key: 'cc', type: 'text', label: 'Cc', default: '', optional: true },
      { key: 'subject', type: 'text', label: 'Subject (supports {{var}})', default: '' },
      { key: 'body', type: 'textarea', label: 'Body (supports {{var}})', default: '' },
      {
        key: 'bodyFormat',
        type: 'select',
        label: 'Body format',
        default: 'text',
        options: [
          { label: 'Plain text', value: 'text' },
          { label: 'HTML', value: 'html' },
        ],
      },
    ],
  },
  {
    id: 'gmail-draft',
    integrationId: 'gmail',
    name: 'Gmail · Create Draft',
    operationName: 'Create draft',
    category: 'action',
    description: 'Save an unsent draft in the authenticated account.',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Draft', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'to', type: 'text', label: 'To', default: '' },
      { key: 'subject', type: 'text', label: 'Subject', default: '' },
      { key: 'body', type: 'textarea', label: 'Body', default: '' },
    ],
  },
  {
    id: 'gmail-search',
    integrationId: 'gmail',
    name: 'Gmail · Search Messages',
    operationName: 'Search messages',
    category: 'action',
    description: 'Search the inbox with Gmail query syntax.',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Messages', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'query', type: 'text', label: 'Gmail query', default: 'is:unread newer_than:1d' },
      { key: 'limit', type: 'number', label: 'Max results', default: 25, optional: true },
    ],
  },
];
