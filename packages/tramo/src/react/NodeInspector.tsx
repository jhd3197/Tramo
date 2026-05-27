/**
 * NodeInspector — config form generated from a NodeDefinition's `fields`.
 *
 * Same role as htmlstudio's BlockConfigForm: take a typed schema, render
 * the right input per field type, and emit `update-node-config` patches
 * back to the workflow.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
  NodeDefinition,
  NodeField,
  Patch,
  WorkflowNode,
} from '../types.js';
import type { NodeRegistry } from '../nodes.js';
import type { SaveState } from './useWorkflow.js';

export interface NodeInspectorProps {
  selection: WorkflowNode | null;
  registry: NodeRegistry;
  onApply: (patch: Patch) => void;
  onClose?: () => void;
  saveState?: SaveState;
}

export function NodeInspector({
  selection,
  registry,
  onApply,
  onClose,
  saveState,
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

  return (
    <NodeInspectorBody
      key={selection.id}
      node={selection}
      def={def}
      onApply={onApply}
      onClose={onClose}
      saveState={saveState}
    />
  );
}

function NodeInspectorBody({
  node,
  def,
  onApply,
  onClose,
  saveState,
}: {
  node: WorkflowNode;
  def: NodeDefinition;
  onApply: (patch: Patch) => void;
  onClose?: () => void;
  saveState?: SaveState;
}) {
  /**
   * Local draft so users can type freely without each keystroke firing
   * a patch. We push the draft to the doc onBlur (or on enter for short
   * inputs) — same pattern as htmlstudio's EditInspector.
   */
  const [draft, setDraft] = useState<Record<string, unknown>>(node.config);

  useEffect(() => {
    setDraft(node.config);
  }, [node.id, node.config]);

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

  return (
    <div className="tr-inspector">
      <div className="tr-inspector__head">
        <div className="tr-inspector__titles">
          <div className="tr-inspector__name">{def.name}</div>
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
}: {
  field: NodeField;
  value: unknown;
  onLocalChange: (v: unknown) => void;
  onCommit: (v: unknown) => void;
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
          <textarea
            id={id}
            className="tr-input tr-input--area"
            value={String(value ?? '')}
            rows={3}
            onChange={(e) => onLocalChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
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
          <input
            id={id}
            type="url"
            className="tr-input"
            value={String(value ?? '')}
            onChange={(e) => onLocalChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
          />
          {help}
        </div>
      );

    case 'text':
    default:
      return (
        <div className="tr-field">
          {label}
          <input
            id={id}
            type="text"
            className="tr-input"
            value={String(value ?? '')}
            onChange={(e) => onLocalChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
          />
          {help}
        </div>
      );
  }
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
