/**
 * TramoHost — the long-running execution core.
 *
 * Holds a catalog of named workflows, an executor registry, a durable
 * checkpoint store, and run history. It triggers runs (manually, by webhook,
 * or on a cron tick), records every run, persists suspended runs, and resumes
 * them when an approval decision arrives. The HTTP layer (http-server.ts) is a
 * thin shell over this — everything testable lives here.
 */

import {
  run,
  BUILTIN_EXECUTOR_REGISTRY,
  cronMatches,
  verifyWebhookSignature,
  redactValue,
  memoryCheckpointStore,
  type ExecutorRegistry,
  type RunResult,
  type RunOptions,
  type RunEvent,
  type AuditSink,
  type ApprovalDecision,
  type CheckpointStore,
  type SignaturePreset,
} from '@tramo/runtime';
import {
  collectSecrets,
  topoSort,
  BUILTIN_REGISTRY,
  type NodeRegistry,
  type WorkflowDoc,
} from '@tramo/spec';
import { RunHistory, type RunRecord, type RunSource } from './history.js';

export interface TramoHostOptions {
  /** Named workflows. The keys double as the call-flow sub-flow catalog. */
  workflows: Record<string, WorkflowDoc>;
  /** Runtime executor registry (e.g. combinePacks(...).executors). */
  executors?: ExecutorRegistry;
  /** Editor-side node registry — used to find secret-typed fields to redact. */
  nodes?: NodeRegistry;
  /** Durable checkpoint store for suspend/resume + crash recovery. */
  checkpoints?: CheckpointStore;
  /** Audit sink applied to every run. */
  audit?: AuditSink;
  /** Forwarded to every run for live event subscription. */
  onEvent?: (event: RunEvent, workflowId: string) => void;
  /** Max concurrent nodes per run. */
  concurrency?: number;
  /** Run-history buffer size. */
  historyLimit?: number;
}

export interface WebhookLikeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody?: string;
  query?: Record<string, string>;
}

export interface WebhookLikeResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

interface SuspendedRun {
  workflowId: string;
  checkpoint: NonNullable<RunResult['checkpoint']>;
  source: RunSource;
}

export class TramoHost {
  readonly workflows: Record<string, WorkflowDoc>;
  private readonly executors: ExecutorRegistry;
  private readonly nodes: NodeRegistry;
  private readonly checkpoints: CheckpointStore;
  private readonly audit?: AuditSink;
  private readonly onEvent?: (event: RunEvent, workflowId: string) => void;
  private readonly concurrency?: number;
  readonly history: RunHistory;
  private readonly suspended = new Map<string, SuspendedRun>();
  private cronTimer: ReturnType<typeof setInterval> | null = null;
  private lastCronMinute = -1;
  readonly startedAt = Date.now();

  constructor(opts: TramoHostOptions) {
    this.workflows = opts.workflows;
    this.executors = opts.executors ?? BUILTIN_EXECUTOR_REGISTRY;
    this.nodes = opts.nodes ?? BUILTIN_REGISTRY;
    this.checkpoints = opts.checkpoints ?? memoryCheckpointStore();
    this.audit = opts.audit;
    this.onEvent = opts.onEvent;
    this.concurrency = opts.concurrency;
    this.history = new RunHistory(opts.historyLimit);
  }

  listWorkflows() {
    return Object.entries(this.workflows).map(([id, doc]) => ({
      id,
      name: doc.meta?.name ?? id,
      description: doc.meta?.description,
      revision: doc.meta?.revision,
      nodes: doc.nodes.length,
      triggers: doc.nodes
        .filter((n) => n.type.startsWith('webhook-trigger') || n.type === 'cron-trigger' || n.type === 'manual-trigger')
        .map((n) => ({ id: n.id, type: n.type })),
    }));
  }

  getWorkflow(id: string): WorkflowDoc | undefined {
    return this.workflows[id];
  }

  /**
   * Replace the loaded workflow catalog in place. Mutates the existing
   * `workflows` object so every live reference (webhook routes, cron entries)
   * picks up the new set, then re-arms cron if it was running. Suspended runs
   * and history are preserved. Used by `POST /api/reload`.
   */
  reloadWorkflows(next: Record<string, WorkflowDoc>): { count: number; ids: string[] } {
    for (const key of Object.keys(this.workflows)) delete this.workflows[key];
    Object.assign(this.workflows, next);
    if (this.cronTimer) {
      this.stopCron();
      this.lastCronMinute = -1;
      this.startCron();
    }
    const ids = Object.keys(this.workflows);
    return { count: ids.length, ids };
  }

  /** Trigger a workflow run. Records history + persists if it suspends. */
  async trigger(workflowId: string, trigger?: unknown, source: RunSource = 'manual'): Promise<RunResult> {
    const doc = this.workflows[workflowId];
    if (!doc) throw new Error(`unknown workflow: ${workflowId}`);
    return this.execute(workflowId, doc, { trigger }, source);
  }

  /** Resume a suspended run with an approval decision (or a map of them). */
  async resume(runId: string, approvals: Record<string, ApprovalDecision>): Promise<RunResult> {
    const susp = this.suspended.get(runId);
    if (!susp) throw new Error(`no suspended run: ${runId}`);
    const doc = this.workflows[susp.workflowId];
    if (!doc) throw new Error(`unknown workflow: ${susp.workflowId}`);
    this.suspended.delete(runId);
    return this.execute(susp.workflowId, doc, { resumeFrom: susp.checkpoint, approvals }, susp.source);
  }

  /** Re-run a past run with the same (recorded) trigger. */
  async replay(runId: string): Promise<RunResult> {
    const rec = this.history.get(runId);
    if (!rec) throw new Error(`no such run: ${runId}`);
    return this.trigger(rec.workflowId, rec.trigger, 'replay');
  }

  private async execute(
    workflowId: string,
    doc: WorkflowDoc,
    extra: Partial<RunOptions>,
    source: RunSource,
  ): Promise<RunResult> {
    const startedAt = Date.now();
    const secrets = collectSecrets(doc, this.nodes);
    const result = await run(doc, this.executors, {
      workflows: this.workflows,
      checkpoint: (s) => this.checkpoints.save(s),
      audit: this.audit,
      secrets,
      concurrency: this.concurrency,
      onEvent: this.onEvent ? (e) => this.onEvent!(e, workflowId) : undefined,
      ...extra,
    });

    const record: RunRecord = {
      runId: result.runId,
      workflowId,
      status: result.status ?? (result.ok ? 'completed' : 'failed'),
      ok: result.ok,
      source,
      startedAt,
      endedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      error: result.error,
      usage: result.usage,
      pendingApprovals: result.pendingApprovals,
      trigger: extra.trigger !== undefined ? redactValue(extra.trigger, secrets) : undefined,
    };
    this.history.put(record);

    if (result.status === 'suspended' && result.checkpoint) {
      this.suspended.set(result.runId, { workflowId, checkpoint: result.checkpoint, source });
    }
    return result;
  }

  /* ---------------- webhooks ---------------- */

  /** Routes exposed across all loaded workflows. */
  webhookRoutes(): Array<{ method: string; path: string; workflowId: string; nodeId: string }> {
    const out: Array<{ method: string; path: string; workflowId: string; nodeId: string }> = [];
    for (const [workflowId, doc] of Object.entries(this.workflows)) {
      for (const n of doc.nodes) {
        if (n.type === 'webhook-trigger' || n.type.startsWith('webhook-trigger:')) {
          out.push({
            method: String(n.config.method ?? 'POST').toUpperCase(),
            path: String(n.config.path ?? '/'),
            workflowId,
            nodeId: n.id,
          });
        }
      }
    }
    return out;
  }

  /** Dispatch an inbound HTTP request to a matching webhook-trigger. */
  async dispatchWebhook(req: WebhookLikeRequest): Promise<WebhookLikeResponse> {
    const url = new URL(req.url, 'http://placeholder');
    const route = this.webhookRoutes().find(
      (r) => r.method === req.method.toUpperCase() && r.path === url.pathname,
    );
    if (!route) {
      return { status: 404, body: { ok: false, error: 'no matching webhook trigger' }, headers: json() };
    }
    const doc = this.workflows[route.workflowId]!;
    const node = doc.nodes.find((n) => n.id === route.nodeId)!;

    // HMAC verification when the trigger declares a secret.
    if (node.config.secret) {
      const raw = req.rawBody ?? (typeof req.body === 'string' ? req.body : undefined);
      if (raw == null) {
        return { status: 401, body: { ok: false, error: 'signature required but raw body unavailable' }, headers: json() };
      }
      const verdict = await verifyWebhookSignature(
        String(node.config.signaturePreset ?? 'github') as SignaturePreset,
        String(node.config.secret),
        raw,
        req.headers,
        String(node.config.signatureHeader ?? 'x-signature'),
      );
      if (!verdict.ok) {
        return { status: 401, body: { ok: false, error: `signature verification failed: ${verdict.reason}` }, headers: json() };
      }
    }

    const trigger = {
      body: req.body,
      headers: req.headers,
      query: req.query ?? Object.fromEntries(url.searchParams),
    };
    const result = await this.execute(route.workflowId, doc, { trigger }, 'webhook');
    if (!result.ok) {
      return { status: 500, body: { ok: false, runId: result.runId, error: result.error }, headers: json() };
    }
    if (result.status === 'suspended') {
      return { status: 202, body: { ok: true, runId: result.runId, status: 'suspended', pending: result.pendingApprovals }, headers: json() };
    }
    const shaped = shapeResponse(doc, result);
    if (shaped) return shaped;
    return { status: 200, body: { ok: true, runId: result.runId, results: result.nodeResults }, headers: json() };
  }

  /* ---------------- cron ---------------- */

  cronEntries(): Array<{ workflowId: string; nodeId: string; expression: string }> {
    const out: Array<{ workflowId: string; nodeId: string; expression: string }> = [];
    for (const [workflowId, doc] of Object.entries(this.workflows)) {
      for (const n of doc.nodes) {
        if (n.type === 'cron-trigger') {
          out.push({ workflowId, nodeId: n.id, expression: String(n.config.expression ?? '* * * * *') });
        }
      }
    }
    return out;
  }

  /** Start the cron ticker. Checks each minute boundary. */
  startCron(): void {
    if (this.cronTimer) return;
    const entries = this.cronEntries();
    if (entries.length === 0) return;
    this.cronTimer = setInterval(() => {
      const now = new Date();
      if (now.getMinutes() === this.lastCronMinute) return;
      this.lastCronMinute = now.getMinutes();
      void this.tickCron(now);
    }, 15_000);
  }

  stopCron(): void {
    if (this.cronTimer) clearInterval(this.cronTimer);
    this.cronTimer = null;
  }

  /** Fire any cron entries matching `now`. Exposed for tests. */
  async tickCron(now = new Date()): Promise<RunResult[]> {
    const results: RunResult[] = [];
    for (const entry of this.cronEntries()) {
      if (!cronMatches(entry.expression, now)) continue;
      results.push(
        await this.trigger(
          entry.workflowId,
          { firedAt: now.toISOString(), nodeId: entry.nodeId, expression: entry.expression },
          'cron',
        ),
      );
    }
    return results;
  }

  pendingApprovals() {
    return this.history.pendingApprovals();
  }
}

function json(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

/** Pick the last http-respond node's shaped response (topo order). */
function shapeResponse(doc: WorkflowDoc, result: RunResult): WebhookLikeResponse | null {
  const responders = doc.nodes.filter((n) => n.type === 'http-respond');
  if (responders.length === 0) return null;
  const topo = topoSort(doc);
  const order = topo.ok ? topo.order : doc.nodes.map((n) => n.id);
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  responders.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
  for (let i = responders.length - 1; i >= 0; i--) {
    const r = result.nodeResults[responders[i]!.id];
    if (r && typeof r === 'object' && 'response' in r) {
      const resp = (r as Record<string, unknown>).response as
        | { status?: number; body?: unknown; headers?: Record<string, string> }
        | undefined;
      if (resp && typeof resp === 'object') {
        return { status: typeof resp.status === 'number' ? resp.status : 200, body: resp.body, headers: resp.headers ?? {} };
      }
    }
  }
  return null;
}
