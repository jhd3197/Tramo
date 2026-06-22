/**
 * Secret redaction.
 *
 * Two layers:
 *   1. Explicit values — anything passed via `RunOptions.secrets` (typically
 *      the result of `collectSecrets(doc, registry)` from @tramo/spec) is
 *      replaced wherever it appears as a substring.
 *   2. Pattern heuristics — common token shapes (Bearer headers, `sk-…`
 *      OpenAI keys, `xoxb-…` Slack tokens, AWS keys, JWTs, …) are masked
 *      even when the runtime was never told about them.
 *
 * Redaction is applied to OBSERVABILITY surfaces only — log payloads, run
 * events, and the audit trail. It deliberately does NOT touch the live
 * `nodeResults` data flow, because a downstream node legitimately needs the
 * real token to make its API call. Callers that serialize results for
 * storage should run them through `redactValue` themselves.
 */

const MASK = '«redacted»';

/** Common secret-ish patterns, masked even without an explicit secret list. */
const PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/g,
  /\bsk-[A-Za-z0-9._\-]{16,}/g, // OpenAI / Anthropic style
  /\bxox[baprs]-[A-Za-z0-9-]{8,}/g, // Slack
  /\bghp_[A-Za-z0-9]{20,}/g, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

export interface Redactor {
  (value: unknown): unknown;
  /** Mask a plain string (used for messages). */
  text: (s: string) => string;
  /** True when this redactor will actually change anything. */
  readonly active: boolean;
}

/**
 * Build a redactor closed over a fixed secret list. Sorting the secrets
 * longest-first prevents a short secret that is a prefix of a longer one
 * from leaving a partial leak.
 */
export function createRedactor(
  secrets: string[] = [],
  options: { patterns?: boolean } = {},
): Redactor {
  const usePatterns = options.patterns !== false;
  const list = Array.from(new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 4))).sort(
    (a, b) => b.length - a.length,
  );

  const text = (s: string): string => {
    let out = s;
    for (const secret of list) {
      if (!secret) continue;
      out = out.split(secret).join(MASK);
    }
    if (usePatterns) {
      for (const re of PATTERNS) out = out.replace(re, MASK);
    }
    return out;
  };

  const visit = (value: unknown, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') return text(value);
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value as object)) return value; // cycle guard
    seen.add(value as object);
    if (Array.isArray(value)) return value.map((v) => visit(v, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Mask values of obviously-sensitive keys wholesale.
      if (/^(api[_-]?key|token|secret|password|authorization|auth[_-]?token|oauth[_-]?token|bearer)$/i.test(k)
        && typeof v === 'string' && v.length > 0) {
        out[k] = MASK;
      } else {
        out[k] = visit(v, seen);
      }
    }
    return out;
  };

  const fn = ((value: unknown) => visit(value, new WeakSet())) as Redactor;
  Object.defineProperty(fn, 'text', { value: text });
  Object.defineProperty(fn, 'active', { value: list.length > 0 || usePatterns });
  return fn;
}

/** One-shot convenience: redact a single value with a fresh redactor. */
export function redactValue(value: unknown, secrets: string[] = []): unknown {
  return createRedactor(secrets)(value);
}
