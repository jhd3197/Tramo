/**
 * Audit trail.
 *
 * Every node lifecycle transition can be recorded as an immutable `AuditRecord`
 * carrying who/what/when plus (redacted) inputs and outputs. Pass a sink via
 * `RunOptions.audit`; the runner stamps and feeds records through it. The
 * `jsonlAuditSink` helper appends one JSON line per record to a file for a
 * tamper-evident, append-only log (Node hosts only).
 */

import type { NodeExecutionResult } from './types.js';

export type AuditType =
  | 'run-start'
  | 'run-end'
  | 'node-start'
  | 'node-success'
  | 'node-error'
  | 'node-skip';

export interface AuditRecord {
  type: AuditType;
  runId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  nodeId?: string;
  /** Node type/kind, when known. */
  nodeType?: string;
  /** Who triggered the run — host-supplied (`RunOptions.actor`). */
  actor?: string;
  /** Attempt number (1-based) for retried nodes. */
  attempt?: number;
  durationMs?: number;
  /** Redacted inputs the node received. */
  inputs?: Record<string, unknown>;
  /** Redacted output the node produced. */
  output?: NodeExecutionResult;
  error?: string;
  reason?: string;
  ok?: boolean;
}

export type AuditSink = (record: AuditRecord) => void;

/**
 * Append-only JSONL audit sink. Each record becomes one line in `filePath`.
 * Uses a lazily-imported `node:fs` so the module stays importable in the
 * browser bundle (where you'd never call this anyway).
 *
 * Writes are serialized through a promise chain so concurrent node
 * completions can't interleave partial lines.
 */
export function jsonlAuditSink(filePath: string): AuditSink {
  let chain: Promise<void> = Promise.resolve();
  return (record: AuditRecord) => {
    chain = chain.then(async () => {
      const { appendFile } = await import('node:fs/promises');
      await appendFile(filePath, JSON.stringify(record) + '\n', 'utf8');
    }).catch((err) => {
      // Never let an audit write failure crash the run; surface to stderr.
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[tramo audit] write failed: ${(err as Error).message}\n`);
      }
    });
  };
}

/** In-memory audit sink — collects records into an array you own. */
export function arrayAuditSink(): AuditSink & { records: AuditRecord[] } {
  const records: AuditRecord[] = [];
  const sink = ((record: AuditRecord) => {
    records.push(record);
  }) as AuditSink & { records: AuditRecord[] };
  sink.records = records;
  return sink;
}
