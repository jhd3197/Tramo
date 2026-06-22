/**
 * Run history — a bounded in-memory ring of every run the host executes,
 * plus aggregate stats for the dashboard. Records are summaries (status,
 * timing, usage, pending approvals), not full event logs, so the buffer
 * stays cheap. Swap in a durable store by implementing the same shape.
 */

import type { ApprovalRequest, RunUsage } from '@tramo/runtime';

export type RunStatus = 'running' | 'completed' | 'suspended' | 'failed';
export type RunSource = 'manual' | 'webhook' | 'cron' | 'api' | 'replay';

export interface RunRecord {
  runId: string;
  workflowId: string;
  status: RunStatus;
  ok: boolean;
  source: RunSource;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  error?: string;
  usage?: RunUsage;
  pendingApprovals?: ApprovalRequest[];
  /** Redacted trigger payload (for replay + debugging). */
  trigger?: unknown;
}

export interface RunStats {
  total: number;
  completed: number;
  suspended: number;
  failed: number;
  running: number;
  /** completed / (completed + failed), 0..1; 1 when no terminal runs yet. */
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
  byWorkflow: Record<string, { runs: number; failed: number; costUsd: number }>;
}

export class RunHistory {
  private records: RunRecord[] = [];
  private index = new Map<string, RunRecord>();

  constructor(private readonly limit = 1000) {}

  put(record: RunRecord): void {
    const existing = this.index.get(record.runId);
    if (existing) {
      Object.assign(existing, record);
      return;
    }
    this.index.set(record.runId, record);
    this.records.unshift(record);
    if (this.records.length > this.limit) {
      const dropped = this.records.pop();
      if (dropped) this.index.delete(dropped.runId);
    }
  }

  get(runId: string): RunRecord | undefined {
    return this.index.get(runId);
  }

  list(opts: { limit?: number; workflowId?: string; status?: RunStatus } = {}): RunRecord[] {
    let out = this.records;
    if (opts.workflowId) out = out.filter((r) => r.workflowId === opts.workflowId);
    if (opts.status) out = out.filter((r) => r.status === opts.status);
    return out.slice(0, opts.limit ?? 100);
  }

  pendingApprovals(): Array<{ runId: string; workflowId: string; requests: ApprovalRequest[] }> {
    return this.records
      .filter((r) => r.status === 'suspended' && r.pendingApprovals && r.pendingApprovals.length > 0)
      .map((r) => ({ runId: r.runId, workflowId: r.workflowId, requests: r.pendingApprovals! }));
  }

  stats(): RunStats {
    const s: RunStats = {
      total: this.records.length,
      completed: 0,
      suspended: 0,
      failed: 0,
      running: 0,
      successRate: 1,
      totalCostUsd: 0,
      totalTokens: 0,
      byWorkflow: {},
    };
    for (const r of this.records) {
      s[r.status] += 1;
      if (r.usage) {
        s.totalCostUsd += r.usage.costUsd;
        s.totalTokens += r.usage.totalTokens;
      }
      const w = (s.byWorkflow[r.workflowId] ??= { runs: 0, failed: 0, costUsd: 0 });
      w.runs += 1;
      if (r.status === 'failed') w.failed += 1;
      if (r.usage) w.costUsd += r.usage.costUsd;
    }
    const terminal = s.completed + s.failed;
    s.successRate = terminal === 0 ? 1 : s.completed / terminal;
    s.totalCostUsd = Math.round(s.totalCostUsd * 1_000_000) / 1_000_000;
    return s;
  }
}
