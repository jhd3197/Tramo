/**
 * Node definitions — editor-side metadata for tramo's starter node set.
 *
 * A NodeDefinition describes the UI surface (label, icon, fields, ports).
 * The matching execute() function lives in tramo-runtime and is registered
 * against the same `id`. That split lets the editor load in a browser
 * without pulling Node-only runtime deps (HTTP, scheduler, etc.).
 *
 * Same split as htmlstudio's BlockDefinition vs. the rendering call site:
 * the definition is the schema; consumers wire behavior.
 */

import type { NodeDefinition } from './types.js';

export interface NodeRegistry {
  list(): NodeDefinition[];
  get(id: string): NodeDefinition | undefined;
  byCategory(): Record<string, NodeDefinition[]>;
}

export function createRegistry(defs: NodeDefinition[]): NodeRegistry {
  const map = new Map(defs.map((d) => [d.id, d]));
  return {
    list: () => Array.from(map.values()),
    get: (id) => map.get(id),
    byCategory: () => {
      const out: Record<string, NodeDefinition[]> = {};
      for (const d of map.values()) {
        (out[d.category] ??= []).push(d);
      }
      return out;
    },
  };
}

/* ====================================================================== */
/* Built-in nodes — the ten that ship in v0.1                              */
/* ====================================================================== */

const COLORS = {
  trigger: '#10b981',
  action: '#3b82f6',
  transform: '#a855f7',
  logic: '#f59e0b',
  ai: '#ec4899',
  io: '#64748b',
} as const;

export const BUILTIN_NODES: NodeDefinition[] = [
  /* ---------- triggers ---------- */
  {
    id: 'manual-trigger',
    name: 'Manual Trigger',
    category: 'trigger',
    description: 'Starts the workflow when the user hits Run.',
    icon: 'Play',
    color: COLORS.trigger,
    inputs: [],
    outputs: [{ key: 'out', label: 'Started', type: 'object' }],
    fields: [
      {
        key: 'payload',
        type: 'json',
        label: 'Initial payload',
        help: 'Optional JSON object emitted on the output port.',
        default: '{}',
      },
    ],
  },
  {
    id: 'webhook-trigger',
    name: 'Webhook Trigger',
    category: 'trigger',
    description: 'Starts the workflow when an HTTP request arrives.',
    icon: 'CloudDownload',
    color: COLORS.trigger,
    inputs: [],
    outputs: [{ key: 'out', label: 'Request', type: 'object' }],
    fields: [
      { key: 'path', type: 'text', label: 'Path', default: '/hooks/my-flow', help: 'Relative URL path the runtime listens on.' },
      {
        key: 'method',
        type: 'select',
        label: 'Method',
        default: 'POST',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'DELETE', value: 'DELETE' },
        ],
      },
    ],
  },
  {
    id: 'cron-trigger',
    name: 'Cron Trigger',
    category: 'trigger',
    description: 'Starts the workflow on a schedule.',
    icon: 'Clock',
    color: COLORS.trigger,
    inputs: [],
    outputs: [{ key: 'out', label: 'Tick', type: 'object' }],
    fields: [
      { key: 'expression', type: 'text', label: 'Cron expression', default: '*/5 * * * *', help: 'Standard 5-field cron syntax.' },
      { key: 'timezone', type: 'text', label: 'Timezone', default: 'UTC', optional: true },
    ],
  },

  /* ---------- actions ---------- */
  {
    id: 'http-request',
    name: 'HTTP Request',
    category: 'action',
    description: 'Make an HTTP request and emit the response.',
    icon: 'Globe',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Response', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      { key: 'url', type: 'url', label: 'URL', default: 'https://httpbin.org/get' },
      {
        key: 'method',
        type: 'select',
        label: 'Method',
        default: 'GET',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'PATCH', value: 'PATCH' },
          { label: 'DELETE', value: 'DELETE' },
        ],
      },
      { key: 'headers', type: 'json', label: 'Headers (JSON)', default: '{}', optional: true },
      { key: 'body', type: 'json', label: 'Body (JSON)', default: '', optional: true },
      { key: 'timeoutMs', type: 'number', label: 'Timeout (ms)', default: 10000 },
    ],
  },
  {
    id: 'log',
    name: 'Log',
    category: 'action',
    description: 'Write the input to the runtime logger.',
    icon: 'StickyNote',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [{ key: 'out', label: 'Out', type: 'any' }],
    fields: [
      {
        key: 'level',
        type: 'select',
        label: 'Level',
        default: 'info',
        options: [
          { label: 'debug', value: 'debug' },
          { label: 'info', value: 'info' },
          { label: 'warn', value: 'warn' },
          { label: 'error', value: 'error' },
        ],
      },
      { key: 'prefix', type: 'text', label: 'Prefix', default: '', optional: true },
    ],
  },

  /* ---------- transforms ---------- */
  {
    id: 'js-transform',
    name: 'JS Transform',
    category: 'transform',
    description: 'Run a JavaScript expression on the input. The expression receives `input` and returns the output.',
    icon: 'Code',
    color: COLORS.transform,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Output', type: 'any' }],
    fields: [
      {
        key: 'expression',
        type: 'code',
        language: 'javascript',
        label: 'Expression',
        default: 'return { ...input, transformed: true };',
        help: 'A function body. Available bindings: `input`. Must `return` a value.',
      },
    ],
  },
  {
    id: 'template',
    name: 'Template',
    category: 'transform',
    description: 'Render a string with `{{path.to.value}}` placeholders against the input.',
    icon: 'Type',
    color: COLORS.transform,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Rendered', type: 'string' }],
    fields: [
      {
        key: 'template',
        type: 'textarea',
        label: 'Template',
        default: 'Hello {{name}}!',
        help: 'Use {{path.to.field}} to interpolate values from the input.',
      },
    ],
  },

  /* ---------- logic ---------- */
  {
    id: 'if',
    name: 'If',
    category: 'logic',
    description: 'Route the input to one of two branches based on a JS condition.',
    icon: 'GitBranch',
    color: COLORS.logic,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [
      { key: 'yes', label: 'Yes', type: 'any' },
      { key: 'no', label: 'No', type: 'any' },
    ],
    fields: [
      {
        key: 'condition',
        type: 'code',
        language: 'javascript',
        label: 'Condition',
        default: 'return Boolean(input);',
        help: 'A JS function body returning truthy/falsy. `input` is available; return truthy to take the Yes branch.',
      },
    ],
  },
  {
    id: 'merge',
    name: 'Merge',
    category: 'logic',
    description: 'Combine inputs from multiple upstream nodes into one object or array.',
    icon: 'Merge',
    color: COLORS.logic,
    inputs: [{ key: 'in', label: 'Inputs', type: 'any' }],
    outputs: [{ key: 'out', label: 'Merged', type: 'any' }],
    fields: [
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'object',
        options: [
          { label: 'Object (shallow merge by source id)', value: 'object' },
          { label: 'Array (concat in arrival order)', value: 'array' },
          { label: 'First non-null', value: 'first' },
        ],
      },
    ],
  },

  /* ---------- ai ---------- */
  {
    id: 'ai-prompt',
    name: 'AI Prompt',
    category: 'ai',
    description: 'Call an LLM with a prompt rendered from the input. Returns the text response.',
    icon: 'Sparkles',
    color: COLORS.ai,
    inputs: [{ key: 'in', label: 'Context', type: 'object' }],
    outputs: [{ key: 'out', label: 'Response', type: 'string' }],
    fields: [
      {
        key: 'provider',
        type: 'select',
        label: 'Provider',
        default: 'anthropic',
        options: [
          { label: 'Anthropic (Claude)', value: 'anthropic' },
          { label: 'OpenAI', value: 'openai' },
          { label: 'Mock (echo)', value: 'mock' },
        ],
      },
      { key: 'model', type: 'text', label: 'Model', default: 'claude-opus-4-7' },
      {
        key: 'system',
        type: 'textarea',
        label: 'System prompt',
        default: 'You are a concise assistant.',
        optional: true,
      },
      {
        key: 'prompt',
        type: 'textarea',
        label: 'User prompt (supports {{var}})',
        default: 'Summarize: {{text}}',
      },
      { key: 'apiKey', type: 'secret', label: 'API key', optional: true },
      { key: 'maxTokens', type: 'number', label: 'Max tokens', default: 1024 },
    ],
  },

  /* ---------- integrations (brand-icon demo nodes) ---------- */
  {
    id: 'telegram-message',
    name: 'Telegram',
    category: 'action',
    description: 'Send a message via a Telegram bot.',
    icon: 'Cable',
    iconBrand: 'telegram',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'botToken', type: 'secret', label: 'Bot token' },
      { key: 'chatId', type: 'text', label: 'Chat ID', default: '' },
      { key: 'text', type: 'textarea', label: 'Message (supports {{var}})', default: 'Hello from tramo' },
    ],
  },
  {
    id: 'github-issue',
    name: 'GitHub',
    category: 'action',
    description: 'Create an issue in a GitHub repository.',
    icon: 'Cable',
    iconBrand: 'github',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Issue', type: 'object' }],
    fields: [
      { key: 'repo', type: 'text', label: 'owner/repo', default: 'octocat/hello-world' },
      { key: 'title', type: 'text', label: 'Title (supports {{var}})', default: 'Triggered from tramo' },
      { key: 'body', type: 'textarea', label: 'Body', default: '', optional: true },
      { key: 'token', type: 'secret', label: 'GitHub token', optional: true },
    ],
  },
  {
    id: 'discord-message',
    name: 'Discord',
    category: 'action',
    description: 'Send a message via a Discord webhook.',
    icon: 'Cable',
    iconBrand: 'discord',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    outputs: [{ key: 'out', label: 'Sent', type: 'object' }],
    fields: [
      { key: 'webhook', type: 'url', label: 'Webhook URL', default: '' },
      { key: 'content', type: 'textarea', label: 'Content (supports {{var}})', default: 'Hello from tramo' },
      { key: 'username', type: 'text', label: 'Username override', default: 'tramo', optional: true },
    ],
  },
];

/** Default registry — equivalent to htmlstudio's BUILTIN_REGISTRY. */
export const BUILTIN_REGISTRY: NodeRegistry = createRegistry(BUILTIN_NODES);
