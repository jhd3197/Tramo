/**
 * FlowParamsField — editor for the `params` config on flow-input and
 * flow-output nodes. Each row is one named parameter: a name, a type, an
 * optional default (JSON-encoded), and a description.
 *
 * Kept deliberately spartan — no drag-reorder, no validation beyond
 * trimming. The shape is what call-flow's inspector will eventually read
 * from to render a typed form.
 */

import { useCallback, useEffect, useState } from 'react';
import { emptyFlowParam, type FlowParam, type FlowParamType } from '@tramo/spec';

const TYPES: Array<{ value: FlowParamType; label: string }> = [
  { value: 'any', label: 'any' },
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
];

export interface FlowParamsFieldProps {
  value: unknown;
  onCommit: (value: FlowParam[]) => void;
}

export function FlowParamsField({ value, onCommit }: FlowParamsFieldProps) {
  const normalized = normalize(value);
  const [draft, setDraft] = useState<FlowParam[]>(normalized);

  useEffect(() => {
    setDraft(normalize(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  const commit = useCallback(
    (next: FlowParam[]) => {
      setDraft(next);
      onCommit(next);
    },
    [onCommit],
  );

  const add = () => commit([...draft, emptyFlowParam(draft)]);
  const remove = (i: number) => commit(draft.filter((_, idx) => idx !== i));
  const patch = (i: number, fields: Partial<FlowParam>) => {
    const next = draft.slice();
    next[i] = { ...next[i]!, ...fields };
    commit(next);
  };

  return (
    <div className="tr-flow-params">
      {draft.length === 0 ? (
        <div className="tr-rule__empty">No parameters declared yet.</div>
      ) : (
        draft.map((p, i) => (
          <div key={i} className="tr-flow-params__row">
            <input
              type="text"
              className="tr-input tr-flow-params__name"
              value={p.name}
              placeholder="name"
              spellCheck={false}
              onChange={(e) => patch(i, { name: e.target.value })}
              onBlur={() => commit(draft)}
            />
            <select
              className="tr-input tr-flow-params__type"
              value={p.type}
              onChange={(e) => patch(i, { type: e.target.value as FlowParamType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              className="tr-input tr-flow-params__default"
              value={p.default ?? ''}
              placeholder="default (JSON, optional)"
              spellCheck={false}
              onChange={(e) => patch(i, { default: e.target.value })}
              onBlur={() => commit(draft)}
            />
            <button
              type="button"
              className="tr-rule__icon-btn"
              onClick={() => remove(i)}
              title="Remove parameter"
              aria-label="Remove parameter"
            >
              ×
            </button>
          </div>
        ))
      )}
      <button type="button" className="tr-rule__add-btn" onClick={add}>
        + parameter
      </button>
    </div>
  );
}

function normalize(value: unknown): FlowParam[] {
  if (!Array.isArray(value)) return [];
  const out: FlowParam[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<FlowParam>;
    const name = String(raw.name ?? '').trim();
    if (!name) continue;
    const type: FlowParamType =
      raw.type === 'string' || raw.type === 'number' || raw.type === 'boolean' ||
      raw.type === 'object' || raw.type === 'array'
        ? raw.type
        : 'any';
    const def: FlowParam = { name, type };
    if (raw.description) def.description = String(raw.description);
    if (raw.default != null) def.default = String(raw.default);
    out.push(def);
  }
  return out;
}
