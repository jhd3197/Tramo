/**
 * @tramo/twilio — official Twilio integration pack.
 *
 * Ships an incoming-message webhook trigger plus SMS, WhatsApp, voice, and
 * message-lookup actions. Auth uses Account SID + Auth Token per node.
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

const COLOR = '#f22f46';

const DEFINITION: IntegrationDefinition = {
  id: 'twilio',
  name: 'Twilio',
  description: 'SMS, WhatsApp, voice, incoming-message webhook.',
  iconBrand: 'twilio',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:twilio:incoming-message',
    integrationId: 'twilio',
    name: 'Twilio · On Incoming Message',
    operationName: 'On incoming message',
    category: 'trigger',
    description: 'Fires when Twilio POSTs an inbound SMS or WhatsApp message to the configured URL.',
    icon: 'CloudDownload',
    iconBrand: 'twilio',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/twilio/incoming', help: 'Configure as the Webhook URL on your Twilio phone number / Messaging Service.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'fromFilter', type: 'text', label: 'From filter (E.164)', default: '', optional: true, help: 'Only fire when From matches this E.164 number' },
      { key: 'authToken', type: 'secret', label: 'Auth token', optional: true, help: 'Twilio signs requests with X-Twilio-Signature. Validate downstream.' },
    ],
  },
  {
    id: 'twilio-send-sms',
    integrationId: 'twilio',
    name: 'Twilio · Send SMS',
    operationName: 'Send SMS',
    category: 'action',
    description: 'Send an SMS (or MMS) message from a Twilio number.',
    icon: 'Cable',
    iconBrand: 'twilio',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Message', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'accountSid', type: 'secret', label: 'Account SID' },
      { key: 'authToken', type: 'secret', label: 'Auth token' },
      { key: 'fromNumber', type: 'text', label: 'From number', default: '', help: 'E.164, e.g. +15551234567' },
      { key: 'to', type: 'text', label: 'To (supports {{var}})', default: '' },
      { key: 'body', type: 'textarea', label: 'Body (supports {{var}})', default: '' },
      { key: 'mediaUrl', type: 'url', label: 'Media URL', default: '', optional: true, help: 'For MMS' },
    ],
  },
  {
    id: 'twilio-send-whatsapp',
    integrationId: 'twilio',
    name: 'Twilio · Send WhatsApp Message',
    operationName: 'Send WhatsApp message',
    category: 'action',
    description: 'Send a WhatsApp message via Twilio.',
    icon: 'Cable',
    iconBrand: 'twilio',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Message', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'accountSid', type: 'secret', label: 'Account SID' },
      { key: 'authToken', type: 'secret', label: 'Auth token' },
      { key: 'fromNumber', type: 'text', label: 'From number', default: 'whatsapp:+14155238886', help: 'Twilio sandbox or your registered WhatsApp sender' },
      { key: 'to', type: 'text', label: 'To (supports {{var}})', default: '', help: 'whatsapp:+E.164' },
      { key: 'body', type: 'textarea', label: 'Body (supports {{var}})', default: '' },
      { key: 'mediaUrl', type: 'url', label: 'Media URL', default: '', optional: true },
    ],
  },
  {
    id: 'twilio-make-call',
    integrationId: 'twilio',
    name: 'Twilio · Make Voice Call',
    operationName: 'Make voice call',
    category: 'action',
    description: 'Place an outbound voice call using TwiML.',
    icon: 'Cable',
    iconBrand: 'twilio',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Call', type: 'object' }],
    fields: [
      { key: 'accountSid', type: 'secret', label: 'Account SID' },
      { key: 'authToken', type: 'secret', label: 'Auth token' },
      { key: 'fromNumber', type: 'text', label: 'From number', default: '' },
      { key: 'to', type: 'text', label: 'To (supports {{var}})', default: '' },
      { key: 'twimlUrl', type: 'url', label: 'TwiML URL', default: '', help: 'URL returning TwiML; alternative to inline twiml' },
      { key: 'inlineTwiml', type: 'textarea', label: 'Inline TwiML', default: '', optional: true, help: 'Inline TwiML XML; takes precedence over twimlUrl' },
    ],
  },
  {
    id: 'twilio-list-messages',
    integrationId: 'twilio',
    name: 'Twilio · List Messages',
    operationName: 'List messages',
    category: 'action',
    description: 'List recent Twilio messages, optionally filtered by To / From.',
    icon: 'Cable',
    iconBrand: 'twilio',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Messages', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'accountSid', type: 'secret', label: 'Account SID' },
      { key: 'authToken', type: 'secret', label: 'Auth token' },
      { key: 'to', type: 'text', label: 'To', default: '', optional: true },
      { key: 'from', type: 'text', label: 'From', default: '', optional: true },
      { key: 'limit', type: 'number', label: 'Limit', default: 20, optional: true },
    ],
  },
  {
    id: 'twilio-get-message',
    integrationId: 'twilio',
    name: 'Twilio · Get Message',
    operationName: 'Get message',
    category: 'action',
    description: 'Fetch a single message by its Twilio SID.',
    icon: 'Cable',
    iconBrand: 'twilio',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Message', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'accountSid', type: 'secret', label: 'Account SID' },
      { key: 'authToken', type: 'secret', label: 'Auth token' },
      { key: 'messageSid', type: 'text', label: 'Message SID', default: '', help: 'Twilio message SID, starts with SM…' },
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

interface TwilioCreds {
  accountSid: string;
  authToken: string;
}

/** Resolve Account SID + Auth Token from config or env, or return an error envelope. */
function twilioCreds(ctx: ExecutionContext, id: string): TwilioCreds | { error: { message: string } } {
  const accountSid = ctx.config.accountSid ? String(ctx.config.accountSid) : env('TWILIO_ACCOUNT_SID');
  const authToken = ctx.config.authToken ? String(ctx.config.authToken) : env('TWILIO_AUTH_TOKEN');
  if (!accountSid) return { error: { message: `${id}: accountSid required (config.accountSid or TWILIO_ACCOUNT_SID)` } };
  if (!authToken) return { error: { message: `${id}: authToken required (config.authToken or TWILIO_AUTH_TOKEN)` } };
  return { accountSid, authToken };
}

const apiBase = (accountSid: string): string =>
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'twilio-send-sms': async (ctx) => {
    const miss = requireFields(ctx.config, ['fromNumber', 'to', 'body'], 'twilio-send-sms');
    if (miss) return miss;
    const creds = twilioCreds(ctx, 'twilio-send-sms');
    if ('error' in creds) return creds;
    const res = await httpJson({
      method: 'POST',
      url: `${apiBase(creds.accountSid)}/Messages.json`,
      basic: { user: creds.accountSid, pass: creds.authToken },
      form: {
        To: tpl(ctx, 'to'),
        From: String(ctx.config.fromNumber),
        Body: tpl(ctx, 'body'),
        ...(ctx.config.mediaUrl ? { MediaUrl: String(ctx.config.mediaUrl) } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'twilio-send-whatsapp': async (ctx) => {
    const miss = requireFields(ctx.config, ['fromNumber', 'to', 'body'], 'twilio-send-whatsapp');
    if (miss) return miss;
    const creds = twilioCreds(ctx, 'twilio-send-whatsapp');
    if ('error' in creds) return creds;
    const to = tpl(ctx, 'to');
    const from = String(ctx.config.fromNumber);
    const res = await httpJson({
      method: 'POST',
      url: `${apiBase(creds.accountSid)}/Messages.json`,
      basic: { user: creds.accountSid, pass: creds.authToken },
      form: {
        To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
        From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        Body: tpl(ctx, 'body'),
        ...(ctx.config.mediaUrl ? { MediaUrl: String(ctx.config.mediaUrl) } : {}),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'twilio-make-call': async (ctx) => {
    const miss = requireFields(ctx.config, ['fromNumber', 'to'], 'twilio-make-call');
    if (miss) return miss;
    const creds = twilioCreds(ctx, 'twilio-make-call');
    if ('error' in creds) return creds;
    const inlineTwiml = String(ctx.config.inlineTwiml ?? '').trim();
    const twimlUrl = String(ctx.config.twimlUrl ?? '').trim();
    if (!inlineTwiml && !twimlUrl) {
      return { error: { message: 'twilio-make-call: either inlineTwiml or twimlUrl is required' } };
    }
    const res = await httpJson({
      method: 'POST',
      url: `${apiBase(creds.accountSid)}/Calls.json`,
      basic: { user: creds.accountSid, pass: creds.authToken },
      form: {
        To: tpl(ctx, 'to'),
        From: String(ctx.config.fromNumber),
        ...(inlineTwiml ? { Twiml: inlineTwiml } : { Url: twimlUrl }),
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'twilio-list-messages': async (ctx) => {
    const creds = twilioCreds(ctx, 'twilio-list-messages');
    if ('error' in creds) return creds;
    const res = await httpJson<{ messages?: unknown[] }>({
      method: 'GET',
      url: `${apiBase(creds.accountSid)}/Messages.json`,
      basic: { user: creds.accountSid, pass: creds.authToken },
      query: {
        To: ctx.config.to ? String(ctx.config.to) : undefined,
        From: ctx.config.from ? String(ctx.config.from) : undefined,
        PageSize: ctx.config.limit != null ? Number(ctx.config.limit) : undefined,
      },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    return { out: Array.isArray(res.data?.messages) ? res.data.messages : [] };
  },

  'twilio-get-message': async (ctx) => {
    const miss = requireFields(ctx.config, ['messageSid'], 'twilio-get-message');
    if (miss) return miss;
    const creds = twilioCreds(ctx, 'twilio-get-message');
    if ('error' in creds) return creds;
    const res = await httpJson({
      method: 'GET',
      url: `${apiBase(creds.accountSid)}/Messages/${encodeURIComponent(String(ctx.config.messageSid))}.json`,
      basic: { user: creds.accountSid, pass: creds.authToken },
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (res.status === 404) return { notFound: { messageSid: String(ctx.config.messageSid) } };
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
  id: 'twilio',
  name: 'Twilio',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
