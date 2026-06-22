/**
 * Built-in executors — one per BUILTIN_NODES entry in `tramo`.
 *
 * Each executor's `id` matches the corresponding NodeDefinition.id, so
 * the runner can look it up by node `type`. The split (definition in
 * tramo, executor here) keeps the editor browser-loadable without
 * Node-only deps.
 */

import { evaluateRuleGroup, isRuleGroup, type SwitchCase } from '@tramo/spec';
import type {
  ExecutionContext,
  ExecutorRegistry,
  NodeExecutionResult,
  NodeExecutor,
} from './types.js';
import { ApprovalRequiredError } from './approval.js';

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
    const url = renderTemplate(String(ctx.config.url ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);
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
      const rendered = renderTemplate(rawArgs, ctx.inputs.in, ctx.vars, ctx.steps);
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
    const bodyRendered = renderTemplate(String(ctx.config.body ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);
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
    const fn = new Function('input', 'vars', 'steps', 'config', 'console', expression) as (
      input: unknown,
      vars: Record<string, unknown>,
      steps: Record<string, unknown>,
      config: Record<string, unknown>,
      console: Console,
    ) => unknown;
    const result = fn(ctx.inputs.in, ctx.vars, ctx.steps, ctx.config, makeScopedConsole(ctx));
    return { out: result };
  },
};

const template: NodeExecutor = {
  id: 'template',
  execute: (ctx) => {
    const tpl = String(ctx.config.template ?? '');
    const rendered = renderTemplate(tpl, ctx.inputs.in, ctx.vars, ctx.steps);
    return { out: rendered };
  },
};

const jsonParse: NodeExecutor = {
  id: 'json-parse',
  execute: (ctx) => {
    const source = String(ctx.config.source ?? 'input');
    type Resolver = (input: unknown, vars: Record<string, unknown>, steps: Record<string, unknown>) => unknown;
    let value: unknown;
    try {
      const fn = new Function('input', 'vars', 'steps', `return (${source});`) as Resolver;
      value = fn(ctx.inputs.in, ctx.vars, ctx.steps);
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
    const env = { input: ctx.inputs.in, vars: ctx.vars, config: ctx.config, steps: ctx.steps };

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
        steps: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => unknown;
      let fn: CondFn;
      try {
        fn = new Function('input', 'vars', 'steps', 'config', `return (${expression});`) as CondFn;
      } catch {
        // Back-compat: pre-0.2 graphs stored function bodies (`return Boolean(input);`).
        fn = new Function('input', 'vars', 'steps', 'config', expression) as CondFn;
      }
      passed = Boolean(fn(ctx.inputs.in, ctx.vars, ctx.steps, ctx.config));
    }

    ctx.log.info(passed ? 'condition: yes' : 'condition: no');
    return passed ? { yes: ctx.inputs.in } : { no: ctx.inputs.in };
  },
};

const switchNode: NodeExecutor = {
  id: 'switch',
  execute: (ctx) => {
    const env = { input: ctx.inputs.in, vars: ctx.vars, config: ctx.config, steps: ctx.steps };
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

/* approval-gate suspends the run until a human decision arrives. With no
 * decision in ctx.approvals it throws ApprovalRequiredError, which the runner
 * turns into a suspended RunResult; on resume the decision routes the input
 * to the `approved` or `rejected` port. */
const approvalGate: NodeExecutor = {
  id: 'approval-gate',
  execute: (ctx) => {
    const key = String(ctx.config.gateKey ?? '').trim() || ctx.node.id;
    const decision = ctx.approvals?.[key];
    if (!decision) {
      const message = renderTemplate(String(ctx.config.message ?? 'Approve this step?'), ctx.inputs.in, ctx.vars, ctx.steps);
      const approvers = String(ctx.config.approvers ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const timeoutSec = Number(ctx.config.timeoutSec ?? 0);
      ctx.log.info(`awaiting approval (${key})`);
      throw new ApprovalRequiredError({
        nodeId: ctx.node.id,
        key,
        message,
        ...(approvers.length ? { approvers } : {}),
        ...(timeoutSec > 0 ? { expiresAt: Date.now() + timeoutSec * 1000 } : {}),
      });
    }
    if (decision.approved) {
      ctx.log.info(`approved by ${decision.by ?? 'unknown'}`);
      return { approved: ctx.inputs.in };
    }
    ctx.log.info(`rejected by ${decision.by ?? 'unknown'}`);
    return { rejected: { input: ctx.inputs.in, decision } };
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
    const resolveSource = new Function('input', 'vars', 'steps', `return (${sourceExpr});`) as (
      input: unknown,
      vars: Record<string, unknown>,
      steps: Record<string, unknown>,
    ) => unknown;
    let items: unknown;
    try {
      items = resolveSource(ctx.inputs.in, ctx.vars, ctx.steps);
    } catch (err) {
      return { error: { message: `for-each: source expression failed: ${(err as Error).message}` } };
    }
    if (!Array.isArray(items)) {
      return { error: { message: `for-each: source did not resolve to an array (got ${typeof items}).` } };
    }

    const body = new Function('item', 'index', 'input', 'vars', 'steps', bodySrc) as (
      item: unknown,
      index: number,
      input: unknown,
      vars: Record<string, unknown>,
      steps: Record<string, unknown>,
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
        value = body(item, i, ctx.inputs.in, ctx.vars, ctx.steps);
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
    const raw = renderTemplate(String(ctx.config.value ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);
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
    const rendered = renderTemplate(String(ctx.config.value ?? ''), ctx.inputs.in, ctx.vars, ctx.steps);
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
      const rendered = renderTemplate(rawInputs, ctx.inputs.in, ctx.vars, ctx.steps);
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
    const prompt = renderTemplate(promptTpl, ctx.inputs.in, ctx.vars, ctx.steps);
    const system = ctx.config.system
      ? renderTemplate(String(ctx.config.system), ctx.inputs.in, ctx.vars, ctx.steps)
      : undefined;
    const model = String(ctx.config.model ?? 'claude-opus-4-7');
    const maxTokens = Number(ctx.config.maxTokens ?? 1024);
    const apiKey = ctx.config.apiKey ? String(ctx.config.apiKey) : undefined;
    const stream = ctx.config.stream === true || ctx.config.stream === 'true';
    const onChunk = stream ? (t: string) => ctx.emitChunk(t) : undefined;

    if (provider === 'mock') {
      ctx.log.info('mock LLM (echo)', { prompt });
      const text = `[mock:${model}] ${prompt}`;
      if (onChunk) for (const word of text.split(/(\s+)/)) onChunk(word);
      ctx.reportUsage({ provider: 'mock', model, inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(text), costUsd: 0 });
      return { out: text };
    }
    if (provider === 'anthropic') {
      const r = await callAnthropic({ apiKey, model, system, prompt, maxTokens, signal: ctx.signal, onChunk });
      ctx.reportUsage({ provider: 'anthropic', model, ...r.usage });
      return { out: r.text };
    }
    if (provider === 'openai') {
      const r = await callOpenAI({ apiKey, model, system, prompt, maxTokens, signal: ctx.signal, onChunk });
      ctx.reportUsage({ provider: 'openai', model, ...r.usage });
      return { out: r.text };
    }
    throw new Error(`Unknown AI provider: ${provider}`);
  },
};

/* ====================================================================== */
/* exports                                                                  */
/* ====================================================================== */

/* Brand-specific operation executors (Gmail, GitHub, Telegram, …) live in
 * their own @tramo/<brand> packages now. Each ships a NodePack via
 * defineNodePack; consumers compose them with BUILTIN_PACK at the app
 * layer using combinePacks(). */

/* ====================================================================== */
/* utility nodes — signatures, parsing, encoding, bytes                     */
/* ====================================================================== */

const verifySignature: NodeExecutor = {
  id: 'verify-signature',
  execute: async (ctx) => {
    const preset = String(ctx.config.preset ?? 'generic');
    const secret = String(ctx.config.secret ?? '');
    if (!secret) return { error: { message: 'verify-signature: secret is required' } };
    const bodyExpr = String(ctx.config.bodySource ?? 'input.body').trim() || 'input.body';
    const algorithmCfg = String(ctx.config.algorithm ?? 'sha256');
    const headerNameCfg = String(ctx.config.headerName ?? 'x-signature').toLowerCase();

    const input = ctx.inputs.in as { headers?: Record<string, string>; body?: unknown } | undefined;
    if (!input || typeof input !== 'object') {
      return { error: { message: 'verify-signature: input must be an object with `headers` and `body`' } };
    }
    const headersIn: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.headers ?? {})) headersIn[k.toLowerCase()] = String(v);

    // Resolve the raw body that was signed.
    let rawBody: string;
    try {
      const fn = new Function('input', 'vars', `return (${bodyExpr});`) as (i: unknown, v: Record<string, unknown>) => unknown;
      const val = fn(input, ctx.vars);
      rawBody = typeof val === 'string' ? val : JSON.stringify(val);
    } catch (err) {
      return { error: { message: `verify-signature: body expression failed: ${(err as Error).message}` } };
    }

    // Decide algorithm + header + comparison strategy per preset.
    let algorithm: 'sha256' | 'sha1' = 'sha256';
    let headerName = headerNameCfg;
    let prefix = '';
    let payload = rawBody;
    if (preset === 'github') { algorithm = 'sha256'; headerName = 'x-hub-signature-256'; prefix = 'sha256='; }
    else if (preset === 'stripe') { algorithm = 'sha256'; headerName = 'stripe-signature'; }
    else if (preset === 'slack') { algorithm = 'sha256'; headerName = 'x-slack-signature'; prefix = 'v0='; }
    else if (preset === 'twilio') { algorithm = 'sha1'; headerName = 'x-twilio-signature'; }
    else { algorithm = algorithmCfg === 'sha1' ? 'sha1' : 'sha256'; }

    const provided = headersIn[headerName];
    if (!provided) {
      return { bad: { reason: `missing ${headerName} header`, expected: null, provided: null } };
    }

    try {
      const expected = await hmacHex(secret, payload, algorithm);
      if (preset === 'stripe') {
        // Stripe signs `${timestamp}.${body}`; signature header is `t=…,v1=…`.
        const parts = Object.fromEntries(
          provided.split(',').map((kv) => kv.split('=') as [string, string]).filter((kv) => kv.length === 2),
        );
        const t = parts.t;
        const v1 = parts.v1;
        if (!t || !v1) return { bad: { reason: 'malformed Stripe-Signature', provided } };
        payload = `${t}.${rawBody}`;
        const stripeExpected = await hmacHex(secret, payload, 'sha256');
        return safeEqual(stripeExpected, v1)
          ? { ok: input }
          : { bad: { reason: 'signature mismatch', expected: stripeExpected, provided: v1 } };
      }
      if (preset === 'slack') {
        const ts = headersIn['x-slack-request-timestamp'];
        if (!ts) return { bad: { reason: 'missing x-slack-request-timestamp header' } };
        payload = `v0:${ts}:${rawBody}`;
        const slackExpected = `v0=${await hmacHex(secret, payload, 'sha256')}`;
        return safeEqual(slackExpected, provided)
          ? { ok: input }
          : { bad: { reason: 'signature mismatch', expected: slackExpected, provided } };
      }
      const expectedFull = `${prefix}${expected}`;
      return safeEqual(expectedFull, provided)
        ? { ok: input }
        : { bad: { reason: 'signature mismatch', expected: expectedFull, provided } };
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
  },
};

const csvParseNode: NodeExecutor = {
  id: 'csv-parse',
  execute: (ctx) => {
    const sourceExpr = String(ctx.config.source ?? 'input').trim() || 'input';
    const delimiter = String(ctx.config.delimiter ?? ',') || ',';
    const headerRow = ctx.config.headerRow !== false;
    const trim = ctx.config.trim !== false;
    let source: unknown;
    try {
      const fn = new Function('input', 'vars', `return (${sourceExpr});`) as (i: unknown, v: Record<string, unknown>) => unknown;
      source = fn(ctx.inputs.in, ctx.vars);
    } catch (err) {
      return { error: { message: `csv-parse: source expression failed: ${(err as Error).message}` } };
    }
    if (typeof source !== 'string') {
      return { error: { message: `csv-parse: source did not resolve to a string (got ${typeof source})` } };
    }
    try {
      const rows = parseCsv(source, delimiter, trim);
      if (!headerRow) return { out: rows };
      const header = rows.shift() ?? [];
      const out = rows.map((row) => {
        const obj: Record<string, string> = {};
        header.forEach((key, i) => { obj[key] = row[i] ?? ''; });
        return obj;
      });
      return { out };
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
  },
};

const csvStringifyNode: NodeExecutor = {
  id: 'csv-stringify',
  execute: (ctx) => {
    const delimiter = String(ctx.config.delimiter ?? ',') || ',';
    const emitHeader = ctx.config.header !== false;
    const explicitCols = parseMaybeJson(ctx.config.columns);
    const rows = ctx.inputs.in;
    if (!Array.isArray(rows)) return { out: '' };
    if (rows.length === 0) return { out: '' };
    let columns: string[];
    if (Array.isArray(explicitCols) && explicitCols.length > 0) {
      columns = explicitCols.map(String);
    } else if (rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
      columns = Object.keys(rows[0] as Record<string, unknown>);
    } else {
      // Array-of-arrays: no header inference possible.
      columns = [];
    }
    const lines: string[] = [];
    if (emitHeader && columns.length > 0) lines.push(columns.map((c) => csvQuote(c, delimiter)).join(delimiter));
    for (const row of rows) {
      if (Array.isArray(row)) {
        lines.push(row.map((c) => csvQuote(String(c ?? ''), delimiter)).join(delimiter));
      } else if (row && typeof row === 'object') {
        const r = row as Record<string, unknown>;
        const cells = columns.length > 0 ? columns.map((c) => r[c]) : Object.values(r);
        lines.push(cells.map((c) => csvQuote(c == null ? '' : typeof c === 'string' ? c : JSON.stringify(c), delimiter)).join(delimiter));
      }
    }
    return { out: lines.join('\n') };
  },
};

const fetchBinary: NodeExecutor = {
  id: 'fetch-binary',
  execute: async (ctx) => {
    const url = renderTemplate(String(ctx.config.url ?? ''), ctx.inputs.in, ctx.vars);
    if (!url) return { error: { message: 'fetch-binary: url is required' } };
    const headers = parseMaybeJson(ctx.config.headers) ?? {};
    const timeoutMs = Number(ctx.config.timeoutMs ?? 30000);
    ctx.log.info(`fetch-binary GET ${url}`);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: headers as HeadersInit,
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!res.ok) return { error: { message: `fetch-binary: HTTP ${res.status}: ${await res.text()}` } };
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const base64 = bytesToBase64(bytes);
      const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
      return { out: { base64, mimeType, size: bytes.byteLength, url } };
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
  },
};

const uploadBinary: NodeExecutor = {
  id: 'upload-binary',
  execute: async (ctx) => {
    const url = renderTemplate(String(ctx.config.url ?? ''), ctx.inputs.in, ctx.vars);
    if (!url) return { error: { message: 'upload-binary: url is required' } };
    const fieldName = String(ctx.config.fieldName ?? 'file');
    const fileName = renderTemplate(String(ctx.config.fileName ?? 'upload.bin'), ctx.inputs.in, ctx.vars);
    const contentBase64 = renderTemplate(String(ctx.config.contentBase64 ?? ''), ctx.inputs.in, ctx.vars);
    if (!contentBase64) return { error: { message: 'upload-binary: contentBase64 is required' } };
    const mimeType = String(ctx.config.mimeType ?? 'application/octet-stream');
    const extraHeaders = parseMaybeJson(ctx.config.headers) ?? {};
    try {
      const bytes = base64ToBytes(contentBase64);
      const form = new FormData();
      // Cast to BlobPart: TS narrows Uint8Array's buffer to ArrayBufferLike
      // (which includes SharedArrayBuffer), but Blob's BlobPart union only
      // accepts plain ArrayBuffer. The runtime accepts either fine.
      const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
      form.append(fieldName, blob, fileName);
      const res = await fetch(url, {
        method: 'POST',
        headers: extraHeaders as HeadersInit,
        body: form,
        signal: ctx.signal,
      });
      const contentType = res.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json')
        ? await res.json().catch(() => res.text())
        : await res.text();
      if (!res.ok) return { error: { message: `upload-binary: HTTP ${res.status}`, status: res.status, data } };
      return { out: { status: res.status, data } };
    } catch (err) {
      return { error: { message: (err as Error).message } };
    }
  },
};

const encodeNode: NodeExecutor = {
  id: 'encode',
  execute: (ctx) => {
    const sourceExpr = String(ctx.config.source ?? 'input').trim() || 'input';
    const mode = String(ctx.config.mode ?? 'base64-encode');
    let value: unknown;
    try {
      const fn = new Function('input', 'vars', `return (${sourceExpr});`) as (i: unknown, v: Record<string, unknown>) => unknown;
      value = fn(ctx.inputs.in, ctx.vars);
    } catch (err) {
      throw new Error(`encode: source expression failed: ${(err as Error).message}`);
    }
    const str = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    switch (mode) {
      case 'base64-encode': return { out: bytesToBase64(new TextEncoder().encode(str)) };
      case 'base64-decode': return { out: new TextDecoder().decode(base64ToBytes(str)) };
      case 'hex-encode': return { out: bytesToHex(new TextEncoder().encode(str)) };
      case 'hex-decode': return { out: new TextDecoder().decode(hexToBytes(str)) };
      case 'url-encode': return { out: encodeURIComponent(str) };
      case 'url-decode': return { out: decodeURIComponent(str) };
      default: throw new Error(`encode: unknown mode "${mode}"`);
    }
  },
};

const hashNode: NodeExecutor = {
  id: 'hash',
  execute: async (ctx) => {
    const sourceExpr = String(ctx.config.source ?? 'input').trim() || 'input';
    const algorithm = String(ctx.config.algorithm ?? 'sha256').toLowerCase();
    const encoding = String(ctx.config.encoding ?? 'hex');
    let value: unknown;
    try {
      const fn = new Function('input', 'vars', `return (${sourceExpr});`) as (i: unknown, v: Record<string, unknown>) => unknown;
      value = fn(ctx.inputs.in, ctx.vars);
    } catch (err) {
      throw new Error(`hash: source expression failed: ${(err as Error).message}`);
    }
    const str = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    const algoName = algorithm === 'sha1' ? 'SHA-1'
      : algorithm === 'sha512' ? 'SHA-512'
      : algorithm === 'md5' ? 'MD5'
      : 'SHA-256';
    if (algoName === 'MD5') {
      // MD5 isn't in Web Crypto; ship a tiny inline implementation.
      const digest = md5(str);
      return { out: encoding === 'base64' ? bytesToBase64(digest) : bytesToHex(digest) };
    }
    const buf = await crypto.subtle.digest(algoName, new TextEncoder().encode(str));
    const bytes = new Uint8Array(buf);
    return { out: encoding === 'base64' ? bytesToBase64(bytes) : bytesToHex(bytes) };
  },
};

const markdownToHtml: NodeExecutor = {
  id: 'markdown-to-html',
  execute: (ctx) => {
    const sourceExpr = String(ctx.config.source ?? 'input').trim() || 'input';
    const wrapInP = ctx.config.wrapInP !== false;
    let value: unknown;
    try {
      const fn = new Function('input', 'vars', `return (${sourceExpr});`) as (i: unknown, v: Record<string, unknown>) => unknown;
      value = fn(ctx.inputs.in, ctx.vars);
    } catch (err) {
      throw new Error(`markdown-to-html: source expression failed: ${(err as Error).message}`);
    }
    const md = typeof value === 'string' ? value : value == null ? '' : String(value);
    return { out: renderMarkdown(md, wrapInP) };
  },
};

const htmlToText: NodeExecutor = {
  id: 'html-to-text',
  execute: (ctx) => {
    const sourceExpr = String(ctx.config.source ?? 'input').trim() || 'input';
    const preserveLineBreaks = ctx.config.preserveLineBreaks !== false;
    let value: unknown;
    try {
      const fn = new Function('input', 'vars', `return (${sourceExpr});`) as (i: unknown, v: Record<string, unknown>) => unknown;
      value = fn(ctx.inputs.in, ctx.vars);
    } catch (err) {
      throw new Error(`html-to-text: source expression failed: ${(err as Error).message}`);
    }
    const html = typeof value === 'string' ? value : value == null ? '' : String(value);
    return { out: stripHtml(html, preserveLineBreaks) };
  },
};

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
  approvalGate,
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
  verifySignature,
  csvParseNode,
  csvStringifyNode,
  fetchBinary,
  uploadBinary,
  encodeNode,
  hashNode,
  markdownToHtml,
  htmlToText,
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
 * `{{path.to.field}}` interpolation. Roots:
 *   - `vars.…`  → the workflow vars map
 *   - `steps.…` → per-run map of completed-node outputs (keyed by id or slug)
 *   - anything else → the immediate input value
 *
 * Falls back to the empty string when a path can't be walked — forgiving
 * on purpose so a missing field renders blank instead of throwing.
 */
function renderTemplate(
  template: string,
  context: unknown,
  vars?: Record<string, unknown>,
  steps?: Record<string, unknown>,
): string {
  if (!template.includes('{{')) return template;
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const segments = String(expr).split('.').map((s) => s.trim());
    let cursor: unknown;
    let path: string[];
    if (segments[0] === 'vars' && vars) {
      cursor = vars;
      path = segments.slice(1);
    } else if (segments[0] === 'steps' && steps) {
      cursor = steps;
      path = segments.slice(1);
    } else {
      cursor = context;
      path = segments;
    }
    if (path.length === 0) {
      // `{{vars}}` / `{{steps}}` — return the whole map.
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

interface LlmCall {
  apiKey: string | undefined;
  model: string;
  system: string | undefined;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
  /** When set, the call streams and invokes this per text delta. */
  onChunk?: (text: string) => void;
}

interface LlmResult {
  text: string;
  usage: { inputTokens?: number; outputTokens?: number };
}

/** Rough token estimate (~4 chars/token) for providers/paths that don't
 *  report usage (e.g. the mock provider). */
function estimateTokens(s: string): number {
  return Math.ceil((s?.length ?? 0) / 4);
}

/** Parse an SSE response body into `{ data }` events. */
async function* sseEvents(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (data) yield data;
    }
  }
}

async function callAnthropic(opts: LlmCall): Promise<LlmResult> {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) throw new Error('ai-prompt: Anthropic API key missing (config.apiKey or ANTHROPIC_API_KEY).');
  const streaming = !!opts.onChunk;
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
      ...(streaming ? { stream: true } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);

  if (!streaming) {
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return { text, usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens } };
  }

  let text = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for await (const data of sseEvents(res)) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const type = json.type;
    if (type === 'message_start') {
      inputTokens = (json.message as { usage?: { input_tokens?: number } })?.usage?.input_tokens;
    } else if (type === 'content_block_delta') {
      const delta = (json.delta as { text?: string })?.text;
      if (delta) {
        text += delta;
        opts.onChunk!(delta);
      }
    } else if (type === 'message_delta') {
      const out = (json.usage as { output_tokens?: number })?.output_tokens;
      if (out != null) outputTokens = out;
    }
  }
  return { text, usage: { inputTokens, outputTokens } };
}

async function callOpenAI(opts: LlmCall): Promise<LlmResult> {
  const apiKey = opts.apiKey ?? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : undefined);
  if (!apiKey) throw new Error('ai-prompt: OpenAI API key missing (config.apiKey or OPENAI_API_KEY).');
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.prompt });
  const streaming = !!opts.onChunk;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
      ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);

  if (!streaming) {
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices[0]?.message.content ?? '',
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    };
  }

  let text = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for await (const data of sseEvents(res)) {
    if (data === '[DONE]') break;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const choices = json.choices as Array<{ delta?: { content?: string } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (delta) {
      text += delta;
      opts.onChunk!(delta);
    }
    const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      inputTokens = usage.prompt_tokens;
      outputTokens = usage.completion_tokens;
    }
  }
  return { text, usage: { inputTokens, outputTokens } };
}

/* ====================================================================== */
/* helpers for utility nodes — bytes, encoding, HMAC, CSV, markdown, html   */
/* ====================================================================== */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
  // Both Node and modern browsers have btoa via global.
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = typeof atob === 'function' ? atob(clean) : Buffer.from(clean, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.byteLength; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacHex(secret: string, payload: string, algorithm: 'sha256' | 'sha1'): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: algorithm === 'sha1' ? 'SHA-1' : 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

/** Constant-time string comparison — guards against timing oracle attacks
 *  on signature checks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Minimal CSV parser. Supports quoted fields (with "" escapes) and \n /
 *  \r\n line endings. Embedded newlines inside quotes are preserved. */
function parseCsv(input: string, delimiter: string, trim: boolean): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { row.push(trim ? cell.trim() : cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(trim ? cell.trim() : cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(trim ? cell.trim() : cell);
    rows.push(row);
  }
  return rows;
}

function csvQuote(cell: string, delimiter: string): string {
  if (cell.includes(delimiter) || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** Tiny Markdown → HTML renderer. Handles headers (#, ##, ###),
 *  bold (**), italic (*, _), inline code (`), links ([text](url)),
 *  ordered + unordered lists, fenced code blocks, blockquotes, hr, and
 *  paragraphs. Not exhaustive — for full-fidelity markdown, pipe to a
 *  proper renderer downstream. */
function renderMarkdown(md: string, wrapInP: boolean): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let inUL = false;
  let inOL = false;
  let inPara: string[] = [];

  const flushPara = () => {
    if (inPara.length === 0) return;
    const text = inlineFormat(inPara.join(' ').trim());
    if (text) out.push(wrapInP ? `<p>${text}</p>` : text);
    inPara = [];
  };
  const closeLists = () => {
    if (inUL) { out.push('</ul>'); inUL = false; }
    if (inOL) { out.push('</ol>'); inOL = false; }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced code block
    if (/^```/.test(line)) {
      flushPara(); closeLists();
      const lang = line.replace(/^```/, '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) { buf.push(lines[i]!); i++; }
      i++;
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // Horizontal rule
    if (/^---+\s*$/.test(line)) { flushPara(); closeLists(); out.push('<hr>'); i++; continue; }
    // Headers
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(); closeLists(); out.push(`<h${h[1]!.length}>${inlineFormat(h[2]!.trim())}</h${h[1]!.length}>`); i++; continue; }
    // Blockquote
    if (/^>\s?/.test(line)) {
      flushPara(); closeLists();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { buf.push(lines[i]!.replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote><p>${inlineFormat(buf.join(' ').trim())}</p></blockquote>`);
      continue;
    }
    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      if (!inUL) { closeLists(); out.push('<ul>'); inUL = true; }
      out.push(`<li>${inlineFormat(line.replace(/^\s*[-*+]\s+/, ''))}</li>`);
      i++; continue;
    }
    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      if (!inOL) { closeLists(); out.push('<ol>'); inOL = true; }
      out.push(`<li>${inlineFormat(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      i++; continue;
    }
    // Blank line — end paragraph + lists
    if (line.trim() === '') { flushPara(); closeLists(); i++; continue; }
    // Default: accumulate paragraph
    closeLists();
    inPara.push(line);
    i++;
  }
  flushPara(); closeLists();
  return out.join('\n');
}

function inlineFormat(s: string): string {
  // Escape HTML special chars first, then re-introduce inline tags.
  let out = escapeHtml(s);
  // Inline code (before bold/italic so * inside backticks isn't formatted)
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // Bold + italic
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip HTML tags and decode common entities. Block-level tags become
 *  newlines when preserveLineBreaks is true; otherwise everything
 *  collapses to a single line. */
function stripHtml(html: string, preserveLineBreaks: boolean): string {
  let s = html;
  // Drop scripts + styles entirely (content too).
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '');
  if (preserveLineBreaks) {
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|li|h[1-6]|tr|pre|blockquote)>/gi, '\n');
  }
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  s = s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  if (preserveLineBreaks) {
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return s.replace(/\s+/g, ' ').trim();
}

/* MD5 — RFC 1321. Tiny implementation because Web Crypto doesn't ship MD5
 * and we don't want a dependency for a node that exists mainly for parity
 * with legacy webhook providers. Operates on UTF-8 bytes, returns a 16-byte
 * Uint8Array digest. */
function md5(input: string): Uint8Array {
  const bytes = new TextEncoder().encode(input);
  const msgLen = bytes.length;
  const padLen = (msgLen + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[msgLen] = 0x80;
  const bitLen = BigInt(msgLen) * 8n;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, Number(bitLen & 0xffffffffn), true);
  dv.setUint32(padLen - 4, Number((bitLen >> 32n) & 0xffffffffn), true);

  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
  ];
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5, 9,14,20,5, 9,14,20,5, 9,14,20,5, 9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  for (let chunk = 0; chunk < padLen; chunk += 64) {
    const M: number[] = new Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(chunk + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) { F = (B & C) | ((~B) & D); g = j; }
      else if (j < 32) { F = (D & B) | ((~D) & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | (~D)); g = (7 * j) % 16; }
      F = (F + A + K[j]! + M[g]!) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[j]!)) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const digest = new Uint8Array(16);
  const ddv = new DataView(digest.buffer);
  ddv.setUint32(0, a0, true);
  ddv.setUint32(4, b0, true);
  ddv.setUint32(8, c0, true);
  ddv.setUint32(12, d0, true);
  return digest;
}

/* re-exports used by callers */
export type { NodeExecutor, ExecutorRegistry, NodeExecutionResult };
