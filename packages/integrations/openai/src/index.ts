/**
 * @tramo/openai — official OpenAI integration pack.
 *
 * Sibling to the generic `ai-prompt` node — provides OpenAI-specific
 * operations the generic node doesn't (image, embed, audio, moderation).
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  toEnvelope,
  renderTemplate,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#10a37f';
const CHAT_API = 'https://api.openai.com/v1/chat/completions';
const EMBED_API = 'https://api.openai.com/v1/embeddings';
const IMAGE_API = 'https://api.openai.com/v1/images/generations';
const SPEECH_API = 'https://api.openai.com/v1/audio/speech';
const TRANSCRIBE_API = 'https://api.openai.com/v1/audio/transcriptions';
const MODERATION_API = 'https://api.openai.com/v1/moderations';

const DEFINITION: IntegrationDefinition = {
  id: 'openai',
  name: 'OpenAI',
  description: 'Chat, images, embeddings, audio, moderation.',
  iconBrand: 'openai',
  color: COLOR,
  category: 'AI',
};

const NODES: NodeDefinition[] = [
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

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const keyOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.apiKey
    ? String(ctx.config.apiKey)
    : (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const noKey = (id: string): NodeExecutionResult => ({
  error: { message: `${id}: API key required (config.apiKey or OPENAI_API_KEY)` },
});

interface ChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function chatMessages(ctx: ExecutionContext): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = [];
  if (ctx.config.system) messages.push({ role: 'system', content: tpl(ctx, 'system') });
  messages.push({ role: 'user', content: tpl(ctx, 'prompt') });
  return messages;
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'openai-chat': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey('openai-chat');
    const model = String(ctx.config.model ?? 'gpt-4o-mini');
    const res = await httpJson<ChatResponse>({
      method: 'POST',
      url: CHAT_API,
      bearer: key,
      json: {
        model,
        messages: chatMessages(ctx),
        max_tokens: Number(ctx.config.maxTokens ?? 1024),
        ...(ctx.config.temperature != null && ctx.config.temperature !== ''
          ? { temperature: Number(ctx.config.temperature) }
          : {}),
      },
      signal: ctx.signal,
      timeoutMs: 120000,
    });
    if (!res.ok) return toEnvelope(res);
    ctx.reportUsage({
      provider: 'openai',
      model,
      inputTokens: res.data?.usage?.prompt_tokens,
      outputTokens: res.data?.usage?.completion_tokens,
    });
    const msg = res.data?.choices?.[0]?.message;
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      return { out: msg.content ?? '', toolCalls: msg.tool_calls };
    }
    return { out: msg?.content ?? '' };
  },

  'openai-image': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey('openai-image');
    const res = await httpJson<{ data?: Array<{ url?: string; b64_json?: string }> }>({
      method: 'POST',
      url: IMAGE_API,
      bearer: key,
      json: {
        model: String(ctx.config.model ?? 'gpt-image-1'),
        prompt: tpl(ctx, 'prompt'),
        size: String(ctx.config.size ?? '1024x1024'),
        n: 1,
      },
      signal: ctx.signal,
      timeoutMs: 120000,
    });
    if (!res.ok) return toEnvelope(res);
    const first = res.data?.data?.[0];
    return { out: first?.url ?? first?.b64_json ?? '' };
  },

  'openai-embed': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey('openai-embed');
    const res = await httpJson<{ data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number } }>({
      method: 'POST',
      url: EMBED_API,
      bearer: key,
      json: {
        model: String(ctx.config.model ?? 'text-embedding-3-small'),
        input: tpl(ctx, 'text'),
      },
      signal: ctx.signal,
      timeoutMs: 60000,
    });
    if (!res.ok) return toEnvelope(res);
    ctx.reportUsage({
      provider: 'openai',
      model: String(ctx.config.model ?? 'text-embedding-3-small'),
      inputTokens: res.data?.usage?.prompt_tokens,
    });
    return { out: res.data?.data?.[0]?.embedding ?? [] };
  },

  'openai-transcribe': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey('openai-transcribe');
    const audioUrl = tpl(ctx, 'audioUrl');
    if (!audioUrl) return { error: { message: 'openai-transcribe: audioUrl is required' } };
    // The transcription endpoint needs a multipart file upload, which the JSON
    // helper can't express — fetch the audio and post it as multipart/form-data.
    try {
      const audioRes = await fetch(audioUrl, { signal: ctx.signal });
      if (!audioRes.ok) {
        return { error: { message: `openai-transcribe: failed to fetch audio (HTTP ${audioRes.status})` } };
      }
      const blob = await audioRes.blob();
      const filename = audioUrl.split('/').pop()?.split('?')[0] || 'audio.mp3';
      const form = new FormData();
      form.append('file', blob, filename);
      form.append('model', String(ctx.config.model ?? 'whisper-1'));
      if (ctx.config.language) form.append('language', String(ctx.config.language));
      if (ctx.config.prompt) form.append('prompt', tpl(ctx, 'prompt'));
      const res = await fetch(TRANSCRIBE_API, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        body: form,
        signal: ctx.signal,
      });
      const data = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
      if (!res.ok) {
        return { error: { message: data?.error?.message ?? `HTTP ${res.status}`, status: res.status, data } };
      }
      return { out: data?.text ?? '' };
    } catch (err) {
      return { error: { message: `openai-transcribe: ${(err as Error).message}` } };
    }
  },

  'openai-speech': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey('openai-speech');
    const format = String(ctx.config.format ?? 'mp3');
    // Audio is binary — call fetch directly and base64-encode the bytes.
    try {
      const res = await fetch(SPEECH_API, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: String(ctx.config.model ?? 'gpt-4o-mini-tts'),
          input: tpl(ctx, 'text'),
          voice: String(ctx.config.voice ?? 'alloy'),
          response_format: format,
        }),
        signal: ctx.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        return { error: { message: data?.error?.message ?? `HTTP ${res.status}`, status: res.status, data } };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        out: {
          format,
          mimeType: `audio/${format}`,
          base64: buf.toString('base64'),
          bytes: buf.length,
        },
      };
    } catch (err) {
      return { error: { message: `openai-speech: ${(err as Error).message}` } };
    }
  },

  'openai-moderation': async (ctx) => {
    const key = keyOf(ctx);
    if (!key) return noKey('openai-moderation');
    const res = await httpJson<{ results?: Array<{ flagged?: boolean }> }>({
      method: 'POST',
      url: MODERATION_API,
      bearer: key,
      json: {
        model: String(ctx.config.model ?? 'omni-moderation-latest'),
        input: tpl(ctx, 'text'),
      },
      signal: ctx.signal,
      timeoutMs: 30000,
    });
    if (!res.ok) return toEnvelope(res);
    const result = res.data?.results?.[0];
    return result?.flagged ? { flagged: result } : { safe: result };
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'openai',
  name: 'OpenAI',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
