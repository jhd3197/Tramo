/**
 * NodeView — the rectangle on the canvas. Two stacked parts:
 *
 *   1. A category pill above the card (e.g. "Trigger", "Action") with a
 *      Lucide icon and a soft pastel color tied to the node's category.
 *      The pill is the primary visual signal of what *kind* of step this is.
 *   2. A white card below with the node icon (brand or Lucide), the bold
 *      title, and a description line.
 *
 * When the host passes a `runStatus`, a result chip is rendered BELOW the
 * card (positioned absolute into the gap between rows), color-coded by
 * status. The chip never affects the card's bounding box so the layout
 * stays stable between runs.
 *
 * Absolute-positioned and memoized. Pure presentation — selection state,
 * click handling, and inspector wiring live in Canvas.
 */

import { memo, type CSSProperties } from 'react';
import { CATEGORY_META, NodeIcon } from './icons.js';
import { outputOffset } from './layout.js';
import { renderTitleWithVars } from './renderTitle.js';
import { NodeMenu } from './NodeMenu.js';
import { resolveOutputs, type NodeDefinition, type NodeField, type Patch, type WorkflowNode } from 'tramo-spec';

/**
 * Per-node execution state derived from the runner's event stream.
 * Hosts (the demo, or any embedder) compute this from RunEvent[] and
 * pass it through Canvas so each node card can show its own outcome.
 */
export type NodeRunStatus =
  | { status: 'running' }
  | { status: 'success'; output?: unknown; durationMs?: number }
  | { status: 'error'; error: string; durationMs?: number }
  | { status: 'skip'; reason: string };

export interface NodeViewProps {
  node: WorkflowNode;
  definition: NodeDefinition | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  onClick: () => void;
  applyPatch: (patch: Patch) => void;
  /** Last value emitted by this node on the most recent run. Used by
   *  consumers that want the bare value (e.g., the inspector); the chip
   *  itself reads `runStatus.output`. */
  lastResult?: unknown;
  /** Per-node execution status from the most recent run. When set, the
   *  card renders a small chip below it summarising the outcome. */
  runStatus?: NodeRunStatus;
}

function NodeViewImpl({
  node,
  definition,
  x,
  y,
  width,
  height,
  selected,
  onClick,
  applyPatch,
  runStatus,
}: NodeViewProps) {
  const label = node.label ?? definition?.name ?? node.type;
  const category = definition?.category;
  const catMeta = category ? CATEGORY_META[category] : undefined;
  const description = definition?.description;
  const preview = definition ? headlinePreview(node, definition) : [];

  const style: CSSProperties = {
    left: x - width / 2,
    top: y,
    width,
    height,
  };

  return (
    <div
      className={`tr-node-v2${selected ? ' tr-node-v2--selected' : ''}`}
      style={style}
      data-node-id={node.id}
      data-node-type={node.type}
    >
      {catMeta ? (
        <div
          className="tr-node-v2__pill"
          style={{ background: catMeta.bg, color: catMeta.fg }}
        >
          <catMeta.Icon size={12} strokeWidth={2.5} aria-hidden />
          <span>{catMeta.label}</span>
        </div>
      ) : null}

      <div className="tr-node-v2__card-wrap">
        <button
          type="button"
          className="tr-node-v2__card"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <span className="tr-node-v2__icon" aria-hidden>
            <NodeIcon definition={definition} size={20} />
          </span>
          <span className="tr-node-v2__titles">
            <span className="tr-node-v2__name">{renderTitleWithVars(label)}</span>
            {preview.length > 0 ? (
              <span className="tr-node-v2__preview">
                {preview.map((row) => (
                  <span key={row.key} className="tr-node-v2__preview-row">
                    <span className="tr-node-v2__preview-key">{row.label}</span>
                    <span className="tr-node-v2__preview-val" title={row.fullValue}>
                      {row.value}
                    </span>
                  </span>
                ))}
              </span>
            ) : description ? (
              <span className="tr-node-v2__desc">{renderTitleWithVars(description)}</span>
            ) : (
              <span className="tr-node-v2__type">{node.type}</span>
            )}
          </span>
        </button>
        <NodeMenu node={node} applyPatch={applyPatch} />
      </div>

      {runStatus ? <ResultChip status={runStatus} /> : null}

      {definition && (() => {
        const outs = resolveOutputs(definition, node);
        if (outs.length <= 1) return null;
        return (
          <div className="tr-node-v2__ports" aria-hidden>
            {outs.map((port) => {
              const dx = outputOffset(outs, port.key, width);
              return (
                <span
                  key={port.key}
                  className="tr-node-v2__port"
                  style={{ left: `calc(50% + ${dx}px)` }}
                  data-port={port.key}
                >
                  {port.label}
                </span>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

export const NodeView = memo(NodeViewImpl);

/* ====================================================================== */
/* ResultChip — small status pill anchored just below the node card        */
/* ====================================================================== */

function ResultChip({ status }: { status: NodeRunStatus }) {
  const { kind, label, full } = describe(status);
  return (
    <div className={`tr-node-v2__result tr-node-v2__result--${kind}`} title={full}>
      <span className="tr-node-v2__result-dot" aria-hidden />
      <span className="tr-node-v2__result-label">{label}</span>
      {status.status === 'success' && status.durationMs != null ? (
        <span className="tr-node-v2__result-meta">{status.durationMs}ms</span>
      ) : null}
      {status.status === 'error' && status.durationMs != null ? (
        <span className="tr-node-v2__result-meta">{status.durationMs}ms</span>
      ) : null}
    </div>
  );
}

interface Described {
  kind: 'running' | 'success' | 'error' | 'skip';
  /** Short text shown on the chip. */
  label: string;
  /** Full text shown in the title attribute on hover. */
  full: string;
}

function describe(status: NodeRunStatus): Described {
  switch (status.status) {
    case 'running':
      return { kind: 'running', label: 'running…', full: 'Node is currently running.' };
    case 'success':
      return {
        kind: 'success',
        label: shortPreview(status.output),
        full: fullPreview(status.output),
      };
    case 'error':
      return {
        kind: 'error',
        label: `✗ ${oneLine(status.error)}`,
        full: status.error,
      };
    case 'skip':
      return {
        kind: 'skip',
        label: `— ${oneLine(status.reason)}`,
        full: status.reason,
      };
  }
}

function shortPreview(v: unknown): string {
  const s = stringify(v);
  const flat = oneLine(s);
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

function fullPreview(v: unknown): string {
  const s = stringify(v);
  return s.length > 400 ? `${s.slice(0, 397)}…` : s;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stringify(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ====================================================================== */
/* Headline preview — pick 1-2 config fields to surface on the card        */
/* ====================================================================== */

interface PreviewRow {
  /** The field's config key (used as the React key). */
  key: string;
  /** Compact label shown to the left — derived from the field key, not the
   *  full label (which is verbose for inspector use). */
  label: string;
  /** Truncated single-line value rendered in the card. */
  value: string;
  /** Full (untruncated) value piped into the `title` attribute. */
  fullValue: string;
}

const MAX_PREVIEW_ROWS = 2;
const MAX_VALUE_CHARS = 28;

/**
 * Decide which config fields are worth showing inside the card. The aim is
 * "show enough that a glance tells you what this node is configured to do"
 * without competing with the right-rail inspector.
 *
 * Rules:
 *  - Secrets never render (we'd leak tokens onto the canvas).
 *  - Skip fields whose current value is empty / null / equals the default.
 *  - Skip structured editor types (rule, switch-cases, flow-params) — they
 *    don't summarise well in one line; the inspector is the right surface.
 *  - Cap at two rows. Field order in the definition wins ties.
 */
function headlinePreview(node: WorkflowNode, def: NodeDefinition): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const field of def.fields) {
    if (rows.length >= MAX_PREVIEW_ROWS) break;
    if (!isPreviewable(field)) continue;
    const raw = node.config[field.key];
    if (!hasSubstantiveValue(raw, field.default)) continue;
    const stringified = previewStringify(raw);
    if (!stringified) continue;
    rows.push({
      key: field.key,
      label: shortFieldLabel(field),
      value: truncate(stringified, MAX_VALUE_CHARS),
      fullValue: stringified,
    });
  }
  return rows;
}

function isPreviewable(field: NodeField): boolean {
  if (field.type === 'secret') return false;
  if (field.type === 'rule' || field.type === 'switch-cases' || field.type === 'flow-params') return false;
  return true;
}

function hasSubstantiveValue(
  value: unknown,
  defaultValue: NodeField['default'],
): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    if (typeof defaultValue === 'string' && trimmed === defaultValue.trim()) return false;
    return true;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value !== defaultValue;
  }
  // Objects / arrays — render only when explicitly populated.
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function previewStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Short label for the preview row's left column. Strips parenthesised
 *  hints and trailing helper text from the inspector label so a row reads
 *  like `to: jhd3197@...` instead of `To (comma-separated): jhd3197@...`. */
function shortFieldLabel(field: NodeField): string {
  const fromLabel = field.label.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return fromLabel || field.key;
}
