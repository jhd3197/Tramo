/**
 * @tramo/outlook — official Outlook integration pack.
 *
 * Microsoft 365 mail + calendar operations via Microsoft Graph
 * (graph.microsoft.com/v1.0/me/...), authenticated with a per-node OAuth
 * bearer token.
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

const COLOR = '#0078d4';
const API = 'https://graph.microsoft.com/v1.0/me';

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

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.oauthToken
    ? String(ctx.config.oauthToken)
    : (typeof process !== 'undefined' ? process.env?.OUTLOOK_OAUTH_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const csv = (v: unknown): string[] =>
  String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function gHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

const recipients = (emails: string[]): Array<{ emailAddress: { address: string } }> =>
  emails.map((address) => ({ emailAddress: { address } }));

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'outlook-send-email': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'to', 'subject'], 'outlook-send-email');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-send-email: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const contentType = String(ctx.config.bodyFormat ?? 'HTML') === 'Text' ? 'Text' : 'HTML';
    const res = await httpJson({
      method: 'POST',
      url: `${API}/sendMail`,
      headers: gHeaders(token),
      json: {
        message: {
          subject: tpl(ctx, 'subject'),
          body: { contentType, content: tpl(ctx, 'body') },
          toRecipients: recipients(csv(tpl(ctx, 'to'))),
          ...(ctx.config.cc ? { ccRecipients: recipients(csv(tpl(ctx, 'cc'))) } : {}),
          ...(ctx.config.bcc ? { bccRecipients: recipients(csv(tpl(ctx, 'bcc'))) } : {}),
        },
        saveToSentItems: true,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    // sendMail returns 202 Accepted with an empty body.
    return res.ok ? { out: { sent: true, status: res.status } } : toEnvelope(res);
  },

  'outlook-reply': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'outlook-reply');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-reply: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const id = encodeURIComponent(String(ctx.config.messageId));
    const action = ctx.config.replyAll === true ? 'replyAll' : 'reply';
    const res = await httpJson({
      method: 'POST',
      url: `${API}/messages/${id}/${action}`,
      headers: gHeaders(token),
      json: { comment: tpl(ctx, 'body') },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok ? { out: { sent: true, status: res.status } } : toEnvelope(res);
  },

  'outlook-search': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'query'], 'outlook-search');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-search: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const folder = ctx.config.folderId ? String(ctx.config.folderId).trim() : '';
    const base = folder ? `${API}/mailFolders/${encodeURIComponent(folder)}/messages` : `${API}/messages`;
    const top = Number(ctx.config.top ?? 25);
    const res = await httpJson<{ value?: unknown[] }>({
      method: 'GET',
      url: base,
      query: {
        $search: `"${tpl(ctx, 'query')}"`,
        $top: Number.isFinite(top) && top > 0 ? top : undefined,
      },
      headers: gHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res, (d) => d.value ?? []);
  },

  'outlook-get-email': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'outlook-get-email');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-get-email: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const id = encodeURIComponent(String(ctx.config.messageId));
    const expand = ctx.config.includeAttachments === true;
    const res = await httpJson({
      method: 'GET',
      url: `${API}/messages/${id}`,
      query: { $expand: expand ? 'attachments' : undefined },
      headers: gHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (res.status === 404) {
      return { notFound: { messageId: String(ctx.config.messageId), status: 404 } };
    }
    return toEnvelope(res);
  },

  'outlook-move-to-folder': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId', 'destinationFolderId'], 'outlook-move-to-folder');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-move-to-folder: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const id = encodeURIComponent(String(ctx.config.messageId));
    const res = await httpJson({
      method: 'POST',
      url: `${API}/messages/${id}/move`,
      headers: gHeaders(token),
      json: { destinationId: String(ctx.config.destinationFolderId) },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'outlook-create-event': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'subject', 'start', 'end'], 'outlook-create-event');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-create-event: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const attendees = csv(ctx.config.attendees).map((address) => ({
      emailAddress: { address },
      type: 'required',
    }));
    const res = await httpJson({
      method: 'POST',
      url: `${API}/events`,
      headers: gHeaders(token),
      json: {
        subject: tpl(ctx, 'subject'),
        start: { dateTime: String(ctx.config.start), timeZone: 'UTC' },
        end: { dateTime: String(ctx.config.end), timeZone: 'UTC' },
        ...(attendees.length ? { attendees } : {}),
        ...(ctx.config.bodyContent ? { body: { contentType: 'HTML', content: tpl(ctx, 'bodyContent') } } : {}),
        ...(ctx.config.location ? { location: { displayName: tpl(ctx, 'location') } } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'outlook-flag': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'outlook-flag');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'outlook-flag: OAuth token required (config.oauthToken or OUTLOOK_OAUTH_TOKEN)' } };
    const id = encodeURIComponent(String(ctx.config.messageId));
    const flagStatus = String(ctx.config.flagStatus ?? 'flagged');
    const res = await httpJson({
      method: 'PATCH',
      url: `${API}/messages/${id}`,
      headers: gHeaders(token),
      json: { flag: { flagStatus } },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  // Triggers (and anything without a real impl) keep the passthrough stub.
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'outlook',
  name: 'Outlook',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
