import type { WorkflowDoc, WorkflowNode } from '@tramo/spec';
import type { Logger } from './logging.js';
import type { AuditSink } from './audit.js';

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
   * Per-run map of every completed upstream node's emitted value, keyed
   * by BOTH the node's id and its derived slug (so `{{steps.fetch_user.x}}`
   * and `{{steps.n_abc.x}}` both work). Templates and JS bindings read
   * from this to address nodes beyond the immediate upstream.
   *
   * Values are the "natural" output: a single-port emitter shows up bare;
   * a multi-port emitter (e.g. `if`) shows up as `{ true|false: ... }`.
   * Empty on the first node of a run.
   */
  steps: Record<string, unknown>;
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
  /**
   * Overall logger (parallel to onEvent). `console` satisfies this, as does
   * any structured `Logger` built via `createLogger` / `createJsonLogger`.
   */
  logger?: Logger;
  /**
   * Catalog of sub-flows the `call-flow` node can invoke, keyed by id.
   * Hosts that want sub-flow support pass every callable workflow in
   * here; the runner threads them through to ExecutionContext.
   */
  workflows?: Record<string, WorkflowDoc>;
  /**
   * Maximum number of nodes to execute concurrently within a topological
   * layer. Independent branches at the same depth run in parallel up to this
   * cap. `1` forces the legacy fully-sequential behaviour. Defaults to
   * `Infinity` (run an entire ready-layer at once).
   */
  concurrency?: number;
  /**
   * Immutable audit sink. Receives a record for every node lifecycle
   * transition with redacted inputs/outputs. See `jsonlAuditSink`.
   */
  audit?: AuditSink;
  /** Who triggered this run — stamped onto audit records. */
  actor?: string;
  /**
   * Secret values to scrub from logs, events, and the audit trail. Pass the
   * result of `collectSecrets(doc, nodeRegistry)` plus any host secrets.
   */
  secrets?: string[];
  /**
   * Redact secrets and common token patterns from observability surfaces.
   * Defaults to `true`. The live `nodeResults` data flow is never altered.
   */
  redact?: boolean;
  /**
   * Roles the current actor holds. A node with `requiredRole` set is skipped
   * (with a clear reason) unless its role is present here. Undefined disables
   * role checks entirely (everything runs).
   */
  roles?: string[];
  /**
   * Resume a previously-checkpointed run. Supplied by the persistence layer
   * (`@tramo/runtime` checkpoint store); pre-seeds completed node results so
   * the scheduler skips finished work. See `runner` resume support.
   */
  resumeFrom?: ResumeState;
  /** Persist progress after each node so a crashed run can resume. */
  checkpoint?: (state: ResumeState) => void | Promise<void>;
}

/**
 * Snapshot of a partially-completed run, enough to resume it. `nodeResults`
 * are the outputs of every node that finished before the checkpoint; the
 * scheduler replays them instead of re-executing.
 */
export interface ResumeState {
  runId: string;
  /** Completed node outputs, keyed by node id. */
  nodeResults: Record<string, NodeExecutionResult>;
  /** Node ids that errored. */
  errored: string[];
  /** Node ids that were skipped, with their reason. */
  skipped: Record<string, string>;
  /** Workflow variables captured at checkpoint time. */
  vars: Record<string, unknown>;
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
