/**
 * Workflow executor.
 *
 * Strategy: topo-sort the graph, run each node when its inputs are ready,
 * pipe outputs along edges to downstream input ports, emit per-node events.
 *
 * Concurrency note: v0.1 runs sequentially in topological order. This is
 * simple and right for chain-shaped flows, which is most automation. Adding
 * "run independent branches in parallel" is straightforward later (Kahn's
 * algorithm already exposes the ready-set per layer — we just sequence
 * within a layer for now).
 *
 * If-style branching: a node may return `{ true: x }` *or* `{ false: y }`
 * (not both). Downstream nodes that wired to the unfired port are skipped.
 *
 * Loops: `loop-start` / `loop-end` are a pair matched by `config.loopId`.
 * A pre-pass computes each pair's body subgraph (nodes downstream of start
 * and upstream of end). When the outer iteration reaches a loop-start, the
 * runner resolves the source array and re-executes the body once per item,
 * accumulating the value arriving at loop-end. Body nodes are then marked
 * visited so the outer iteration skips past them.
 */

import { topoSort, getIncomingEdges, getOutgoingEdges, SPEC_VERSION, buildStepSlugMap } from 'tramo-spec';
import type { WorkflowNode } from 'tramo-spec';
import type {
  ExecutionContext,
  ExecutorRegistry,
  NodeExecutionResult,
  RunEvent,
  RunOptions,
  RunResult,
  WorkflowDoc,
} from './types.js';

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
  const events: RunEvent[] = [];
  const emit = (e: RunEvent) => {
    events.push(e);
    options.onEvent?.(e);
  };

  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const signal = options.signal ?? new AbortController().signal;
  const vars: Record<string, unknown> = {};

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
    return { ok: false, nodeResults: {}, events, error: err };
  }

  /* 1. topo sort + abort on cycle */
  const topo = topoSort(doc);
  if (!topo.ok) {
    const err = topo.error ?? 'Cycle detected.';
    emit({ type: 'run-end', runId, ok: false, error: err });
    return { ok: false, nodeResults: {}, events, error: err };
  }

  /* 1b. plan loop pairs — fails the whole run on mismatch so the user sees
   *     a structural error up-front rather than a confusing mid-run skip. */
  const planResult = planLoops(doc, topo.order);
  if (!planResult.ok) {
    emit({ type: 'run-end', runId, ok: false, error: planResult.error });
    return { ok: false, nodeResults: {}, events, error: planResult.error };
  }
  const loopPlansByStart = planResult.plansByStart;
  const loopBodyIds = planResult.bodyIds;
  const loopEndIds = planResult.endIds;

  emit({ type: 'run-start', runId, nodeOrder: topo.order });

  /* 2. precompute incoming-edges map (cheap and reused) */
  const incoming = new Map<string, ReturnType<typeof getIncomingEdges>>();
  for (const nid of topo.order) incoming.set(nid, getIncomingEdges(doc, nid));

  /* 3. iterate. nodeResults[nid] = result emitted by that node. */
  const nodeResults: Record<string, NodeExecutionResult> = {};
  const erroredNodes = new Set<string>();
  const skippedReason = new Map<string, string>();
  const visited = new Set<string>();

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
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
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
        }),
      log: makeLogger((level, message, data) => {
        emit({ type: 'node-log', runId, nodeId, level, message, data });
      }),
    };

    try {
      const result = await Promise.resolve(executor.execute(ctx));
      const normalized = normalizeResult(result);
      nodeResults[nodeId] = normalized;
      recordStep(nodeId, normalized);
      emit({
        type: 'node-success',
        runId,
        nodeId,
        output: normalized,
        durationMs: Date.now() - startMs,
      });
      return true;
    } catch (err) {
      const message = (err as Error).message || String(err);
      emit({ type: 'node-error', runId, nodeId, error: message, durationMs: Date.now() - startMs });
      skippedReason.set(nodeId, `error: ${message}`);
      erroredNodes.add(nodeId);
      options.logger?.error(`[tramo] node ${nodeId} threw: ${message}`);
      return false;
    }
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
      erroredNodes.add(plan.startId);
      skippedReason.set(plan.startId, `error: ${msg}`);
      skippedReason.set(plan.endId, `paired loop-start errored`);
      for (const b of plan.body) skippedReason.set(b, `loop-start errored`);
      return;
    }
    if (!Array.isArray(items)) {
      const msg = `loop-start ${plan.loopId}: source did not resolve to an array (got ${typeof items}).`;
      emit({ type: 'node-error', runId, nodeId: plan.startId, error: msg, durationMs: 0 });
      erroredNodes.add(plan.startId);
      skippedReason.set(plan.startId, `error: ${msg}`);
      skippedReason.set(plan.endId, `paired loop-start errored`);
      for (const b of plan.body) skippedReason.set(b, `loop-start errored`);
      return;
    }

    emit({ type: 'node-start', runId, nodeId: plan.startId });
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

    emit({
      type: 'node-success',
      runId,
      nodeId: plan.startId,
      output: { out: items[items.length - 1], index: items.length - 1 },
      durationMs: 0,
    });

    // Synthesize the loop-end's result so anything downstream consumes the
    // collected/final value without needing a dedicated executor.
    const endOutput =
      plan.mode === 'last' ? { out: lastIterValue } : { out: collected };
    nodeResults[plan.endId] = endOutput;
    recordStep(plan.endId, endOutput);
    emit({ type: 'node-success', runId, nodeId: plan.endId, output: endOutput, durationMs: 0 });

    // Mark everything inside the loop as visited so the outer iteration
    // doesn't try to run them again.
    visited.add(plan.startId);
    visited.add(plan.endId);
    for (const b of plan.body) visited.add(b);
    void startNode;
  };

  for (const nodeId of topo.order) {
    if (visited.has(nodeId)) continue;
    if (signal.aborted) {
      emit({ type: 'node-skip', runId, nodeId, reason: 'run aborted' });
      skippedReason.set(nodeId, 'run aborted');
      continue;
    }

    const plan = loopPlansByStart.get(nodeId);
    if (plan) {
      await runLoop(plan);
      continue;
    }

    // A loop-end reached outside its planned run is an orphan that the
    // pre-pass should have flagged. Defensive skip just in case.
    if (loopEndIds.has(nodeId)) {
      const reason = 'orphan loop-end (no matching loop-start in plan)';
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
      visited.add(nodeId);
      continue;
    }
    // Body nodes shouldn't appear outside the loop; if they do, the body
    // membership set will have caught them in planning. Belt-and-braces:
    if (loopBodyIds.has(nodeId)) {
      const reason = 'loop body node fell through outside its loop';
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
      visited.add(nodeId);
      continue;
    }

    await executeNode(nodeId);
    visited.add(nodeId);
  }

  emit({ type: 'run-end', runId, ok: true });
  return { ok: true, nodeResults, events };
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
