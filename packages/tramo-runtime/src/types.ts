import type { WorkflowDoc, WorkflowNode } from 'tramo-spec';

/* ====================================================================== */
/* Executor surface                                                         */
/* ====================================================================== */

/**
 * Runtime execution context handed to every NodeExecutor.
 *
 * - `inputs`  : the value(s) arriving on each input port. Keys are
 *               port keys; values are whatever the upstream node returned
 *               on the matching output port. When multiple upstreams feed
 *               the same port, only the most recent wins for v0.1.
 *               (The `merge` node is how you fan-in deliberately.)
 * - `config`  : the node's typed config (from the editor's form).
 * - `signal`  : aborts the workflow when the runtime is cancelled.
 * - `log`     : structured logger — appears in the per-node execution log.
 * - `node`    : the WorkflowNode itself, for nodes that need their id/label.
 * - `runId`   : a per-execution identifier shared across nodes in this run.
 */
export interface ExecutionContext {
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  signal: AbortSignal;
  log: NodeLogger;
  node: WorkflowNode;
  runId: string;
  /**
   * Shared mutable map of workflow variables. Lives for the duration of
   * one Run and resets between runs. Mutated by the state-category nodes
   * (set-var, increment-var, append-var) and read by template/JS fields
   * via the `vars.NAME` path.
   */
  vars: Record<string, unknown>;
  /**
   * Catalog of callable workflows passed to the runner. The `call-flow`
   * executor looks up by id here. Undefined when the host didn't register
   * any sub-flows — `call-flow` then errors with a clear message.
   */
  workflows?: Record<string, WorkflowDoc>;
  /**
   * Recursive invocation hook supplied by the runner. `call-flow` uses
   * this to run a sub-flow with the assembled inputs. Pulled out into a
   * callback so executors don't need to import `run()` directly (which
   * would be a circular import).
   */
  invokeFlow?: (doc: WorkflowDoc, input: unknown) => Promise<RunResult>;
}

export interface NodeLogger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

/**
 * What a node executor returns.
 *
 * The simple case: return a plain value, and it goes out on the
 * default `out` port. For multi-port nodes (like `if`), return a map
 * of `{ portKey: value }` to address each one explicitly. Returning
 * undefined sends nothing downstream.
 */
export type NodeExecutionResult =
  | undefined
  | { [portKey: string]: unknown };

export interface NodeExecutor {
  /** Must match a NodeDefinition.id in the editor's registry. */
  id: string;
  /** The actual work. */
  execute: (ctx: ExecutionContext) => Promise<NodeExecutionResult> | NodeExecutionResult;
}

export interface ExecutorRegistry {
  list(): NodeExecutor[];
  get(id: string): NodeExecutor | undefined;
}

/* ====================================================================== */
/* Run plumbing                                                             */
/* ====================================================================== */

export interface RunOptions {
  /** Initial payload exposed to root (trigger) nodes via their `in` port. */
  trigger?: unknown;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /** Per-node log/status callback. */
  onEvent?: (event: RunEvent) => void;
  /** Overall logger (parallel to onEvent). */
  logger?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  /**
   * Catalog of sub-flows the `call-flow` node can invoke, keyed by id.
   * Hosts that want sub-flow support pass every callable workflow in
   * here; the runner threads them through to ExecutionContext.
   */
  workflows?: Record<string, WorkflowDoc>;
}

export interface RunResult {
  ok: boolean;
  /** Final results keyed by node id (whatever each node emitted). */
  nodeResults: Record<string, NodeExecutionResult>;
  /** Per-node status snapshots in execution order. */
  events: RunEvent[];
  error?: string;
}

export type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export type RunEvent =
  | { type: 'run-start'; runId: string; nodeOrder: string[] }
  | { type: 'node-start'; runId: string; nodeId: string }
  | { type: 'node-log'; runId: string; nodeId: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; data?: unknown }
  | { type: 'node-success'; runId: string; nodeId: string; output: NodeExecutionResult; durationMs: number }
  | { type: 'node-error'; runId: string; nodeId: string; error: string; durationMs: number }
  | { type: 'node-skip'; runId: string; nodeId: string; reason: string }
  | { type: 'run-end'; runId: string; ok: boolean; error?: string };

export type { WorkflowDoc };
