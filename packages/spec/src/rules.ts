/**
 * Rule evaluation — pure function over the RuleNode tree.
 *
 * The `if` node uses this when its `rules` field is set. Both the JS and
 * Python runtimes implement the same operator semantics; this is the
 * canonical reference. Keep them in sync.
 *
 * Empty groups evaluate to the algebraic identity: AND of zero = true,
 * OR of zero = false. So a freshly-added If with no rules takes the Yes
 * branch by default.
 */

import type { RuleGroup, RuleNode, RuleOp } from './types.js';

export interface RuleEvalEnv {
  input: unknown;
  vars: Record<string, unknown>;
  config: Record<string, unknown>;
  /** Per-run map of completed-node outputs, keyed by id and slug. Optional
   *  for back-compat — older callers that don't pass it still evaluate
   *  rules over input/vars/config. */
  steps?: Record<string, unknown>;
}

export function emptyRuleGroup(): RuleGroup {
  return { kind: 'group', combinator: 'and', rules: [] };
}

export function isRuleGroup(value: unknown): value is RuleGroup {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'group' &&
    Array.isArray((value as { rules?: unknown }).rules)
  );
}

export function evaluateRuleGroup(group: RuleGroup, env: RuleEvalEnv): boolean {
  return evaluateRuleNode(group, env);
}

function evaluateRuleNode(node: RuleNode, env: RuleEvalEnv): boolean {
  if (node.kind === 'group') {
    const results = node.rules.map((r) => evaluateRuleNode(r, env));
    const combined = node.combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
    return node.not ? !combined : combined;
  }
  const left = evalExpr(node.left, env);
  const right = node.rightIsExpr ? evalExpr(String(node.right ?? ''), env) : node.right;
  const out = applyOp(node.op, left, right);
  return node.not ? !out : out;
}

function evalExpr(expr: string, env: RuleEvalEnv): unknown {
  const src = (expr ?? '').trim();
  if (!src) return undefined;
  try {
    const fn = new Function('input', 'vars', 'steps', 'config', `return (${src});`) as (
      input: unknown,
      vars: Record<string, unknown>,
      steps: Record<string, unknown>,
      config: Record<string, unknown>,
    ) => unknown;
    return fn(env.input, env.vars, env.steps ?? {}, env.config);
  } catch {
    return undefined;
  }
}

function applyOp(op: RuleOp, left: unknown, right: unknown): boolean {
  switch (op) {
    case '=':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '>':
      return cmp(left, right) > 0;
    case '>=':
      return cmp(left, right) >= 0;
    case '<':
      return cmp(left, right) < 0;
    case '<=':
      return cmp(left, right) <= 0;
    case 'contains':
      return contains(left, right);
    case 'not-contains':
      return !contains(left, right);
    case 'starts-with':
      return typeof left === 'string' && typeof right === 'string' && left.startsWith(right);
    case 'ends-with':
      return typeof left === 'string' && typeof right === 'string' && left.endsWith(right);
    case 'matches': {
      if (typeof left !== 'string' || typeof right !== 'string') return false;
      try {
        return new RegExp(right).test(left);
      } catch {
        return false;
      }
    }
    case 'in':
      return Array.isArray(right) ? right.some((v) => looseEquals(v, left)) : false;
    case 'not-in':
      return Array.isArray(right) ? !right.some((v) => looseEquals(v, left)) : true;
    case 'is-empty':
      return isEmpty(left);
    case 'is-not-empty':
      return !isEmpty(left);
    case 'exists':
      return left !== undefined && left !== null;
    case 'not-exists':
      return left === undefined || left === null;
    case 'is-truthy':
      return Boolean(left);
    case 'is-falsy':
      return !left;
    default:
      return false;
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  // Numeric coercion when one side is a numeric string.
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof b === 'number' && typeof a === 'string') return b === Number(a);
  return false;
}

function cmp(a: unknown, b: unknown): number {
  const an = toComparable(a);
  const bn = toComparable(b);
  if (an === undefined || bn === undefined) return Number.NaN;
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

function toComparable(v: unknown): number | string | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== '' ? n : v;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'boolean') return v ? 1 : 0;
  return undefined;
}

function contains(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === 'string') return haystack.includes(String(needle ?? ''));
  if (Array.isArray(haystack)) return haystack.some((v) => looseEquals(v, needle));
  if (haystack && typeof haystack === 'object') {
    return Object.prototype.hasOwnProperty.call(haystack, String(needle));
  }
  return false;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}
