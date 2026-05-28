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
import { resolveOutputs, type NodeDefinition, type Patch, type WorkflowNode } from 'tramo-spec';

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
            {description ? (
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
