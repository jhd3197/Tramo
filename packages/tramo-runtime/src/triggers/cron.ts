/**
 * Cron trigger driver.
 *
 * v0.1: minimal scheduler. Supports the five-field cron syntax through a
 * tiny in-house matcher (so we don't add a dep for one feature). For
 * production use callers should swap in `node-cron` or `croner` and
 * register their own handle that simply calls `manual().fire()` on tick.
 */

import { run } from '../runner.js';
import type {
  ExecutorRegistry,
  RunOptions,
  RunResult,
  WorkflowDoc,
} from '../types.js';

export interface CronTriggerHandle {
  start: () => void;
  stop: () => void;
  /** Force a tick now (also useful for tests). */
  tick: () => Promise<RunResult[]>;
  /** Cron entries currently scheduled. */
  schedule: () => Array<{ expression: string; nodeId: string }>;
}

export function cron(
  doc: WorkflowDoc,
  registry: ExecutorRegistry,
  options: Omit<RunOptions, 'trigger'> = {},
): CronTriggerHandle {
  const cronNodes = doc.nodes.filter((n) => n.type === 'cron-trigger');
  const schedule = cronNodes.map((n) => ({
    expression: String(n.config.expression ?? '* * * * *'),
    nodeId: n.id,
  }));

  let interval: ReturnType<typeof setInterval> | null = null;
  let lastMinute = -1;

  const tick = async (): Promise<RunResult[]> => {
    const now = new Date();
    const results: RunResult[] = [];
    for (const entry of schedule) {
      if (!matches(entry.expression, now)) continue;
      results.push(
        await run(doc, registry, {
          ...options,
          trigger: { firedAt: now.toISOString(), nodeId: entry.nodeId, expression: entry.expression },
        }),
      );
    }
    return results;
  };

  return {
    start: () => {
      if (interval) return;
      // Tick on the next minute boundary; check every 15s thereafter so we
      // don't miss the minute even if event-loop latency drifts.
      interval = setInterval(() => {
        const now = new Date();
        if (now.getMinutes() === lastMinute) return;
        lastMinute = now.getMinutes();
        void tick();
      }, 15_000);
    },
    stop: () => {
      if (interval) clearInterval(interval);
      interval = null;
    },
    tick,
    schedule: () => schedule.slice(),
  };
}

/* ======================================================================
 * tiny cron matcher: supports `*`, N, N-N, N,N,N, and step (slash N).
 * fields: minute hour dayOfMonth month dayOfWeek
 * ====================================================================== */

export function matches(expression: string, when: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const m = when.getMinutes();
  const h = when.getHours();
  const dom = when.getDate();
  const mon = when.getMonth() + 1;
  const dow = when.getDay();
  return (
    matchField(fields[0]!, m, 0, 59) &&
    matchField(fields[1]!, h, 0, 23) &&
    matchField(fields[2]!, dom, 1, 31) &&
    matchField(fields[3]!, mon, 1, 12) &&
    matchField(fields[4]!, dow, 0, 6)
  );
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
  if (expr === '*') return true;
  for (const part of expr.split(',')) {
    if (part.startsWith('*/')) {
      const step = Number(part.slice(2));
      if (step > 0 && value % step === 0) return true;
      continue;
    }
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (a == null || b == null) continue;
      if (value >= a && value <= b) return true;
      continue;
    }
    const n = Number(part);
    if (!Number.isNaN(n) && n === value && n >= min && n <= max) return true;
  }
  return false;
}
