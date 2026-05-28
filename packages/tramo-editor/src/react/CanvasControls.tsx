/**
 * CanvasControls — small floating toolbar in the canvas corner.
 *
 * Four buttons in a single row: zoom-out, zoom percentage (click to
 * reset to 100%), zoom-in, fit-to-view. Pure presentation; the parent
 * owns the view state and computes the percentage from `zoom`.
 *
 * Stops pointer / wheel events so clicking the toolbar never starts a
 * canvas pan or fires the wheel-zoom handler underneath.
 */

import { Maximize2, Minus, Plus } from 'lucide-react';
import type { SyntheticEvent } from 'react';

export interface CanvasControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFit: () => void;
  /** Disable fit when there's nothing on the canvas yet. */
  fitDisabled?: boolean;
}

export function CanvasControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  fitDisabled,
}: CanvasControlsProps) {
  const pct = Math.round(zoom * 100);
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="tr-canvas-controls"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      <button
        type="button"
        className="tr-canvas-controls__btn"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus size={14} strokeWidth={2.25} aria-hidden />
      </button>
      <button
        type="button"
        className="tr-canvas-controls__pct"
        onClick={onReset}
        aria-label={`Zoom ${pct}%, click to reset`}
        title="Reset zoom"
      >
        {pct}%
      </button>
      <button
        type="button"
        className="tr-canvas-controls__btn"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus size={14} strokeWidth={2.25} aria-hidden />
      </button>
      <button
        type="button"
        className="tr-canvas-controls__btn"
        onClick={onFit}
        disabled={fitDisabled}
        aria-label="Fit to view"
        title="Fit to view"
      >
        <Maximize2 size={14} strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  );
}
