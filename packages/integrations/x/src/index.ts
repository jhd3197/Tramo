/**
 * @tramo/x — official X (Twitter) integration pack.
 * Post tweets, delete tweets, lookup users, and search via X API v2.
 * Auth: OAuth 2.0 bearer or user-context token supplied per node.
 */

import { defineNodePack, defineStubExecutor } from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#000000';

const DEFINITION: IntegrationDefinition = {
  id: 'x',
  name: 'X',
  description: 'Post tweets, search, lookup users.',
  iconBrand: 'x',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'x-post-tweet',
    integrationId: 'x',
    name: 'X · Post Tweet',
    operationName: 'Post tweet',
    category: 'action',
    description: 'Publish a new tweet, optionally as a reply or with pre-uploaded media.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Tweet', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token', help: 'X API v2 OAuth 2.0 bearer or user-context token' },
      { key: 'text', type: 'textarea', label: 'Text (supports {{var}})', default: '', help: 'Up to 280 chars (4000 for X Premium)' },
      { key: 'replyToTweetId', type: 'text', label: 'Reply to tweet ID', default: '', optional: true, help: 'Reply target tweet ID' },
      { key: 'mediaIds', type: 'json', label: 'Media IDs', default: '[]', optional: true, help: 'JSON array of pre-uploaded media IDs' },
    ],
  },
  {
    id: 'x-delete-tweet',
    integrationId: 'x',
    name: 'X · Delete Tweet',
    operationName: 'Delete tweet',
    category: 'action',
    description: 'Delete a tweet owned by the authenticated user.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Result', type: 'object' }],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token' },
      { key: 'tweetId', type: 'text', label: 'Tweet ID', default: '' },
    ],
  },
  {
    id: 'x-get-user',
    integrationId: 'x',
    name: 'X · Get User',
    operationName: 'Get user',
    category: 'action',
    description: 'Look up an X user by handle.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'User', type: 'object' },
      { key: 'notFound', label: 'Not Found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token' },
      { key: 'handle', type: 'text', label: 'Handle', default: '', help: 'Handle without the @, e.g. elonmusk' },
    ],
  },
  {
    id: 'x-search-tweets',
    integrationId: 'x',
    name: 'X · Search Tweets',
    operationName: 'Search tweets',
    category: 'action',
    description: 'Search recent tweets using X search syntax.',
    icon: 'Cable',
    iconBrand: 'x',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Tweets', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'bearerToken', type: 'secret', label: 'Bearer token' },
      { key: 'query', type: 'text', label: 'Query (supports {{var}})', default: '', help: 'X search syntax, e.g. from:user lang:en' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 10, optional: true },
    ],
  },
];

export default defineNodePack({
  id: 'x',
  name: 'X',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
