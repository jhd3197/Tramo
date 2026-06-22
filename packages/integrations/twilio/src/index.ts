/**
 * @tramo/twilio — official Twilio integration pack.
 *
 * Ships an incoming-message webhook trigger plus SMS, WhatsApp, voice, and
 * message-lookup actions. Auth uses Account SID + Auth Token per node.
 */

import { defineNodePack, defineStubExecutor } from '@tramo/runtime';
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

export default defineNodePack({
  id: 'twilio',
  name: 'Twilio',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
