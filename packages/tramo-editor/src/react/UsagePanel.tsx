/**
 * UsagePanel — token + cost summary for a run. Feed it `result.usage` from
 * @tramo/runtime. Structural prop types keep the editor free of a runtime
 * dependency.
 */

import type { CSSProperties } from 'react';

export interface UsageLike {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  byModel?: Record<string, { inputTokens?: number; outputTokens?: number; costUsd?: number }>;
  byNode?: Record<string, { inputTokens?: number; outputTokens?: number; costUsd?: number; model?: string }>;
}

export interface UsagePanelProps {
  usage?: UsageLike | null;
  title?: string;
}

const card: CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: 14,
  background: '#fff',
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};

function fmtCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function UsagePanel({ usage, title = 'Usage' }: UsagePanelProps) {
  if (!usage) {
    return (
      <div style={{ ...card, color: '#94a3b8', fontSize: 13 }}>No token usage recorded for this run.</div>
    );
  }
  return (
    <div style={card}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
        <Stat label="Cost" value={fmtCost(usage.costUsd)} accent="#0ea5a4" />
        <Stat label="Tokens" value={fmtTokens(usage.totalTokens)} />
        <Stat label="In" value={fmtTokens(usage.inputTokens)} muted />
        <Stat label="Out" value={fmtTokens(usage.outputTokens)} muted />
      </div>
      {usage.byModel && Object.keys(usage.byModel).length > 0 ? (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
              <th style={{ fontWeight: 500, padding: '2px 0' }}>Model</th>
              <th style={{ fontWeight: 500, textAlign: 'right' }}>Tokens</th>
              <th style={{ fontWeight: 500, textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(usage.byModel).map(([model, u]) => (
              <tr key={model} style={{ borderTop: '1px solid #f1f5f9' }}>
                <td style={{ padding: '4px 0', color: '#334155' }}>{model}</td>
                <td style={{ textAlign: 'right', color: '#64748b' }}>
                  {fmtTokens((u.inputTokens ?? 0) + (u.outputTokens ?? 0))}
                </td>
                <td style={{ textAlign: 'right', color: '#0ea5a4' }}>{fmtCost(u.costUsd ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function Stat({ label, value, accent, muted }: { label: string; value: string; accent?: string; muted?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent ?? (muted ? '#94a3b8' : '#0f172a') }}>{value}</div>
      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}
