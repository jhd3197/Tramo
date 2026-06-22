/**
 * `{{path.to.field}}` interpolation + lenient JSON parsing, shared by the
 * built-in executors and the integration packs so they all interpret
 * template fields and config identically.
 */

/** Parse a string as JSON when possible; pass non-strings through; empty → undefined. */
export function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const trimmed = v.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return v;
  }
}

/**
 * `{{path.to.field}}` interpolation. Roots:
 *   - `vars.…`  → the workflow vars map
 *   - `steps.…` → per-run map of completed-node outputs (keyed by id or slug)
 *   - anything else → the immediate input value
 *
 * Falls back to the empty string when a path can't be walked — forgiving on
 * purpose so a missing field renders blank instead of throwing.
 */
export function renderTemplate(
  template: string,
  context: unknown,
  vars?: Record<string, unknown>,
  steps?: Record<string, unknown>,
): string {
  if (!template.includes('{{')) return template;
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    const segments = String(expr).split('.').map((s) => s.trim());
    let cursor: unknown;
    let path: string[];
    if (segments[0] === 'vars' && vars) {
      cursor = vars;
      path = segments.slice(1);
    } else if (segments[0] === 'steps' && steps) {
      cursor = steps;
      path = segments.slice(1);
    } else {
      cursor = context;
      path = segments;
    }
    if (path.length === 0) {
      return cursor == null ? '' : JSON.stringify(cursor);
    }
    for (const seg of path) {
      if (cursor == null) return '';
      if (typeof cursor !== 'object') return '';
      cursor = (cursor as Record<string, unknown>)[seg];
    }
    if (cursor == null) return '';
    return typeof cursor === 'string' ? cursor : JSON.stringify(cursor);
  });
}
