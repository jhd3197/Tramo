/**
 * Workflow executor.
 *
 * Strategy: topo-sort the graph, run each node when its inputs are ready,
 * pipe outputs along edges to downstream input ports, emit per-node events.
 *
 * Concurrency: nodes are scheduled in topological layers using Kahn's
 * ready-set. Every node whose dependencies have resolved runs concurrently,
 * bounded by RunOptions.concurrency (default Infinity; 1 = legacy sequential
 * walk). A loop pair is one scheduling unit owned by its loop-start.
 *
 * If-style branching: a node may return `{ true: x }` *or* `{ false: y }`
 * (not both). Downstream nodes that wired to the unfired port are skipped.
 *
 * Loops: `loop-start` / `loop-end` are a pair matched by `config.loopId`.
 * A pre-pass computes each pair's body subgraph (nodes downstream of start
 * and upstream of end). The loop-start drives the body sequentially once per
 * item, accumulating the value arriving at loop-end; its whole interior is
 * marked resolved so the layer scheduler steps past it.
 *
 * Reliability: per-node retry/backoff, secret redaction, an audit sink, role
 * gating, token/cost accounting, and checkpoint/resume are all layered in
 * here. A streaming variant, runStream(), yields events live.
 */

import { topoSort, getIncomingEdges, getOutgoingEdges, SPEC_VERSION, buildStepSlugMap } from '@tramo/spec';
import type { RetryPolicy, WorkflowNode } from '@tramo/spec';
import type {
  ExecutionContext,
  ExecutorRegistry,
  NodeExecutionResult,
  ResumeState,
  RunEvent,
  RunOptions,
  RunResult,
  RunUsage,
  TokenUsage,
  WorkflowDoc,
} from './types.js';
import { createRedactor, type Redactor } from './redact.js';
import type { AuditRecord } from './audit.js';
import { estimateCost } from './pricing.js';

interface LoopPlan {
  startId: string;
  endId: string;
  loopId: string;
  source: string;
  mode: 'map' | 'filter' | 'last';
  /** Body node ids in topo order. */
  body: string[];
}

export async function run(
  doc: WorkflowDoc,
  registry: ExecutorRegistry,
  options: RunOptions = {},
): Promise<RunResult> {
  const redactEnabled = options.redact !== false;
  const redactor: Redactor = createRedactor(
    redactEnabled ? options.secrets ?? [] : [],
    { patterns: redactEnabled },
  );
  const auditSink = options.audit;
  const actor = options.actor;

  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => {
    const out = redactEnabled ? redactEvent(e, redactor) : e;
    events.push(out);
    options.onEvent?.(out);
  };

  const pushAudit = (record: Omit<AuditRecord, 'timestamp' | 'actor'>) => {
    if (!auditSink) return;
    auditSink({
      ...record,
      actor,
      timestamp: new Date().toISOString(),
      inputs: record.inputs ? (redactor(record.inputs) as Record<string, unknown>) : undefined,
      output: record.output != null ? (redactor(record.output) as NodeExecutionResult) : record.output,
    });
  };

  const runId =
    options.resumeFrom?.runId ??
    `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const signal = options.signal ?? new AbortController().signal;
  const vars: Record<string, unknown> = options.resumeFrom ? { ...options.resumeFrom.vars } : {};
  const concurrency = Math.max(1, options.concurrency ?? Number.POSITIVE_INFINITY);

  /* Per-run `steps` map exposed to templates/JS so any node can read any
   * already-completed upstream's value. Keyed by both id and slug; values
   * are the natural emission (single-port → bare, multi-port → port map).
   * Slugs come from node.label or node.type — the runner doesn't see
   * NodeDefinitions, so we don't fall back to def.name here. */
  const steps: Record<string, unknown> = {};
  const { idToSlug } = buildStepSlugMap(doc, () => undefined);

  const recordStep = (nodeId: string, result: NodeExecutionResult) => {
    const value = stepValue(result);
    steps[nodeId] = value;
    const slug = idToSlug.get(nodeId);
    if (slug) steps[slug] = value;
  };

  /* 0. spec-version compatibility */
  if (doc.version !== SPEC_VERSION) {
    const err = `Workflow spec version ${doc.version} is not supported by this runtime (expects ${SPEC_VERSION}).`;
    emit({ type: 'run-end', runId, ok: false, error: err });
    return { ok: false, runId, nodeResults: {}, events, error: err };
  }

  /* 1. topo sort + abort on cycle */
  const topo = topoSort(doc);
  if (!topo.ok) {
    const err = topo.error ?? 'Cycle detected.';
    emit({ type: 'run-end', runId, ok: false, error: err });
    return { ok: false, runId, nodeResults: {}, events, error: err };
  }

  /* 1b. plan loop pairs — fails the whole run on mismatch so the user sees
   *     a structural error up-front rather than a confusing mid-run skip. */
  const planResult = planLoops(doc, topo.order);
  if (!planResult.ok) {
    emit({ type: 'run-end', runId, ok: false, error: planResult.error });
    return { ok: false, runId, nodeResults: {}, events, error: planResult.error };
  }
  const loopPlansByStart = planResult.plansByStart;
  const loopBodyIds = planResult.bodyIds;
  const loopEndIds = planResult.endIds;

  emit({ type: 'run-start', runId, nodeOrder: topo.order });
  pushAudit({ type: 'run-start', runId });

  /* 2. precompute incoming-edges map (cheap and reused) */
  const incoming = new Map<string, ReturnType<typeof getIncomingEdges>>();
  for (const nid of topo.order) incoming.set(nid, getIncomingEdges(doc, nid));

  /* 3. iterate. nodeResults[nid] = result emitted by that node. */
  const nodeResults: Record<string, NodeExecutionResult> = {};
  const erroredNodes = new Set<string>();
  const skippedReason = new Map<string, string>();

  /* 3a. resume — replay a checkpointed run's completed work so the
   *     scheduler treats those nodes as already done. */
  if (options.resumeFrom) {
    const r = options.resumeFrom;
    for (const [id, result] of Object.entries(r.nodeResults)) {
      nodeResults[id] = result;
      recordStep(id, result);
    }
    for (const id of r.errored) erroredNodes.add(id);
    for (const [id, reason] of Object.entries(r.skipped)) skippedReason.set(id, reason);
  }

  const snapshot = (): ResumeState => ({
    runId,
    nodeResults: { ...nodeResults },
    errored: Array.from(erroredNodes),
    skipped: Object.fromEntries(skippedReason),
    vars: { ...vars },
  });

  /* Usage accumulation — executors call ctx.reportUsage; we fill in missing
   * cost from the pricing table and aggregate per-node and per-model. */
  const usageByNode: Record<string, TokenUsage> = {};
  const usageByModel: Record<string, TokenUsage> = {};
  let anyUsage = false;
  const recordUsage = (nodeId: string, raw: TokenUsage) => {
    anyUsage = true;
    const u: TokenUsage = { ...raw };
    if (u.totalTokens == null) u.totalTokens = (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
    if (u.costUsd == null) u.costUsd = estimateCost(u.model, u.inputTokens, u.outputTokens);
    mergeUsage((usageByNode[nodeId] ??= {}), u);
    mergeUsage((usageByModel[`${u.provider ?? 'unknown'}/${u.model ?? 'unknown'}`] ??= {}), u);
    emit({ type: 'node-usage', runId, nodeId, usage: u });
  };

  const nodeTypeOf = (id: string) => doc.nodes.find((n) => n.id === id)?.type;
  const emitSkip = (nodeId: string, reason: string) => {
    emit({ type: 'node-skip', runId, nodeId, reason });
    skippedReason.set(nodeId, reason);
    pushAudit({ type: 'node-skip', runId, nodeId, nodeType: nodeTypeOf(nodeId), reason });
  };

  /** Run one node. Returns true if it produced a result (success), false if
   *  it was skipped or errored. Mutates nodeResults / erroredNodes /
   *  skippedReason. Used both by the outer iteration and by the per-loop
   *  body iteration. */
  const executeNode = async (nodeId: string): Promise<boolean> => {
    if (signal.aborted) {
      emit({ type: 'node-skip', runId, nodeId, reason: 'run aborted' });
      skippedReason.set(nodeId, 'run aborted');
      return false;
    }

    const node = doc.nodes.find((n) => n.id === nodeId)!;
    const executor = registry.get(node.type);
    if (!executor) {
      const reason = `No executor registered for type "${node.type}"`;
      emitSkip(nodeId, reason);
      return false;
    }

    /* Role gate: when the host supplies `roles`, a node tagged with a
     * `requiredRole` the actor lacks is skipped (not errored) so fallback
     * branches downstream can still run. Undefined roles = no gate. */
    if (options.roles && node.requiredRole && !options.roles.includes(node.requiredRole)) {
      emitSkip(nodeId, `missing required role "${node.requiredRole}" (have: ${options.roles.join(', ') || 'none'})`);
      return false;
    }

    const runAfter = node.runAfter ?? 'on-success';
    const edges = incoming.get(nodeId) ?? [];
    const upstreamError = edges.some((e) => erroredNodes.has(e.source));
    const upstreamSkipped = edges.some(
      (e) => skippedReason.has(e.source) && !erroredNodes.has(e.source),
    );
    const allSucceeded = edges.length === 0
      ? true
      : edges.every((e) => !skippedReason.has(e.source));

    let shouldRun = true;
    let policySkipReason: string | null = null;
    if (runAfter === 'on-success') {
      if (!allSucceeded) {
        shouldRun = false;
        const which = upstreamError
          ? 'upstream errored'
          : upstreamSkipped
            ? 'upstream skipped'
            : 'upstream not ready';
        policySkipReason = `${which} (runAfter=on-success)`;
      }
    } else if (runAfter === 'on-error') {
      if (!upstreamError) {
        shouldRun = false;
        policySkipReason = `no upstream errored (runAfter=on-error)`;
      }
    }

    if (!shouldRun) {
      const reason = policySkipReason ?? 'policy';
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
      return false;
    }

    const inputs: Record<string, unknown> = {};
    let allInputsAvailable = true;
    let inputSkipReason: string | null = null;

    for (const edge of edges) {
      const fromPort = edge.sourceHandle ?? 'out';
      const toPort = edge.targetHandle ?? 'in';
      if (skippedReason.has(edge.source)) {
        if (runAfter === 'on-success') {
          allInputsAvailable = false;
          inputSkipReason = `upstream ${edge.source} skipped (${skippedReason.get(edge.source)})`;
          break;
        }
        inputs[toPort] = undefined;
        continue;
      }
      const upstream = nodeResults[edge.source];
      let value: unknown;
      if (upstream && typeof upstream === 'object' && fromPort in upstream) {
        value = (upstream as Record<string, unknown>)[fromPort];
      } else if (fromPort === 'out') {
        value = upstream;
      } else if (runAfter === 'on-success') {
        allInputsAvailable = false;
        inputSkipReason = `upstream ${edge.source} did not emit port "${fromPort}"`;
        break;
      } else {
        value = undefined;
      }
      inputs[toPort] = value;
    }

    if (!allInputsAvailable) {
      const reason = inputSkipReason ?? 'inputs unavailable';
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
      return false;
    }

    if (edges.length === 0 && options.trigger !== undefined) {
      inputs.in = options.trigger;
    }

    emit({ type: 'node-start', runId, nodeId });
    pushAudit({ type: 'node-start', runId, nodeId, nodeType: node.type, inputs });
    const startMs = Date.now();

    const ctx: ExecutionContext = {
      inputs,
      config: node.config,
      signal,
      node,
      runId,
      vars,
      steps,
      workflows: options.workflows,
      invokeFlow: (subDoc, subInput) =>
        run(subDoc, registry, {
          trigger: subInput,
          signal,
          workflows: options.workflows,
          secrets: options.secrets,
          redact: options.redact,
          roles: options.roles,
          actor: options.actor,
          logger: options.logger,
        }),
      log: makeLogger((level, message, data) => {
        emit({ type: 'node-log', runId, nodeId, level, message, data });
      }),
      reportUsage: (usage: TokenUsage) => recordUsage(nodeId, usage),
      emitChunk: (chunk: string, channel = 'out') => {
        emit({ type: 'node-chunk', runId, nodeId, chunk, channel });
      },
    };

    /* Retry loop: an executor that *throws* is retried per the node's
     * RetryPolicy. Executors that return an `{ error }` envelope are treated
     * as a normal success by the scheduler and are never retried. */
    const retry = node.retry;
    const maxAttempts = 1 + Math.max(0, Math.floor(retry?.count ?? 0));
    let lastMessage = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await Promise.resolve(executor.execute(ctx));
        const normalized = normalizeResult(result);
        nodeResults[nodeId] = normalized;
        recordStep(nodeId, normalized);
        const durationMs = Date.now() - startMs;
        emit({ type: 'node-success', runId, nodeId, output: normalized, durationMs });
        pushAudit({ type: 'node-success', runId, nodeId, nodeType: node.type, inputs, output: normalized, durationMs, attempt });
        return true;
      } catch (err) {
        lastMessage = (err as Error).message || String(err);
        const willRetry = attempt < maxAttempts && !signal.aborted;
        if (willRetry) {
          const delayMs = computeBackoff(retry!, attempt);
          emit({ type: 'node-log', runId, nodeId, level: 'warn', message: `attempt ${attempt}/${maxAttempts} failed: ${lastMessage} — retrying in ${delayMs}ms` });
          try {
            await sleep(delayMs, signal);
          } catch {
            break; // aborted during backoff
          }
          if (!signal.aborted) continue;
          break;
        }
        break;
      }
    }

    const durationMs = Date.now() - startMs;
    emit({ type: 'node-error', runId, nodeId, error: lastMessage, durationMs });
    pushAudit({ type: 'node-error', runId, nodeId, nodeType: node.type, inputs, error: lastMessage, durationMs });
    skippedReason.set(nodeId, `error: ${lastMessage}`);
    erroredNodes.add(nodeId);
    options.logger?.error(`[tramo] node ${nodeId} failed after ${maxAttempts} attempt(s): ${lastMessage}`);
    return false;
  };

  /** Dispatch: loop-starts go through runLoop, everything else through
   *  executeNode. Used by both the outer iteration and the body iteration
   *  inside runLoop so a loop body can itself contain another loop. */
  const runOne = async (nodeId: string): Promise<void> => {
    const innerPlan = loopPlansByStart.get(nodeId);
    if (innerPlan) {
      await runLoop(innerPlan);
      return;
    }
    // Bare loop-end inside a body iteration shouldn't happen — planning
    // strips it out. Belt-and-braces:
    if (loopEndIds.has(nodeId)) return;
    await executeNode(nodeId);
  };

  const runLoop = async (plan: LoopPlan): Promise<void> => {
    const startNode = doc.nodes.find((n) => n.id === plan.startId)!;

    // Resolve the source array. `vars` and the start node's `in` are the
    // bindings — same surface as for-each and js-transform.
    const startEdges = incoming.get(plan.startId) ?? [];
    const startInput = readInputForNode(startEdges, nodeResults, options.trigger).in;
    let items: unknown;
    try {
      const fn = new Function('input', 'vars', 'steps', `return (${plan.source || 'input'});`) as (
        input: unknown,
        vars: Record<string, unknown>,
        steps: Record<string, unknown>,
      ) => unknown;
      items = fn(startInput, vars, steps);
    } catch (err) {
      const msg = `loop-start ${plan.loopId}: source expression failed: ${(err as Error).message}`;
      emit({ type: 'node-error', runId, nodeId: plan.startId, error: msg, durationMs: 0 });
      pushAudit({ type: 'node-error', runId, nodeId: plan.startId, nodeType: 'loop-start', error: msg });
      erroredNodes.add(plan.startId);
      skippedReason.set(plan.startId, `error: ${msg}`);
      skippedReason.set(plan.endId, `paired loop-start errored`);
      for (const b of plan.body) skippedReason.set(b, `loop-start errored`);
      return;
    }
    if (!Array.isArray(items)) {
      const msg = `loop-start ${plan.loopId}: source did not resolve to an array (got ${typeof items}).`;
      emit({ type: 'node-error', runId, nodeId: plan.startId, error: msg, durationMs: 0 });
      pushAudit({ type: 'node-error', runId, nodeId: plan.startId, nodeType: 'loop-start', error: msg });
      erroredNodes.add(plan.startId);
      skippedReason.set(plan.startId, `error: ${msg}`);
      skippedReason.set(plan.endId, `paired loop-start errored`);
      for (const b of plan.body) skippedReason.set(b, `loop-start errored`);
      return;
    }

    emit({ type: 'node-start', runId, nodeId: plan.startId });
    pushAudit({ type: 'node-start', runId, nodeId: plan.startId, nodeType: 'loop-start' });
    emit({
      type: 'node-log',
      runId,
      nodeId: plan.startId,
      level: 'info',
      message: `loop ${plan.loopId}: iterating ${items.length} item(s)`,
    });

    const collected: unknown[] = [];
    let lastIterValue: unknown;
    const endIncoming = incoming.get(plan.endId) ?? [];

    iterating: for (let i = 0; i < items.length; i++) {
      if (signal.aborted) {
        emit({ type: 'node-log', runId, nodeId: plan.startId, level: 'warn', message: `loop ${plan.loopId}: aborted at iteration ${i}` });
        break iterating;
      }

      // Reset per-iteration state for body nodes so a previous iteration's
      // skip / error doesn't poison this one.
      for (const bId of plan.body) {
        delete nodeResults[bId];
        erroredNodes.delete(bId);
        skippedReason.delete(bId);
      }
      // Publish the iteration's value on the start node's ports.
      nodeResults[plan.startId] = { out: items[i], index: i };
      recordStep(plan.startId, nodeResults[plan.startId]);
      erroredNodes.delete(plan.startId);
      skippedReason.delete(plan.startId);

      for (const bId of plan.body) {
        await runOne(bId);
      }

      const iterValue = readEndIncomingValue(endIncoming, nodeResults, skippedReason);
      lastIterValue = iterValue;
      if (plan.mode === 'map') {
        collected.push(iterValue);
      } else if (plan.mode === 'filter') {
        if (iterValue) collected.push(iterValue);
      }
      // 'last' mode only stores lastIterValue (handled below).

      emit({
        type: 'node-log',
        runId,
        nodeId: plan.startId,
        level: 'debug',
        message: `loop ${plan.loopId}: iter ${i} done`,
      });
    }

    const startOut = { out: items[items.length - 1], index: items.length - 1 };
    emit({ type: 'node-success', runId, nodeId: plan.startId, output: startOut, durationMs: 0 });
    pushAudit({ type: 'node-success', runId, nodeId: plan.startId, nodeType: 'loop-start', output: startOut });

    // Synthesize the loop-end's result so anything downstream consumes the
    // collected/final value without needing a dedicated executor.
    const endOutput =
      plan.mode === 'last' ? { out: lastIterValue } : { out: collected };
    nodeResults[plan.endId] = endOutput;
    recordStep(plan.endId, endOutput);
    emit({ type: 'node-success', runId, nodeId: plan.endId, output: endOutput, durationMs: 0 });
    pushAudit({ type: 'node-success', runId, nodeId: plan.endId, nodeType: 'loop-end', output: endOutput });
    void startNode;
  };

  /* ---------------------------------------------------------------------- */
  /* Scheduler — layered parallel execution (Kahn's ready-set).             */
  /*                                                                        */
  /* Top-level units are every node except those owned by a loop (its body  */
  /* and loop-end), which the loop-start's runLoop drives internally. A     */
  /* unit is ready when all of its external dependencies have resolved. The */
  /* whole ready layer is dispatched concurrently (bounded by              */
  /* options.concurrency); `concurrency: 1` reproduces the old sequential  */
  /* topo walk exactly.                                                     */
  /* ---------------------------------------------------------------------- */

  const orderIndex = new Map(topo.order.map((id, i) => [id, i]));

  // Per-loop interior (start ∪ body-closure ∪ end) and the external nodes
  // each loop depends on (edges entering the interior from outside it).
  const loopInterior = new Map<string, Set<string>>();
  const externalDeps = new Map<string, string[]>();
  const topLevel = topo.order.filter((id) => !loopBodyIds.has(id) && !loopEndIds.has(id));

  for (const id of topLevel) {
    const plan = loopPlansByStart.get(id);
    if (plan) {
      const interior = new Set<string>([plan.startId, plan.endId]);
      const desc = descendantsOf(doc, plan.startId);
      const anc = ancestorsOf(doc, plan.endId);
      for (const n of desc) if (anc.has(n)) interior.add(n);
      loopInterior.set(id, interior);
      const deps = new Set<string>();
      for (const n of interior) {
        for (const e of incoming.get(n) ?? []) {
          if (!interior.has(e.source)) deps.add(e.source);
        }
      }
      externalDeps.set(id, Array.from(deps));
    } else {
      externalDeps.set(id, (incoming.get(id) ?? []).map((e) => e.source));
    }
  }

  const resolved = new Set<string>();
  if (options.resumeFrom) {
    for (const id of Object.keys(options.resumeFrom.nodeResults)) resolved.add(id);
    for (const id of options.resumeFrom.errored) resolved.add(id);
    for (const id of Object.keys(options.resumeFrom.skipped)) resolved.add(id);
  }
  const pending = new Set(topLevel.filter((id) => !resolved.has(id)));

  while (pending.size > 0) {
    if (signal.aborted) {
      for (const id of topo.order) {
        if (!pending.has(id)) continue;
        emitSkip(id, 'run aborted');
        pending.delete(id);
        resolved.add(id);
      }
      break;
    }

    const ready = Array.from(pending)
      .filter((id) => (externalDeps.get(id) ?? []).every((src) => resolved.has(src)))
      .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

    if (ready.length === 0) {
      // No node can make progress — remaining pending have dependencies that
      // will never resolve (defensive; topo sort should prevent this).
      for (const id of Array.from(pending).sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))) {
        emitSkip(id, 'dependencies never resolved');
        resolved.add(id);
      }
      pending.clear();
      break;
    }

    await runPool(ready, concurrency, runOne);

    for (const id of ready) {
      pending.delete(id);
      resolved.add(id);
      const interior = loopInterior.get(id);
      if (interior) for (const n of interior) resolved.add(n);
    }

    if (options.checkpoint) await options.checkpoint(snapshot());
  }

  emit({ type: 'run-end', runId, ok: true });
  pushAudit({ type: 'run-end', runId, ok: true });

  const usage = anyUsage ? buildRunUsage(usageByNode, usageByModel) : undefined;
  return { ok: true, runId, nodeResults, events, usage };
}

/**
 * Streaming variant of {@link run}. Yields every `RunEvent` as it happens —
 * including `node-chunk` partials from streaming LLM executors — and returns
 * the final `RunResult` as the generator's return value.
 *
 * ```ts
 * const gen = runStream(doc, registry);
 * let next = await gen.next();
 * while (!next.done) {
 *   if (next.value.type === 'node-chunk') process.stdout.write(next.value.chunk);
 *   next = await gen.next();
 * }
 * const result = next.value; // RunResult
 * ```
 *
 * A `for await` loop also works for events; grab the result via the manual
 * loop above when you need it. Any `onEvent` passed in options still fires.
 */
export async function* runStream(
  doc: WorkflowDoc,
  registry: ExecutorRegistry,
  options: RunOptions = {},
): AsyncGenerator<RunEvent, RunResult, void> {
  const queue: RunEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  const onEvent = (e: RunEvent) => {
    queue.push(e);
    options.onEvent?.(e);
    wake?.();
  };

  const resultPromise = run(doc, registry, { ...options, onEvent }).then(
    (r) => {
      finished = true;
      wake?.();
      return r;
    },
    (err) => {
      finished = true;
      wake?.();
      throw err;
    },
  );

  while (true) {
    while (queue.length > 0) yield queue.shift()!;
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
    wake = null;
  }
  while (queue.length > 0) yield queue.shift()!;
  return await resultPromise;
}

/* ---------- loop planning ---------- */

interface PlanResult {
  ok: boolean;
  error?: string;
  plansByStart: Map<string, LoopPlan>;
  endIds: Set<string>;
  bodyIds: Set<string>;
}

function planLoops(doc: WorkflowDoc, topoOrder: string[]): PlanResult {
  const plansByStart = new Map<string, LoopPlan>();
  const endIds = new Set<string>();
  const bodyIds = new Set<string>();

  const starts = doc.nodes.filter((n) => n.type === 'loop-start');
  const ends = doc.nodes.filter((n) => n.type === 'loop-end');
  if (starts.length === 0 && ends.length === 0) {
    return { ok: true, plansByStart, endIds, bodyIds };
  }

  // Group by loopId to detect duplicates and orphans.
  const startsById = new Map<string, WorkflowNode[]>();
  for (const s of starts) {
    const id = String(s.config?.loopId ?? '').trim();
    if (!id) return failPlan(`loop-start ${s.id} has no Loop ID set`);
    (startsById.get(id) ?? startsById.set(id, []).get(id)!).push(s);
  }
  const endsById = new Map<string, WorkflowNode[]>();
  for (const e of ends) {
    const id = String(e.config?.loopId ?? '').trim();
    if (!id) return failPlan(`loop-end ${e.id} has no Loop ID set`);
    (endsById.get(id) ?? endsById.set(id, []).get(id)!).push(e);
  }

  // Surface every mismatch in a single error message — clearer than firing
  // them one at a time.
  for (const [id, sList] of startsById) {
    if (sList.length > 1) {
      return failPlan(`Multiple loop-start nodes share Loop ID "${id}" (${sList.map((n) => n.id).join(', ')})`);
    }
    if (!endsById.has(id)) {
      return failPlan(`loop-start "${id}" (${sList[0].id}) has no matching loop-end with the same Loop ID`);
    }
  }
  for (const [id, eList] of endsById) {
    if (eList.length > 1) {
      return failPlan(`Multiple loop-end nodes share Loop ID "${id}" (${eList.map((n) => n.id).join(', ')})`);
    }
    if (!startsById.has(id)) {
      return failPlan(`loop-end "${id}" (${eList[0].id}) has no matching loop-start with the same Loop ID`);
    }
  }

  // Pass 1: raw bodies — `descendants(start) ∩ ancestors(end)` minus endpoints.
  // Pass 2: effective bodies subtract nested loop pairs so an outer loop's
  //   body iteration walks direct children + nested loop-starts only, never
  //   stepping into a nested loop's interior (the recursive dispatch does
  //   that for us).
  const rawBodies = new Map<string, Set<string>>();
  for (const [id, sList] of startsById) {
    const start = sList[0];
    const end = endsById.get(id)![0];
    const desc = descendantsOf(doc, start.id);
    const anc = ancestorsOf(doc, end.id);
    const bodySet = new Set<string>();
    for (const nId of desc) {
      if (nId === start.id || nId === end.id) continue;
      if (anc.has(nId)) bodySet.add(nId);
    }

    // Containment check: a body node leaking an edge to anything not in the
    // body and not the loop-end means data escapes the loop without going
    // through the aggregator — that's almost always a wiring mistake and
    // the resulting semantics ("last iteration wins") are surprising.
    for (const bId of bodySet) {
      const outs = getOutgoingEdges(doc, bId);
      for (const e of outs) {
        if (e.target === end.id) continue;
        if (bodySet.has(e.target)) continue;
        if (e.target === start.id) {
          return failPlan(`loop body node ${bId} feeds back into loop-start "${id}" — that would create a cycle`);
        }
        return failPlan(
          `loop body node ${bId} has an edge to ${e.target}, which is outside loop "${id}" — wire it through loop-end instead`,
        );
      }
    }
    rawBodies.set(start.id, bodySet);
  }

  for (const [id, sList] of startsById) {
    const start = sList[0];
    const end = endsById.get(id)![0];
    const raw = rawBodies.get(start.id)!;

    // Strip out anything that belongs to a nested loop pair living inside
    // this one. We keep the nested loop's start node so the outer body
    // iteration still dispatches into runLoop(innerPlan); everything below
    // that (inner's own body + end) is handled by the recursive call.
    const effective = new Set(raw);
    for (const [otherId, otherSList] of startsById) {
      if (otherId === id) continue;
      const otherStart = otherSList[0];
      if (!raw.has(otherStart.id)) continue; // not nested in this pair
      const otherEnd = endsById.get(otherId)![0];
      const otherRaw = rawBodies.get(otherStart.id)!;
      for (const n of otherRaw) effective.delete(n);
      effective.delete(otherEnd.id);
    }

    const bodyOrdered = topoOrder.filter((nId) => effective.has(nId));
    plansByStart.set(start.id, {
      startId: start.id,
      endId: end.id,
      loopId: id,
      source: String(start.config?.source ?? 'input'),
      mode: normalizeMode(String(end.config?.mode ?? 'map')),
      body: bodyOrdered,
    });
    endIds.add(end.id);
    for (const b of raw) bodyIds.add(b);
  }

  return { ok: true, plansByStart, endIds, bodyIds };
}

function failPlan(error: string): PlanResult {
  return {
    ok: false,
    error,
    plansByStart: new Map(),
    endIds: new Set(),
    bodyIds: new Set(),
  };
}

function normalizeMode(s: string): 'map' | 'filter' | 'last' {
  return s === 'filter' || s === 'last' ? s : 'map';
}

function descendantsOf(doc: WorkflowDoc, nodeId: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of getOutgoingEdges(doc, cur)) {
      if (!out.has(e.target)) {
        out.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return out;
}

function ancestorsOf(doc: WorkflowDoc, nodeId: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of getIncomingEdges(doc, cur)) {
      if (!out.has(e.source)) {
        out.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return out;
}

/* ---------- helpers reused by the loop iterator ---------- */

function readInputForNode(
  edges: ReturnType<typeof getIncomingEdges>,
  nodeResults: Record<string, NodeExecutionResult>,
  trigger: unknown,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const edge of edges) {
    const fromPort = edge.sourceHandle ?? 'out';
    const toPort = edge.targetHandle ?? 'in';
    const upstream = nodeResults[edge.source];
    let value: unknown;
    if (upstream && typeof upstream === 'object' && fromPort in upstream) {
      value = (upstream as Record<string, unknown>)[fromPort];
    } else if (fromPort === 'out') {
      value = upstream;
    }
    inputs[toPort] = value;
  }
  if (edges.length === 0 && trigger !== undefined) inputs.in = trigger;
  return inputs;
}

/** Loop-end has no executor; we synthesize the value the user wired into its
 *  `in` port by reading from the most recent upstream result. */
function readEndIncomingValue(
  edges: ReturnType<typeof getIncomingEdges>,
  nodeResults: Record<string, NodeExecutionResult>,
  skipped: Map<string, string>,
): unknown {
  for (const edge of edges) {
    const toPort = edge.targetHandle ?? 'in';
    if (toPort !== 'in') continue;
    if (skipped.has(edge.source)) return undefined;
    const fromPort = edge.sourceHandle ?? 'out';
    const upstream = nodeResults[edge.source];
    if (upstream && typeof upstream === 'object' && fromPort in upstream) {
      return (upstream as Record<string, unknown>)[fromPort];
    }
    if (fromPort === 'out') return upstream;
  }
  return undefined;
}

/* ---------- scheduling + reliability helpers ---------- */

/** Compute the backoff wait (ms) before retry `attempt` (1-based: 1 = first
 *  retry) for a RetryPolicy. */
function computeBackoff(retry: RetryPolicy, attempt: number): number {
  const base = Math.max(0, retry.delayMs ?? 0);
  let d = base;
  if (retry.backoff === 'linear') d = base * attempt;
  else if (retry.backoff === 'exponential') d = base * 2 ** (attempt - 1);
  if (retry.maxDelayMs != null) d = Math.min(d, Math.max(0, retry.maxDelayMs));
  if (retry.jitter) d = d * (0.5 + Math.random()); // ±50%
  return Math.max(0, Math.round(d));
}

/** Promise sleep that rejects if the signal aborts (so backoff is cancellable). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    if (ms <= 0) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Run `worker` over `items` with at most `limit` concurrent calls. `limit`
 *  ≤ 1 runs strictly sequentially in the given order. Never rejects — a
 *  worker's own error handling is its responsibility (executeNode swallows). */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (!Number.isFinite(limit) || limit >= items.length) {
    if (limit <= 1) {
      for (const item of items) await worker(item);
      return;
    }
    await Promise.all(items.map((item) => worker(item)));
    return;
  }
  if (limit <= 1) {
    for (const item of items) await worker(item);
    return;
  }
  let cursor = 0;
  const lane = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: limit }, lane));
}

/** Redact observability payloads on an event without touching nodeResults. */
function redactEvent(e: RunEvent, redact: Redactor): RunEvent {
  switch (e.type) {
    case 'node-log':
      return { ...e, message: redact.text(e.message), data: e.data === undefined ? undefined : redact(e.data) };
    case 'node-success':
      return { ...e, output: redact(e.output) as NodeExecutionResult };
    case 'node-error':
      return { ...e, error: redact.text(e.error) };
    case 'node-skip':
      return { ...e, reason: redact.text(e.reason) };
    case 'node-chunk':
      return { ...e, chunk: redact.text(e.chunk) };
    case 'run-end':
      return e.error ? { ...e, error: redact.text(e.error) } : e;
    default:
      return e;
  }
}

/* ---------- usage aggregation ---------- */

function mergeUsage(target: TokenUsage, u: TokenUsage): void {
  target.inputTokens = (target.inputTokens ?? 0) + (u.inputTokens ?? 0);
  target.outputTokens = (target.outputTokens ?? 0) + (u.outputTokens ?? 0);
  target.totalTokens = (target.totalTokens ?? 0) + (u.totalTokens ?? 0);
  target.costUsd = (target.costUsd ?? 0) + (u.costUsd ?? 0);
  if (u.cacheReadTokens != null) target.cacheReadTokens = (target.cacheReadTokens ?? 0) + u.cacheReadTokens;
  if (u.cacheWriteTokens != null) target.cacheWriteTokens = (target.cacheWriteTokens ?? 0) + u.cacheWriteTokens;
  if (u.provider) target.provider = u.provider;
  if (u.model) target.model = u.model;
}

function buildRunUsage(
  byNode: Record<string, TokenUsage>,
  byModel: Record<string, TokenUsage>,
): RunUsage {
  const total: RunUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, byNode, byModel };
  for (const u of Object.values(byNode)) {
    total.inputTokens += u.inputTokens ?? 0;
    total.outputTokens += u.outputTokens ?? 0;
    total.totalTokens += u.totalTokens ?? 0;
    total.costUsd += u.costUsd ?? 0;
  }
  total.costUsd = Math.round(total.costUsd * 1_000_000) / 1_000_000;
  return total;
}

/* Convert a bare value into an `{ out: value }` map. Pass through if already shaped. */
function normalizeResult(result: NodeExecutionResult): NodeExecutionResult {
  if (result == null) return undefined;
  if (typeof result === 'object' && !Array.isArray(result)) return result;
  return { out: result };
}

/**
 * Unwrap a node's normalized result for the `steps` map. Single-port
 * emitters publish the bare value (so `steps.fetch.foo` works the obvious
 * way); multi-port emitters keep the port map so consumers can pick a
 * branch (`steps.if_user.true`). Undefined results are stored as null.
 */
function stepValue(result: NodeExecutionResult): unknown {
  if (result == null) return null;
  const keys = Object.keys(result);
  if (keys.length === 1 && keys[0] === 'out') return (result as Record<string, unknown>).out;
  return result;
}

function makeLogger(emit: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown) => void) {
  return {
    debug: (m: string, d?: unknown) => emit('debug', m, d),
    info: (m: string, d?: unknown) => emit('info', m, d),
    warn: (m: string, d?: unknown) => emit('warn', m, d),
    error: (m: string, d?: unknown) => emit('error', m, d),
  };
}
