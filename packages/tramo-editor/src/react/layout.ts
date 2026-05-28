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

import { resolveOutputs, type NodeDefinition, type NodePort, type NodeRegistry, type WorkflowDoc, type WorkflowNode } from 'tramo-spec';

export interface LayoutOptions {
  /** Width allotted per node slot, used for horizontal centering. */
  nodeWidth?: number;
  /** Base height allotted per row (node height + vertical gap). */
  rowHeight?: number;
  /**
   * Extra vertical gap added below any row that contains a node with
   * more than one output port. The port labels, leaf-+ buttons, and
   * between-+ buttons for branchy nodes share the gap below the card;
   * without extra room the cluster reads as cramped. Defaults to 48px.
   */
  multiOutputExtraGap?: number;
  /** Horizontal gap between sibling columns in the same row. */
  columnGap?: number;
  /** Padding from the layout's logical origin to the first node. */
  padding?: number;
  /**
   * Optional node registry. When provided, the layout can detect
   * multi-output rows (for extra vertical spacing). Without it, all
   * rows use the base height.
   */
  registry?: NodeRegistry;
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
 * 70% of the card width — wide enough that port labels and + buttons
 * don't crowd each other, narrow enough that the anchors stay within
 * the card and the leaf-+ buttons don't poke past its left/right edges.
 *
 *   - 1 output:      offset = 0
 *   - 2 outputs:     offsets = ±nodeWidth · 0.35
 *   - 3 outputs:     offsets = ±nodeWidth · 0.35, 0
 *   - N outputs:     evenly distributed across nodeWidth · 0.7
 */
const PORT_SPREAD = 0.7;

export function outputOffset(
  defOrOutputs: NodeDefinition | NodePort[] | undefined,
  sourceHandle: string | undefined,
  nodeWidth: number,
): number {
  const outs: NodePort[] = Array.isArray(defOrOutputs)
    ? defOrOutputs
    : (defOrOutputs?.outputs ?? []);
  if (outs.length <= 1) return 0;
  // Default to the first output when no handle is named on the edge.
  const handle = sourceHandle ?? outs[0]!.key;
  const idx = outs.findIndex((o) => o.key === handle);
  if (idx < 0) return 0;
  const n = outs.length;
  const spread = nodeWidth * PORT_SPREAD;
  const step = spread / (n - 1);
  return -spread / 2 + idx * step;
}

/**
 * Resolved outputs for a node — convenience wrapper around the spec's
 * `resolveOutputs` so editor code can drop in a `(def, node)` lookup
 * anywhere it used to read `def.outputs`. The runtime doesn't need this:
 * executors emit port keys directly.
 */
export function nodeOutputs(
  def: NodeDefinition | undefined,
  node: WorkflowNode | undefined,
): NodePort[] {
  if (!def) return [];
  return resolveOutputs(def, node);
}

interface ResolvedOptions {
  nodeWidth: number;
  rowHeight: number;
  multiOutputExtraGap: number;
  columnGap: number;
  padding: number;
  registry: NodeRegistry | undefined;
}

const DEFAULTS = {
  nodeWidth: 240,
  rowHeight: 140,
  multiOutputExtraGap: 48,
  columnGap: 40,
  padding: 40,
};

export function layoutWorkflow(
  doc: WorkflowDoc,
  options: LayoutOptions = {},
): LayoutResult {
  const opts: ResolvedOptions = {
    nodeWidth: options.nodeWidth ?? DEFAULTS.nodeWidth,
    rowHeight: options.rowHeight ?? DEFAULTS.rowHeight,
    multiOutputExtraGap: options.multiOutputExtraGap ?? DEFAULTS.multiOutputExtraGap,
    columnGap: options.columnGap ?? DEFAULTS.columnGap,
    padding: options.padding ?? DEFAULTS.padding,
    registry: options.registry,
  };
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

  /* --- compute row (ASAP + bottom-up pull-down for non-leaves) ---
   *
   * ASAP alone (longest path from any root) puts a fan-in source way up
   * at row 1 while its consumer sits at row N, producing a long L-bend
   * edge across the canvas. Pure ALAP fixes that but also pushes child-
   * less leaves all the way down, stranding them visually.
   *
   * Hybrid: start with ASAP, then walk bottom-up and pull every node
   * with children down to (min(child.row) - 1). Leaves keep their ASAP
   * row. Chains stay vertical, fan-in sources drop to sit next to their
   * consumer, dead-end branches stay near their producer.
   */
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

  // Step 1: ASAP via BFS.
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
        // Re-allow propagation so deeper descendants see the new depth.
        visited.delete(target);
      }
    }
  }

  // Step 2: bottom-up pull-down. Process nodes by descending row so a
  // child is always finalised before its parent. For any node with
  // children, set row = min(child.row) - 1. Leaves untouched.
  const idsByDescendingRow = doc.nodes
    .map((n) => n.id)
    .sort((a, b) => (row.get(b) ?? 0) - (row.get(a) ?? 0));
  for (const id of idsByDescendingRow) {
    const children = outgoing.get(id) ?? [];
    if (children.length === 0) continue;
    let minChildRow = Infinity;
    for (const c of children) {
      const cr = row.get(c) ?? 0;
      if (cr < minChildRow) minChildRow = cr;
    }
    if (minChildRow !== Infinity) row.set(id, minChildRow - 1);
  }

  /* --- group by row --- */
  const rows = new Map<number, string[]>();
  for (const n of doc.nodes) {
    const r = row.get(n.id) ?? 0;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r)!.push(n.id);
  }

  /* --- assign x top-down using absolute world coordinates ---
   *
   * Per row:
   *   1. Each node's *preferred* x = mean(parent.x). Roots distribute
   *      evenly around 0.
   *   2. Sort by preferred-x (stable on tie).
   *   3. Greedy pack left-to-right: every node is at least `slotWidth`
   *      from its left neighbour; if its preferred position is to the
   *      right of that, use the preferred position instead.
   *   4. Shift the whole packed cluster so its centroid matches the
   *      centroid of the preferred positions. With no collisions this
   *      is a no-op; with collisions it splits the spread symmetrically
   *      around the parents instead of cascading right.
   *
   * Why not per-row centering: a row with one node would re-centre to
   * x=0 regardless of its parent's x, producing a horizontal zig-zag
   * whenever a single child lived under a parent that itself sat off-
   * centre due to a sibling. Absolute x keeps children aligned under
   * their parents (or under the midpoint of multiple parents) all the
   * way down.
   */
  const slotWidth = opts.nodeWidth + opts.columnGap;
  const xByNode = new Map<string, number>();
  let maxRow = 0;
  const sortedRows = Array.from(rows.entries()).sort(([a], [b]) => a - b);

  const rootIds = doc.nodes
    .filter((n) => (incoming.get(n.id) ?? []).length === 0)
    .map((n) => n.id);
  const rootIndex = new Map(rootIds.map((id, i) => [id, i]));

  for (const [r, ids] of sortedRows) {
    if (r > maxRow) maxRow = r;

    // Step 1: preferred x per node.
    const preferred = new Map<string, number>();
    for (const id of ids) {
      const parents = incoming.get(id) ?? [];
      if (parents.length === 0) {
        const idx = rootIndex.get(id) ?? 0;
        preferred.set(id, (idx - (rootIds.length - 1) / 2) * slotWidth);
      } else {
        let sum = 0;
        let n = 0;
        for (const p of parents) {
          const px = xByNode.get(p);
          if (px !== undefined) {
            sum += px;
            n++;
          }
        }
        preferred.set(id, n > 0 ? sum / n : 0);
      }
    }

    // Step 2: sort by preferred x (stable tie-break on doc order).
    const sortedIds = ids.slice().sort((a, b) => {
      const diff = (preferred.get(a) ?? 0) - (preferred.get(b) ?? 0);
      if (diff !== 0) return diff;
      return ids.indexOf(a) - ids.indexOf(b);
    });

    // Step 3: greedy pack.
    const packed = new Map<string, number>();
    let lastX = Number.NEGATIVE_INFINITY;
    for (const id of sortedIds) {
      const want = preferred.get(id) ?? 0;
      const x = lastX === Number.NEGATIVE_INFINITY ? want : Math.max(want, lastX + slotWidth);
      packed.set(id, x);
      lastX = x;
    }

    // Step 4: shift so packed centroid = preferred centroid.
    let meanPref = 0;
    let meanPacked = 0;
    for (const id of sortedIds) {
      meanPref += preferred.get(id) ?? 0;
      meanPacked += packed.get(id) ?? 0;
    }
    const n = sortedIds.length || 1;
    meanPref /= n;
    meanPacked /= n;
    const shift = meanPref - meanPacked;

    for (const id of sortedIds) xByNode.set(id, (packed.get(id) ?? 0) + shift);

    rows.set(r, sortedIds);
  }

  /* --- compute per-row Y with extra gap below multi-output rows ---
   *
   * Each row's Y is `previous row's Y + rowHeight + (extra if the
   * previous row contains a multi-output node)`. The extra is added
   * BELOW the multi-output row because that's where its port labels,
   * leaf-+ buttons, and between-+ buttons cluster — they need room
   * before the next row's category pill arrives.
   */
  const yByRow = new Map<number, number>();
  let cursorY = opts.padding;
  for (let r = 0; r <= maxRow; r++) {
    yByRow.set(r, cursorY);
    const rowIds = rows.get(r) ?? [];
    const hasMultiOut = opts.registry
      ? rowIds.some((id) => {
          const n = doc.nodes.find((node) => node.id === id);
          if (!n) return false;
          const def = opts.registry?.get(n.type);
          if (!def) return false;
          return resolveOutputs(def, n).length > 1;
        })
      : false;
    cursorY += opts.rowHeight + (hasMultiOut ? opts.multiOutputExtraGap : 0);
  }

  /* --- emit positions with computed x ---
   * `col` is kept on NodeLayout for backwards compatibility (it was the
   * driver of x in the previous implementation). It's now derived purely
   * from the in-row order, useful for debugging / stable React keys but
   * no longer authoritative.
   */
  let maxAbsX = 0;
  let maxY = 0;
  for (const [r, ids] of rows) {
    ids.forEach((id, col) => {
      const x = xByNode.get(id) ?? 0;
      const y = yByRow.get(r) ?? opts.padding;
      positions.set(id, { x, y, row: r, col });
      const absX = Math.abs(x) + opts.nodeWidth / 2;
      if (absX > maxAbsX) maxAbsX = absX;
      if (y > maxY) maxY = y;
    });
  }

  return {
    positions,
    bounds: {
      width: maxAbsX * 2 + opts.padding * 2,
      height: opts.padding + maxY + opts.rowHeight,
    },
  };
}
