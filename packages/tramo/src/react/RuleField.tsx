/**
 * RuleField — visual editor for a RuleGroup (used by 'rule'-type fields).
 *
 * Two layers of state:
 *  - `draft` is the locally-editable copy of the rule tree, used for
 *    typing-friendly inputs (left expr, right literal) that we don't want
 *    to commit on every keystroke.
 *  - Structural edits (add/remove/change op/toggle combinator) commit
 *    immediately. Free-text edits commit on blur.
 *
 * The shape mirrors tramo-spec's RuleGroup / RuleCondition so AI emitters
 * can produce the same JSON the UI writes back.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  emptyRuleGroup,
  isRuleGroup,
  type RuleCombinator,
  type RuleCondition,
  type RuleGroup,
  type RuleNode,
  type RuleOp,
} from 'tramo-spec';

type Path = number[]; // path of child indices from root

const OP_GROUPS: Array<{ label: string; ops: Array<{ value: RuleOp; label: string }> }> = [
  {
    label: 'Equality',
    ops: [
      { value: '=', label: '=' },
      { value: '!=', label: '≠' },
    ],
  },
  {
    label: 'Compare',
    ops: [
      { value: '>', label: '>' },
      { value: '>=', label: '≥' },
      { value: '<', label: '<' },
      { value: '<=', label: '≤' },
    ],
  },
  {
    label: 'Text',
    ops: [
      { value: 'contains', label: 'contains' },
      { value: 'not-contains', label: 'does not contain' },
      { value: 'starts-with', label: 'starts with' },
      { value: 'ends-with', label: 'ends with' },
      { value: 'matches', label: 'matches regex' },
    ],
  },
  {
    label: 'List',
    ops: [
      { value: 'in', label: 'in' },
      { value: 'not-in', label: 'not in' },
    ],
  },
  {
    label: 'Presence',
    ops: [
      { value: 'is-empty', label: 'is empty' },
      { value: 'is-not-empty', label: 'is not empty' },
      { value: 'exists', label: 'exists' },
      { value: 'not-exists', label: 'does not exist' },
      { value: 'is-truthy', label: 'is truthy' },
      { value: 'is-falsy', label: 'is falsy' },
    ],
  },
];

const UNARY_OPS = new Set<RuleOp>([
  'is-empty',
  'is-not-empty',
  'exists',
  'not-exists',
  'is-truthy',
  'is-falsy',
]);

export interface RuleFieldProps {
  value: unknown;
  onCommit: (value: RuleGroup) => void;
}

export function RuleField({ value, onCommit }: RuleFieldProps) {
  const normalized = isRuleGroup(value) ? (value as RuleGroup) : emptyRuleGroup();
  const [draft, setDraft] = useState<RuleGroup>(normalized);

  // Re-seed when the node selection changes (parent re-uses this component).
  useEffect(() => {
    setDraft(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(normalized)]);

  const commit = useCallback(
    (next: RuleGroup) => {
      setDraft(next);
      onCommit(next);
    },
    [onCommit],
  );

  return (
    <div className="tr-rule">
      <GroupView
        group={draft}
        path={[]}
        isRoot
        onLocalChange={setDraft}
        onCommit={commit}
        root={draft}
      />
    </div>
  );
}

/* ====================================================================== */
/* GroupView                                                                */
/* ====================================================================== */

function GroupView({
  group,
  path,
  isRoot,
  root,
  onLocalChange,
  onCommit,
}: {
  group: RuleGroup;
  path: Path;
  isRoot: boolean;
  root: RuleGroup;
  onLocalChange: (next: RuleGroup) => void;
  onCommit: (next: RuleGroup) => void;
}) {
  const setCombinator = (combinator: RuleCombinator) => {
    onCommit(updateAt(root, path, (g) => ({ ...(g as RuleGroup), combinator })));
  };
  const addCondition = () => {
    const newCond: RuleCondition = { kind: 'condition', left: 'input', op: '=', right: '' };
    onCommit(
      updateAt(root, path, (g) => ({
        ...(g as RuleGroup),
        rules: [...(g as RuleGroup).rules, newCond],
      })),
    );
  };
  const addGroup = () => {
    const newGroup: RuleGroup = { kind: 'group', combinator: 'and', rules: [] };
    onCommit(
      updateAt(root, path, (g) => ({
        ...(g as RuleGroup),
        rules: [...(g as RuleGroup).rules, newGroup],
      })),
    );
  };
  const deleteSelf = () => {
    if (isRoot) return;
    onCommit(removeAt(root, path));
  };
  const toggleNot = () => {
    onCommit(updateAt(root, path, (g) => ({ ...(g as RuleGroup), not: !g.not })));
  };

  return (
    <div className={`tr-rule__group${isRoot ? ' tr-rule__group--root' : ''}`}>
      <div className="tr-rule__group-head">
        <div className="tr-rule__combinator" role="group" aria-label="Combinator">
          <button
            type="button"
            className={`tr-rule__pill${group.combinator === 'and' ? ' is-active' : ''}`}
            onClick={() => setCombinator('and')}
          >
            AND
          </button>
          <button
            type="button"
            className={`tr-rule__pill${group.combinator === 'or' ? ' is-active' : ''}`}
            onClick={() => setCombinator('or')}
          >
            OR
          </button>
        </div>
        <button
          type="button"
          className={`tr-rule__not${group.not ? ' is-active' : ''}`}
          onClick={toggleNot}
          title="Negate this group"
          aria-pressed={!!group.not}
        >
          NOT
        </button>
        <div className="tr-rule__spacer" />
        {!isRoot ? (
          <button
            type="button"
            className="tr-rule__icon-btn"
            onClick={deleteSelf}
            title="Remove group"
            aria-label="Remove group"
          >
            ×
          </button>
        ) : null}
      </div>

      <div className="tr-rule__rows">
        {group.rules.length === 0 ? (
          <div className="tr-rule__empty">
            No conditions yet — empty means always Yes.
          </div>
        ) : (
          group.rules.map((child, i) => (
            <RowView
              key={i}
              node={child}
              path={[...path, i]}
              root={root}
              onLocalChange={onLocalChange}
              onCommit={onCommit}
            />
          ))
        )}
      </div>

      <div className="tr-rule__group-actions">
        <button type="button" className="tr-rule__add-btn" onClick={addCondition}>
          + rule
        </button>
        <button type="button" className="tr-rule__add-btn" onClick={addGroup}>
          + group
        </button>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* RowView — dispatch on kind                                              */
/* ====================================================================== */

function RowView(props: {
  node: RuleNode;
  path: Path;
  root: RuleGroup;
  onLocalChange: (next: RuleGroup) => void;
  onCommit: (next: RuleGroup) => void;
}) {
  if (props.node.kind === 'group') {
    return (
      <GroupView
        group={props.node}
        path={props.path}
        isRoot={false}
        root={props.root}
        onLocalChange={props.onLocalChange}
        onCommit={props.onCommit}
      />
    );
  }
  return <ConditionView {...props} node={props.node} />;
}

/* ====================================================================== */
/* ConditionView                                                            */
/* ====================================================================== */

function ConditionView({
  node,
  path,
  root,
  onLocalChange,
  onCommit,
}: {
  node: RuleCondition;
  path: Path;
  root: RuleGroup;
  onLocalChange: (next: RuleGroup) => void;
  onCommit: (next: RuleGroup) => void;
}) {
  const patch = (fields: Partial<RuleCondition>, commitNow: boolean) => {
    const next = updateAt(root, path, (n) => ({ ...(n as RuleCondition), ...fields }));
    (commitNow ? onCommit : onLocalChange)(next);
  };

  const setOp = (op: RuleOp) => {
    // Switching to a unary op should drop `right` to avoid a stale value
    // hanging around in the JSON.
    const fields: Partial<RuleCondition> = UNARY_OPS.has(op)
      ? { op, right: undefined, rightIsExpr: false }
      : { op };
    patch(fields, true);
  };

  const toggleNot = () => patch({ not: !node.not }, true);
  const toggleRightExpr = () => patch({ rightIsExpr: !node.rightIsExpr }, true);
  const remove = () => onCommit(removeAt(root, path));

  const unary = UNARY_OPS.has(node.op);

  return (
    <div className="tr-rule__row">
      <button
        type="button"
        className={`tr-rule__not${node.not ? ' is-active' : ''}`}
        onClick={toggleNot}
        title="Negate this row"
        aria-pressed={!!node.not}
      >
        NOT
      </button>

      <input
        type="text"
        className="tr-input tr-rule__left"
        value={node.left}
        placeholder="input.user.age"
        spellCheck={false}
        onChange={(e) => patch({ left: e.target.value }, false)}
        onBlur={(e) => patch({ left: e.target.value }, true)}
      />

      <select
        className="tr-input tr-rule__op"
        value={node.op}
        onChange={(e) => setOp(e.target.value as RuleOp)}
      >
        {OP_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.ops.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {!unary ? (
        <>
          <RightInput
            value={node.right}
            isExpr={!!node.rightIsExpr}
            onLocal={(v) => patch({ right: v }, false)}
            onCommit={(v) => patch({ right: v }, true)}
          />
          <button
            type="button"
            className={`tr-rule__mode${node.rightIsExpr ? ' is-active' : ''}`}
            onClick={toggleRightExpr}
            title={node.rightIsExpr ? 'Right side: expression' : 'Right side: literal value'}
            aria-pressed={!!node.rightIsExpr}
          >
            {node.rightIsExpr ? 'fx' : 'abc'}
          </button>
        </>
      ) : (
        <div className="tr-rule__spacer" />
      )}

      <button
        type="button"
        className="tr-rule__icon-btn"
        onClick={remove}
        title="Remove condition"
        aria-label="Remove condition"
      >
        ×
      </button>
    </div>
  );
}

/* ====================================================================== */
/* RightInput — literal mode parses with JSON.parse so types are preserved */
/* ====================================================================== */

function RightInput({
  value,
  isExpr,
  onLocal,
  onCommit,
}: {
  value: unknown;
  isExpr: boolean;
  onLocal: (v: unknown) => void;
  onCommit: (v: unknown) => void;
}) {
  // Round-trip: render literal values back to their JSON form so users
  // see what they typed (and arrays stay editable as `["a","b"]`).
  const display = isExpr ? String(value ?? '') : stringifyLiteral(value);

  return (
    <input
      type="text"
      className="tr-input tr-rule__right"
      value={display}
      placeholder={isExpr ? 'vars.threshold' : 'value'}
      spellCheck={false}
      onChange={(e) => onLocal(isExpr ? e.target.value : parseLiteral(e.target.value))}
      onBlur={(e) => onCommit(isExpr ? e.target.value : parseLiteral(e.target.value))}
    />
  );
}

function stringifyLiteral(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function parseLiteral(raw: string): unknown {
  // Empty → empty string (keeps the field controllable). Users can switch
  // to expression mode if they need an explicit null.
  if (raw === '') return '';
  // Try JSON first so `18`, `true`, `["US","CA"]`, `null` keep their types.
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/* ====================================================================== */
/* Immutable tree helpers                                                   */
/* ====================================================================== */

function updateAt(
  root: RuleGroup,
  path: Path,
  updater: (n: RuleNode) => RuleNode,
): RuleGroup {
  if (path.length === 0) return updater(root) as RuleGroup;
  const [head, ...rest] = path;
  const next = { ...root, rules: root.rules.slice() };
  const child = next.rules[head];
  if (child.kind === 'group') {
    next.rules[head] = updateAt(child, rest, updater);
  } else {
    if (rest.length !== 0) return root; // path goes deeper than a leaf — no-op
    next.rules[head] = updater(child);
  }
  return next;
}

function removeAt(root: RuleGroup, path: Path): RuleGroup {
  if (path.length === 0) return root; // cannot remove the root
  const [head, ...rest] = path;
  if (rest.length === 0) {
    const rules = root.rules.slice();
    rules.splice(head, 1);
    return { ...root, rules };
  }
  const next = { ...root, rules: root.rules.slice() };
  const child = next.rules[head];
  if (child.kind === 'group') {
    next.rules[head] = removeAt(child, rest);
  }
  return next;
}
