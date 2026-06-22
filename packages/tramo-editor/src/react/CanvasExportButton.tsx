/**
 * CanvasExportButton — export the current workflow as SVG or PNG. Self-
 * contained; place it anywhere near the canvas. Uses exportSvg.ts helpers.
 */

import { useCallback, useState } from 'react';
import type { NodeRegistry, WorkflowDoc } from '@tramo/spec';
import { downloadWorkflowSvg, downloadWorkflowPng } from './exportSvg.js';

export interface CanvasExportButtonProps {
  doc: WorkflowDoc | null;
  registry: NodeRegistry;
  /** Base filename (no extension). Default from doc name or "workflow". */
  filename?: string;
}

export function CanvasExportButton({ doc, registry, filename }: CanvasExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const base = filename ?? slug(doc?.meta?.name) ?? 'workflow';

  const onSvg = useCallback(() => {
    if (doc) downloadWorkflowSvg(doc, registry, `${base}.svg`);
  }, [doc, registry, base]);

  const onPng = useCallback(async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await downloadWorkflowPng(doc, registry, `${base}.png`);
    } finally {
      setBusy(false);
    }
  }, [doc, registry, base]);

  return (
    <div className="tr-export" style={{ display: 'inline-flex', gap: 6 }}>
      <button type="button" className="tr-btn tr-btn--ghost" onClick={onSvg} disabled={!doc} title="Export as SVG">
        Export SVG
      </button>
      <button type="button" className="tr-btn tr-btn--ghost" onClick={onPng} disabled={!doc || busy} title="Export as PNG">
        {busy ? 'Exporting…' : 'Export PNG'}
      </button>
    </div>
  );
}

function slug(name?: string): string | undefined {
  if (!name) return undefined;
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || undefined;
}
