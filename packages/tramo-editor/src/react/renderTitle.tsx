/**
 * renderTitleWithVars — split a string on `{{var.path}}` placeholders and
 * render each placeholder as a gray chip (Zapier-style "data picker"
 * pill). The rest of the string renders as plain text.
 *
 * Used inside node titles + descriptions on the canvas so workflows
 * show their dataflow inline. Pure function of a string; no schema or
 * resolution — the runtime's `renderTemplate()` handles actual variable
 * substitution at execution time.
 */

import type { ReactNode } from 'react';

const VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function renderTitleWithVars(input: string): ReactNode {
  if (!input || !input.includes('{{')) return input;

  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of input.matchAll(VAR_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(input.slice(last, idx));
    out.push(
      <span key={`v${key++}`} className="tr-var-chip" data-var={m[1]}>
        <span aria-hidden className="tr-var-chip__hash">#</span>
        <span className="tr-var-chip__name">{m[1]}</span>
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < input.length) out.push(input.slice(last));
  return out;
}
