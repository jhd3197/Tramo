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
  description: 'Charges, customers, subscriptions.',
  iconBrand: 'stripe',
  color: COLOR,
  category: 'Commerce',
};

export const NODES: NodeDefinition[] = [
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
];
