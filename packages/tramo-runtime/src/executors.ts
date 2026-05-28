/**
 * Built-in executors — one per BUILTIN_NODES entry in `tramo`.
 *
 * Each executor's `id` matches the corresponding NodeDefinition.id, so
 * the runner can look it up by node `type`. The split (definition in
 * tramo, executor here) keeps the editor browser-loadable without
 * Node-only deps.
 */

import { evaluateRuleGroup, isRuleGroup, type SwitchCase } from 'tramo-spec';
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
    get: (id) => {
      const exact = map.get(id);
      if (exact) return exact;
      // Prefix fallback: ids shaped `<executorId>:<...>` dispatch to the
      // executor named by the prefix. Used by MCP — every dynamically-
      // synthesised `mcp-tool-call:<server>:<tool>` node maps to the single
      // `mcp-tool-call` executor, which reads serverUrl + toolName from the
      // node's own config.
      const colon = id.indexOf(':');
      if (colon > 0) {
        const prefix = id.slice(0, colon);
        return map.get(prefix);
      }
      return undefined;
    },
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
    const url = renderTemplate(String(ctx.config.url ?? ''), ctx.inputs.in, ctx.vars);
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

const mcpToolCall: NodeExecutor = {
  id: 'mcp-tool-call',
  execute: async (ctx) => {
    const serverUrl = String(ctx.config.serverUrl ?? '').trim();
    const toolName = String(ctx.config.toolName ?? '').trim();
    if (!serverUrl) return { error: { message: 'mcp-tool-call: serverUrl is required' } };
    if (!toolName) return { error: { message: 'mcp-tool-call: toolName is required' } };

    const rawArgs = ctx.config.arguments;
    let parsedArgs: unknown;
    if (typeof rawArgs === 'string') {
      const rendered = renderTemplate(rawArgs, ctx.inputs.in, ctx.vars);
      const trimmed = rendered.trim();
      if (trimmed === '') {
        parsedArgs = {};
      } else {
        try {
          parsedArgs = JSON.parse(trimmed);
        } catch (err) {
          return { error: { message: `mcp-tool-call: arguments JSON invalid after rendering: ${(err as Error).message}` } };
        }
      }
    } else {
      parsedArgs = rawArgs ?? {};
    }

    const timeoutMs = Number(ctx.config.timeoutMs ?? 30000);
    const authToken = ctx.config.authToken ? String(ctx.config.authToken) : undefined;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (authToken) headers.authorization = `Bearer ${authToken}`;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: parsedArgs },
    });

    ctx.log.info(`mcp-tool-call → ${toolName} @ ${serverUrl}`);
    try {
      const res = await fetch(serverUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!res.ok) {
        return { error: { message: `mcp-tool-call: HTTP ${res.status} from ${serverUrl}: ${await res.text()}` } };
      }
      const contentType = res.headers.get('content-type') ?? '';
      // Streamable HTTP servers may return SSE; we read the body as text and
      // pick the last `data: { ... }` line, which is the final JSON-RPC frame.
      let payload: unknown;
      if (contentType.includes('text/event-stream')) {
        const text = await res.text();
        const lines = text.split(/\r?\n/).filter((l) => l.startsWith('data:'));
        const last = lines[lines.length - 1]?.slice(5).trim();
        if (!last) return { error: { message: 'mcp-tool-call: empty SSE stream from server' } };
        try {
          payload = JSON.parse(last);
        } catch (err) {
          return { error: { message: `mcp-tool-call: failed to parse SSE frame: ${(err as Error).message}` } };
        }
      } else {
        payload = await res.json();
      }
      const rpc = payload as { result?: { content?: unknown; isError?: boolean }; error?: { message?: string } };
      if (rpc.error) {
        return { error: { message: rpc.error.message ?? 'mcp-tool-call: server returned a JSON-RPC error' } };
      }
      if (rpc.result?.isError) {
        return { error: { message: 'mcp-tool-call: tool reported isError=true', content: rpc.result.content } };
      }
      return { out: rpc.result?.content ?? rpc.result ?? payload };
    } catch (err) {
      return { error: { message: (err as Error).message || String(err) } };
    }
  },
};

const httpRespond: NodeExecutor = {
  id: 'http-respond',
  execute: (ctx) => {
    const status = Number(ctx.config.status ?? 200);
    const bodyMode = String(ctx.config.bodyMode ?? 'json');
    const bodyRendered = renderTemplate(String(ctx.config.body ?? ''), ctx.inputs.in, ctx.vars);
    const extraHeaders = (parseMaybeJson(ctx.config.headers) ?? {}) as Record<string, string>;

    let body: unknown;
    const headers: Record<string, string> = { ...extraHeaders };
    if (bodyMode === 'json') {
      try {
        body = bodyRendered.trim() === '' ? null : JSON.parse(bodyRendered);
      } catch (err) {
        throw new Error(`http-respond: body is not valid JSON after rendering: ${(err as Error).message}`);
      }
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
      }
    } else {
      body = bodyRendered;
      if (!headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'text/plain; charset=utf-8';
      }
    }

    const response = { status, body, headers };
    ctx.log.info(`responding ${status} (${bodyMode})`);
    return { response, out: ctx.inputs.in };
  },
};

const delay: NodeExecutor = {
  id: 'delay',
  execute: (ctx) =>
    new Promise((resolve, reject) => {
      const ms = Math.max(0, Number(ctx.config.ms ?? 0));
      if (ctx.signal.aborted) {
        reject(new Error('delay: aborted before starting'));
        return;
      }
      const timer = setTimeout(() => {
        ctx.signal.removeEventListener('abort', onAbort);
        resolve({ out: ctx.inputs.in });
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('delay: aborted'));
      };
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      ctx.log.info(`waiting ${ms}ms`);
    }),
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
    const fn = new Function('input', 'vars', 'config', 'console', expression) as (
      input: unknown,
      vars: Record<string, unknown>,
      config: Record<string, unknown>,
      console: Console,
    ) => unknown;
    const result = fn(ctx.inputs.in, ctx.vars, ctx.config, makeScopedConsole(ctx));
    return { out: result };
  },
};

const template: NodeExecutor = {
  id: 'template',
  execute: (ctx) => {
    const tpl = String(ctx.config.template ?? '');
    const rendered = renderTemplate(tpl, ctx.inputs.in, ctx.vars);
    return { out: rendered };
  },
};

const jsonParse: NodeExecutor = {
  id: 'json-parse',
  execute: (ctx) => {
    const source = String(ctx.config.source ?? 'input');
    type Resolver = (input: unknown, vars: Record<string, unknown>) => unknown;
    let value: unknown;
    try {
      const fn = new Function('input', 'vars', `return (${source});`) as Resolver;
      value = fn(ctx.inputs.in, ctx.vars);
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
    if (typeof value !== 'string') {
      return { error: { message: `json-parse: source did not resolve to a string (got ${typeof value})` } };
    }
    try {
      return { out: JSON.parse(value) };
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
  },
};

const jsonStringify: NodeExecutor = {
  id: 'json-stringify',
  execute: (ctx) => {
    const indent = Math.max(0, Math.min(8, Number(ctx.config.indent ?? 0)));
    return { out: JSON.stringify(ctx.inputs.in, null, indent || undefined) };
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

const switchNode: NodeExecutor = {
  id: 'switch',
  execute: (ctx) => {
    const env = { input: ctx.inputs.in, vars: ctx.vars, config: ctx.config };
    const raw = ctx.config.cases;
    const cases: SwitchCase[] = Array.isArray(raw) ? (raw as SwitchCase[]) : [];
    for (const c of cases) {
      const key = String(c?.key ?? '').trim();
      if (!key || key === 'default') continue;
      if (isRuleGroup(c.rules) && c.rules.rules.length > 0) {
        if (evaluateRuleGroup(c.rules, env)) {
          ctx.log.info(`switch → ${key}`);
          return { [key]: ctx.inputs.in };
        }
      } else {
        // Empty rules in a case match anything — same convention as If.
        ctx.log.info(`switch → ${key} (empty rules)`);
        return { [key]: ctx.inputs.in };
      }
    }
    ctx.log.info('switch → default');
    return { default: ctx.inputs.in };
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

/* loop-start / loop-end are control-flow primitives — the runner's planning
 * pass picks them up and runs the body subgraph itself. These stub executors
 * exist so the pack registry stays exhaustive; if anything ever calls them
 * directly it means the planning pass was bypassed and the user deserves a
 * clear error rather than silent skipping. */
const loopStartStub: NodeExecutor = {
  id: 'loop-start',
  execute: () => {
    throw new Error(
      'loop-start invoked directly — the runner handles loop pairing as a planning pre-pass; calling the executor manually is unsupported.',
    );
  },
};

const loopEndStub: NodeExecutor = {
  id: 'loop-end',
  execute: () => {
    throw new Error(
      'loop-end invoked directly — the runner synthesizes its output as part of the loop iteration; calling the executor manually is unsupported.',
    );
  },
};

const forEach: NodeExecutor = {
  id: 'for-each',
  execute: (ctx) => {
    const sourceExpr = String(ctx.config.source ?? 'input').trim() || 'input';
    const mode = String(ctx.config.mode ?? 'map');
    const bodySrc = String(ctx.config.body ?? 'return item;');
    const varName = String(ctx.config.varName ?? '').trim();

    // Resolve the source array. `input` and `vars` are the same bindings
    // exposed to JS Transform — keeping them consistent across nodes so
    // users learn one mental model.
    const resolveSource = new Function('input', 'vars', `return (${sourceExpr});`) as (
      input: unknown,
      vars: Record<string, unknown>,
    ) => unknown;
    let items: unknown;
    try {
      items = resolveSource(ctx.inputs.in, ctx.vars);
    } catch (err) {
      return { error: { message: `for-each: source expression failed: ${(err as Error).message}` } };
    }
    if (!Array.isArray(items)) {
      return { error: { message: `for-each: source did not resolve to an array (got ${typeof items}).` } };
    }

    const body = new Function('item', 'index', 'input', 'vars', bodySrc) as (
      item: unknown,
      index: number,
      input: unknown,
      vars: Record<string, unknown>,
    ) => unknown;

    if (mode === 'reduce-into-var') {
      if (!varName) {
        return { error: { message: 'for-each: reduce-into-var requires a Target variable.' } };
      }
      if (!Array.isArray(ctx.vars[varName])) ctx.vars[varName] = [];
    }

    const collected: unknown[] = [];
    for (let i = 0; i < items.length; i++) {
      if (ctx.signal.aborted) {
        ctx.log.warn(`for-each aborted at index ${i}`);
        break;
      }
      const item = items[i];
      let value: unknown;
      try {
        value = body(item, i, ctx.inputs.in, ctx.vars);
      } catch (err) {
        return { error: { message: `for-each body failed at index ${i}: ${(err as Error).message}` } };
      }
      if (mode === 'filter') {
        if (value) collected.push(item);
      } else if (mode === 'reduce-into-var') {
        (ctx.vars[varName] as unknown[]).push(value);
      } else {
        // map (default)
        collected.push(value);
      }
    }

    if (mode === 'reduce-into-var') {
      ctx.log.info(`for-each → vars.${varName} (len=${(ctx.vars[varName] as unknown[]).length})`);
      return { out: ctx.vars[varName] };
    }
    ctx.log.info(`for-each (${mode}) processed ${items.length} item(s)`);
    return { out: collected };
  },
};

/* ====================================================================== */
/* state — workflow-scoped variables                                        */
/* ====================================================================== */

const setVar: NodeExecutor = {
  id: 'set-var',
  execute: (ctx) => {
    const name = String(ctx.config.name ?? '').trim();
    if (!name) throw new Error('set-var: name is required');
    const raw = renderTemplate(String(ctx.config.value ?? ''), ctx.inputs.in, ctx.vars);
    const parsed = parseMaybeJson(raw);
    ctx.vars[name] = parsed;
    ctx.log.info(`set vars.${name}`, parsed);
    return { out: ctx.inputs.in };
  },
};

const incrementVar: NodeExecutor = {
  id: 'increment-var',
  execute: (ctx) => {
    const name = String(ctx.config.name ?? '').trim();
    if (!name) throw new Error('increment-var: name is required');
    const by = Number(ctx.config.by ?? 1);
    const current = Number(ctx.vars[name] ?? 0);
    const next = current + (Number.isFinite(by) ? by : 0);
    ctx.vars[name] = next;
    ctx.log.info(`vars.${name} = ${next}`);
    return { out: ctx.inputs.in };
  },
};

const appendVar: NodeExecutor = {
  id: 'append-var',
  execute: (ctx) => {
    const name = String(ctx.config.name ?? '').trim();
    if (!name) throw new Error('append-var: name is required');
    const rendered = renderTemplate(String(ctx.config.value ?? ''), ctx.inputs.in, ctx.vars);
    const value = parseMaybeJson(rendered);
    const existing = ctx.vars[name];
    const arr = Array.isArray(existing) ? [...existing] : [];
    arr.push(value);
    ctx.vars[name] = arr;
    ctx.log.info(`appended to vars.${name} (len=${arr.length})`);
    return { out: ctx.inputs.in };
  },
};

/* ====================================================================== */
/* sub-flows                                                                */
/* ====================================================================== */

/* flow-input behaves like manual-trigger except it favours the caller-
 * supplied trigger and falls back to the editor's "sample payload" when
 * the workflow is run standalone (so users can iterate without setting up
 * a parent flow). */
const flowInput: NodeExecutor = {
  id: 'flow-input',
  execute: (ctx) => {
    const fromCaller = ctx.inputs.in;
    if (fromCaller !== undefined) {
      ctx.log.info('flow-input received params from caller', fromCaller);
      return { out: fromCaller };
    }
    const sample = parseMaybeJson(ctx.config.samplePayload) ?? {};
    ctx.log.info('flow-input using sample payload (no caller)', sample);
    return { out: sample };
  },
};

/* flow-output is a sink — it just captures what arrived. The call-flow
 * executor reads its result from `nodeResults` after the sub-flow run. */
const flowOutput: NodeExecutor = {
  id: 'flow-output',
  execute: (ctx) => {
    ctx.log.info('flow-output', ctx.inputs.in);
    return { in: ctx.inputs.in, out: ctx.inputs.in };
  },
};

const callFlow: NodeExecutor = {
  id: 'call-flow',
  execute: async (ctx) => {
    const flowId = String(ctx.config.flowId ?? '').trim();
    if (!flowId) return { error: { message: 'call-flow: no workflow selected' } };
    const sub = ctx.workflows?.[flowId];
    if (!sub) return { error: { message: `call-flow: no workflow registered with id "${flowId}"` } };
    if (!ctx.invokeFlow) return { error: { message: 'call-flow: runtime did not supply an invokeFlow hook' } };

    // Render the inputs JSON (with template vars), then JSON-parse.
    const rawInputs = ctx.config.inputs;
    let parsedInputs: unknown;
    if (typeof rawInputs === 'string') {
      const rendered = renderTemplate(rawInputs, ctx.inputs.in, ctx.vars);
      const trimmed = rendered.trim();
      if (trimmed === '') {
        parsedInputs = {};
      } else {
        try {
          parsedInputs = JSON.parse(trimmed);
        } catch (err) {
          return { error: { message: `call-flow: inputs JSON invalid after rendering: ${(err as Error).message}` } };
        }
      }
    } else {
      parsedInputs = rawInputs ?? {};
    }

    ctx.log.info(`call-flow → ${flowId}`, parsedInputs);
    const result = await ctx.invokeFlow(sub, parsedInputs);
    if (!result.ok) {
      return { error: { message: `sub-flow "${flowId}" failed: ${result.error ?? 'unknown error'}` } };
    }

    // The sub-flow's "return value" is whatever flow-output captured. If
    // the sub-flow has no flow-output node, fall back to the last node's
    // result so things still work for simple cases.
    const outputNode = sub.nodes.find((n) => n.type === 'flow-output');
    let returnValue: unknown;
    if (outputNode) {
      const r = result.nodeResults[outputNode.id];
      returnValue = r && typeof r === 'object' && 'out' in r
        ? (r as Record<string, unknown>).out
        : r;
    } else {
      const ids = Object.keys(result.nodeResults);
      const lastId = ids[ids.length - 1];
      const r = lastId ? result.nodeResults[lastId] : undefined;
      returnValue = r && typeof r === 'object' && 'out' in r
        ? (r as Record<string, unknown>).out
        : r;
    }
    return { out: returnValue };
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
    const prompt = renderTemplate(promptTpl, ctx.inputs.in, ctx.vars);
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

/* Each integration operation is currently a stub: it logs and forwards a
 * shape that mirrors the real API response, so workflows can be built and
 * tested without credentials. Real implementations replace these one-by-
 * one without changing the operation id or config shape. */

function makeIntegrationStub(id: string, label: string): NodeExecutor {
  return {
    id,
    execute: (ctx) => {
      ctx.log.info(`${label} (stub) — config:`, ctx.config);
      return { out: { ok: true, stub: id, config: ctx.config, input: ctx.inputs.in } };
    },
  };
}

const githubExecutors: NodeExecutor[] = [
  makeIntegrationStub('github-issue-create', 'github · create issue'),
  makeIntegrationStub('github-issue-comment', 'github · comment'),
  makeIntegrationStub('github-issue-close', 'github · close issue'),
  makeIntegrationStub('github-pr-create', 'github · open pr'),
  makeIntegrationStub('github-repo-star', 'github · star'),
  makeIntegrationStub('github-dispatch', 'github · dispatch'),
  makeIntegrationStub('github-release-create', 'github · create release'),
  makeIntegrationStub('github-file-get', 'github · get file'),
];

const discordExecutors: NodeExecutor[] = [
  makeIntegrationStub('discord-webhook-send', 'discord · send (webhook)'),
  makeIntegrationStub('discord-webhook-embed', 'discord · embed'),
  makeIntegrationStub('discord-thread-create', 'discord · thread'),
  makeIntegrationStub('discord-bot-send', 'discord · send (bot)'),
  makeIntegrationStub('discord-dm-send', 'discord · dm'),
  makeIntegrationStub('discord-react', 'discord · react'),
];

const telegramExecutors: NodeExecutor[] = [
  makeIntegrationStub('telegram-send-message', 'telegram · send'),
  makeIntegrationStub('telegram-send-photo', 'telegram · photo'),
  makeIntegrationStub('telegram-send-document', 'telegram · document'),
  makeIntegrationStub('telegram-edit-message', 'telegram · edit'),
  makeIntegrationStub('telegram-delete-message', 'telegram · delete'),
  makeIntegrationStub('telegram-send-poll', 'telegram · poll'),
];

const notionExecutors: NodeExecutor[] = [
  makeIntegrationStub('notion-page-create', 'notion · create page'),
  makeIntegrationStub('notion-page-update', 'notion · update page'),
  makeIntegrationStub('notion-page-get', 'notion · get page'),
  makeIntegrationStub('notion-database-query', 'notion · query db'),
  makeIntegrationStub('notion-block-append', 'notion · append blocks'),
  makeIntegrationStub('notion-search', 'notion · search'),
];

const gmailExecutors: NodeExecutor[] = [
  makeIntegrationStub('gmail-send', 'gmail · send'),
  makeIntegrationStub('gmail-reply', 'gmail · reply'),
  makeIntegrationStub('gmail-draft', 'gmail · draft'),
  makeIntegrationStub('gmail-search', 'gmail · search'),
  makeIntegrationStub('gmail-get', 'gmail · get'),
  makeIntegrationStub('gmail-trash', 'gmail · trash'),
  makeIntegrationStub('gmail-label-modify', 'gmail · labels'),
];

const openaiExecutors: NodeExecutor[] = [
  makeIntegrationStub('openai-chat', 'openai · chat'),
  makeIntegrationStub('openai-image', 'openai · image'),
  makeIntegrationStub('openai-embed', 'openai · embed'),
  makeIntegrationStub('openai-transcribe', 'openai · transcribe'),
  makeIntegrationStub('openai-speech', 'openai · speech'),
  makeIntegrationStub('openai-moderation', 'openai · moderation'),
];

const anthropicExecutors: NodeExecutor[] = [
  makeIntegrationStub('anthropic-message', 'anthropic · message'),
  makeIntegrationStub('anthropic-vision', 'anthropic · vision'),
  makeIntegrationStub('anthropic-extract', 'anthropic · extract'),
  makeIntegrationStub('anthropic-summarize', 'anthropic · summarize'),
  makeIntegrationStub('anthropic-classify', 'anthropic · classify'),
  makeIntegrationStub('anthropic-tool-use', 'anthropic · tool use'),
];

const linearExecutors: NodeExecutor[] = [
  makeIntegrationStub('linear-issue-create', 'linear · create issue'),
  makeIntegrationStub('linear-issue-comment', 'linear · comment'),
  makeIntegrationStub('linear-issue-update', 'linear · update'),
  makeIntegrationStub('linear-issue-search', 'linear · search'),
  makeIntegrationStub('linear-project-create', 'linear · create project'),
  makeIntegrationStub('linear-comment-list', 'linear · list comments'),
];

const airtableExecutors: NodeExecutor[] = [
  makeIntegrationStub('airtable-record-create', 'airtable · create record'),
  makeIntegrationStub('airtable-record-update', 'airtable · update record'),
  makeIntegrationStub('airtable-record-get', 'airtable · get record'),
  makeIntegrationStub('airtable-record-delete', 'airtable · delete record'),
  makeIntegrationStub('airtable-list-records', 'airtable · list'),
  makeIntegrationStub('airtable-record-find', 'airtable · find'),
];

const stripeExecutors: NodeExecutor[] = [
  makeIntegrationStub('stripe-customer-create', 'stripe · create customer'),
  makeIntegrationStub('stripe-charge-create', 'stripe · payment intent'),
  makeIntegrationStub('stripe-subscription-create', 'stripe · subscription'),
  makeIntegrationStub('stripe-refund-create', 'stripe · refund'),
  makeIntegrationStub('stripe-invoice-create', 'stripe · invoice'),
  makeIntegrationStub('stripe-checkout-session', 'stripe · checkout session'),
];

/* ====================================================================== */
/* exports                                                                  */
/* ====================================================================== */

export const BUILTIN_EXECUTORS: NodeExecutor[] = [
  manualTrigger,
  webhookTrigger,
  cronTrigger,
  httpRequest,
  mcpToolCall,
  httpRespond,
  delay,
  log,
  jsTransform,
  template,
  jsonParse,
  jsonStringify,
  ifNode,
  switchNode,
  merge,
  loopStartStub,
  loopEndStub,
  forEach,
  setVar,
  incrementVar,
  appendVar,
  flowInput,
  flowOutput,
  callFlow,
  aiPrompt,
  ...githubExecutors,
  ...discordExecutors,
  ...telegramExecutors,
  ...notionExecutors,
  ...gmailExecutors,
  ...openaiExecutors,
  ...anthropicExecutors,
  ...linearExecutors,
  ...airtableExecutors,
  ...stripeExecutors,
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
 * `{{path.to.field}}` interpolation. Paths that start with `vars.` resolve
 * against the workflow vars map; everything else resolves against the
 * input context. Falls back to the empty string when a path can't be
 * walked — this is forgiving on purpose so a missing field renders blank
 * instead of throwing.
 */
function renderTemplate(template: string, context: unknown, vars?: Record<string, unknown>): string {
  if (!template.includes('{{')) return template;
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const segments = String(expr).split('.').map((s) => s.trim());
    let cursor: unknown;
    if (segments[0] === 'vars' && vars) {
      cursor = vars;
    } else {
      cursor = context;
    }
    const path = segments[0] === 'vars' && vars ? segments.slice(1) : segments;
    if (path.length === 0) {
      // `{{vars}}` — return the whole vars map.
      return cursor == null ? '' : JSON.stringify(cursor);
    }
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
