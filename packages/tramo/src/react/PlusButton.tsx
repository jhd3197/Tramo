/**
 * PlusButton — the dashed `+` chip that appears at the midpoint of an
 * edge (or below a leaf node). Clicking it opens a popover with the
 * node palette filtered to "what can follow this anchor."
 *
 * Pure presentation: the parent decides where to render it (via the
 * absolute `x` / `y` coordinates in canvas space) and what to do when
 * `onClick` fires.
 */

import type { CSSProperties } from 'react';

export interface PlusButtonProps {
  x: number;
  y: number;
  onClick: () => void;
  /** Optional aria label override. */
  label?: string;
  /** Diameter in px. Default 24. */
  size?: number;
}

export function PlusButton({ x, y, onClick, label = 'Add node', size = 24 }: PlusButtonProps) {
  const style: CSSProperties = {
    left: x - size / 2,
    top: y - size / 2,
    width: size,
    height: size,
  };
  return (
    <button
      type="button"
      className="tr-plus"
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
    >
      <span aria-hidden>+</span>
    </button>
  );
}
