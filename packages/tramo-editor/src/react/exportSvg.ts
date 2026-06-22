/**
 * Canvas export — render a WorkflowDoc to a standalone SVG string (and, in
 * the browser, download it as SVG or rasterize to PNG). The SVG is derived
 * from the same `layoutWorkflow` the canvas uses, so the exported image
 * matches what's on screen. Pure string generation — no DOM — so it's unit
 * testable and works server-side for docs/runbooks.
 */

import {
  resolveOutputs,
  type NodeRegistry,
  type WorkflowDoc,
} from '@tramo/spec';
import { layoutWorkflow, outputOffset } from './layout.js';

export interface SvgExportOptions {
  registry?: NodeRegistry;
  nodeWidth?: number;
  nodeHeight?: number;
  /** Background fill. Default the mint canvas tone. */
  background?: string;
  padding?: number;
  /** Title rendered top-left. Defaults to doc.meta.name. */
  title?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  trigger: '#10b981',
  action: '#3b82f6',
  transform: '#a855f7',
  logic: '#f59e0b',
  state: '#0ea5a4',
  ai: '#ec4899',
  io: '#64748b',
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function workflowToSvg(doc: WorkflowDoc, options: SvgExportOptions = {}): string {
  const nodeWidth = options.nodeWidth ?? 220;
  const nodeHeight = options.nodeHeight ?? 64;
  const padding = options.padding ?? 48;
  const background = options.background ?? '#f3f7f4';
  const registry = options.registry;

  const layout = layoutWorkflow(doc, { registry, nodeWidth });
  const positions = layout.positions;

  // Layout x is centered around 0; shift everything into positive space.
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x - nodeWidth / 2);
    maxX = Math.max(maxX, p.x + nodeWidth / 2);
    maxY = Math.max(maxY, p.y + nodeHeight);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = nodeWidth;
    maxY = nodeHeight;
  }
  const offsetX = padding - minX;
  const width = Math.ceil(maxX - minX + padding * 2);
  const height = Math.ceil(maxY + padding * 2);

  const at = (id: string) => {
    const p = positions.get(id)!;
    return { x: p.x + offsetX, y: p.y + padding };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${background}"/>`);

  const title = options.title ?? doc.meta?.name;
  if (title) {
    parts.push(`<text x="${padding}" y="${padding - 18}" font-size="16" font-weight="600" fill="#0f172a">${esc(title)}</text>`);
  }

  // Edges (orthogonal elbows), drawn under nodes.
  for (const edge of doc.edges) {
    if (!positions.has(edge.source) || !positions.has(edge.target)) continue;
    const s = at(edge.source);
    const t = at(edge.target);
    const srcNode = doc.nodes.find((n) => n.id === edge.source);
    const def = registry?.get(srcNode?.type ?? '');
    const outs = def && srcNode ? resolveOutputs(def, srcNode) : [];
    const dx = outs.length > 1 ? outputOffset(outs, edge.sourceHandle, nodeWidth) : 0;
    const sx = s.x + dx;
    const sy = s.y + nodeHeight;
    const tx = t.x;
    const ty = t.y;
    const midY = (sy + ty) / 2;
    parts.push(
      `<path d="M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`,
    );
    // Arrowhead.
    parts.push(`<path d="M ${tx - 4} ${ty - 6} L ${tx} ${ty} L ${tx + 4} ${ty - 6}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`);
  }

  // Nodes.
  for (const node of doc.nodes) {
    const p = at(node.id);
    const def = registry?.get(node.type);
    const color = def?.color ?? CATEGORY_COLORS[def?.category ?? 'io'] ?? '#64748b';
    const left = p.x - nodeWidth / 2;
    const label = node.label ?? def?.name ?? node.type;
    parts.push(`<g>`);
    parts.push(`<rect x="${left}" y="${p.y}" rx="10" ry="10" width="${nodeWidth}" height="${nodeHeight}" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>`);
    parts.push(`<rect x="${left}" y="${p.y}" rx="10" ry="10" width="6" height="${nodeHeight}" fill="${color}"/>`);
    parts.push(`<text x="${left + 18}" y="${p.y + 26}" font-size="13" font-weight="600" fill="#0f172a">${esc(truncate(label, 26))}</text>`);
    if (def) {
      parts.push(`<text x="${left + 18}" y="${p.y + 45}" font-size="11" fill="#64748b">${esc(truncate(def.category, 30))}</text>`);
    }
    if (node.sensitive || node.requiredRole) {
      parts.push(`<text x="${left + nodeWidth - 14}" y="${p.y + 22}" font-size="12" text-anchor="end" fill="#b45309">🔒</text>`);
    }
    parts.push(`</g>`);
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ---------------- browser download helpers ---------------- */

/** Trigger a download of the workflow as an .svg file (browser only). */
export function downloadWorkflowSvg(doc: WorkflowDoc, registry: NodeRegistry, filename = 'workflow.svg'): void {
  const svg = workflowToSvg(doc, { registry });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  triggerDownload(URL.createObjectURL(blob), filename);
}

/**
 * Rasterize the workflow SVG to a PNG and download it (browser only).
 * Resolves once the PNG has been generated.
 */
export async function downloadWorkflowPng(
  doc: WorkflowDoc,
  registry: NodeRegistry,
  filename = 'workflow.png',
  scale = 2,
): Promise<void> {
  const svg = workflowToSvg(doc, { registry });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('failed to load SVG for rasterization'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const cx = canvas.getContext('2d');
    if (!cx) throw new Error('2d canvas context unavailable');
    cx.scale(scale, scale);
    cx.drawImage(img, 0, 0);
    const pngUrl = canvas.toDataURL('image/png');
    triggerDownload(pngUrl, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
