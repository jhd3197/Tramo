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

import type {
  FlowParam,
  IntegrationDefinition,
  MCPServerRef,
  NodeDefinition,
  NodePort,
  SwitchCase,
  WorkflowNode,
} from './types.js';
import { emptyRuleGroup } from './rules.js';
import {
  BUILTIN_INTEGRATIONS,
  BUILTIN_INTEGRATION_NODES,
} from './integrations/index.js';

export interface NodeRegistry {
  list(): NodeDefinition[];
  get(id: string): NodeDefinition | undefined;
  byCategory(): Record<string, NodeDefinition[]>;
  /** All integration packs registered. */
  integrations(): IntegrationDefinition[];
  /** Operation nodes grouped by their `integrationId`. */
  byIntegration(): Record<string, NodeDefinition[]>;
}

export function createRegistry(
  defs: NodeDefinition[],
  integrations: IntegrationDefinition[] = [],
): NodeRegistry {
  const map = new Map(defs.map((d) => [d.id, d]));
  const integrationList = integrations.slice();
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
    integrations: () => integrationList.slice(),
    byIntegration: () => {
      const out: Record<string, NodeDefinition[]> = {};
      for (const d of map.values()) {
        if (d.integrationId) (out[d.integrationId] ??= []).push(d);
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
  state: '#0ea5a4',
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
        label: 'Test payload',
        help: 'JSON emitted when you press Run with no external trigger — handy for iterating on the flow with a fixed input until you wire up the real trigger.',
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
    id: 'http-respond',
    name: 'HTTP Respond',
    category: 'action',
    description: 'Build the HTTP response that the webhook trigger returns. Place at the end of a webhook flow.',
    icon: 'Reply',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [
      { key: 'response', label: 'Response', type: 'object' },
      { key: 'out', label: 'Out (passthrough)', type: 'any' },
    ],
    fields: [
      {
        key: 'status',
        type: 'number',
        label: 'Status code',
        default: 200,
      },
      {
        key: 'bodyMode',
        type: 'select',
        label: 'Body format',
        default: 'json',
        options: [
          { label: 'JSON — parse the rendered body and send as application/json', value: 'json' },
          { label: 'Text — send the rendered string as text/plain', value: 'text' },
        ],
      },
      {
        key: 'body',
        type: 'textarea',
        label: 'Body (supports {{var}})',
        default: '{ "ok": true }',
        help: 'For JSON mode, the rendered string must be valid JSON.',
      },
      {
        key: 'headers',
        type: 'json',
        label: 'Extra headers (JSON)',
        default: '{}',
        optional: true,
        help: 'Merged on top of the Content-Type set by Body format.',
      },
    ],
  },
  {
    id: 'mcp-tool-call',
    name: 'MCP Tool Call',
    category: 'action',
    description: 'Invoke a tool on an MCP (Model Context Protocol) server via JSON-RPC over HTTP.',
    icon: 'Plug',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Result', type: 'object' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      {
        key: 'serverUrl',
        type: 'url',
        label: 'Server URL',
        default: 'http://localhost:3000/mcp',
        help: 'HTTP endpoint of the MCP server (Streamable HTTP or stateless JSON-RPC).',
      },
      {
        key: 'toolName',
        type: 'text',
        label: 'Tool name',
        default: '',
        help: 'The tool to call, as exposed by the server\'s tools/list. Use the discovery panel to browse.',
      },
      {
        key: 'arguments',
        type: 'json',
        label: 'Arguments (JSON, supports {{var}})',
        default: '{}',
        help: 'Object passed as the tool\'s arguments. {{var}} interpolation is applied before JSON parsing.',
      },
      {
        key: 'authToken',
        type: 'secret',
        label: 'Bearer token',
        optional: true,
        help: 'Sent as Authorization: Bearer <token> if set. Leave empty for unauthenticated servers.',
      },
      {
        key: 'timeoutMs',
        type: 'number',
        label: 'Timeout (ms)',
        default: 30000,
        optional: true,
      },
    ],
  },
  {
    id: 'delay',
    name: 'Delay',
    category: 'action',
    description: 'Pause the workflow for a number of milliseconds, then forward the input.',
    icon: 'Hourglass',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [{ key: 'out', label: 'Out', type: 'any' }],
    fields: [
      {
        key: 'ms',
        type: 'number',
        label: 'Delay (ms)',
        default: 1000,
        help: 'Wait this many milliseconds. Aborts immediately if the run is cancelled.',
      },
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

  {
    id: 'json-parse',
    name: 'JSON Parse',
    category: 'transform',
    description: 'Parse a string as JSON. Emits the parsed value on `out`, or the error on `error`.',
    icon: 'Code',
    color: COLORS.transform,
    inputs: [{ key: 'in', label: 'String', type: 'string' }],
    outputs: [
      { key: 'out', label: 'Parsed', type: 'any' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      {
        key: 'source',
        type: 'text',
        label: 'Source expression',
        default: 'input',
        help: 'JS expression resolving to the string to parse. Bindings: `input`, `vars`.',
      },
    ],
  },
  {
    id: 'json-stringify',
    name: 'JSON Stringify',
    category: 'transform',
    description: 'Serialise the input as a JSON string. Optional indentation for readability.',
    icon: 'Code',
    color: COLORS.transform,
    inputs: [{ key: 'in', label: 'Value', type: 'any' }],
    outputs: [{ key: 'out', label: 'String', type: 'string' }],
    fields: [
      {
        key: 'indent',
        type: 'number',
        label: 'Indent spaces',
        default: 0,
        help: '0 = compact. 2 or 4 = pretty-printed.',
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
        key: 'rules',
        type: 'rule',
        label: 'Conditions',
        help: 'Build a rule tree. Empty = always Yes. Combine rows with AND/OR; group for precedence.',
        optional: true,
      },
      {
        key: 'condition',
        type: 'code',
        language: 'javascript',
        label: 'Or a JS expression',
        default: 'input',
        optional: true,
        help: 'Used only when the rule tree above is empty. Evaluated against `input`, `vars`, `config`.',
      },
    ],
  },
  {
    id: 'switch',
    name: 'Switch',
    category: 'logic',
    description: 'Route the input to the first case whose rules match, or to Default when none match.',
    icon: 'Split',
    color: COLORS.logic,
    inputs: [{ key: 'in', label: 'Input', type: 'any' }],
    /* Static outputs are a fallback the renderer uses before any case is
     * added. Real outputs are resolved per-node from `config.cases` via
     * `resolveOutputs()`. */
    outputs: [
      { key: 'default', label: 'Default', type: 'any' },
    ],
    fields: [
      {
        key: 'cases',
        type: 'switch-cases',
        label: 'Cases',
        help: 'Evaluated top-to-bottom — first match wins. Unmatched inputs leave via the Default port.',
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

  {
    id: 'loop-start',
    name: 'Loop Start',
    category: 'logic',
    description: 'Begin an iteration over an array. Wire its output to the loop body and pair it with a Loop End that has the same Loop ID.',
    icon: 'Repeat',
    color: COLORS.logic,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Item', type: 'any' },
      { key: 'index', label: 'Index', type: 'number' },
    ],
    fields: [
      {
        key: 'loopId',
        type: 'text',
        label: 'Loop ID',
        default: 'loop1',
        help: 'Free identifier. The matching Loop End must use the same value.',
      },
      {
        key: 'source',
        type: 'text',
        label: 'Source array',
        default: 'input.items',
        help: 'JS expression resolving to an array. Bindings: `input`, `vars`.',
      },
    ],
  },
  {
    id: 'loop-end',
    name: 'Loop End',
    category: 'logic',
    description: 'Close the loop. Each iteration\'s value on `in` is collected; downstream nodes receive the array.',
    icon: 'Repeat',
    color: COLORS.logic,
    inputs: [{ key: 'in', label: 'Per-iteration value', type: 'any' }],
    outputs: [{ key: 'out', label: 'Collected', type: 'array' }],
    fields: [
      { key: 'loopId', type: 'text', label: 'Loop ID', default: 'loop1', help: 'Must match the paired Loop Start.' },
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'map',
        options: [
          { label: 'Map — collect every iteration', value: 'map' },
          { label: 'Filter — keep iterations whose `in` is truthy', value: 'filter' },
          { label: 'Last — keep only the final iteration value', value: 'last' },
        ],
      },
    ],
  },
  {
    id: 'for-each',
    name: 'For Each',
    category: 'logic',
    description: 'Iterate an array, run a JS body per item, collect the results. Body bindings: `item`, `index`, `input`, `vars`.',
    icon: 'Repeat',
    color: COLORS.logic,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Collected', type: 'array' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      {
        key: 'source',
        type: 'text',
        label: 'Source array',
        default: 'input.items',
        help: 'A JS expression that resolves to the array. Available: `input`, `vars`. e.g. `input.items` or `vars.queue`.',
      },
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'map',
        options: [
          { label: 'Map — collect every body return', value: 'map' },
          { label: 'Filter — keep items where body returns truthy', value: 'filter' },
          { label: 'Reduce into variable — append body return to vars.NAME', value: 'reduce-into-var' },
        ],
      },
      {
        key: 'varName',
        type: 'text',
        label: 'Target variable (reduce-into-var only)',
        default: 'results',
        optional: true,
        help: 'When mode is reduce-into-var: each iteration appends to this workflow variable.',
      },
      {
        key: 'body',
        type: 'code',
        language: 'javascript',
        label: 'Body',
        default: 'return { name: item.name };',
        help: 'A function body. Available bindings: `item`, `index`, `input`, `vars`. Must `return` a value.',
      },
    ],
  },

  /* ---------- state (workflow-scoped variables) ----------
   *
   * Variables live in a per-run map (ExecutionContext.vars) that is reset
   * each Run. They're addressable from templates as `{{vars.NAME}}` and
   * from JS fields as `vars.NAME`. The `name` field on each node is the
   * variable identifier — keep it short and js-safe.
   */
  {
    id: 'set-var',
    name: 'Set Variable',
    category: 'state',
    description: 'Assign a value to a workflow variable. Forwards the input downstream.',
    icon: 'Variable',
    color: COLORS.state,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [{ key: 'out', label: 'Out', type: 'any' }],
    fields: [
      { key: 'name', type: 'text', label: 'Variable name', default: 'counter', help: 'Identifier. Read it elsewhere as {{vars.counter}}.' },
      {
        key: 'value',
        type: 'text',
        label: 'Value',
        default: '0',
        help: 'Supports {{var}} interpolation. Parsed as JSON when possible (so `0`, `true`, `[]` become typed).',
      },
    ],
  },
  {
    id: 'increment-var',
    name: 'Increment Variable',
    category: 'state',
    description: 'Add a number to a workflow variable. Creates it (starting at 0) if not set.',
    icon: 'Plus',
    color: COLORS.state,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [{ key: 'out', label: 'Out', type: 'any' }],
    fields: [
      { key: 'name', type: 'text', label: 'Variable name', default: 'counter' },
      { key: 'by', type: 'number', label: 'Step', default: 1, help: 'Use a negative number to decrement.' },
    ],
  },
  {
    id: 'append-var',
    name: 'Append to Variable',
    category: 'state',
    description: 'Push a value onto a workflow array variable. Creates an empty array if not set.',
    icon: 'ListPlus',
    color: COLORS.state,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [{ key: 'out', label: 'Out', type: 'any' }],
    fields: [
      { key: 'name', type: 'text', label: 'Variable name', default: 'items' },
      {
        key: 'value',
        type: 'text',
        label: 'Value',
        default: '{{value}}',
        help: 'Supports {{var}} interpolation. JSON-parsed when possible.',
      },
    ],
  },

  /* ---------- sub-flow (callable workflows) ----------
   *
   * `flow-input` is a trigger that declares the sub-flow's parameter
   * signature; `flow-output` is a leaf that captures the return shape;
   * `call-flow` runs another workflow from inside this one. The runner
   * wires recursion via ExecutionContext.invokeFlow.
   */
  {
    id: 'flow-input',
    name: 'Flow Input',
    category: 'trigger',
    description: 'Entry point for a callable sub-flow. Emits the parameters passed by the caller.',
    icon: 'LogIn',
    color: COLORS.trigger,
    inputs: [],
    outputs: [{ key: 'out', label: 'Params', type: 'object' }],
    fields: [
      {
        key: 'params',
        type: 'flow-params',
        label: 'Parameters',
        help: 'Declared inputs the caller must provide. Read as {{name}} or input.name downstream.',
      },
      {
        key: 'samplePayload',
        type: 'json',
        label: 'Sample payload (for testing)',
        default: '{}',
        optional: true,
        help: 'Used when running this flow directly (no caller). Ignored when invoked via call-flow.',
      },
    ],
  },
  {
    id: 'flow-output',
    name: 'Flow Output',
    category: 'action',
    description: 'Sub-flow exit point. Whatever arrives here becomes the return value seen by the caller.',
    icon: 'LogOut',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'Value', type: 'any' }],
    outputs: [],
    fields: [
      {
        key: 'params',
        type: 'flow-params',
        label: 'Returns',
        help: 'Declared return shape — used by call-flow to render readable output keys.',
        optional: true,
      },
    ],
  },
  {
    id: 'call-flow',
    name: 'Call Flow',
    category: 'action',
    description: 'Run another workflow as a sub-flow and forward its return value downstream.',
    icon: 'PhoneOutgoing',
    color: COLORS.action,
    inputs: [{ key: 'in', label: 'In', type: 'any' }],
    outputs: [
      { key: 'out', label: 'Result', type: 'any' },
      { key: 'error', label: 'Error', type: 'object' },
    ],
    fields: [
      {
        key: 'flowId',
        type: 'flow-ref',
        label: 'Workflow',
        help: 'Pick a sub-flow registered with the runtime.',
      },
      {
        key: 'inputs',
        type: 'json',
        label: 'Inputs (JSON, supports {{var}})',
        default: '{}',
        help: 'Object passed as the sub-flow’s parameters. {{var}} interpolation works.',
        optional: true,
      },
    ],
  },

  /* ---------- integrations (multi-op packs) ----------
   *
   * The actual operation nodes live in ./integrations/*.ts. This file
   * keeps only the core, integration-agnostic nodes; everything brand-
   * specific (GitHub, Discord, Telegram, Notion, Gmail, OpenAI, …) is
   * pulled in below so each provider can ship multiple operations.
   */
  ...BUILTIN_INTEGRATION_NODES,
];

/* ====================================================================== */
/* Output resolution                                                        */
/* ====================================================================== */

/**
 * Return the ports a node actually exposes, after taking into account
 * config-driven ports.
 *
 * For most nodes this just returns `def.outputs`. Switch is the one
 * exception: it adds one port per case declared in `node.config.cases`,
 * with `default` always present at the end. Callers in the editor pass
 * the result of this to layout / edge routing so dynamic ports render
 * correctly; the runtime doesn't need it because executors return port
 * keys directly.
 */
export function resolveOutputs(
  def: NodeDefinition,
  node?: WorkflowNode,
): NodePort[] {
  if (def.id === 'switch') {
    const raw = node?.config?.cases;
    const cases: SwitchCase[] = Array.isArray(raw) ? (raw as SwitchCase[]) : [];
    const seen = new Set<string>();
    const out: NodePort[] = [];
    for (const c of cases) {
      const key = String(c?.key ?? '').trim();
      if (!key || seen.has(key) || key === 'default') continue;
      seen.add(key);
      out.push({ key, label: c.label || key, type: 'any' });
    }
    out.push({ key: 'default', label: 'Default', type: 'any' });
    return out;
  }
  return def.outputs;
}

/* ====================================================================== */
/* Factories                                                                */
/* ====================================================================== */

/** Generate a stable, slug-safe key for a fresh switch case. */
export function newSwitchCaseKey(existing: SwitchCase[] = []): string {
  const used = new Set(existing.map((c) => c.key));
  let i = existing.length + 1;
  while (used.has(`case_${i}`)) i++;
  return `case_${i}`;
}

/** Build an empty switch case row. */
export function emptySwitchCase(existing: SwitchCase[] = []): SwitchCase {
  const key = newSwitchCaseKey(existing);
  return {
    key,
    label: `Case ${(existing.length + 1).toString()}`,
    rules: emptyRuleGroup(),
  };
}

/** Build an empty flow parameter row. */
export function emptyFlowParam(existing: FlowParam[] = []): FlowParam {
  const used = new Set(existing.map((p) => p.name));
  let i = existing.length + 1;
  while (used.has(`param${i}`)) i++;
  return { name: `param${i}`, type: 'any' };
}

/** Default registry — equivalent to htmlstudio's BUILTIN_REGISTRY. */
export const BUILTIN_REGISTRY: NodeRegistry = createRegistry(
  BUILTIN_NODES,
  BUILTIN_INTEGRATIONS,
);

export { BUILTIN_INTEGRATIONS, BUILTIN_INTEGRATION_NODES };

/* ====================================================================== */
/* MCP overlay — synthesise picker tiles + per-tool node defs from servers  */
/* ====================================================================== */

/** Prefix used for synthesised MCP NodeDefinition ids. The runtime registry's
 *  prefix-fallback lookup matches this and dispatches all such ids to the
 *  single `mcp-tool-call` executor. */
export const MCP_NODE_ID_PREFIX = 'mcp-tool-call:';

const MCP_TILE_COLOR = '#7c3aed';

/** Build the IntegrationDefinition the picker uses to render the tile for
 *  this MCP server. The tile id matches the server slug, so every synthesised
 *  NodeDefinition can point at it via `integrationId`. */
export function mcpServerToIntegration(server: MCPServerRef): IntegrationDefinition {
  return {
    id: server.id,
    name: server.name,
    description: server.description ?? `MCP server · ${server.tools.length} tool${server.tools.length === 1 ? '' : 's'}`,
    icon: 'Plug',
    color: MCP_TILE_COLOR,
    category: 'MCP',
  };
}

/** Synthesise one NodeDefinition per cached tool. Each def carries the
 *  server's URL and the tool's name as field defaults so the runtime can
 *  dispatch without re-reading the server registry. The def id namespace is
 *  `mcp-tool-call:<serverId>:<toolName>`. */
export function mcpServerToNodeDefs(server: MCPServerRef): NodeDefinition[] {
  return server.tools.map((tool) => ({
    id: `${MCP_NODE_ID_PREFIX}${server.id}:${tool.name}`,
    integrationId: server.id,
    name: `${server.name} · ${tool.name}`,
    operationName: tool.name,
    category: 'action' as const,
    description: tool.description ?? `Call the "${tool.name}" tool on ${server.name}.`,
    icon: 'Plug',
    color: MCP_TILE_COLOR,
    inputs: [{ key: 'in', label: 'In', type: 'any' as const }],
    outputs: [
      { key: 'out', label: 'Result', type: 'object' as const },
      { key: 'error', label: 'Error', type: 'object' as const },
    ],
    fields: [
      { key: 'serverUrl', type: 'url' as const, label: 'Server URL', default: server.url },
      { key: 'toolName', type: 'text' as const, label: 'Tool name', default: tool.name },
      {
        key: 'arguments',
        type: 'json' as const,
        label: 'Arguments (JSON, supports {{var}})',
        default: '{}',
        help: tool.inputSchema
          ? `Schema: ${JSON.stringify(tool.inputSchema)}`
          : undefined,
      },
      { key: 'authToken', type: 'secret' as const, label: 'Bearer token', optional: true, default: server.authToken ?? '' },
      { key: 'timeoutMs', type: 'number' as const, label: 'Timeout (ms)', default: 30000, optional: true },
    ],
  }));
}

/** Build a registry that overlays the dynamic MCP defs from a doc on top of
 *  the static `base` registry. The picker and inspector use the returned
 *  registry; the runtime never needs to (synthesised defs share the same
 *  executor as `mcp-tool-call`). */
export function withMcpServers(
  base: NodeRegistry,
  servers: MCPServerRef[],
): NodeRegistry {
  if (servers.length === 0) return base;
  const extraDefs = servers.flatMap(mcpServerToNodeDefs);
  const extraIntegrations = servers.map(mcpServerToIntegration);
  const combinedDefs = [...base.list(), ...extraDefs];
  const combinedIntegrations = [...base.integrations(), ...extraIntegrations];
  return createRegistry(combinedDefs, combinedIntegrations);
}
