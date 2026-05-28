/**
 * OpenAI integration pack.
 *
 * Sibling to the generic `ai-prompt` node — provides OpenAI-specific
 * operations the generic node doesn't (image gen, embeddings, audio,
 * moderation).
 */

import type { IntegrationDefinition, NodeDefinition } from '../types.js';

const COLOR = '#10a37f';

export const DEFINITION: IntegrationDefinition = {
  id: 'openai',
  name: 'OpenAI',
  description: 'Chat, images, embeddings, audio, moderation.',
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
  {
    id: 'openai-transcribe',
    integrationId: 'openai',
    name: 'OpenAI · Transcribe Audio',
    operationName: 'Transcribe audio',
    category: 'ai',
    description: 'Transcribe audio to text via the Whisper / audio transcription API.',
    icon: 'Cable',
    iconBrand: 'openai',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [
      { key: 'out', label: 'Transcript', type: 'string' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'whisper-1' },
      { key: 'audioUrl', type: 'url', label: 'Audio file URL', default: '' },
      { key: 'language', type: 'text', label: 'Language (ISO 639-1, optional)', default: '', optional: true },
      { key: 'prompt', type: 'textarea', label: 'Style/context prompt (optional)', default: '', optional: true },
    ],
  },
  {
    id: 'openai-speech',
    integrationId: 'openai',
    name: 'OpenAI · Generate Speech',
    operationName: 'Generate speech',
    category: 'ai',
    description: 'Synthesize spoken audio from text (TTS).',
    icon: 'Cable',
    iconBrand: 'openai',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Audio', type: 'object' }],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'gpt-4o-mini-tts' },
      { key: 'text', type: 'textarea', label: 'Text to speak (supports {{var}})', default: '' },
      {
        key: 'voice',
        type: 'select',
        label: 'Voice',
        default: 'alloy',
        options: [
          { label: 'Alloy', value: 'alloy' },
          { label: 'Echo', value: 'echo' },
          { label: 'Fable', value: 'fable' },
          { label: 'Onyx', value: 'onyx' },
          { label: 'Nova', value: 'nova' },
          { label: 'Shimmer', value: 'shimmer' },
        ],
      },
      {
        key: 'format',
        type: 'select',
        label: 'Format',
        default: 'mp3',
        options: [
          { label: 'MP3', value: 'mp3' },
          { label: 'WAV', value: 'wav' },
          { label: 'Opus', value: 'opus' },
          { label: 'AAC', value: 'aac' },
        ],
      },
    ],
  },
  {
    id: 'openai-moderation',
    integrationId: 'openai',
    name: 'OpenAI · Moderate Text',
    operationName: 'Moderate text',
    category: 'ai',
    description: 'Run the moderation classifier on input text.',
    icon: 'Cable',
    iconBrand: 'openai',
    color: COLOR,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [
      { key: 'flagged', label: 'Flagged', type: 'object' },
      { key: 'safe', label: 'Safe', type: 'object' },
    ],
    fields: [
      { key: 'apiKey', type: 'secret', label: 'API key' },
      { key: 'model', type: 'text', label: 'Model', default: 'omni-moderation-latest' },
      { key: 'text', type: 'textarea', label: 'Text to moderate (supports {{var}})', default: '{{text}}' },
    ],
  },
];
