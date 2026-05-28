/**
 * Built-in executors — one per BUILTIN_NODES entry in `tramo`.
 *
 * Each executor's `id` matches the corresponding NodeDefinition.id, so
 * the runner can look it up by node `type`. The split (definition in
 * tramo, executor here) keeps the editor browser-loadable without
 * Node-only deps.
 */

import { evaluateRuleGroup, isRuleGroup } from 'tramo-spec';
import type {
  ExecutionContext,
  ExecutorRegistry,
  NodeExecutionResult,
  NodeExecutor,
} from './types.js';

/* ====================================================================== */
/* registry helper                                                          */
/* ====================================================================== */

export function createExecutorRegistry(executors: NodeExecutor[]): ExecutorRegistry {
  const map = new Map(executors.map((e) => [e.id, e]));
  return {
    list: () => Array.from(map.values()),
    get: (id) => map.get(id),
  };
}

/* ====================================================================== */
/* triggers                                                                 */
/* ====================================================================== */

const manualTrigger: NodeExecutor = {
  id: 'manual-trigger',
  execute: (ctx) => {
    const payload = parseMaybeJson(ctx.config.payload);
    ctx.log.info('manual trigger fired', payload);
    // If the runner was started with options.trigger, prefer it.
    return { out: ctx.inputs.in ?? payload };
  },
};

const webhookTrigger: NodeExecutor = {
  id: 'webhook-trigger',
  execute: (ctx) => {
    // In a real deployment, the runtime's HTTP layer (`triggers/webhook.ts`)
    // calls run() with `trigger = { body, headers, query }` already populated.
    // Here we just forward whatever came in.
    ctx.log.info('webhook trigger', ctx.inputs.in);
    return { out: ctx.inputs.in ?? { body: null, headers: {}, query: {} } };
  },
};

const cronTrigger: NodeExecutor = {
  id: 'cron-trigger',
  execute: (ctx) => {
    ctx.log.info(`cron tick (${ctx.config.expression ?? 'on demand'})`);
    return { out: { firedAt: Date.now() } };
  },
};

/* ====================================================================== */
/* actions                                                                  */
/* ====================================================================== */

const httpRequest: NodeExecutor = {
  id: 'http-request',
  execute: async (ctx) => {
    const url = renderTemplate(String(ctx.config.url ?? ''), ctx.inputs.in);
    const method = String(ctx.config.method ?? 'GET');
    const headers = parseMaybeJson(ctx.config.headers) ?? {};
    const bodyRaw = ctx.config.body;
    const timeoutMs = Number(ctx.config.timeoutMs ?? 10000);

    const init: RequestInit = {
      method,
      headers: headers as HeadersInit,
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
    };
    if (method !== 'GET' && method !== 'HEAD' && bodyRaw !== '' && bodyRaw != null) {
      const body = typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(bodyRaw);
      init.body = body;
      if (!(init.headers as Record<string, string>)['content-type']
          && !(init.headers as Record<string, string>)['Content-Type']) {
        init.headers = { ...(init.headers as Record<string, string>), 'content-type': 'application/json' };
      }
    }

    ctx.log.info(`${method} ${url}`);
    try {
      const res = await fetch(url, init);
      const contentType = res.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json')
        ? await res.json().catch(() => res.text())
        : await res.text();
      const headerOut: Record<string, string> = {};
      res.headers.forEach((v, k) => { headerOut[k] = v; });
      return {
        out: { status: res.status, ok: res.ok, headers: headerOut, data },
      };
    } catch (err) {
      const message = (err as Error).message || String(err);
      ctx.log.error('http request failed', message);
      return { error: { message } };
    }
  },
};

const log: NodeExecutor = {
  id: 'log',
  execute: (ctx) => {
    const level = (ctx.config.level as 'debug' | 'info' | 'warn' | 'error') ?? 'info';
    const prefix = String(ctx.config.prefix ?? '').trim();
    const payload = ctx.inputs.in;
    const msg = prefix ? `${prefix}` : 'log';
    ctx.log[level](msg, payload);
    return { out: payload };
  },
};

/* ====================================================================== */
/* transforms                                                               */
/* ====================================================================== */

const jsTransform: NodeExecutor = {
  id: 'js-transform',
  execute: (ctx) => {
    const expression = String(ctx.config.expression ?? 'return input;');
    const fn = new Function('input', 'config', 'console', expression) as (
      input: unknown,
      config: Record<string, unknown>,
      console: Console,
    ) => unknown;
    const result = fn(ctx.inputs.in, ctx.config, makeScopedConsole(ctx));
    return { out: result };
  },
};

const template: NodeExecutor = {
  id: 'template',
  execute: (ctx) => {
    const tpl = String(ctx.config.template ?? '');
    const rendered = renderTemplate(tpl, ctx.inputs.in);
    return { out: rendered };
  },
};

/* ====================================================================== */
/* logic                                                                    */
/* ====================================================================== */

const ifNode: NodeExecutor = {
  id: 'if',
  execute: (ctx) => {
    const env = { input: ctx.inputs.in, vars: ctx.vars, config: ctx.config };

    // Rule tree wins when present and non-empty; otherwise fall back to
    // the JS expression. This lets visual edits and legacy code coexist.
    const rules = ctx.config.rules;
    let passed: boolean;
    if (isRuleGroup(rules) && rules.rules.length > 0) {
      passed = evaluateRuleGroup(rules, env);
    } else {
      const expression = String(ctx.config.condition ?? 'input');
      type CondFn = (
        input: unknown,
        vars: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => unknown;
      let fn: CondFn;
      try {
        fn = new Function('input', 'vars', 'config', `return (${expression});`) as CondFn;
      } catch {
        // Back-compat: pre-0.2 graphs stored function bodies (`return Boolean(input);`).
        fn = new Function('input', 'vars', 'config', expression) as CondFn;
      }
      passed = Boolean(fn(ctx.inputs.in, ctx.vars, ctx.config));
    }

    ctx.log.info(passed ? 'condition: yes' : 'condition: no');
    return passed ? { yes: ctx.inputs.in } : { no: ctx.inputs.in };
  },
};

const merge: NodeExecutor = {
  id: 'merge',
  execute: (ctx) => {
    const mode = String(ctx.config.mode ?? 'object');
    // The runner currently delivers only the most recent value per port; the
    // merge node is special-cased: it reads its FULL inputs record (which the
    // runner builds anyway). Multi-source semantics are exercised when several
    // edges all target the same port — last write wins under v0.1's contract,
    // so `merge` is mostly useful in pure-mode workflows (one edge per source
    // node, fanned-in via different port names you wire up).
    const values = Object.values(ctx.inputs).filter((v) => v !== undefined);
    if (mode === 'array') return { out: values };
    if (mode === 'first') return { out: values.find((v) => v != null) ?? null };
    // object mode: shallow-merge anything that's an object
    const out: Record<string, unknown> = {};
    for (const v of values) {
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, v);
    }
    return { out };
  },
};

/* ====================================================================== */
/* ai                                                                       */
/* ====================================================================== */

const aiPrompt: NodeExecutor = {
  id: 'ai-prompt',
  execute: async (ctx) => {
    const provider = String(ctx.config.provider ?? 'mock');
    const promptTpl = String(ctx.config.prompt ?? '');
    const prompt = renderTemplate(promptTpl, ctx.inputs.in);
    const system = ctx.config.system ? String(ctx.config.system) : undefined;
    const model = String(ctx.config.model ?? 'claude-opus-4-7');
    const maxTokens = Number(ctx.config.maxTokens ?? 1024);
    const apiKey = ctx.config.apiKey ? String(ctx.config.apiKey) : undefined;

    if (provider === 'mock') {
      ctx.log.info('mock LLM (echo)', { prompt });
      return { out: `[mock:${model}] ${prompt}` };
    }
    if (provider === 'anthropic') {
      return { out: await callAnthropic({ apiKey, model, system, prompt, maxTokens, signal: ctx.signal }) };
    }
    if (provider === 'openai') {
      return { out: await callOpenAI({ apiKey, model, system, prompt, maxTokens, signal: ctx.signal }) };
    }
    throw new Error(`Unknown AI provider: ${provider}`);
  },
};

/* ====================================================================== */
/* integrations — brand-icon demo stubs                                     */
/* ====================================================================== */

/* These three forward the input through after logging that they "would"
 * have called the third-party API. Real implementations wrap the same
 * config shape — keeping the editor-side definitions stable while the
 * executor layer grows. */

const telegramMessage: NodeExecutor = {
  id: 'telegram-message',
  execute: (ctx) => {
    const text = renderTemplate(String(ctx.config.text ?? ''), ctx.inputs.in);
    const chatId = String(ctx.config.chatId ?? '');
    ctx.log.info(`telegram (stub) → ${chatId}: ${text}`);
    return { out: { chatId, text, ok: true } };
  },
};

const githubIssue: NodeExecutor = {
  id: 'github-issue',
  execute: (ctx) => {
    const repo = String(ctx.config.repo ?? '');
    const title = renderTemplate(String(ctx.config.title ?? ''), ctx.inputs.in);
    ctx.log.info(`github (stub) → ${repo} issue: ${title}`);
    return { out: { repo, title, ok: true } };
  },
};

const discordMessage: NodeExecutor = {
  id: 'discord-message',
  execute: (ctx) => {
    const content = renderTemplate(String(ctx.config.content ?? ''), ctx.inputs.in);
    ctx.log.info(`discord (stub): ${content}`);
    return { out: { content, ok: true } };
  },
};

/* ====================================================================== */
/* exports                                                                  */
/* ====================================================================== */

export const BUILTIN_EXECUTORS: NodeExecutor[] = [
  manualTrigger,
  webhookTrigger,
  cronTrigger,
  httpRequest,
  log,
  jsTransform,
  template,
  ifNode,
  merge,
  aiPrompt,
  telegramMessage,
  githubIssue,
  discordMessage,
];

export const BUILTIN_EXECUTOR_REGISTRY: ExecutorRegistry = createExecutorRegistry(BUILTIN_EXECUTORS);

/* ====================================================================== */
/* helpers                                                                  */
/* ====================================================================== */

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v;
  }
}

/**
 * `{{path.to.field}}` interpolation against a context object. Falls back
 * to the raw string when context is missing or non-object.
 */
function renderTemplate(template: string, context: unknown): string {
  if (!template.includes('{{')) return template;
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const path = String(expr).split('.').map((s) => s.trim());
    let cursor: unknown = context;
    for (const seg of path) {
      if (cursor == null) return '';
      if (typeof cursor !== 'object') return '';
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    if (cursor == null) return '';
    return typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
  });
}

function makeScopedConsole(ctx: ExecutionContext): Console {
  return {
    ...console,
    log: (...args: unknown[]) => ctx.log.info(args.map(String).join(' ')),
    info: (...args: unknown[]) => ctx.log.info(args.map(String).join(' ')),
    warn: (...args: unknown[]) => ctx.log.warn(args.map(String).join(' ')),
    error: (...args: unknown[]) => ctx.log.error(args.map(String).join(' ')),
    debug: (...args: unknown[]) => ctx.log.debug(args.map(String).join(' ')),
  } as Console;
}

/* ---------- LLM provider stubs ----------
 * Minimal direct HTTP calls — no SDK dependency so the runtime stays small.
 * Callers who want richer features (streaming, tool use) wrap their own
 * executor and pass it via createExecutorRegistry.
 */

async function callAnthropic(opts: {
  apiKey: string | undefined;
  model: string;
  system: string | undefined;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
}): Promise<string> {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) throw new Error('ai-prompt: Anthropic API key missing (config.apiKey or ANTHROPIC_API_KEY).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
}

async function callOpenAI(opts: {
  apiKey: string | undefined;
  model: string;
  system: string | undefined;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
}): Promise<string> {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined);
  if (!apiKey) throw new Error('ai-prompt: OpenAI API key missing (config.apiKey or OPENAI_API_KEY).');
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.prompt });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: opts.model, messages, max_tokens: opts.maxTokens }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message.content ?? '';
}

/* re-exports used by callers */
export type { NodeExecutor, ExecutorRegistry, NodeExecutionResult };
