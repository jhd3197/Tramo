/**
 * @tramo/stripe — official Stripe integration pack.
 *
 * The webhook trigger keeps a passthrough stub (driven by the runtime's
 * webhook router). Every action node makes real REST calls against
 * api.stripe.com/v1 using the shared HTTP helper. Stripe expects
 * application/x-www-form-urlencoded bodies, so params are flattened with
 * bracket notation (metadata[key], items[0][price], …).
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

const COLOR = '#635bff';
const API = 'https://api.stripe.com/v1';

const DEFINITION: IntegrationDefinition = {
  id: 'stripe',
  name: 'Stripe',
  description: 'Customers, payments, subscriptions, invoices, checkout.',
  iconBrand: 'stripe',
  color: COLOR,
  category: 'Commerce',
};

const NODES: NodeDefinition[] = [
  {
    id: 'webhook-trigger:stripe:event',
    integrationId: 'stripe',
    name: 'Stripe · On Event',
    operationName: 'On event',
    category: 'trigger',
    description: 'Fires when Stripe POSTs a webhook event (payment_intent.succeeded, customer.created, …).',
    icon: 'CloudDownload',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/stripe/events', help: 'Register this URL as a Stripe Endpoint and copy the signing secret.' },
      { key: 'method', type: 'select', label: 'Method', default: 'POST', options: [{ label: 'POST', value: 'POST' }] },
      { key: 'eventTypes', type: 'text', label: 'Filter event types (comma-separated, blank = all)', default: 'payment_intent.succeeded,charge.refunded', optional: true },
      { key: 'signingSecret', type: 'secret', label: 'Signing secret (whsec_…)', optional: true, help: 'Stripe sends `Stripe-Signature`; validate downstream.' },
    ],
  },
  {
    id: 'stripe-customer-create',
    integrationId: 'stripe',
    name: 'Stripe · Create Customer',
    operationName: 'Create customer',
    category: 'action',
    description: 'Create a new Stripe Customer object.',
    icon: 'Cable',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Customer', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'Secret key' },
      { key: 'email', type: 'text', label: 'Email (supports {{var}})', default: '' },
      { key: 'name', type: 'text', label: 'Name', default: '', optional: true },
      { key: 'metadata', type: 'json', label: 'Metadata (JSON)', default: '{}', optional: true },
    ],
  },
  {
    id: 'stripe-charge-create',
    integrationId: 'stripe',
    name: 'Stripe · Create Payment Intent',
    operationName: 'Create payment intent',
    category: 'action',
    description: 'Start a Payment Intent for a given amount + currency.',
    icon: 'Cable',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'PaymentIntent', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'Secret key' },
      { key: 'amount', type: 'number', label: 'Amount (smallest unit, e.g. cents)', default: 1000 },
      { key: 'currency', type: 'text', label: 'Currency (ISO 4217)', default: 'usd' },
      { key: 'customerId', type: 'text', label: 'Customer ID', default: '', optional: true },
      { key: 'description', type: 'text', label: 'Description', default: '', optional: true },
    ],
  },
  {
    id: 'stripe-subscription-create',
    integrationId: 'stripe',
    name: 'Stripe · Create Subscription',
    operationName: 'Create subscription',
    category: 'action',
    description: 'Subscribe a customer to one or more recurring prices.',
    icon: 'Cable',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Subscription', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'Secret key' },
      { key: 'customerId', type: 'text', label: 'Customer ID', default: '' },
      { key: 'priceIds', type: 'json', label: 'Price IDs (JSON array)', default: '["price_..."]' },
      { key: 'trialDays', type: 'number', label: 'Trial days', default: 0, optional: true },
    ],
  },
  {
    id: 'stripe-refund-create',
    integrationId: 'stripe',
    name: 'Stripe · Refund Charge',
    operationName: 'Refund charge',
    category: 'action',
    description: 'Issue a refund against a Payment Intent or Charge.',
    icon: 'Cable',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Refund', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'Secret key' },
      { key: 'paymentIntentId', type: 'text', label: 'Payment Intent ID', default: '' },
      { key: 'amount', type: 'number', label: 'Amount to refund (omit for full)', default: 0, optional: true },
      { key: 'reason', type: 'select', label: 'Reason', default: 'requested_by_customer', optional: true, options: [
        { label: 'Requested by customer', value: 'requested_by_customer' },
        { label: 'Duplicate', value: 'duplicate' },
        { label: 'Fraudulent', value: 'fraudulent' },
      ] },
    ],
  },
  {
    id: 'stripe-invoice-create',
    integrationId: 'stripe',
    name: 'Stripe · Create Invoice',
    operationName: 'Create invoice',
    category: 'action',
    description: 'Create an invoice for a customer; optionally auto-finalize and send.',
    icon: 'Cable',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Invoice', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'Secret key' },
      { key: 'customerId', type: 'text', label: 'Customer ID', default: '' },
      { key: 'description', type: 'text', label: 'Description', default: '', optional: true },
      { key: 'daysUntilDue', type: 'number', label: 'Days until due', default: 14, optional: true },
      { key: 'autoSend', type: 'boolean', label: 'Auto-finalize and send', default: false, optional: true },
    ],
  },
  {
    id: 'stripe-checkout-session',
    integrationId: 'stripe',
    name: 'Stripe · Checkout Session',
    operationName: 'Create checkout session',
    category: 'action',
    description: 'Create a hosted checkout session for one or more price line items.',
    icon: 'Cable',
    iconBrand: 'stripe',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Session', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'Secret key' },
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'payment',
        options: [
          { label: 'One-time payment', value: 'payment' },
          { label: 'Subscription', value: 'subscription' },
          { label: 'Setup', value: 'setup' },
        ],
      },
      { key: 'lineItems', type: 'json', label: 'Line items (JSON array)', default: '[{"price":"price_...","quantity":1}]' },
      { key: 'successUrl', type: 'url', label: 'Success URL', default: 'https://example.com/success' },
      { key: 'cancelUrl', type: 'url', label: 'Cancel URL', default: 'https://example.com/cancel' },
      { key: 'customerId', type: 'text', label: 'Customer ID (optional)', default: '', optional: true },
    ],
  },
];

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const keyOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.apiKey ? String(ctx.config.apiKey) : (typeof process !== 'undefined' ? process.env?.STRIPE_SECRET_KEY : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const noKey = { error: { message: 'stripe: secret key required (config.apiKey or STRIPE_SECRET_KEY)' } } as const;

/**
 * Flatten a nested object/array into Stripe's bracket-notation form params.
 * e.g. { metadata: { a: 1 }, items: [{ price: 'p' }] } →
 *      { 'metadata[a]': '1', 'items[0][price]': 'p' }
 */
function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, prefix ? `${prefix}[${i}]` : String(i), out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    if (prefix) out[prefix] = String(value);
  }
  return out;
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'stripe-customer-create': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey;
    const meta = parseMaybeJson(ctx.config.metadata);
    const form: Record<string, string> = {};
    const email = tpl(ctx, 'email');
    if (email) form.email = email;
    if (ctx.config.name) form.name = tpl(ctx, 'name');
    if (meta && typeof meta === 'object') Object.assign(form, flatten(meta, 'metadata'));
    const res = await httpJson({
      method: 'POST',
      url: `${API}/customers`,
      bearer: key,
      form,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'stripe-charge-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['amount', 'currency'], 'stripe-charge-create');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return noKey;
    const form: Record<string, string> = {
      amount: String(Number(ctx.config.amount)),
      currency: String(ctx.config.currency).toLowerCase(),
    };
    if (ctx.config.customerId) form.customer = String(ctx.config.customerId);
    if (ctx.config.description) form.description = tpl(ctx, 'description');
    const res = await httpJson({
      method: 'POST',
      url: `${API}/payment_intents`,
      bearer: key,
      form,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'stripe-subscription-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['customerId', 'priceIds'], 'stripe-subscription-create');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return noKey;
    const parsed = parseMaybeJson(ctx.config.priceIds);
    const priceIds = Array.isArray(parsed) ? parsed.map((p) => String(p)).filter(Boolean) : [];
    if (priceIds.length === 0) {
      return { error: { message: 'stripe-subscription-create: priceIds must be a non-empty JSON array of price IDs' } };
    }
    const form: Record<string, string> = { customer: String(ctx.config.customerId) };
    priceIds.forEach((price, i) => { form[`items[${i}][price]`] = price; });
    const trial = Number(ctx.config.trialDays ?? 0);
    if (trial > 0) form.trial_period_days = String(trial);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/subscriptions`,
      bearer: key,
      form,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'stripe-refund-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['paymentIntentId'], 'stripe-refund-create');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return noKey;
    const form: Record<string, string> = { payment_intent: String(ctx.config.paymentIntentId) };
    const amount = Number(ctx.config.amount ?? 0);
    if (amount > 0) form.amount = String(amount);
    if (ctx.config.reason) form.reason = String(ctx.config.reason);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/refunds`,
      bearer: key,
      form,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    return toEnvelope(res);
  },

  'stripe-invoice-create': async (ctx) => {
    const miss = requireFields(ctx.config, ['customerId'], 'stripe-invoice-create');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return noKey;
    const form: Record<string, string> = { customer: String(ctx.config.customerId) };
    if (ctx.config.description) form.description = tpl(ctx, 'description');
    const autoSend = ctx.config.autoSend === true;
    const days = Number(ctx.config.daysUntilDue ?? 0);
    if (autoSend) {
      form.collection_method = 'send_invoice';
      form.days_until_due = String(days > 0 ? days : 14);
    }
    const res = await httpJson<{ id?: string }>({
      method: 'POST',
      url: `${API}/invoices`,
      bearer: key,
      form,
      signal: ctx.signal,
      timeoutMs: 20000,
    });
    if (!res.ok) return toEnvelope(res);
    if (autoSend && res.data?.id) {
      const sent = await httpJson({
        method: 'POST',
        url: `${API}/invoices/${res.data.id}/send`,
        bearer: key,
        form: {},
        signal: ctx.signal,
        timeoutMs: 20000,
      });
      return toEnvelope(sent);
    }
    return { out: res.data };
  },

  'stripe-checkout-session': async (ctx) => {
    const miss = requireFields(ctx.config, ['lineItems', 'successUrl', 'cancelUrl'], 'stripe-checkout-session');
    if (miss) return miss;
    const key = keyOf(ctx);
    if (!key) return noKey;
    const parsed = parseMaybeJson(ctx.config.lineItems);
    const lineItems = Array.isArray(parsed) ? parsed : [];
    if (lineItems.length === 0) {
      return { error: { message: 'stripe-checkout-session: lineItems must be a non-empty JSON array' } };
    }
    const form: Record<string, string> = {
      mode: String(ctx.config.mode ?? 'payment'),
      success_url: String(ctx.config.successUrl),
      cancel_url: String(ctx.config.cancelUrl),
      ...flatten(lineItems, 'line_items'),
    };
    if (ctx.config.customerId) form.customer = String(ctx.config.customerId);
    const res = await httpJson({
      method: 'POST',
      url: `${API}/checkout/sessions`,
      bearer: key,
      form,
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
  id: 'stripe',
  name: 'Stripe',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
