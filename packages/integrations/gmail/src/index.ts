/**
 * @tramo/gmail — official Gmail integration pack.
 *
 * Action nodes make real REST calls against the Gmail API
 * (gmail.googleapis.com) using a per-node OAuth bearer token. Send / reply /
 * draft build an RFC 2822 message, base64url-encode it into `{ raw }` and POST
 * it; search, get, modify and trash hit the corresponding message endpoints.
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

const COLOR = '#ea4335';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const DEFINITION: IntegrationDefinition = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Send, reply, draft, search, label messages.',
  iconBrand: 'gmail',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
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
      { key: 'bcc', type: 'text', label: 'Bcc', default: '', optional: true },
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
    id: 'gmail-reply',
    integrationId: 'gmail',
    name: 'Gmail · Reply to Email',
    operationName: 'Reply to email',
    category: 'action',
    description: 'Reply to an existing message thread; preserves subject and threading.',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'messageId', type: 'text', label: 'Message ID to reply to', default: '' },
      { key: 'body', type: 'textarea', label: 'Reply body (supports {{var}})', default: '' },
      { key: 'replyAll', type: 'boolean', label: 'Reply to all recipients', default: false, optional: true },
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
  {
    id: 'gmail-get',
    integrationId: 'gmail',
    name: 'Gmail · Get Email',
    operationName: 'Get email',
    category: 'action',
    description: 'Retrieve the full details of a message by ID.',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Message', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'messageId', type: 'text', label: 'Message ID', default: '' },
      { key: 'includeAttachments', type: 'boolean', label: 'Include attachments', default: false, optional: true },
    ],
  },
  {
    id: 'gmail-trash',
    integrationId: 'gmail',
    name: 'Gmail · Move to Trash',
    operationName: 'Move to trash',
    category: 'action',
    description: 'Move a message to the trash (recoverable, unlike permanent delete).',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'messageId', type: 'text', label: 'Message ID', default: '' },
    ],
  },
  {
    id: 'gmail-label-modify',
    integrationId: 'gmail',
    name: 'Gmail · Modify Labels',
    operationName: 'Modify labels',
    category: 'action',
    description: 'Add or remove labels on a message (e.g. mark as read, star, archive).',
    icon: 'Cable',
    iconBrand: 'gmail',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Message', type: 'object' }],
    fields: [
      { key: 'oauthToken', type: 'secret', label: 'OAuth access token' },
      { key: 'messageId', type: 'text', label: 'Message ID', default: '' },
      { key: 'addLabels', type: 'json', label: 'Labels to add (JSON array)', default: '["STARRED"]', optional: true },
      { key: 'removeLabels', type: 'json', label: 'Labels to remove (JSON array)', default: '["UNREAD"]', optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const tokenOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.oauthToken
    ? String(ctx.config.oauthToken)
    : (typeof process !== 'undefined' ? process.env?.GMAIL_OAUTH_TOKEN : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const csv = (v: unknown): string[] =>
  String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** URL-safe base64 (RFC 4648 §5): +/ → -_ and trailing = stripped. */
function base64url(input: string): string {
  const raw = typeof Buffer !== 'undefined'
    ? Buffer.from(input, 'utf8').toString('base64')
    : (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(input))) : input);
  return raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Build a minimal RFC 2822 message and return it base64url-encoded. */
function buildRawMessage(parts: {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body: string;
  html?: boolean;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers: string[] = [];
  if (parts.to) headers.push(`To: ${parts.to}`);
  if (parts.cc) headers.push(`Cc: ${parts.cc}`);
  if (parts.bcc) headers.push(`Bcc: ${parts.bcc}`);
  if (parts.subject) headers.push(`Subject: ${parts.subject}`);
  if (parts.inReplyTo) headers.push(`In-Reply-To: ${parts.inReplyTo}`);
  if (parts.references) headers.push(`References: ${parts.references}`);
  headers.push('MIME-Version: 1.0');
  headers.push(`Content-Type: ${parts.html ? 'text/html' : 'text/plain'}; charset="UTF-8"`);
  const message = `${headers.join('\r\n')}\r\n\r\n${parts.body}`;
  return base64url(message);
}

function gHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

interface GmailMessage {
  id?: string;
  threadId?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
  [k: string]: unknown;
}

function headerValue(msg: GmailMessage | null | undefined, name: string): string | undefined {
  const headers = msg?.payload?.headers ?? [];
  const lower = name.toLowerCase();
  for (const h of headers) {
    if (typeof h?.name === 'string' && h.name.toLowerCase() === lower) return h.value;
  }
  return undefined;
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'gmail-send': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'to', 'subject'], 'gmail-send');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-send: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const raw = buildRawMessage({
      to: tpl(ctx, 'to'),
      cc: ctx.config.cc ? tpl(ctx, 'cc') : undefined,
      bcc: ctx.config.bcc ? tpl(ctx, 'bcc') : undefined,
      subject: tpl(ctx, 'subject'),
      body: tpl(ctx, 'body'),
      html: String(ctx.config.bodyFormat ?? 'text') === 'html',
    });
    const res = await httpJson({
      method: 'POST',
      url: `${API}/messages/send`,
      headers: gHeaders(token),
      json: { raw },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'gmail-reply': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'gmail-reply');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-reply: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const messageId = String(ctx.config.messageId);
    // Fetch the original to derive threadId, recipients and threading headers.
    const orig = await httpJson<GmailMessage>({
      method: 'GET',
      url: `${API}/messages/${encodeURIComponent(messageId)}`,
      query: { format: 'metadata', metadataHeaders: 'Subject' },
      headers: gHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!orig.ok) return toEnvelope(orig);
    // Need full headers for From/To/Cc/Message-ID/References — re-fetch with the needed headers.
    const full = await httpJson<GmailMessage>({
      method: 'GET',
      url: `${API}/messages/${encodeURIComponent(messageId)}`,
      query: { format: 'metadata', metadataHeaders: ['Subject', 'From', 'To', 'Cc', 'Message-ID', 'References'].join(',') },
      headers: gHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!full.ok) return toEnvelope(full);
    const msg = full.data;
    const threadId = msg?.threadId;
    const origSubject = headerValue(msg, 'Subject') ?? '';
    const subject = /^re:/i.test(origSubject) ? origSubject : `Re: ${origSubject}`;
    const origMessageId = headerValue(msg, 'Message-ID');
    const origReferences = headerValue(msg, 'References');
    const replyAll = ctx.config.replyAll === true;
    const to = headerValue(msg, 'From') ?? '';
    const cc = replyAll
      ? [headerValue(msg, 'To'), headerValue(msg, 'Cc')].filter(Boolean).join(', ') || undefined
      : undefined;
    const raw = buildRawMessage({
      to,
      cc,
      subject,
      body: tpl(ctx, 'body'),
      html: String(ctx.config.bodyFormat ?? 'text') === 'html',
      inReplyTo: origMessageId,
      references: [origReferences, origMessageId].filter(Boolean).join(' ') || undefined,
    });
    const res = await httpJson({
      method: 'POST',
      url: `${API}/messages/send`,
      headers: gHeaders(token),
      json: { raw, ...(threadId ? { threadId } : {}) },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'gmail-draft': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'to'], 'gmail-draft');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-draft: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const raw = buildRawMessage({
      to: tpl(ctx, 'to'),
      subject: tpl(ctx, 'subject'),
      body: tpl(ctx, 'body'),
    });
    const res = await httpJson({
      method: 'POST',
      url: `${API}/drafts`,
      headers: gHeaders(token),
      json: { message: { raw } },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'gmail-search': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'query'], 'gmail-search');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-search: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const limit = Number(ctx.config.limit ?? 25);
    const res = await httpJson<{ messages?: unknown[]; resultSizeEstimate?: number }>({
      method: 'GET',
      url: `${API}/messages`,
      query: {
        q: tpl(ctx, 'query'),
        maxResults: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      },
      headers: gHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res, (d) => d.messages ?? []);
  },

  'gmail-get': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'gmail-get');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-get: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const res = await httpJson({
      method: 'GET',
      url: `${API}/messages/${encodeURIComponent(String(ctx.config.messageId))}`,
      query: { format: ctx.config.includeAttachments === true ? 'full' : 'metadata' },
      headers: gHeaders(token),
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'gmail-trash': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'gmail-trash');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-trash: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const res = await httpJson({
      method: 'POST',
      url: `${API}/messages/${encodeURIComponent(String(ctx.config.messageId))}/trash`,
      headers: gHeaders(token),
      json: {},
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return res.ok
      ? { out: { trashed: true, id: String(ctx.config.messageId), message: res.data } }
      : toEnvelope(res);
  },

  'gmail-label-modify': async (ctx) => {
    const miss = requireFields(ctx.config, ['oauthToken', 'messageId'], 'gmail-label-modify');
    if (miss) return miss;
    const token = tokenOf(ctx);
    if (!token) return { error: { message: 'gmail-label-modify: OAuth token required (config.oauthToken or GMAIL_OAUTH_TOKEN)' } };
    const toLabelArray = (v: unknown): string[] => {
      const parsed = parseMaybeJson(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
      return csv(v);
    };
    const addLabelIds = toLabelArray(ctx.config.addLabels);
    const removeLabelIds = toLabelArray(ctx.config.removeLabels);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/messages/${encodeURIComponent(String(ctx.config.messageId))}/modify`,
      headers: gHeaders(token),
      json: {
        ...(addLabelIds.length ? { addLabelIds } : {}),
        ...(removeLabelIds.length ? { removeLabelIds } : {}),
      },
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
  id: 'gmail',
  name: 'Gmail',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
