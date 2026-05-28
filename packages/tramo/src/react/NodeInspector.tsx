/**
 * NodeInspector — config form generated from a NodeDefinition's `fields`.
 *
 * Same role as htmlstudio's BlockConfigForm: take a typed schema, render
 * the right input per field type, and emit `update-node-config` patches
 * back to the workflow.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type {
  NodeDefinition,
  NodeField,
  NodeRegistry,
  Patch,
  WorkflowDoc,
  WorkflowNode,
} from 'tramo-spec';
import type { SaveState } from './useWorkflow.js';
import { getVarSuggestions, type VarSuggestion } from './varSuggestions.js';
import { VarPicker } from './VarPicker.js';
import { RuleField } from './RuleField.js';

export interface NodeInspectorProps {
  selection: WorkflowNode | null;
  registry: NodeRegistry;
  onApply: (patch: Patch) => void;
  onClose?: () => void;
  saveState?: SaveState;
  /**
   * Whole workflow doc — only used to power the {{var}} picker. The
   * inspector itself does not mutate it.
   */
  doc?: WorkflowDoc | null;
  /** Most recent run's per-node outputs, keyed by node id. */
  runResults?: Record<string, unknown>;
}

export function NodeInspector({
  selection,
  registry,
  onApply,
  onClose,
  saveState,
  doc,
  runResults,
}: NodeInspectorProps) {
  if (!selection) {
    return (
      <div className="tr-inspector tr-inspector--empty">
        <p>Select a node to edit its configuration.</p>
      </div>
    );
  }

  const def = registry.get(selection.type);
  if (!def) {
    return (
      <div className="tr-inspector tr-inspector--empty">
        <p>Unknown node type: <code>{selection.type}</code></p>
      </div>
    );
  }

  const suggestions = doc
    ? getVarSuggestions(doc, registry, selection.id, { results: runResults })
    : [];

  return (
    <NodeInspectorBody
      key={selection.id}
      node={selection}
      def={def}
      onApply={onApply}
      onClose={onClose}
      saveState={saveState}
      varSuggestions={suggestions}
    />
  );
}

function NodeInspectorBody({
  node,
  def,
  onApply,
  onClose,
  saveState,
  varSuggestions,
}: {
  node: WorkflowNode;
  def: NodeDefinition;
  onApply: (patch: Patch) => void;
  onClose?: () => void;
  saveState?: SaveState;
  varSuggestions: VarSuggestion[];
}) {
  /**
   * Local draft so users can type freely without each keystroke firing
   * a patch. We push the draft to the doc onBlur (or on enter for short
   * inputs) — same pattern as htmlstudio's EditInspector.
   */
  const [draft, setDraft] = useState<Record<string, unknown>>(node.config);
  const [labelDraft, setLabelDraft] = useState<string>(node.label ?? '');

  useEffect(() => {
    setDraft(node.config);
  }, [node.id, node.config]);

  useEffect(() => {
    setLabelDraft(node.label ?? '');
  }, [node.id, node.label]);

  const commit = useCallback(
    (key: string, value: unknown) => {
      onApply({
        kind: 'update-node-config',
        id: node.id,
        config: { [key]: value },
      });
    },
    [node.id, onApply],
  );

  const setLocal = useCallback(
    (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value })),
    [],
  );

  const commitLabel = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      // Empty string clears back to the definition's name. We send
      // `label: undefined` so the doc drops the key on JSON serialization.
      const next = trimmed === '' ? undefined : trimmed;
      if (next === node.label) return;
      onApply({
        kind: 'update-node',
        id: node.id,
        patch: { label: next as string | undefined },
      });
    },
    [node.id, node.label, onApply],
  );

  return (
    <div className="tr-inspector">
      <div className="tr-inspector__head">
        <div className="tr-inspector__titles">
          <input
            type="text"
            className="tr-inspector__name-input"
            value={labelDraft}
            placeholder={def.name}
            aria-label="Step name"
            spellCheck={false}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={(e) => commitLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setLabelDraft(node.label ?? '');
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <div className="tr-inspector__id">{node.id}</div>
        </div>
        {onClose ? (
          <button type="button" className="tr-btn tr-btn--ghost" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>

      {def.description ? <p className="tr-inspector__desc">{def.description}</p> : null}

      <div className="tr-inspector__fields">
        {def.fields.map((f) => (
          <FieldRow
            key={f.key}
            field={f}
            value={draft[f.key] ?? f.default ?? ''}
            onLocalChange={(v) => setLocal(f.key, v)}
            onCommit={(v) => commit(f.key, v)}
            varSuggestions={varSuggestions}
          />
        ))}
      </div>

      {saveState ? <SaveBadge state={saveState} /> : null}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onLocalChange,
  onCommit,
  varSuggestions,
}: {
  field: NodeField;
  value: unknown;
  onLocalChange: (v: unknown) => void;
  onCommit: (v: unknown) => void;
  varSuggestions: VarSuggestion[];
}) {
  const id = `tr-f-${field.key}`;
  const label = (
    <label htmlFor={id} className="tr-field__label">
      {field.label}
      {field.optional ? <span className="tr-field__optional"> (optional)</span> : null}
    </label>
  );

  const help = field.help ? <div className="tr-field__help">{field.help}</div> : null;

  switch (field.type) {
    case 'textarea':
      return (
        <div className="tr-field">
          {label}
          <PickerTextField
            tag="textarea"
            id={id}
            value={String(value ?? '')}
            onLocalChange={(v) => onLocalChange(v)}
            onCommit={(v) => onCommit(v)}
            rows={3}
            className="tr-input tr-input--area"
            suggestions={varSuggestions}
          />
          {help}
        </div>
      );

    case 'code':
      return (
        <div className="tr-field">
          {label}
          <textarea
            id={id}
            className="tr-input tr-input--code"
            value={String(value ?? '')}
            rows={6}
            spellCheck={false}
            onChange={(e) => onLocalChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
          />
          {help}
        </div>
      );

    case 'rule':
      return (
        <div className="tr-field">
          {label}
          <RuleField value={value} onCommit={(v) => onCommit(v)} />
          {help}
        </div>
      );

    case 'json': {
      return (
        <div className="tr-field">
          {label}
          <textarea
            id={id}
            className="tr-input tr-input--code"
            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            rows={4}
            spellCheck={false}
            onChange={(e) => onLocalChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
          />
          {help}
        </div>
      );
    }

    case 'select':
      return (
        <div className="tr-field">
          {label}
          <select
            id={id}
            className="tr-input"
            value={String(value ?? '')}
            onChange={(e) => {
              onLocalChange(e.target.value);
              onCommit(e.target.value);
            }}
          >
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {help}
        </div>
      );

    case 'boolean':
      return (
        <div className="tr-field tr-field--row">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => {
              onLocalChange(e.target.checked);
              onCommit(e.target.checked);
            }}
          />
          {label}
          {help}
        </div>
      );

    case 'number':
      return (
        <div className="tr-field">
          {label}
          <input
            id={id}
            type="number"
            className="tr-input"
            value={value as number}
            onChange={(e) => onLocalChange(Number(e.target.value))}
            onBlur={(e) => onCommit(Number(e.target.value))}
          />
          {help}
        </div>
      );

    case 'secret':
      return (
        <div className="tr-field">
          {label}
          <input
            id={id}
            type="password"
            className="tr-input"
            value={String(value ?? '')}
            autoComplete="off"
            onChange={(e) => onLocalChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
          />
          {help}
        </div>
      );

    case 'url':
      return (
        <div className="tr-field">
          {label}
          <PickerTextField
            tag="input"
            id={id}
            type="url"
            value={String(value ?? '')}
            onLocalChange={(v) => onLocalChange(v)}
            onCommit={(v) => onCommit(v)}
            className="tr-input"
            suggestions={varSuggestions}
          />
          {help}
        </div>
      );

    case 'text':
    default:
      return (
        <div className="tr-field">
          {label}
          <PickerTextField
            tag="input"
            id={id}
            type="text"
            value={String(value ?? '')}
            onLocalChange={(v) => onLocalChange(v)}
            onCommit={(v) => onCommit(v)}
            className="tr-input"
            suggestions={varSuggestions}
          />
          {help}
        </div>
      );
  }
}

/* ====================================================================== */
/* PickerTextField — input/textarea that opens a {{var}} picker on "/"     */
/* ====================================================================== */

type PickerTextFieldProps = {
  tag: 'input' | 'textarea';
  id: string;
  value: string;
  onLocalChange: (v: string) => void;
  onCommit: (v: string) => void;
  className?: string;
  rows?: number;
  type?: string;
  suggestions: VarSuggestion[];
};

function PickerTextField({
  tag,
  id,
  value,
  onLocalChange,
  onCommit,
  className,
  rows,
  type,
  suggestions,
}: PickerTextFieldProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  /** Cursor index of the "/" that opened the picker. null when closed. */
  const [slashAt, setSlashAt] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [query, setQuery] = useState('');

  const open = useMemo(() => slashAt !== null && suggestions.length > 0, [slashAt, suggestions]);

  const close = useCallback(() => setSlashAt(null), []);

  const updateAnchorFromCaret = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Anchor below the field — caret-precise positioning would need a
    // mirror element. The field is narrow so the picker reads naturally.
    setAnchor({ left: r.left, top: r.bottom + 4 });
  }, []);

  const handleChange = useCallback(
    (next: string, caret: number) => {
      onLocalChange(next);
      if (slashAt === null) {
        // Open when the user types a "/" preceded by start or whitespace.
        const ch = next[caret - 1];
        if (ch === '/') {
          const prev = next[caret - 2];
          const ok = caret === 1 || prev === ' ' || prev === '\n' || prev === '\t';
          if (ok && suggestions.length > 0) {
            setSlashAt(caret - 1);
            setQuery('');
            updateAnchorFromCaret();
          }
        }
        return;
      }
      // Picker is open — update the query string.
      if (caret <= slashAt) {
        close();
        return;
      }
      const segment = next.slice(slashAt + 1, caret);
      // Bail out if user typed a space or another slash → close.
      if (segment.includes(' ') || segment.includes('\n') || segment.includes('/')) {
        close();
        return;
      }
      setQuery(segment);
    },
    [onLocalChange, slashAt, suggestions.length, updateAnchorFromCaret, close],
  );

  const pick = useCallback(
    (s: VarSuggestion) => {
      const el = ref.current;
      if (!el || slashAt === null) {
        close();
        return;
      }
      const caret = el.selectionStart ?? value.length;
      const before = value.slice(0, slashAt);
      const after = value.slice(caret);
      const insert = `{{${s.path}}}`;
      const next = before + insert + after;
      onLocalChange(next);
      onCommit(next);
      close();
      // Restore caret just after the inserted chip.
      requestAnimationFrame(() => {
        const pos = before.length + insert.length;
        try {
          el.focus();
          el.setSelectionRange(pos, pos);
        } catch {
          // setSelectionRange is unsupported on some input types — fine.
        }
      });
    },
    [close, onCommit, onLocalChange, slashAt, value],
  );

  const onInput = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value;
      const caret = e.target.selectionStart ?? next.length;
      handleChange(next, caret);
    },
    [handleChange],
  );

  const onBlur = useCallback(
    (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // Don't commit if the picker is intercepting the focus shift.
      if (slashAt !== null) return;
      onCommit(e.target.value);
    },
    [onCommit, slashAt],
  );

  const sharedKeyDown = (e: KeyboardEvent) => {
    if (
      open &&
      (e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === 'Tab' ||
        e.key === 'Escape')
    ) {
      // VarPicker handles these on window, but Enter in a textarea would
      // insert a newline before its preventDefault fires. Stop it here too.
      e.preventDefault();
    }
  };

  return (
    <>
      {tag === 'textarea' ? (
        <textarea
          id={id}
          ref={ref as RefObject<HTMLTextAreaElement>}
          value={value}
          rows={rows}
          className={className}
          onChange={onInput}
          onBlur={onBlur}
          onKeyDown={sharedKeyDown}
        />
      ) : (
        <input
          id={id}
          ref={ref as RefObject<HTMLInputElement>}
          value={value}
          type={type ?? 'text'}
          className={className}
          onChange={onInput}
          onBlur={onBlur}
          onKeyDown={sharedKeyDown}
        />
      )}
      {open ? (
        <VarPicker
          suggestions={suggestions}
          anchor={anchor}
          query={query}
          onPick={pick}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const label = {
    idle: '',
    pending: 'unsaved…',
    saving: 'saving…',
    saved: 'saved',
    error: `error: ${state.error}`,
  }[state.status];
  if (!label) return null;
  return <div className={`tr-save tr-save--${state.status}`}>{label}</div>;
}

export default NodeInspector;
