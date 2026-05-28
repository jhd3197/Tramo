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
          <PickerTextField
            tag="textarea"
            id={id}
            value={String(value ?? '')}
            onLocalChange={(v) => onLocalChange(v)}
            onCommit={(v) => onCommit(v)}
            rows={6}
            className="tr-input tr-input--code"
            suggestions={varSuggestions}
            insertMode="js"
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

type InsertMode = 'template' | 'js';

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
  /**
   * How to render an inserted suggestion. 'template' wraps in `{{...}}`
   * for renderTemplate fields; 'js' inserts a bare JS expression
   * (`input.foo` or `vars.NAME`) for the JS Transform / If condition.
   */
  insertMode?: InsertMode;
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
  insertMode = 'template',
}: PickerTextFieldProps) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  /**
   * Picker open-state. `null` means closed. When opened by "/" we track
   * the slash index so we can replace `/query` on pick. When opened by
   * the button we just remember the caret to insert at.
   */
  const [pickerState, setPickerState] = useState<
    | { source: 'slash'; slashAt: number; caret: number }
    | { source: 'button'; caret: number }
    | null
  >(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [query, setQuery] = useState('');

  const open = useMemo(
    () => pickerState !== null && suggestions.length > 0,
    [pickerState, suggestions],
  );

  const close = useCallback(() => {
    setPickerState(null);
    setQuery('');
  }, []);

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
      if (pickerState === null) {
        // Slash-open is disabled in JS mode — `/` is the divide operator,
        // it would be in the way. Users open the picker via the button.
        if (insertMode === 'js') return;
        const ch = next[caret - 1];
        if (ch === '/') {
          const prev = next[caret - 2];
          const ok = caret === 1 || prev === ' ' || prev === '\n' || prev === '\t';
          if (ok && suggestions.length > 0) {
            setPickerState({ source: 'slash', slashAt: caret - 1, caret });
            setQuery('');
            updateAnchorFromCaret();
          }
        }
        return;
      }
      if (pickerState.source !== 'slash') return; // button-opened picker doesn't filter via typing
      if (caret <= pickerState.slashAt) {
        close();
        return;
      }
      const segment = next.slice(pickerState.slashAt + 1, caret);
      if (segment.includes(' ') || segment.includes('\n') || segment.includes('/')) {
        close();
        return;
      }
      setQuery(segment);
    },
    [onLocalChange, pickerState, suggestions.length, updateAnchorFromCaret, close, insertMode],
  );

  const formatInsert = useCallback(
    (s: VarSuggestion): string => {
      if (insertMode === 'js') {
        // suggestions for upstream nodes have paths like `data.name`
        // (relative to `input`). Vars come in as `vars.NAME`.
        return s.path.startsWith('vars.') ? s.path : `input.${s.path}`;
      }
      return `{{${s.path}}}`;
    },
    [insertMode],
  );

  const pick = useCallback(
    (s: VarSuggestion) => {
      const el = ref.current;
      if (!el || pickerState === null) {
        close();
        return;
      }
      const insert = formatInsert(s);
      let before: string;
      let after: string;
      if (pickerState.source === 'slash') {
        const caret = el.selectionStart ?? value.length;
        before = value.slice(0, pickerState.slashAt);
        after = value.slice(caret);
      } else {
        before = value.slice(0, pickerState.caret);
        after = value.slice(pickerState.caret);
      }
      const next = before + insert + after;
      onLocalChange(next);
      onCommit(next);
      close();
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
    [close, onCommit, onLocalChange, pickerState, value, formatInsert],
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
      if (pickerState !== null) return;
      onCommit(e.target.value);
    },
    [onCommit, pickerState],
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
      e.preventDefault();
    }
  };

  const onButtonClick = useCallback(() => {
    if (pickerState !== null) {
      close();
      return;
    }
    if (suggestions.length === 0) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    setPickerState({ source: 'button', caret });
    setQuery('');
    updateAnchorFromCaret();
  }, [pickerState, close, suggestions.length, value.length, updateAnchorFromCaret]);

  return (
    <div className="tr-picker-wrap">
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
      <button
        type="button"
        className="tr-picker-btn"
        onClick={onButtonClick}
        // The mousedown→focus→blur sequence would commit the field draft
        // before our click handler runs. Suppressing focus shift keeps
        // the value stable so insertion math stays correct.
        onMouseDown={(e) => e.preventDefault()}
        disabled={suggestions.length === 0}
        title={
          suggestions.length === 0
            ? 'Connect an upstream node or add a Set Variable to use variables here.'
            : 'Insert a variable'
        }
        aria-label="Insert variable"
      >
        + var
      </button>
      {open ? (
        <VarPicker
          suggestions={suggestions}
          anchor={anchor}
          query={query}
          onPick={pick}
          onClose={close}
        />
      ) : null}
    </div>
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
