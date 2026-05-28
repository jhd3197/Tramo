/**
 * VarPicker — small popover that lists {{var}} suggestions and inserts
 * one into a text input or textarea when chosen.
 *
 * Activated by typing "/" inside a text/textarea field rendered by
 * NodeInspector. The wrapper component owns the open state and the
 * cursor-anchor coordinates; this component is pure presentation.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { VarSuggestion } from './varSuggestions.js';

export interface VarPickerProps {
  suggestions: VarSuggestion[];
  /** Anchor in viewport coords (top-left of the popover). */
  anchor: { left: number; top: number };
  /** Free-text filter typed after the slash. */
  query: string;
  onPick: (s: VarSuggestion) => void;
  onClose: () => void;
}

export function VarPicker({
  suggestions,
  anchor,
  query,
  onPick,
  onClose,
}: VarPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return suggestions;
    return suggestions.filter((s) => {
      return (
        s.path.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.group.toLowerCase().includes(q)
      );
    });
  }, [suggestions, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filtered.length]);

  // Keyboard nav from the input is delegated to us via a custom event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const pick = filtered[activeIndex];
        if (pick) {
          e.preventDefault();
          onPick(pick);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeIndex, filtered, onPick, onClose]);

  // Outside-click closes.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose]);

  if (filtered.length === 0) {
    return (
      <div
        ref={rootRef}
        className="tr-var-picker tr-var-picker--empty"
        style={anchorStyle(anchor)}
      >
        No upstream variables yet — connect this step to an upstream node.
      </div>
    );
  }

  // Group suggestions by their source node for readability.
  const groups = new Map<string, VarSuggestion[]>();
  for (const s of filtered) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }

  let flatIndex = -1;
  return (
    <div ref={rootRef} className="tr-var-picker" style={anchorStyle(anchor)}>
      {Array.from(groups.entries()).map(([group, items]) => (
        <div key={group} className="tr-var-picker__group">
          <div className="tr-var-picker__group-head" title={group}>{group}</div>
          {items.map((s) => {
            flatIndex += 1;
            const isActive = flatIndex === activeIndex;
            const name = s.displayName ?? s.label;
            return (
              <button
                key={`${group}-${s.path}`}
                type="button"
                className={`tr-var-picker__item${isActive ? ' tr-var-picker__item--active' : ''}`}
                title={s.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(s);
                }}
              >
                <span className="tr-var-picker__item-body">
                  <span className="tr-var-picker__item-name">{name}</span>
                  {s.sourceLabel ? (
                    <span className="tr-var-picker__item-meta">{s.sourceLabel}</span>
                  ) : null}
                </span>
                <span className="tr-var-picker__item-path">{s.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function anchorStyle({ left, top }: { left: number; top: number }): CSSProperties {
  return {
    position: 'fixed',
    left,
    top,
    zIndex: 80,
  };
}
