/**
 * NodeView — the rectangle on the canvas. Two stacked parts:
 *
 *   1. A category pill above the card (e.g. "Trigger", "Action") with a
 *      Lucide icon and a soft pastel color tied to the node's category.
 *      The pill is the primary visual signal of what *kind* of step this is.
 *   2. A white card below with the node icon (brand or Lucide), the bold
 *      title, and a description line.
 *
 * Absolute-positioned and memoized. Pure presentation — selection state,
 * click handling, and inspector wiring live in Canvas.
 */

import { memo, type CSSProperties } from 'react';
import { CATEGORY_META, NodeIcon } from './icons.js';
import { outputOffset } from './layout.js';
import { renderTitleWithVars } from './renderTitle.js';
import { NodeMenu } from './NodeMenu.js';
import type { NodeDefinition, Patch, WorkflowNode } from 'tramo-spec';

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

      {definition && definition.outputs.length > 1 ? (
        <div className="tr-node-v2__ports" aria-hidden>
          {definition.outputs.map((port) => {
            const dx = outputOffset(definition, port.key, width);
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
      ) : null}
    </div>
  );
}

export const NodeView = memo(NodeViewImpl);
