/**
 * Stripe integration pack — Commerce vertical.
 *
 * Uses a restricted API key. Stub executors return the shape Stripe's API
 * returns so downstream nodes can build templates against it before the
 * real call is wired.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#635bff';

export const DEFINITION: IntegrationDefinition = {
  id: 'stripe',
  name: 'Stripe',
  description: 'Customers, payments, subscriptions, invoices, checkout.',
  iconBrand: 'stripe',
  color: COLOR,
  category: 'Commerce',
};

export const NODES: NodeDefinition[] = [
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
