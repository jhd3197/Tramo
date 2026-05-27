/**
 * layout — auto-compute (x, y) for every node in a WorkflowDoc.
 *
 * Algorithm (top-down vertical flow):
 *
 *   1. Compute longest-path depth for each node from any root (a node
 *      with no inbound edges). Depth becomes the *row*.
 *   2. Group nodes by row. Within a row, order by the column of the
 *      parent (or the row's traversal order for roots).
 *   3. Centre each row's nodes horizontally around a shared origin so
 *      single-column chains sit at x = 0 and branches fan out evenly.
 *
 * No state, no library dependencies. Re-runs cheaply whenever the doc
 * changes. If the doc has a cycle, we fall back to a stable insertion
 * order to avoid an infinite loop (caller can detect via topoSort).
 */

import type { NodeDefinition, WorkflowDoc } from 'tramo-spec';

export interface LayoutOptions {
  /** Width allotted per node slot, used for horizontal centering. */
  nodeWidth?: number;
  /** Height allotted per row (node height + vertical gap). */
  rowHeight?: number;
  /** Horizontal gap between sibling columns in the same row. */
  columnGap?: number;
  /** Padding from the layout's logical origin to the first node. */
  padding?: number;
}

export interface NodeLayout {
  x: number;
  y: number;
  row: number;
  col: number;
}

export interface LayoutResult {
  /** Position for every node by id. */
  positions: Map<string, NodeLayout>;
  /** Bounding box of all positioned nodes (useful for canvas sizing). */
  bounds: { width: number; height: number };
}

/**
 * Compute the x-offset (relative to the node's centre) of one of its
 * output anchors. Nodes with a single output anchor at the centre
 * (offset 0); multi-output nodes distribute their ports evenly across
 * the bottom of the card.
 *
 *   - 1 output:      [           o           ]   offset = 0
 *   - 2 outputs:     [     o           o     ]   offsets = ±nodeWidth/6
 *   - 3 outputs:     [   o      o      o     ]   offsets = ±nodeWidth/4, 0
 */
export function outputOffset(
  def: NodeDefinition | undefined,
  sourceHandle: string | undefined,
  nodeWidth: number,
): number {
  const outs = def?.outputs ?? [];
  if (outs.length <= 1) return 0;
  // Default to the first output when no handle is named on the edge.
  const handle = sourceHandle ?? outs[0]!.key;
  const idx = outs.findIndex((o) => o.key === handle);
  if (idx < 0) return 0;
  const n = outs.length;
  const spacing = nodeWidth / (n + 1);
  return (idx + 1) * spacing - nodeWidth / 2;
}

const DEFAULTS: Required<LayoutOptions> = {
  nodeWidth: 240,
  rowHeight: 140,
  columnGap: 40,
  padding: 40,
};

export function layoutWorkflow(
  doc: WorkflowDoc,
  options: LayoutOptions = {},
): LayoutResult {
  const opts = { ...DEFAULTS, ...options };
  const positions = new Map<string, NodeLayout>();

  if (doc.nodes.length === 0) {
    return { positions, bounds: { width: 0, height: 0 } };
  }

  /* --- build adjacency --- */
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of doc.nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of doc.edges) {
    if (!outgoing.has(e.source) || !incoming.has(e.target)) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  }

  /* --- compute row (depth from any root) --- */
  const row = new Map<string, number>();
  const queue: string[] = [];

  for (const n of doc.nodes) {
    if ((incoming.get(n.id) ?? []).length === 0) {
      row.set(n.id, 0);
      queue.push(n.id);
    }
  }
  // Orphan-resistance: any node not yet rowed (cycle participants,
  // disconnected sub-graphs that weren't reached) goes in row 0 too.
  for (const n of doc.nodes) {
    if (!row.has(n.id)) {
      row.set(n.id, 0);
      queue.push(n.id);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const depth = row.get(id)!;
    for (const target of outgoing.get(id) ?? []) {
      const next = depth + 1;
      if ((row.get(target) ?? -1) < next) {
        row.set(target, next);
        queue.push(target);
      }
    }
  }

  /* --- group by row --- */
  const rows = new Map<number, string[]>();
  for (const n of doc.nodes) {
    const r = row.get(n.id) ?? 0;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r)!.push(n.id);
  }

  /* --- assign columns top-down by averaging parent columns ---
   * Each child node aims to land at the same column as the centre of
   * its parents. This keeps fan-in joins centred under their parents
   * and avoids the "leftmost slot wins by insertion order" feel.
   * Order within a row by that target so the columns interleave
   * naturally; then assign integer slots left-to-right.
   */
  const colByNode = new Map<string, number>();
  let maxRow = 0;
  const sortedRows = Array.from(rows.entries()).sort(([a], [b]) => a - b);

  for (const [r, ids] of sortedRows) {
    if (r > maxRow) maxRow = r;
    // Compute target column for each node in this row.
    const targets = ids.map((id) => {
      const parents = incoming.get(id) ?? [];
      if (parents.length === 0) {
        // Root row: just preserve original ordering as the target.
        return ids.indexOf(id);
      }
      let sum = 0;
      let n = 0;
      for (const p of parents) {
        const c = colByNode.get(p);
        if (c !== undefined) {
          sum += c;
          n++;
        }
      }
      return n > 0 ? sum / n : ids.indexOf(id);
    });

    // Sort ids by target; tie-break by original doc order (stable).
    const indexed = ids.map((id, i) => ({ id, target: targets[i] ?? 0, i }));
    indexed.sort((a, b) => a.target - b.target || a.i - b.i);

    indexed.forEach((entry, col) => {
      colByNode.set(entry.id, col);
    });

    rows.set(r, indexed.map((e) => e.id));
  }

  /* --- emit positions, centering each row around x=0 --- */
  const slotWidth = opts.nodeWidth + opts.columnGap;
  let maxAbsX = 0;
  for (const [r, ids] of rows) {
    const count = ids.length;
    const rowWidth = count * opts.nodeWidth + Math.max(0, count - 1) * opts.columnGap;
    const startX = -rowWidth / 2 + opts.nodeWidth / 2;
    ids.forEach((id, col) => {
      const x = startX + col * slotWidth;
      const y = opts.padding + r * opts.rowHeight;
      positions.set(id, { x, y, row: r, col });
      const absX = Math.abs(x) + opts.nodeWidth / 2;
      if (absX > maxAbsX) maxAbsX = absX;
    });
  }

  return {
    positions,
    bounds: {
      width: maxAbsX * 2 + opts.padding * 2,
      height: opts.padding * 2 + (maxRow + 1) * opts.rowHeight,
    },
  };
}
