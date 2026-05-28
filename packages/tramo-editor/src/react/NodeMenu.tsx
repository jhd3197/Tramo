/**
 * NodeMenu — the ⋮ button on each node card.
 *
 * Renders a popover with:
 *   - Run after: on-success | on-error | always (radio-style).
 *   - Delete this step.
 *
 * The menu wires directly to applyPatch instead of bubbling clicks
 * through the rest of the canvas — same pattern as the insertion
 * popover. The dot button is always visible to keep the affordance
 * discoverable on a flat-looking canvas.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { MoreVertical, Trash2, AlertCircle, CheckCircle2, Infinity as InfinityIcon, Pencil } from 'lucide-react';
import type { Patch, RunAfter, WorkflowNode } from 'tramo-spec';

export interface NodeMenuProps {
  node: WorkflowNode;
  applyPatch: (patch: Patch) => void;
}

export function NodeMenu({ node, applyPatch }: NodeMenuProps) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string>(node.label ?? '');
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
      setRenaming(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renaming) {
          setRenaming(false);
          return;
        }
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, renaming]);

  useEffect(() => {
    if (!renaming) return;
    setRenameDraft(node.label ?? '');
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renaming, node.label]);

  const setRunAfter = useCallback(
    (policy: RunAfter) => {
      applyPatch({ kind: 'update-node', id: node.id, patch: { runAfter: policy } });
      setOpen(false);
    },
    [applyPatch, node.id],
  );

  const deleteNode = useCallback(() => {
    applyPatch({ kind: 'remove-node', id: node.id });
    setOpen(false);
  }, [applyPatch, node.id]);

  const commitRename = useCallback(() => {
    const trimmed = renameDraft.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next !== node.label) {
      applyPatch({ kind: 'update-node', id: node.id, patch: { label: next as string | undefined } });
    }
    setRenaming(false);
    setOpen(false);
  }, [applyPatch, node.id, node.label, renameDraft]);

  const current: RunAfter = node.runAfter ?? 'on-success';
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="tr-node-menu-btn"
        aria-label="Node actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onPointerDown={stop}
      >
        <MoreVertical size={16} strokeWidth={2.2} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          className="tr-node-menu"
          role="menu"
          style={menuStyle()}
          onClick={stop}
          onPointerDown={stop}
          onPointerMove={stop}
          onWheel={stop}
        >
          {renaming ? (
            <div className="tr-node-menu__rename">
              <div className="tr-node-menu__section">Rename step</div>
              <input
                ref={renameInputRef}
                type="text"
                className="tr-input tr-node-menu__rename-input"
                value={renameDraft}
                placeholder={node.type}
                spellCheck={false}
                onChange={(e) => setRenameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenaming(false);
                  }
                }}
              />
              <div className="tr-node-menu__rename-actions">
                <button
                  type="button"
                  className="tr-node-menu__rename-btn"
                  onClick={() => setRenaming(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="tr-node-menu__rename-btn tr-node-menu__rename-btn--primary"
                  onClick={commitRename}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                icon={<Pencil size={14} />}
                label="Rename step"
                onClick={() => setRenaming(true)}
              />
              <div className="tr-node-menu__sep" />
              <div className="tr-node-menu__section">Run after</div>
              <MenuItem
                icon={<CheckCircle2 size={14} />}
                label="Previous succeeds"
                active={current === 'on-success'}
                onClick={() => setRunAfter('on-success')}
              />
              <MenuItem
                icon={<AlertCircle size={14} />}
                label="Previous errors"
                active={current === 'on-error'}
                onClick={() => setRunAfter('on-error')}
              />
              <MenuItem
                icon={<InfinityIcon size={14} />}
                label="Always"
                active={current === 'always'}
                onClick={() => setRunAfter('always')}
              />
              <div className="tr-node-menu__sep" />
              <MenuItem
                icon={<Trash2 size={14} />}
                label="Delete this step"
                onClick={deleteNode}
                danger
              />
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

function MenuItem({
  icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  const cls = [
    'tr-node-menu__item',
    active ? 'tr-node-menu__item--active' : '',
    danger ? 'tr-node-menu__item--danger' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} role="menuitem" onClick={onClick}>
      <span className="tr-node-menu__item-icon" aria-hidden>{icon}</span>
      <span>{label}</span>
      {active ? <span className="tr-node-menu__item-check" aria-hidden>✓</span> : null}
    </button>
  );
}

function menuStyle(): CSSProperties {
  // The button sits at the top-right of the card; the menu drops down
  // anchored to the button.
  return {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    right: 0,
  };
}
