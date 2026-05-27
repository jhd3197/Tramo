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
 */

import { topoSort, getIncomingEdges } from 'tramo';
import type {
  ExecutionContext,
  ExecutorRegistry,
  NodeExecutionResult,
  RunEvent,
  RunOptions,
  RunResult,
  WorkflowDoc,
} from './types.js';

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

  /* 1. topo sort + abort on cycle */
  const topo = topoSort(doc);
  if (!topo.ok) {
    const err = topo.error ?? 'Cycle detected.';
    emit({ type: 'run-end', runId, ok: false, error: err });
    return { ok: false, nodeResults: {}, events, error: err };
  }

  emit({ type: 'run-start', runId, nodeOrder: topo.order });

  /* 2. precompute incoming-edges map (cheap and reused) */
  const incoming = new Map<string, ReturnType<typeof getIncomingEdges>>();
  for (const nid of topo.order) incoming.set(nid, getIncomingEdges(doc, nid));

  /* 3. iterate. nodeResults[nid] = result emitted by that node. */
  const nodeResults: Record<string, NodeExecutionResult> = {};
  const erroredNodes = new Set<string>();
  const skippedReason = new Map<string, string>();

  for (const nodeId of topo.order) {
    if (signal.aborted) {
      emit({ type: 'node-skip', runId, nodeId, reason: 'run aborted' });
      skippedReason.set(nodeId, 'run aborted');
      continue;
    }

    const node = doc.nodes.find((n) => n.id === nodeId)!;
    const executor = registry.get(node.type);
    if (!executor) {
      const reason = `No executor registered for type "${node.type}"`;
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
      continue;
    }

    /* Apply runAfter policy to decide whether this node runs at all,
     * before we assemble inputs. `on-success` (default) preserves the
     * original propagation behavior; `on-error` flips it; `always`
     * forces execution regardless. */
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
    // 'always' → always run; inputs may be undefined for skipped predecessors.

    if (!shouldRun) {
      const reason = policySkipReason ?? 'policy';
      emit({ type: 'node-skip', runId, nodeId, reason });
      skippedReason.set(nodeId, reason);
      continue;
    }

    /* assemble inputs from upstream results, honoring source/target port keys */
    const inputs: Record<string, unknown> = {};
    let allInputsAvailable = true;
    let inputSkipReason: string | null = null;

    for (const edge of edges) {
      const fromPort = edge.sourceHandle ?? 'out';
      const toPort = edge.targetHandle ?? 'in';
      if (skippedReason.has(edge.source)) {
        // For on-success this branch is unreachable; for on-error / always
        // we keep going with the missing input as undefined.
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
        // bare-return convenience: a non-object result implicitly maps to `out`
        value = upstream;
      } else if (runAfter === 'on-success') {
        // upstream produced a port map but not this one → branch not taken
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
      continue;
    }

    /* trigger nodes (no incoming edges) receive options.trigger on `in` */
    if (edges.length === 0 && options.trigger !== undefined) {
      inputs.in = options.trigger;
    }

    emit({ type: 'node-start', runId, nodeId });
    const start = Date.now();

    const ctx: ExecutionContext = {
      inputs,
      config: node.config,
      signal,
      node,
      runId,
      log: makeLogger((level, message, data) => {
        emit({ type: 'node-log', runId, nodeId, level, message, data });
      }),
    };

    try {
      const result = await Promise.resolve(executor.execute(ctx));
      const normalized = normalizeResult(result);
      nodeResults[nodeId] = normalized;
      emit({
        type: 'node-success',
        runId,
        nodeId,
        output: normalized,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const message = (err as Error).message || String(err);
      emit({ type: 'node-error', runId, nodeId, error: message, durationMs: Date.now() - start });
      skippedReason.set(nodeId, `error: ${message}`);
      erroredNodes.add(nodeId);
      options.logger?.error(`[tramo] node ${nodeId} threw: ${message}`);
      // continue — downstream nodes will be marked skipped due to propagation
    }
  }

  emit({ type: 'run-end', runId, ok: true });
  return { ok: true, nodeResults, events };
}

/* Convert a bare value into an `{ out: value }` map. Pass through if already shaped. */
function normalizeResult(result: NodeExecutionResult): NodeExecutionResult {
  if (result == null) return undefined;
  if (typeof result === 'object' && !Array.isArray(result)) return result;
  return { out: result };
}

function makeLogger(emit: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: unknown) => void) {
  return {
    debug: (m: string, d?: unknown) => emit('debug', m, d),
    info: (m: string, d?: unknown) => emit('info', m, d),
    warn: (m: string, d?: unknown) => emit('warn', m, d),
    error: (m: string, d?: unknown) => emit('error', m, d),
  };
}
