/**
 * @tramo/outlook — official Outlook integration pack.
 *
 * Microsoft 365 mail + calendar operations via Microsoft Graph,
 * authenticated with a per-node OAuth bearer token.
 */

import { defineNodePack, defineStubExecutor } from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#0078d4';

const DEFINITION: IntegrationDefinition = {
  id: 'outlook',
  name: 'Outlook',
  description: 'Mail + calendar via Microsoft Graph.',
  iconBrand: 'microsoftoutlook',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'outlook-send-email',
    integrationId: 'outlook',
    name: 'Outlook · Send Email',
    operationName: 'Send email',
    category: 'action',
    description: 'Send an email message through Microsoft Graph.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'to', type: 'text', label: 'To', default: '', help: 'comma-separated' },
      { key: 'cc', type: 'text', label: 'Cc', default: '', optional: true },
      { key: 'bcc', type: 'text', label: 'Bcc', default: '', optional: true },
      { key: 'subject', type: 'text', label: 'Subject (supports {{var}})', default: '' },
      { key: 'body', type: 'textarea', label: 'Body (supports {{var}})', default: '' },
      {
        key: 'bodyFormat',
        type: 'select',
        label: 'Body format',
        default: 'HTML',
        options: [
          { label: 'HTML', value: 'HTML' },
          { label: 'Text', value: 'Text' },
        ],
      },
    ],
  },
  {
    id: 'outlook-reply',
    integrationId: 'outlook',
    name: 'Outlook · Reply to Email',
    operationName: 'Reply to email',
    category: 'action',
    description: 'Reply to an existing message, optionally to all recipients.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'messageId', type: 'text', label: 'Message id', default: '' },
      { key: 'body', type: 'textarea', label: 'Body (supports {{var}})', default: '' },
      { key: 'replyAll', type: 'boolean', label: 'Reply all', default: false, optional: true },
    ],
  },
  {
    id: 'outlook-search',
    integrationId: 'outlook',
    name: 'Outlook · Search Messages',
    operationName: 'Search messages',
    category: 'action',
    description: 'Search the mailbox using a KQL query.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Messages', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'query', type: 'text', label: 'Query', default: 'from:bob isread:false', help: 'KQL search string' },
      { key: 'folderId', type: 'text', label: 'Folder id', default: 'inbox', optional: true },
      { key: 'top', type: 'number', label: 'Top', default: 25, optional: true },
    ],
  },
  {
    id: 'outlook-get-email',
    integrationId: 'outlook',
    name: 'Outlook · Get Email',
    operationName: 'Get email',
    category: 'action',
    description: 'Fetch a single message by id.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Message', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'messageId', type: 'text', label: 'Message id', default: '' },
      { key: 'includeAttachments', type: 'boolean', label: 'Include attachments', default: false, optional: true },
    ],
  },
  {
    id: 'outlook-move-to-folder',
    integrationId: 'outlook',
    name: 'Outlook · Move to Folder',
    operationName: 'Move to folder',
    category: 'action',
    description: 'Move a message to another mail folder.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Message', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'messageId', type: 'text', label: 'Message id', default: '' },
      { key: 'destinationFolderId', type: 'text', label: 'Destination folder', default: 'archive', help: 'Folder id or one of: inbox/archive/junkemail/deleteditems' },
    ],
  },
  {
    id: 'outlook-create-event',
    integrationId: 'outlook',
    name: 'Outlook · Create Calendar Event',
    operationName: 'Create calendar event',
    category: 'action',
    description: 'Create a calendar event with optional attendees and location.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Event', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'subject', type: 'text', label: 'Subject (supports {{var}})', default: '' },
      { key: 'start', type: 'text', label: 'Start', default: '', help: 'ISO 8601 e.g. 2026-06-01T09:00:00Z' },
      { key: 'end', type: 'text', label: 'End', default: '', help: 'ISO 8601' },
      { key: 'attendees', type: 'text', label: 'Attendees', default: '', optional: true, help: 'comma-separated emails' },
      { key: 'bodyContent', type: 'textarea', label: 'Body (supports {{var}})', default: '', optional: true },
      { key: 'location', type: 'text', label: 'Location', default: '', optional: true },
    ],
  },
  {
    id: 'outlook-flag',
    integrationId: 'outlook',
    name: 'Outlook · Flag Message',
    operationName: 'Flag message',
    category: 'action',
    description: 'Set the follow-up flag status on a message.',
    icon: 'Cable',
    iconBrand: 'microsoftoutlook',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Message', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth token', help: 'Microsoft Graph OAuth token' },
      { key: 'messageId', type: 'text', label: 'Message id', default: '' },
      {
        key: 'flagStatus',
        type: 'select',
        label: 'Flag status',
        default: 'flagged',
        options: [
          { label: 'Not flagged', value: 'notFlagged' },
          { label: 'Flagged', value: 'flagged' },
          { label: 'Complete', value: 'complete' },
        ],
      },
    ],
  },
];

export default defineNodePack({
  id: 'outlook',
  name: 'Outlook',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
