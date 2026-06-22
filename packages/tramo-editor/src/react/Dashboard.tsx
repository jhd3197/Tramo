/**
 * Dashboard — a landing overview of recent runs and aggregate health. Feed
 * it `@tramo/server`'s `/api/stats` + `/api/runs` (or any equivalent). The
 * prop types are structural so the editor stays decoupled from the server.
 */

import type { CSSProperties } from 'react';

export interface DashboardRun {
  runId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'suspended' | 'failed';
  startedAt?: number;
  durationMs?: number;
  source?: string;
  usage?: { costUsd?: number; totalTokens?: number } | null;
}

export interface DashboardStats {
  total: number;
  completed: number;
  failed: number;
  suspended: number;
  running: number;
  successRate: number;
  totalCostUsd: number;
  totalTokens: number;
}

export interface DashboardProps {
  stats?: DashboardStats;
  runs: DashboardRun[];
  onSelectRun?: (runId: string) => void;
  emptyHint?: string;
}

const wrap: CSSProperties = {
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  padding: 20,
  background: '#f8fafc',
  height: '100%',
  overflow: 'auto',
  boxSizing: 'border-box',
};

const STATUS_COLOR: Record<DashboardRun['status'], string> = {
  completed: '#16a34a',
  failed: '#dc2626',
  suspended: '#d97706',
  running: '#2563eb',
};

export function Dashboard({ stats, runs, onSelectRun, emptyHint }: DashboardProps) {
  return (
    <div style={wrap}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, color: '#0f172a' }}>Run overview</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Card label="Total runs" value={String(stats?.total ?? runs.length)} />
        <Card label="Success rate" value={`${Math.round((stats?.successRate ?? 1) * 100)}%`} accent="#16a34a" />
        <Card label="Failed" value={String(stats?.failed ?? runs.filter((r) => r.status === 'failed').length)} accent="#dc2626" />
        <Card label="Awaiting approval" value={String(stats?.suspended ?? runs.filter((r) => r.status === 'suspended').length)} accent="#d97706" />
        <Card label="Est. cost" value={fmtCost(stats?.totalCostUsd ?? sumCost(runs))} accent="#0ea5a4" />
        <Card label="Tokens" value={fmtTokens(stats?.totalTokens ?? sumTokens(runs))} />
      </div>

      <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#334155' }}>Recent runs</h3>
      {runs.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: 13, padding: 16, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 10 }}>
          {emptyHint ?? 'No runs yet. Trigger a workflow to see it here.'}
        </div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
          {runs.map((r) => (
            <button
              key={r.runId}
              type="button"
              onClick={() => onSelectRun?.(r.runId)}
              style={{
                display: 'grid',
                gridTemplateColumns: '10px 1fr auto auto',
                gap: 12,
                alignItems: 'center',
                width: '100%',
                padding: '10px 14px',
                border: 'none',
                borderTop: '1px solid #f1f5f9',
                background: 'transparent',
                cursor: onSelectRun ? 'pointer' : 'default',
                textAlign: 'left',
                fontSize: 13,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 8, background: STATUS_COLOR[r.status] }} aria-hidden />
              <span style={{ color: '#0f172a', fontWeight: 500 }}>
                {r.workflowId}
                {r.source ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {r.source}</span> : null}
              </span>
              <span style={{ color: STATUS_COLOR[r.status], fontSize: 12 }}>{r.status}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                {r.usage?.costUsd ? fmtCost(r.usage.costUsd) : ''} {r.durationMs != null ? `${r.durationMs}ms` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#fff' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? '#0f172a' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function sumCost(runs: DashboardRun[]): number {
  return runs.reduce((s, r) => s + (r.usage?.costUsd ?? 0), 0);
}
function sumTokens(runs: DashboardRun[]): number {
  return runs.reduce((s, r) => s + (r.usage?.totalTokens ?? 0), 0);
}
function fmtCost(usd: number): string {
  if (!usd) return '$0';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
