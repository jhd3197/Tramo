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
  const fields = toCron(expression).trim().split(/\s+/);
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

/* ======================================================================
 * Natural-language → cron.
 *
 * Accepts phrases like "every 30 minutes", "daily at 9am", "weekdays at 5pm",
 * "every monday at 09:30", "hourly", "monthly on the 1st at midnight". If the
 * input already parses as a 5-field cron expression it's returned unchanged.
 * Returns the original string when nothing matches (so matches() then fails
 * loudly rather than silently mis-scheduling).
 * ====================================================================== */

const DOW: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4, friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export function toCron(input: string): string {
  const raw = input.trim();
  if (raw === '') return raw;
  // Already a 5-field cron? Each field must look cron-ish.
  const parts = raw.split(/\s+/);
  if (parts.length === 5 && parts.every((p) => /^[*\d/,-]+$/.test(p))) return raw;

  const s = raw.toLowerCase();
  const time = parseTime(s); // { m, h } or null
  const M = time ? String(time.m) : '0';
  const H = time ? String(time.h) : '*';

  // "every N minutes" / "every minute"
  let m = /every\s+(\d+)\s*(?:minutes?|mins?|m)\b/.exec(s);
  if (m) return `*/${m[1]} * * * *`;
  if (/\bevery\s+minute\b/.test(s)) return '* * * * *';

  // "every N hours" / "hourly"
  m = /every\s+(\d+)\s*(?:hours?|hrs?|h)\b/.exec(s);
  if (m) return `0 */${m[1]} * * *`;
  if (/\b(hourly|every\s+hour)\b/.test(s)) return '0 * * * *';

  // Day-of-week sets
  let dow = '*';
  if (/\b(weekdays?|business\s+days?|mon(day)?\s*[-–to]+\s*fri(day)?)\b/.test(s)) dow = '1-5';
  else if (/\bweekends?\b/.test(s)) dow = '0,6';
  else {
    const named = Object.keys(DOW).filter((d) => new RegExp(`\\b${d}\\b`).test(s));
    if (named.length) dow = Array.from(new Set(named.map((d) => DOW[d]))).sort((a, b) => a - b).join(',');
  }

  // Day-of-month: "on the 1st", "on the 15th"
  let dom = '*';
  const domMatch = /\bon the\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s);
  if (domMatch) dom = domMatch[1]!;
  if (/\bmonthly\b/.test(s) && dom === '*') dom = '1';

  // "daily" / "every day"
  if (/\b(daily|every\s+day)\b/.test(s)) return `${M} ${H === '*' ? '0' : H} * * *`;
  // "weekly" with a named day already captured in dow
  if (dow !== '*' || dom !== '*') return `${M} ${H === '*' ? '0' : H} ${dom} * ${dow}`;
  // Just a time, e.g. "at 9am" → daily at 9
  if (time) return `${M} ${H} * * *`;

  return raw; // unrecognised — let matches() reject it
}

/** Parse a time-of-day from a phrase: "9am", "9:30 am", "17:00", "5pm",
 *  "noon", "midnight". Returns 24h {h, m} or null. */
function parseTime(s: string): { h: number; m: number } | null {
  if (/\bnoon\b/.test(s)) return { h: 12, m: 0 };
  if (/\bmidnight\b/.test(s)) return { h: 0, m: 0 };
  const m = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(s) ?? /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
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
