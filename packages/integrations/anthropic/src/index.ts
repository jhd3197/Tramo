/**
 * @tramo/anthropic — official Anthropic / Claude integration pack.
 *
 * Exposes the things Claude is uniquely good at: long-context messages,
 * tool use, vision, structured extraction.
 */

import { defineNodePack, defineStubExecutor } from 'tramo-runtime';
import type { IntegrationDefinition, NodeDefinition } from 'tramo-spec';

const COLOR = '#d97706';

const DEFINITION: IntegrationDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  description: 'Claude messages, tool use, vision, summarize, classify.',
  iconBrand: 'anthropic',
  color: COLOR,
  category: 'AI',
};

const NODES: NodeDefinition[] = [
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
  {
    id: 'anthropic-summarize',
    integrationId: 'anthropic',
    name: 'Anthropic · Summarize',
    operationName: 'Summarize',
    category: 'ai',
    description: 'Summarize long text into a target length or style.',
    icon: 'Cable',
    iconBrand: 'anthropic',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Summary', type: 'string' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      { key: 'text', type: 'textarea', label: 'Text to summarize (supports {{var}})', default: '{{text}}' },
      {
        key: 'style',
        type: 'select',
        label: 'Style',
        default: 'bullets',
        options: [
          { label: 'Bullet points', value: 'bullets' },
          { label: 'One paragraph', value: 'paragraph' },
          { label: 'TL;DR (1 sentence)', value: 'tldr' },
          { label: 'Executive summary', value: 'executive' },
        ],
      },
      { key: 'maxTokens', type: 'number', label: 'Max tokens', default: 512 },
    ],
  },
  {
    id: 'anthropic-classify',
    integrationId: 'anthropic',
    name: 'Anthropic · Classify',
    operationName: 'Classify',
    category: 'ai',
    description: 'Pick the best label for the input from a predefined list.',
    icon: 'Cable',
    iconBrand: 'anthropic',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [
      { key: 'out', label: 'Label', type: 'string' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      { key: 'text', type: 'textarea', label: 'Input text (supports {{var}})', default: '{{text}}' },
      { key: 'labels', type: 'json', label: 'Labels (JSON array)', default: '["billing","support","sales","other"]' },
      { key: 'instructions', type: 'textarea', label: 'Extra instructions (optional)', default: '', optional: true },
    ],
  },
  {
    id: 'anthropic-tool-use',
    integrationId: 'anthropic',
    name: 'Anthropic · Tool Use',
    operationName: 'Tool use',
    category: 'ai',
    description: 'Call Claude with a list of tool schemas and return the tool call (or fallback text).',
    icon: 'Cable',
    iconBrand: 'anthropic',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [
      { key: 'toolCall', label: 'Tool call', type: 'object' },
      { key: 'text', label: 'Text fallback', type: 'string' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      { key: 'system', type: 'textarea', label: 'System prompt', default: '', optional: true },
      { key: 'prompt', type: 'textarea', label: 'User prompt (supports {{var}})', default: '' },
      { key: 'tools', type: 'json', label: 'Tools (JSON array of tool defs)', default: '[]' },
      {
        key: 'toolChoice',
        type: 'select',
        label: 'Tool choice',
        default: 'auto',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Any', value: 'any' },
          { label: 'None (force text)', value: 'none' },
        ],
      },
      { key: 'maxTokens', type: 'number', label: 'Max tokens', default: 1024 },
    ],
  },
];

export default defineNodePack({
  id: 'anthropic',
  name: 'Anthropic',
  version: '0.1.0',
  entries: NODES.map((definition) => ({
    definition,
    executor: defineStubExecutor(definition),
  })),
  integrations: [DEFINITION],
});
