/**
 * OpenAI integration pack.
 *
 * Sibling to the generic `ai-prompt` node — provides OpenAI-specific
 * operations the generic node doesn't (image gen, embeddings, audio).
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#10a37f';

export const DEFINITION: IntegrationDefinition = {
  id: 'openai',
  name: 'OpenAI',
  description: 'Chat, images, embeddings, audio.',
  iconBrand: 'openai',
  color: COLOR,
  category: 'AI',
};

export const NODES: NodeDefinition[] = [
  {
    id: 'openai-chat',
    integrationId: 'openai',
    name: 'OpenAI · Chat Completion',
    operationName: 'Chat completion',
    category: 'ai',
    description: 'Run a chat completion against the OpenAI API.',
    icon: 'Cable',
    iconBrand: 'openai',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Response', type: 'string' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'gpt-4o-mini' },
      { key: 'system', type: 'textarea', label: 'System prompt', default: '', optional: true },
      { key: 'prompt', type: 'textarea', label: 'User prompt (supports {{var}})', default: '' },
      { key: 'maxTokens', type: 'number', label: 'Max tokens', default: 1024 },
      { key: 'temperature', type: 'number', label: 'Temperature', default: 0.7, optional: true },
    ],
  },
  {
    id: 'openai-image',
    integrationId: 'openai',
    name: 'OpenAI · Generate Image',
    operationName: 'Generate image',
    category: 'ai',
    description: 'Generate an image with the OpenAI image API.',
    icon: 'Cable',
    iconBrand: 'openai',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Image URL', type: 'string' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'gpt-image-1' },
      { key: 'prompt', type: 'textarea', label: 'Prompt (supports {{var}})', default: '' },
      {
        key: 'size',
        type: 'select',
        label: 'Size',
        default: '1024x1024',
        options: [
          { label: '1024×1024', value: '1024x1024' },
          { label: '1024×1792', value: '1024x1792' },
          { label: '1792×1024', value: '1792x1024' },
        ],
      },
    ],
  },
  {
    id: 'openai-embed',
    integrationId: 'openai',
    name: 'OpenAI · Embed Text',
    operationName: 'Embed text',
    category: 'ai',
    description: 'Compute an embedding vector for the input text.',
    icon: 'Cable',
    iconBrand: 'openai',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Vector', type: 'array' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'text-embedding-3-small' },
      { key: 'text', type: 'textarea', label: 'Text (supports {{var}})', default: '{{text}}' },
    ],
  },
];
