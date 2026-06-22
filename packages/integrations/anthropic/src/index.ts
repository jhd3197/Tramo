/**
 * @tramo/anthropic — official Anthropic / Claude integration pack.
 *
 * Exposes the things Claude is uniquely good at: long-context messages,
 * tool use, vision, structured extraction.
 */

import {
  defineNodePack,
  defineStubExecutor,
  httpJson,
  renderTemplate,
  parseMaybeJson,
  type ExecutionContext,
  type NodeExecutionResult,
  type NodeExecutor,
} from '@tramo/runtime';
import type { IntegrationDefinition, NodeDefinition } from '@tramo/spec';

const COLOR = '#d97706';
const API = 'https://api.anthropic.com/v1/messages';

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

/* ---------------------------------------------------------------------- */
/* Real executors                                                          */
/* ---------------------------------------------------------------------- */

const keyOf = (ctx: ExecutionContext): string | undefined =>
  ctx.config.apiKey
    ? String(ctx.config.apiKey)
    : (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : undefined);

const tpl = (ctx: ExecutionContext, key: string): string =>
  renderTemplate(String(ctx.config[key] ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);

const headers = (key: string): Record<string, string> => ({
  'x-api-key': key,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json',
});

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
}
interface MessagesResponse {
  content?: ContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

const textOf = (data: MessagesResponse | null): string =>
  (data?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');

const errEnvelope = (res: { status: number; data: unknown }): NodeExecutionResult => {
  const d = res.data as { error?: { message?: string }; message?: string } | string | null;
  let message = `HTTP ${res.status}`;
  if (typeof d === 'string' && d) message = d;
  else if (d && typeof d === 'object') {
    if (d.error?.message) message = d.error.message;
    else if (d.message) message = d.message;
  }
  return { error: { message, status: res.status, data: res.data } };
};

/** Single request to the Messages API. */
async function callMessages(
  ctx: ExecutionContext,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: MessagesResponse } | { ok: false; result: NodeExecutionResult }> {
  const key = keyOf(ctx);
  if (!key) {
    return { ok: false, result: { error: { message: 'anthropic: API key required (config.apiKey or ANTHROPIC_API_KEY)' } } };
  }
  const res = await httpJson<MessagesResponse>({
    method: 'POST',
    url: API,
    headers: headers(key),
    json: body,
    signal: ctx.signal,
    timeoutMs: 120000,
  });
  if (!res.ok) return { ok: false, result: errEnvelope(res) };
  ctx.reportUsage({
    provider: 'anthropic',
    model: String(body.model ?? ''),
    inputTokens: res.data?.usage?.input_tokens,
    outputTokens: res.data?.usage?.output_tokens,
  });
  return { ok: true, data: res.data };
}

const EXEC: Record<string, (ctx: ExecutionContext) => Promise<NodeExecutionResult>> = {
  'anthropic-message': async (ctx) => {
    const system = ctx.config.system ? tpl(ctx, 'system') : undefined;
    const r = await callMessages(ctx, {
      model: String(ctx.config.model ?? 'claude-opus-4-7'),
      max_tokens: Number(ctx.config.maxTokens ?? 1024),
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: tpl(ctx, 'prompt') }],
    });
    if (!r.ok) return r.result;
    return { out: textOf(r.data) };
  },

  'anthropic-vision': async (ctx) => {
    const imageUrl = tpl(ctx, 'imageUrl');
    const isBase64 = imageUrl.startsWith('data:');
    let source: Record<string, unknown>;
    if (isBase64) {
      // data:<media-type>;base64,<data>
      const match = /^data:([^;]+);base64,(.*)$/.exec(imageUrl);
      source = match
        ? { type: 'base64', media_type: match[1], data: match[2] }
        : { type: 'url', url: imageUrl };
    } else {
      source = { type: 'url', url: imageUrl };
    }
    const r = await callMessages(ctx, {
      model: String(ctx.config.model ?? 'claude-opus-4-7'),
      max_tokens: Number(ctx.config.maxTokens ?? 1024),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source },
            { type: 'text', text: tpl(ctx, 'prompt') },
          ],
        },
      ],
    });
    if (!r.ok) return r.result;
    return { out: textOf(r.data) };
  },

  'anthropic-extract': async (ctx) => {
    const schema = tpl(ctx, 'schema');
    const source = tpl(ctx, 'text');
    const r = await callMessages(ctx, {
      model: String(ctx.config.model ?? 'claude-opus-4-7'),
      max_tokens: Number(ctx.config.maxTokens ?? 1024),
      system:
        'You are a structured-data extraction engine. Return ONLY a single valid JSON value matching the requested schema. No prose, no markdown fences.',
      messages: [
        {
          role: 'user',
          content: `Schema:\n${schema}\n\nSource text:\n${source}\n\nReturn the JSON now.`,
        },
      ],
    });
    if (!r.ok) return r.result;
    const text = textOf(r.data).trim();
    // Strip optional markdown code fences before parsing.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = parseMaybeJson(cleaned);
    if (parsed === cleaned || parsed == null || typeof parsed !== 'object') {
      // parseMaybeJson returns the input unchanged when it can't parse.
      return { error: { message: 'anthropic-extract: response was not valid JSON', data: text } };
    }
    return { out: parsed };
  },

  'anthropic-summarize': async (ctx) => {
    const style = String(ctx.config.style ?? 'bullets');
    const styleInstruction: Record<string, string> = {
      bullets: 'Summarize as a concise bulleted list of the key points.',
      paragraph: 'Summarize in a single clear paragraph.',
      tldr: 'Summarize in a single TL;DR sentence.',
      executive: 'Write a brief executive summary suitable for a busy stakeholder.',
    };
    const r = await callMessages(ctx, {
      model: String(ctx.config.model ?? 'claude-opus-4-7'),
      max_tokens: Number(ctx.config.maxTokens ?? 512),
      system: styleInstruction[style] ?? styleInstruction.bullets,
      messages: [{ role: 'user', content: tpl(ctx, 'text') }],
    });
    if (!r.ok) return r.result;
    return { out: textOf(r.data) };
  },

  'anthropic-classify': async (ctx) => {
    const labelsRaw = parseMaybeJson(ctx.config.labels);
    const labels = Array.isArray(labelsRaw) ? labelsRaw.map((l) => String(l)) : [];
    if (labels.length === 0) {
      return { error: { message: 'anthropic-classify: labels must be a non-empty JSON array' } };
    }
    const extra = ctx.config.instructions ? tpl(ctx, 'instructions') : '';
    const system =
      `You are a classifier. Choose exactly ONE label from this list for the input: ${labels.join(', ')}.` +
      ` Reply with ONLY the chosen label, nothing else.${extra ? `\n${extra}` : ''}`;
    const r = await callMessages(ctx, {
      model: String(ctx.config.model ?? 'claude-opus-4-7'),
      max_tokens: 32,
      system,
      messages: [{ role: 'user', content: tpl(ctx, 'text') }],
    });
    if (!r.ok) return r.result;
    const raw = textOf(r.data).trim();
    // Normalise to one of the provided labels when possible.
    const match =
      labels.find((l) => l.toLowerCase() === raw.toLowerCase()) ??
      labels.find((l) => raw.toLowerCase().includes(l.toLowerCase()));
    return { out: match ?? raw };
  },

  'anthropic-tool-use': async (ctx) => {
    const toolsRaw = parseMaybeJson(ctx.config.tools);
    const tools = Array.isArray(toolsRaw) ? toolsRaw : [];
    const choice = String(ctx.config.toolChoice ?? 'auto');
    const toolChoice =
      choice === 'any' ? { type: 'any' } :
      choice === 'none' ? { type: 'none' } :
      { type: 'auto' };
    const system = ctx.config.system ? tpl(ctx, 'system') : undefined;
    const r = await callMessages(ctx, {
      model: String(ctx.config.model ?? 'claude-opus-4-7'),
      max_tokens: Number(ctx.config.maxTokens ?? 1024),
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: tpl(ctx, 'prompt') }],
      ...(tools.length ? { tools } : {}),
      ...(tools.length ? { tool_choice: toolChoice } : {}),
    });
    if (!r.ok) return r.result;
    // Real single-round tool loop: surface the first tool_use block if present.
    const blocks = r.data?.content ?? [];
    const toolUse = blocks.find((b) => b.type === 'tool_use');
    if (toolUse) {
      return { toolCall: { name: toolUse.name, input: toolUse.input, id: toolUse.id } };
    }
    return { text: textOf(r.data) };
  },
};

function buildExecutor(def: NodeDefinition): NodeExecutor {
  const fn = EXEC[def.id];
  if (fn) return { id: def.id, execute: fn };
  return defineStubExecutor(def);
}

export default defineNodePack({
  id: 'anthropic',
  name: 'Anthropic',
  version: '0.1.0',
  entries: NODES.map((definition) => ({ definition, executor: buildExecutor(definition) })),
  integrations: [DEFINITION],
});
