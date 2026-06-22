/**
 * DiffView — renders a WorkflowDiff (from diff.ts). Drop it into a modal to
 * review changes before accepting an agent edit or a version rollback.
 */

import type { CSSProperties } from 'react';
import { summarizeDiff, type WorkflowDiff, type FieldChange } from './diff.js';

export interface DiffViewProps {
  diff: WorkflowDiff;
}

const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

export function DiffView({ diff }: DiffViewProps) {
  if (diff.identical) {
    return <div style={{ color: '#64748b', fontSize: 13, padding: 12 }}>No changes.</div>;
  }
  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 10, color: '#0f172a' }}>{summarizeDiff(diff)}</div>

      <Section title="Added nodes" tone="add">
        {diff.addedNodes.map((n) => (
          <Line key={n.id} tone="add">+ {n.label ?? n.type} <span style={{ color: '#94a3b8' }}>({n.id})</span></Line>
        ))}
      </Section>

      <Section title="Removed nodes" tone="remove">
        {diff.removedNodes.map((n) => (
          <Line key={n.id} tone="remove">− {n.label ?? n.type} <span style={{ color: '#94a3b8' }}>({n.id})</span></Line>
        ))}
      </Section>

      <Section title="Changed nodes" tone="change">
        {diff.changedNodes.map((c) => (
          <div key={c.id} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{c.label ?? c.type} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({c.id})</span></div>
            {[...c.props, ...c.fields].map((f) => (
              <FieldChangeRow key={f.key} change={f} />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Edges" tone="change">
        {diff.addedEdges.map((e) => (
          <Line key={`+${e.id}`} tone="add">+ {e.source} → {e.target}{e.sourceHandle ? ` [${e.sourceHandle}]` : ''}</Line>
        ))}
        {diff.removedEdges.map((e) => (
          <Line key={`-${e.id}`} tone="remove">− {e.source} → {e.target}{e.sourceHandle ? ` [${e.sourceHandle}]` : ''}</Line>
        ))}
      </Section>

      {diff.metaChanged.length > 0 ? (
        <Section title="Workflow meta" tone="change">
          {diff.metaChanged.map((f) => (
            <FieldChangeRow key={f.key} change={f} />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function FieldChangeRow({ change }: { change: FieldChange }) {
  return (
    <div style={{ ...mono, paddingLeft: 12, marginTop: 2 }}>
      <span style={{ color: '#64748b' }}>{change.key}: </span>
      <span style={{ color: '#b91c1c', textDecoration: 'line-through' }}>{preview(change.before)}</span>
      <span style={{ color: '#94a3b8' }}> → </span>
      <span style={{ color: '#15803d' }}>{preview(change.after)}</span>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: 'add' | 'remove' | 'change'; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(arr) && arr.length === 0) return null;
  const color = tone === 'add' ? '#15803d' : tone === 'remove' ? '#b91c1c' : '#475569';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function Line({ tone, children }: { tone: 'add' | 'remove'; children: React.ReactNode }) {
  return (
    <div style={{ ...mono, color: tone === 'add' ? '#15803d' : '#b91c1c' }}>{children}</div>
  );
}

function preview(v: unknown): string {
  if (v === undefined) return '∅';
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 37)}…"` : `"${v}"`;
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 37)}…` : s;
  } catch {
    return String(v);
  }
}
