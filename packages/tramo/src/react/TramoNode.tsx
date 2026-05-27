/**
 * Default canvas node renderer. Receives a TramoNodeData payload and
 * draws a card with the definition's icon, label, ports, and a
 * left-edge color stripe based on category.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TramoNodeData } from './useWorkflow.js';

export interface TramoNodeProps extends NodeProps {
  data: TramoNodeData;
}

export function TramoNode({ data, selected }: TramoNodeProps) {
  const { node, definition } = data;
  const label = node.label ?? definition?.name ?? node.type;
  const color = definition?.color ?? '#94a3b8';
  const description = definition?.description;

  const inputs = definition?.inputs ?? [];
  const outputs = definition?.outputs ?? [];

  return (
    <div
      className={`tr-node${selected ? ' tr-node--selected' : ''}`}
      style={{ borderLeftColor: color }}
    >
      <div className="tr-node__head">
        <span className="tr-node__icon" aria-hidden>
          {iconGlyph(definition?.icon)}
        </span>
        <div className="tr-node__titles">
          <div className="tr-node__name">{label}</div>
          <div className="tr-node__type">{node.type}</div>
        </div>
      </div>
      {description ? <div className="tr-node__desc">{description}</div> : null}

      {/* Input handles, vertically stacked on the left */}
      {inputs.map((p, i) => (
        <Handle
          key={p.key}
          id={p.key}
          type="target"
          position={Position.Left}
          className="tr-handle tr-handle--in"
          style={{ top: handleTop(i, inputs.length) }}
          aria-label={`input ${p.label}`}
        />
      ))}

      {/* Output handles, on the right */}
      {outputs.map((p, i) => (
        <div
          key={p.key}
          className="tr-node__port"
          style={{ top: handleTop(i, outputs.length) - 8 }}
        >
          <span className="tr-node__port-label">{p.label}</span>
          <Handle
            id={p.key}
            type="source"
            position={Position.Right}
            className="tr-handle tr-handle--out"
            aria-label={`output ${p.label}`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Vertically stagger N handles within the 64px-tall body. Single handle
 * sits dead-center; pairs split top/bottom; etc.
 */
function handleTop(index: number, total: number): number {
  if (total <= 1) return 44;
  const spacing = 22;
  const start = 44 - ((total - 1) * spacing) / 2;
  return start + index * spacing;
}

/**
 * Map a phosphor name to a single-character glyph for the v0.1 canvas
 * cards. Real phosphor icon rendering happens in the inspector and
 * palette where the package is already a peer dep; on the canvas we
 * keep deps zero so users can render nodes without phosphor installed.
 */
function iconGlyph(name: string | undefined): string {
  if (!name) return '◆';
  const map: Record<string, string> = {
    Play: '▶',
    CloudArrowDown: '⇣',
    Clock: '◷',
    Globe: '◍',
    Note: '✎',
    Code: '{}',
    TextT: 'T',
    GitBranch: '⑂',
    ArrowsMerge: '⇢',
    Sparkle: '✦',
  };
  return map[name] ?? name.charAt(0);
}

export default TramoNode;
