/**
 * SwitchCasesField — editor for a Switch node's `cases` config.
 *
 * Each case is a row containing: a label input (drives the port name on
 * the canvas), the same rule editor used by the If node, and a delete
 * button. Reordering uses ↑/↓ buttons rather than drag-and-drop to keep
 * the implementation small — most users have a handful of cases.
 *
 * The case `key` is generated once on creation and never edited, so
 * existing edges keep pointing at the right port when the label changes.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  emptySwitchCase,
  isRuleGroup,
  newSwitchCaseKey,
  type RuleGroup,
  type SwitchCase,
} from 'tramo-spec';
import { RuleField } from './RuleField.js';

export interface SwitchCasesFieldProps {
  value: unknown;
  onCommit: (value: SwitchCase[]) => void;
}

export function SwitchCasesField({ value, onCommit }: SwitchCasesFieldProps) {
  const normalized = normalizeCases(value);
  const [draft, setDraft] = useState<SwitchCase[]>(normalized);

  useEffect(() => {
    setDraft(normalizeCases(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  const commit = useCallback(
    (next: SwitchCase[]) => {
      setDraft(next);
      onCommit(next);
    },
    [onCommit],
  );

  const addCase = () => commit([...draft, emptySwitchCase(draft)]);
  const removeCase = (i: number) => commit(draft.filter((_, idx) => idx !== i));
  const moveCase = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = draft.slice();
    [next[i], next[j]] = [next[j]!, next[i]!];
    commit(next);
  };
  const setLabel = (i: number, label: string) => {
    const next = draft.slice();
    next[i] = { ...next[i]!, label };
    commit(next);
  };
  const setRules = (i: number, rules: RuleGroup) => {
    const next = draft.slice();
    next[i] = { ...next[i]!, rules };
    commit(next);
  };

  return (
    <div className="tr-switch">
      {draft.length === 0 ? (
        <div className="tr-rule__empty">
          No cases yet — every input will leave via the Default port.
        </div>
      ) : (
        draft.map((c, i) => (
          <div key={c.key} className="tr-switch__case">
            <div className="tr-switch__case-head">
              <span className="tr-switch__case-num">{i + 1}</span>
              <input
                type="text"
                className="tr-input tr-switch__case-label"
                value={c.label}
                placeholder={`Case ${i + 1}`}
                spellCheck={false}
                onChange={(e) => setLabel(i, e.target.value)}
                onBlur={() => commit(draft)}
              />
              <div className="tr-switch__case-actions">
                <button
                  type="button"
                  className="tr-rule__icon-btn"
                  onClick={() => moveCase(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  aria-label="Move case up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="tr-rule__icon-btn"
                  onClick={() => moveCase(i, 1)}
                  disabled={i === draft.length - 1}
                  title="Move down"
                  aria-label="Move case down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="tr-rule__icon-btn"
                  onClick={() => removeCase(i)}
                  title="Remove case"
                  aria-label="Remove case"
                >
                  ×
                </button>
              </div>
            </div>
            <RuleField value={c.rules} onCommit={(r) => setRules(i, r)} />
          </div>
        ))
      )}
      <button type="button" className="tr-rule__add-btn" onClick={addCase}>
        + case
      </button>
    </div>
  );
}

function normalizeCases(value: unknown): SwitchCase[] {
  if (!Array.isArray(value)) return [];
  const out: SwitchCase[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<SwitchCase>;
    const key = String(raw.key ?? '').trim() || newSwitchCaseKey(out);
    const label = String(raw.label ?? '');
    const rules = isRuleGroup(raw.rules)
      ? (raw.rules as RuleGroup)
      : { kind: 'group' as const, combinator: 'and' as const, rules: [] };
    out.push({ key, label, rules });
  }
  return out;
}
