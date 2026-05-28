/**
 * Anthropic (Claude) integration pack.
 *
 * Sibling to the generic `ai-prompt` node and the openai pack. Exposes
 * the things Claude is uniquely good at: long-context messages, tool
 * use, and structured prompt-caching.
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#d97706';

export const DEFINITION: IntegrationDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  description: 'Claude messages, tool use, vision.',
  iconBrand: 'anthropic',
  color: COLOR,
  category: 'AI',
};

export const NODES: NodeDefinition[] = [
  {
    id: 'anthropic-message',
    integrationId: 'anthropic',
    name: 'Anthropic · Send Message',
    operationName: 'Send message',
    category: 'ai',
    description: 'Call the Claude Messages API with a single user turn.',
    icon: 'Cable',
    iconBrand: 'anthropic',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Response', type: 'string' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      { key: 'system', type: 'textarea', label: 'System prompt', default: '', optional: true },
      { key: 'prompt', type: 'textarea', label: 'User prompt (supports {{var}})', default: '' },
      { key: 'maxTokens', type: 'number', label: 'Max tokens', default: 1024 },
    ],
  },
  {
    id: 'anthropic-vision',
    integrationId: 'anthropic',
    name: 'Anthropic · Analyze Image',
    operationName: 'Analyze image',
    category: 'ai',
    description: 'Send an image URL + prompt to Claude and return the analysis text.',
    icon: 'Cable',
    iconBrand: 'anthropic',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Analysis', type: 'string' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      { key: 'imageUrl', type: 'url', label: 'Image URL', default: '' },
      { key: 'prompt', type: 'textarea', label: 'Question about the image', default: 'Describe this image in detail.' },
      { key: 'maxTokens', type: 'number', label: 'Max tokens', default: 1024 },
    ],
  },
  {
    id: 'anthropic-extract',
    integrationId: 'anthropic',
    name: 'Anthropic · Extract Structured Data',
    operationName: 'Extract structured data',
    category: 'ai',
    description: 'Ask Claude to return a JSON object matching a schema description.',
    icon: 'Cable',
    iconBrand: 'anthropic',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [
      { key: 'out', label: 'JSON', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      { key: 'text', type: 'textarea', label: 'Source text (supports {{var}})', default: '{{text}}' },
      { key: 'schema', type: 'textarea', label: 'Schema description', default: 'Return an object with keys "name", "email", "phone".' },
    ],
  },
];
