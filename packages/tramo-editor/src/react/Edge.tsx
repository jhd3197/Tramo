/**
 * Edge — one orthogonal-elbow path between a source-node bottom anchor
 * and a target-node top anchor. Pure SVG, deterministic, no router.
 *
 * Path shape: down from source → across at mid-Y → down to target.
 *
 *     source ╶┐
 *             │
 *             └──┐   (or straight when x1 === x2)
 *                │
 *                └─ target
 */

import type { CSSProperties } from 'react';

export interface EdgeProps {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** When true, mid-Y bends are corner-rounded. */
  rounded?: boolean;
  /** Stroke color. Defaults to a neutral mid-tone. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

export function Edge({
  id,
  x1,
  y1,
  x2,
  y2,
  rounded = true,
  color,
  className,
  style,
}: EdgeProps) {
  const d = buildPath(x1, y1, x2, y2, rounded);
  return (
    <path
      d={d}
      data-edge-id={id}
      fill="none"
      stroke={color ?? 'var(--tr-edge, #cbd5e1)'}
      strokeWidth={2}
      className={className}
      style={style}
    />
  );
}

function buildPath(x1: number, y1: number, x2: number, y2: number, rounded: boolean): string {
  // Straight vertical — single column, no bend needed.
  if (Math.abs(x1 - x2) < 0.5) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midY = y1 + (y2 - y1) / 2;
  if (!rounded) {
    return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  }
  // Rounded corners: at each bend, leave room for an arc of radius R.
  const R = Math.min(12, Math.abs(midY - y1), Math.abs(x2 - x1) / 2);
  const dir = x2 > x1 ? 1 : -1;
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${midY - R}`,
    `Q ${x1} ${midY} ${x1 + R * dir} ${midY}`,
    `L ${x2 - R * dir} ${midY}`,
    `Q ${x2} ${midY} ${x2} ${midY + R}`,
    `L ${x2} ${y2}`,
  ].join(' ');
}
