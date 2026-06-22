/**
 * @tramo/youtube — official YouTube integration pack.
 *
 * Read-only operations against the YouTube Data API v3 (video metadata,
 * search, comments, playlist items). Auth: API key passed per node.
 */

import { defineNodePack, defineStubExecutor } from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#ff0000';

const DEFINITION: IntegrationDefinition = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Video metadata, search, comments, playlists.',
  iconBrand: 'youtube',
  color: COLOR,
  category: 'Communication',
};

const NODES: NodeDefinition[] = [
  {
    id: 'youtube-get-video',
    integrationId: 'youtube',
    name: 'YouTube · Get Video',
    operationName: 'Get video',
    category: 'action',
    description: 'Fetch metadata for a single video by ID.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Video metadata', type: 'object' },
      { key: 'notFound', label: 'Not found', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'videoId', type: 'text', label: 'Video ID', default: '' },
    ],
  },
  {
    id: 'youtube-search-videos',
    integrationId: 'youtube',
    name: 'YouTube · Search Videos',
    operationName: 'Search videos',
    category: 'action',
    description: 'Search YouTube for videos matching a query.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Results', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'query', type: 'text', label: 'Query (supports {{var}})', default: '' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 10, optional: true },
      {
        key: 'order',
        type: 'select',
        label: 'Order',
        default: 'relevance',
        optional: true,
        options: [
          { label: 'Relevance', value: 'relevance' },
          { label: 'Date', value: 'date' },
          { label: 'Rating', value: 'rating' },
          { label: 'View count', value: 'viewCount' },
        ],
      },
    ],
  },
  {
    id: 'youtube-list-comments',
    integrationId: 'youtube',
    name: 'YouTube · List Video Comments',
    operationName: 'List video comments',
    category: 'action',
    description: 'List top-level comments on a video.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Comments', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'videoId', type: 'text', label: 'Video ID', default: '' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 20, optional: true },
      {
        key: 'order',
        type: 'select',
        label: 'Order',
        default: 'time',
        optional: true,
        options: [
          { label: 'Time', value: 'time' },
          { label: 'Relevance', value: 'relevance' },
        ],
      },
    ],
  },
  {
    id: 'youtube-list-playlist-items',
    integrationId: 'youtube',
    name: 'YouTube · List Playlist Items',
    operationName: 'List playlist items',
    category: 'action',
    description: 'List videos in a YouTube playlist.',
    icon: 'Cable',
    iconBrand: 'youtube',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Items', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key', help: 'YouTube Data API v3 key' },
      { key: 'playlistId', type: 'text', label: 'Playlist ID', default: '' },
      { key: 'maxResults', type: 'number', label: 'Max results', default: 25, optional: true },
    ],
  },
];

export default defineNodePack({
  id: 'youtube',
  name: 'YouTube',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
