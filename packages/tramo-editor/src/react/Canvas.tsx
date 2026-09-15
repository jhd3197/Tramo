/**
 * Canvas — tramo's own pan/zoom workflow renderer.
 *
 * Replaces XYFlow. The model:
 *   - Read the doc directly off the WorkflowHandle.
 *   - Compute node positions with `layoutWorkflow` every render. Layout
 *     is cheap (O(N+E)) and pure, so we don't memo aggressively.
 *   - Render every edge as an SVG path and every node as an absolute-
 *     positioned div, all inside a single transformed `<div>` that we
 *     pan and zoom by mutating its `transform` style.
 *   - A `+` button sits at every edge midpoint and below every leaf;
 *     clicking it opens a popover anchored to that point with the
 *     palette filtered to the right successor set.
 *
 * Drag-to-reposition nodes is intentionally absent — positions are a
 * function of the doc graph, so the only way to "move" a node is to
 * change its edges.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { CanvasControls } from './CanvasControls.js';
import { Edge } from './Edge.js';
import { NodeView } from './NodeView.js';
import { CATEGORY_META, IntegrationIcon, NodeIcon } from './icons.js';
import { ArrowLeft, Search } from 'lucide-react';
import { PlusButton } from './PlusButton.js';
import { layoutWorkflow, outputOffset, type NodeLayout } from './layout.js';
import { newNodeId, newEdgeId, resolveOutputs, withMcpServers, type IntegrationDefinition, type MCPServerRef, type NodeCategory, type NodeDefinition } from '@tramo/spec';
import { MCPImportModal } from './MCPImportModal.js';
import type { WorkflowHandle } from './useWorkflow.js';

export interface CanvasProps {
  workflow: WorkflowHandle;
  /** Node width in canvas units. Default 240. */
  nodeWidth?: number;
  /** Node height in canvas units. Default 64. */
  nodeHeight?: number;
  /** Min / max zoom levels. */
  minZoom?: number;
  maxZoom?: number;
  /**
   * Per-node outputs from the most recent run (keyed by node id). The
   * inspector + var picker use this to surface concrete field names; the
   * inline result chip on each card uses `runStatus` instead.
   */
  runResults?: Record<string, unknown>;
  /**
   * Per-node execution status from the most recent run (keyed by node
   * id). When provided, each card renders a small chip below it
   * summarising whether the node succeeded/errored/skipped/is running.
   */
  runStatus?: Record<string, import('./NodeView.js').NodeRunStatus>;
}

interface InsertionTarget {
  /** Where to anchor the popover in screen coordinates. */
  screenX: number;
  screenY: number;
  /** "after" inserts a new node after `sourceId`, splitting the edge to
   *  the existing target (if any). "leaf" appends after a leaf node. */
  mode: 'between' | 'after-leaf' | 'first';
  sourceId?: string;
  targetId?: string;
  /** The edge to split when mode === 'between'. */
  edgeId?: string;
  /** Output port key on the source — preserved on the new edge so
   *  inserting on the 'yes' branch of an If stays on 'yes'. */
  sourceHandle?: string;
  /** Input port key on the target — preserved on the new edge. */
  targetHandle?: string;
}

const NODE_WIDTH_DEFAULT = 260;
// Total node height = category pill (~22px) + 4px gap + single-row card (~44px) ≈ 70
const NODE_HEIGHT_DEFAULT = 70;
const PLUS_OFFSET = 44; // distance below a leaf node for the trailing +

export function Canvas({
  workflow,
  nodeWidth = NODE_WIDTH_DEFAULT,
  nodeHeight = NODE_HEIGHT_DEFAULT,
  minZoom = 0.4,
  maxZoom = 2,
  runResults,
  runStatus,
}: CanvasProps) {
  const { doc, selectedId, setSelection, clearSelection, registry: baseRegistry, applyPatch } = workflow;

  /* ---------- MCP servers overlay ----------
   *
   * Synthesise tiles + per-tool NodeDefinitions from anything the user has
   * imported into this workflow. The runtime never reads this overlay —
   * picked nodes get serverUrl + toolName baked into their config and
   * dispatch via the `mcp-tool-call:` executor prefix. */
  const mcpServers: MCPServerRef[] = useMemo(
    () => doc?.meta?.mcpServers ?? [],
    [doc?.meta?.mcpServers],
  );
  const registry = useMemo(
    () => withMcpServers(baseRegistry, mcpServers),
    [baseRegistry, mcpServers],
  );

  /* ---------- MCP import modal ---------- */
  const [mcpModal, setMcpModal] = useState<{ mode: 'add' } | { mode: 'edit'; initial: MCPServerRef } | null>(null);
  const openMcpAdd = useCallback(() => setMcpModal({ mode: 'add' }), []);
  const closeMcpModal = useCallback(() => setMcpModal(null), []);
  const confirmMcpServer = useCallback(
    (server: MCPServerRef) => {
      applyPatch({ kind: 'upsert-mcp-server', server });
      setMcpModal(null);
    },
    [applyPatch],
  );

  /* ---------- pan & zoom ----------
   *
   * Gesture model:
   *   - 1 active pointer  → pan (one-finger drag on touch, primary-button
   *     drag on mouse).
   *   - 2+ active pointers → pinch-zoom + midpoint pan. We pin the world
   *     point that was under the *initial* midpoint so it stays under the
   *     *current* midpoint — spreading-without-moving zooms in place,
   *     translating-without-spreading pans cleanly, both combined "just
   *     work" without separate code paths.
   *   - When the active count drops 2→1 we enter a "locked" mode so the
   *     remaining finger doesn't snap into a single-finger pan with a
   *     stale anchor. Lock clears on full release.
   *
   * Mouse keeps `e.button === 0` filtering so middle-click / right-click
   * aren't hijacked.
   */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });

  type GestureMode = 'idle' | 'pan' | 'pinch' | 'locked';
  interface PanSnapshot {
    pointerId: number;
    startX: number;
    startY: number;
    vx: number;
    vy: number;
  }
  interface PinchSnapshot {
    distance: number;
    midX: number;
    midY: number;
    vx: number;
    vy: number;
    vzoom: number;
  }
  const gestureRef = useRef<{
    mode: GestureMode;
    pointers: Map<number, { x: number; y: number }>;
    pan: PanSnapshot | null;
    pinch: PinchSnapshot | null;
  }>({ mode: 'idle', pointers: new Map(), pan: null, pinch: null });

  /** Convert client coords to wrapper-local pixels. */
  const wrapperLocal = useCallback((clientX: number, clientY: number) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    return rect
      ? { x: clientX - rect.left, y: clientY - rect.top }
      : { x: clientX, y: clientY };
  }, []);

  /** Zoom around a focal point in wrapper-local pixels. Pins the world
   *  point under (focalX, focalY) so it stays under the cursor / pinch
   *  centre / button-press anchor. */
  const zoomAt = useCallback(
    (focalX: number, focalY: number, factor: number) => {
      setView((v) => {
        const nextZoom = clamp(v.zoom * factor, minZoom, maxZoom);
        if (nextZoom === v.zoom) return v;
        const worldX = (focalX - v.x) / v.zoom;
        const worldY = (focalY - v.y) / v.zoom;
        return {
          zoom: nextZoom,
          x: focalX - worldX * nextZoom,
          y: focalY - worldY * nextZoom,
        };
      });
    },
    [maxZoom, minZoom],
  );

  /** Reset to zoom=1 and re-centre the way the initial layout effect does. */
  const resetView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    setView({ x: rect.width / 2, y: 60, zoom: 1 });
  }, []);

  /** Zoom step applied per toolbar +/- click. Slightly larger than the
   *  wheel's 1.1 so a click feels like a deliberate jump. */
  const BUTTON_ZOOM_STEP = 1.2;

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, factor);
    },
    [zoomAt],
  );

  const handleZoomIn = useCallback(() => zoomAtCenter(BUTTON_ZOOM_STEP), [zoomAtCenter]);
  const handleZoomOut = useCallback(() => zoomAtCenter(1 / BUTTON_ZOOM_STEP), [zoomAtCenter]);

  /* fitToView is declared further down, just after `layout`, because it
   * closes over it. */

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Only start a gesture when the pointer lands on the canvas background.
    // Interactive children (nodes, plus buttons, popover, toolbar) handle
    // their own events; capturing here would steal the click.
    const target = e.target as HTMLElement;
    if (target.closest('.tr-node-v2, .tr-plus, .tr-popover, .tr-popover-scrim, .tr-empty, .tr-canvas-controls')) return;
    // Mouse: only primary button. Touch/pen always report button 0.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const g = gestureRef.current;
    const local = wrapperLocal(e.clientX, e.clientY);
    g.pointers.set(e.pointerId, local);
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    if (g.pointers.size === 1) {
      clearSelection();
      g.mode = 'pan';
      g.pan = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        vx: view.x,
        vy: view.y,
      };
      g.pinch = null;
    } else if (g.pointers.size === 2) {
      // Upgrade pan → pinch. Snapshot baseline using the two current
      // pointer positions and the *current* view (not pan-start view).
      const pts = Array.from(g.pointers.values());
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      g.mode = 'pinch';
      g.pan = null;
      g.pinch = {
        distance: Math.max(1, Math.hypot(dx, dy)),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        vx: view.x,
        vy: view.y,
        vzoom: view.zoom,
      };
    }
    // 3+ pointers: ignore the extras; pinch keeps using its baseline.
  }, [clearSelection, view.x, view.y, view.zoom, wrapperLocal]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, wrapperLocal(e.clientX, e.clientY));

    if (g.mode === 'pan' && g.pan && g.pan.pointerId === e.pointerId) {
      const s = g.pan;
      setView((v) => ({ ...v, x: s.vx + (e.clientX - s.startX), y: s.vy + (e.clientY - s.startY) }));
    } else if (g.mode === 'pinch' && g.pinch) {
      const pts = Array.from(g.pointers.values()).slice(0, 2);
      if (pts.length < 2) return;
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const mx = (pts[0].x + pts[1].x) / 2;
      const my = (pts[0].y + pts[1].y) / 2;
      const s = g.pinch;
      const factor = d / s.distance;
      const nextZoom = clamp(s.vzoom * factor, minZoom, maxZoom);
      // World point that was under the initial midpoint at gesture start.
      const worldX = (s.midX - s.vx) / s.vzoom;
      const worldY = (s.midY - s.vy) / s.vzoom;
      // Pin that world point under the current midpoint at the new zoom.
      setView({
        zoom: nextZoom,
        x: mx - worldX * nextZoom,
        y: my - worldY * nextZoom,
      });
    }
  }, [maxZoom, minZoom, wrapperLocal]);

  const endGesturePointer = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer was never captured, fine
    }

    if (g.pointers.size === 0) {
      g.mode = 'idle';
      g.pan = null;
      g.pinch = null;
    } else if (g.pointers.size === 1 && g.mode === 'pinch') {
      // Don't snap into single-finger pan — the remaining finger's anchor
      // would teleport. Stay locked until full release.
      g.mode = 'locked';
      g.pan = null;
      g.pinch = null;
    }
  }, []);

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!wrapperRef.current) return;
      // Only respond to ctrl/meta + wheel for zoom; plain wheel pans vertically.
      // Trackpad pinch on macOS arrives here as wheel + ctrlKey synthesised by
      // the browser, so this path covers it transparently.
      const wantsZoom = e.ctrlKey || e.metaKey;
      const rect = wrapperRef.current.getBoundingClientRect();
      if (wantsZoom) {
        e.preventDefault();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoomAt(cx, cy, factor);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    },
    [zoomAt],
  );

  /* ---------- layout ---------- */
  const layout = useMemo(() => {
    if (!doc) return null;
    return layoutWorkflow(doc, {
      nodeWidth,
      rowHeight: nodeHeight + 72,
      registry,
    });
  }, [doc, nodeWidth, nodeHeight, registry]);

  /** Fit every node into the viewport with padding. No-op if the
   *  layout hasn't computed yet or there are no nodes. Declared here
   *  (not next to the other zoom helpers) because the dep array needs
   *  `layout` to already be in scope. */
  const fitToView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !layout || layout.positions.size === 0) return;
    const rect = wrapper.getBoundingClientRect();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of layout.positions.values()) {
      if (p.x - nodeWidth / 2 < minX) minX = p.x - nodeWidth / 2;
      if (p.x + nodeWidth / 2 > maxX) maxX = p.x + nodeWidth / 2;
      if (p.y < minY) minY = p.y;
      if (p.y + nodeHeight > maxY) maxY = p.y + nodeHeight;
    }
    const PAD = 64;
    const boxW = maxX - minX;
    const boxH = maxY - minY;
    const availW = Math.max(rect.width - PAD * 2, 1);
    const availH = Math.max(rect.height - PAD * 2, 1);
    const fitZoom = clamp(Math.min(availW / boxW, availH / boxH), minZoom, maxZoom);
    const centerWorldX = (minX + maxX) / 2;
    const centerWorldY = (minY + maxY) / 2;
    setView({
      zoom: fitZoom,
      x: rect.width / 2 - centerWorldX * fitZoom,
      y: rect.height / 2 - centerWorldY * fitZoom,
    });
  }, [layout, maxZoom, minZoom, nodeHeight, nodeWidth]);

  /* ---------- centre on first layout ---------- */
  const didCentreRef = useRef(false);
  useEffect(() => {
    if (didCentreRef.current || !layout || !wrapperRef.current || layout.positions.size === 0) {
      return;
    }
    const rect = wrapperRef.current.getBoundingClientRect();
    setView({ x: rect.width / 2, y: 60, zoom: 1 });
    didCentreRef.current = true;
  }, [layout]);

  /* ---------- insertion popover ---------- */
  const [insertion, setInsertion] = useState<InsertionTarget | null>(null);
  const [panning, setPanning] = useState(false);

  // The picker can render up to ~560px tall. Before opening, we pan the
  // world so the anchor `+` lands near the top of the canvas — that
  // guarantees ~560+ px of free space below for the picker, no matter
  // where on screen the user clicked. Computed explicitly (not as a
  // delta) so the post-pan position is exact.
  const openInsertion = useCallback(
    (target: InsertionTarget) => {
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const rect = wrapper.getBoundingClientRect();
        const POPOVER_HEIGHT = 560;
        const BOTTOM_PAD = 80; // breathing room between picker and viewport bottom
        const ANCHOR_OFFSET = 18; // matches the +18 in InsertionPopover
        // Where we'd like the anchor to land in viewport space, so the
        // picker fits entirely above (vh - bottom-pad) with room to spare.
        const minAnchorY = rect.top + 24;
        const maxAnchorY = window.innerHeight - BOTTOM_PAD - POPOVER_HEIGHT - ANCHOR_OFFSET;
        const idealAnchorY = Math.max(minAnchorY, Math.min(maxAnchorY, rect.top + 80));
        // Solve for the view.y that places the anchor at idealAnchorY:
        //   rect.top + target.screenY * zoom + newViewY + ANCHOR_OFFSET = idealAnchorY
        const newViewY = idealAnchorY - rect.top - target.screenY * view.zoom - ANCHOR_OFFSET;
        // Only pan when the new view.y meaningfully differs and the anchor
        // is currently lower than ideal (we never push it further down).
        if (newViewY < view.y - 8) {
          setPanning(true);
          setView((v) => ({ ...v, y: newViewY }));
          window.setTimeout(() => setPanning(false), 220);
        }
      }
      setInsertion(target);
    },
    [view.x, view.y, view.zoom],
  );
  const closeInsertion = useCallback(() => setInsertion(null), []);

  // Pan the canvas by `dy` pixels (positive = world shifts down, anchor
  // moves down with it; negative = world shifts up). Called by the picker
  // when its measured size still doesn't fit after the preflight pan.
  const requestCanvasPan = useCallback((dy: number) => {
    setPanning(true);
    setView((v) => ({ ...v, y: v.y + dy }));
    window.setTimeout(() => setPanning(false), 220);
  }, []);

  const handleInsert = useCallback(
    (def: NodeDefinition) => {
      if (!insertion || !doc) return;
      const config: Record<string, unknown> = {};
      for (const f of def.fields) {
        if (f.default !== undefined) config[f.key] = f.default;
      }
      const newId = newNodeId();

      if (insertion.mode === 'between' && insertion.edgeId && insertion.sourceId && insertion.targetId) {
        // Split the edge: remove old, add node, add source→new + new→target.
        // The first segment inherits the original edge's sourceHandle so
        // an insert on If/Yes stays on the Yes branch; the second segment
        // inherits the original targetHandle.
        applyPatch({ kind: 'remove-edge', id: insertion.edgeId });
        applyPatch({ kind: 'add-node', node: { id: newId, type: def.id, config } });
        applyPatch({
          kind: 'add-edge',
          edge: {
            id: newEdgeId(),
            source: insertion.sourceId,
            target: newId,
            ...(insertion.sourceHandle ? { sourceHandle: insertion.sourceHandle } : {}),
          },
        });
        applyPatch({
          kind: 'add-edge',
          edge: {
            id: newEdgeId(),
            source: newId,
            target: insertion.targetId,
            ...(insertion.targetHandle ? { targetHandle: insertion.targetHandle } : {}),
          },
        });
      } else if (insertion.mode === 'after-leaf' && insertion.sourceId) {
        applyPatch({ kind: 'add-node', node: { id: newId, type: def.id, config } });
        applyPatch({
          kind: 'add-edge',
          edge: {
            id: newEdgeId(),
            source: insertion.sourceId,
            target: newId,
            ...(insertion.sourceHandle ? { sourceHandle: insertion.sourceHandle } : {}),
          },
        });
      } else {
        // First node — no edges yet.
        applyPatch({ kind: 'add-node', node: { id: newId, type: def.id, config } });
      }
      setSelection(newId);
      closeInsertion();
    },
    [applyPatch, closeInsertion, doc, insertion, setSelection],
  );

  /* ---------- derive plus-button anchor points ---------- */
  const plusAnchors = useMemo(() => {
    type Between = {
      key: string;
      x: number;
      y: number;
      edgeId: string;
      sourceId: string;
      targetId: string;
      sourceHandle?: string;
      targetHandle?: string;
    };
    type Leaf = {
      key: string;
      x: number;
      y: number;
      sourceId: string;
      sourceHandle?: string;
      portLabel?: string;
    };

    if (!doc || !layout) {
      return {
        betweens: [] as Between[],
        leaves: [] as Leaf[],
        first: null as null | { x: number; y: number },
      };
    }

    const betweens: Between[] = doc.edges
      .map((e) => {
        const s = layout.positions.get(e.source);
        const t = layout.positions.get(e.target);
        if (!s || !t) return null;
        // Anchor + to the target's column, just above the target. For
        // straight (single-column) edges this still sits on the line.
        // For fan-out branches it sits on the vertical descent into the
        // target instead of floating in the elbow's horizontal bend.
        return {
          key: `edge-${e.id}`,
          x: t.x,
          y: t.y - 22,
          edgeId: e.id,
          sourceId: e.source,
          targetId: e.target,
          ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
          ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
        } as Between;
      })
      .filter(Boolean) as Between[];

    /* Build "edges grouped by (source, sourceHandle)" so we know which
     * outputs of a multi-output node already have a connection. Every
     * un-connected output gets its own trailing + so users can extend
     * each branch independently.
     *
     * Edges from older docs (or any caller that omits `sourceHandle`)
     * are normalised to the source node's first output — the same
     * default `outputOffset` uses when drawing the edge line. Without
     * this, a wired-up `out`/`yes` port would still render a leaf-+
     * on top of the between-+ for the same connection.
     */
    const connectedOuts = new Map<string, Set<string>>();
    for (const e of doc.edges) {
      const srcNode = doc.nodes.find((n) => n.id === e.source);
      const srcDef = registry.get(srcNode?.type ?? '');
      const srcOuts = srcDef ? resolveOutputs(srcDef, srcNode) : [];
      const defaultHandle = srcOuts[0]?.key;
      const handle = e.sourceHandle ?? defaultHandle ?? '__default__';
      const set = connectedOuts.get(e.source) ?? new Set<string>();
      set.add(handle);
      connectedOuts.set(e.source, set);
    }

    const leaves: Leaf[] = [];
    for (const n of doc.nodes) {
      const def = registry.get(n.type);
      const outs = def ? resolveOutputs(def, n) : [];
      const connected = connectedOuts.get(n.id) ?? new Set<string>();
      const p = layout.positions.get(n.id);
      if (!p) continue;

      if (outs.length <= 1) {
        // Single-output (or undefined-def) — any outgoing edge counts as
        // connected, regardless of whether its sourceHandle was set
        // explicitly or left default. Zero-output nodes (flow-output)
        // never get a trailing +.
        if (outs.length === 0) continue;
        if (connected.size === 0) {
          leaves.push({
            key: `leaf-${n.id}`,
            x: p.x,
            y: p.y + nodeHeight + PLUS_OFFSET,
            sourceId: n.id,
          });
        }
      } else {
        // Multi-output — one + per unconnected output, positioned under
        // that output's anchor.
        for (const out of outs) {
          if (connected.has(out.key)) continue;
          const dx = outputOffset(outs, out.key, nodeWidth);
          leaves.push({
            key: `leaf-${n.id}-${out.key}`,
            x: p.x + dx,
            y: p.y + nodeHeight + PLUS_OFFSET,
            sourceId: n.id,
            sourceHandle: out.key,
            portLabel: out.label,
          });
        }
      }
    }

    const first = doc.nodes.length === 0 ? { x: 0, y: 60 } : null;
    return { betweens, leaves, first };
  }, [doc, layout, nodeHeight, nodeWidth, registry]);

  /* ---------- render ---------- */
  if (!doc || !layout) {
    return <div className="tr-canvas-v2 tr-canvas-v2--empty" />;
  }

  const transformStyle: CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={wrapperRef}
      className={`tr-canvas-v2${panning ? ' tr-canvas-v2--panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesturePointer}
      onPointerCancel={endGesturePointer}
      onWheel={onWheel}
    >
      <div className="tr-canvas-v2__world" style={transformStyle}>
        <svg className="tr-canvas-v2__edges" overflow="visible">
          {doc.edges.map((e) => {
            const s = layout.positions.get(e.source);
            const t = layout.positions.get(e.target);
            if (!s || !t) return null;
            const srcNode = doc.nodes.find((n) => n.id === e.source);
            const srcDef = registry.get(srcNode?.type ?? '');
            const srcOuts = srcDef ? resolveOutputs(srcDef, srcNode) : [];
            const dx = outputOffset(srcOuts, e.sourceHandle, nodeWidth);
            return (
              <Edge
                key={e.id}
                id={e.id}
                x1={s.x + dx}
                y1={s.y + nodeHeight}
                x2={t.x}
                y2={t.y}
              />
            );
          })}
        </svg>

        {doc.nodes.map((n) => {
          const p = layout.positions.get(n.id);
          if (!p) return null;
          return (
            <NodeView
              key={n.id}
              node={n}
              definition={registry.get(n.type)}
              x={p.x}
              y={p.y}
              width={nodeWidth}
              height={nodeHeight}
              selected={n.id === selectedId}
              onClick={() => setSelection(n.id)}
              applyPatch={applyPatch}
              lastResult={runResults?.[n.id]}
              runStatus={runStatus?.[n.id]}
            />
          );
        })}

        {plusAnchors.betweens.map((a) => (
          <PlusButton
            key={a.key}
            x={a.x}
            y={a.y}
            onClick={() => openInsertion({
              mode: 'between',
              screenX: a.x,
              screenY: a.y,
              edgeId: a.edgeId,
              sourceId: a.sourceId,
              targetId: a.targetId,
              ...(a.sourceHandle ? { sourceHandle: a.sourceHandle } : {}),
              ...(a.targetHandle ? { targetHandle: a.targetHandle } : {}),
            })}
            label="Insert step here"
          />
        ))}
        {plusAnchors.leaves.map((a) => (
          <PlusButton
            key={a.key}
            x={a.x}
            y={a.y}
            onClick={() => openInsertion({
              mode: 'after-leaf',
              screenX: a.x,
              screenY: a.y,
              sourceId: a.sourceId,
              ...(a.sourceHandle ? { sourceHandle: a.sourceHandle } : {}),
            })}
            label={a.portLabel ? `Add next step on ${a.portLabel}` : 'Add next step'}
          />
        ))}
        {/* The empty-state EmptyPrompt below owns the first-insertion CTA,
            so no world-coord first + is rendered. */}
      </div>

      <CanvasControls
        zoom={view.zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={resetView}
        onFit={fitToView}
        fitDisabled={doc.nodes.length === 0}
      />

      {insertion && (
        <InsertionPopover
          insertion={insertion}
          view={view}
          wrapperRef={wrapperRef}
          registry={registry}
          onPick={handleInsert}
          onClose={closeInsertion}
          onAddMcp={openMcpAdd}
          onRequestPan={requestCanvasPan}
        />
      )}

      {mcpModal ? (
        <MCPImportModal
          initial={mcpModal.mode === 'edit' ? mcpModal.initial : undefined}
          onClose={closeMcpModal}
          onConfirm={confirmMcpServer}
        />
      ) : null}

      {doc.nodes.length === 0 ? (
        <EmptyPrompt
          onStart={() =>
            openInsertion({ mode: 'first', screenX: 0, screenY: 60 })
          }
        />
      ) : null}
    </div>
  );
}

function EmptyPrompt({ onStart }: { onStart: () => void }) {
  return (
    <div className="tr-empty">
      <div className="tr-empty__card">
        <div className="tr-empty__icon" aria-hidden>
          {/* lucide Zap — inline to avoid an extra import */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
          </svg>
        </div>
        <div className="tr-empty__title">Start your workflow</div>
        <div className="tr-empty__sub">Pick a trigger to decide when this flow fires.</div>
        <button type="button" className="tr-empty__cta" onClick={onStart}>
          + Add a trigger
        </button>
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Insertion popover — featured-tiles row + flat operation list            */
/* ====================================================================== */

const CORE_BUNDLE_LABELS: Partial<Record<NodeCategory, string>> = {
  trigger: 'Triggers',
  action: 'Core Actions',
  transform: 'Transforms',
  logic: 'Logic',
  state: 'Variables',
  ai: 'AI',
  io: 'I/O',
};

const CORE_BUCKET_ID = '__core__';

/** Resolve "what bucket does this node belong to" for the featured-tiles row. */
function bucketIdFor(def: NodeDefinition): string {
  return def.integrationId ?? CORE_BUCKET_ID;
}

function InsertionPopover({
  insertion,
  view,
  wrapperRef,
  registry,
  onPick,
  onClose,
  onAddMcp,
  onRequestPan,
}: {
  insertion: InsertionTarget;
  view: { x: number; y: number; zoom: number };
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  registry: WorkflowHandle['registry'];
  onPick: (def: NodeDefinition) => void;
  onClose: () => void;
  /** Called when the picker's "+ MCP server" tile is clicked. Omitted while
   *  picking a trigger (MCP servers expose actions, not triggers). */
  onAddMcp?: () => void;
  /** Ask the canvas to pan vertically by `dy` pixels (negative = pan up,
   *  bringing the anchor higher in the viewport). The picker calls this
   *  when its measured size still overflows after positioning. */
  onRequestPan: (dy: number) => void;
}) {
  // Anchor in viewport coords: convert canvas-local point to screen-fixed
  // by adding the wrapper's bounding rect. The popover itself is portalled
  // to document.body with position: fixed, so all clamping is one math.
  const wrapperRect = wrapperRef.current?.getBoundingClientRect();
  const wrapperLeft = wrapperRect?.left ?? 0;
  const wrapperTop = wrapperRect?.top ?? 0;
  const anchorLeft = wrapperLeft + insertion.screenX * view.zoom + view.x;
  const anchorTop = wrapperTop + insertion.screenY * view.zoom + view.y + 18;

  const wantsTriggerOnly = insertion.mode === 'first';
  const headerText = wantsTriggerOnly ? 'Choose a trigger' : 'Choose an operation';

  // Pool of nodes given the insertion context.
  const allNodes = useMemo(() => {
    return registry.list().filter((d) =>
      wantsTriggerOnly ? d.category === 'trigger' : d.category !== 'trigger',
    );
  }, [registry, wantsTriggerOnly]);

  // Integrations with at least one node matching the current mode. In
  // trigger-only mode we only count brand nodes whose category is
  // `trigger` so the tile row stays consistent with the rows below.
  const integrationsAvailable = useMemo(() => {
    const byInt = registry.byIntegration();
    return registry.integrations().filter((i) => {
      const nodes = byInt[i.id] ?? [];
      return nodes.some((n) =>
        wantsTriggerOnly ? n.category === 'trigger' : n.category !== 'trigger',
      );
    });
  }, [registry, wantsTriggerOnly]);

  const hasCoreNonIntegration = useMemo(() => {
    return allNodes.some((d) => !d.integrationId);
  }, [allNodes]);

  const [query, setQuery] = useState('');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  useEffect(() => {
    setQuery('');
    setSelectedBucket(null);
  }, [insertion.mode, insertion.screenX, insertion.screenY]);

  const q = query.trim().toLowerCase();
  const searchActive = q.length > 0;

  // Filtered op list: search overrides bucket filter so users always see all matches.
  const ops: NodeDefinition[] = useMemo(() => {
    let base = allNodes;
    if (!searchActive && selectedBucket) {
      base = base.filter((d) => bucketIdFor(d) === selectedBucket);
    }
    if (searchActive) {
      base = base.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          (d.operationName ?? '').toLowerCase().includes(q) ||
          (d.integrationId ?? '').toLowerCase().includes(q),
      );
    }
    return base;
  }, [allNodes, selectedBucket, searchActive, q]);

  // Lookup integration metadata by id for the row subtitles.
  const integrationLookup = useMemo(() => {
    const m = new Map<string, IntegrationDefinition>();
    for (const i of registry.integrations()) m.set(i.id, i);
    return m;
  }, [registry]);

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  // The popover is portalled to document.body and uses `position: fixed`,
  // so left/top are viewport coordinates. We start hidden, measure, clamp,
  // then reveal — this avoids any first-frame jump. A ResizeObserver
  // re-clamps when the picker's size changes (search filtering, etc.).
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ready: boolean }>({
    left: anchorLeft,
    top: anchorTop,
    ready: false,
  });

  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    const recompute = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w === 0 || h === 0) return;
      const margin = 16;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // The anchor is the centre of the `+`; `anchorTop` is already offset
      // 18px below it. The geometry above the `+` mirrors that 18px gap.
      const anchorGap = 18;

      // Horizontal: keep fully inside the viewport.
      let nextLeft = anchorLeft;
      if (nextLeft + w > vw - margin) nextLeft = vw - margin - w;
      if (nextLeft < margin) nextLeft = margin;

      // Vertical: pick the side with more free room. Place below when both
      // sides fit and below has at least as much room — that matches the
      // user's mental model (clicking + → menu drops down).
      const spaceBelow = vh - margin - anchorTop;
      const spaceAbove = (anchorTop - anchorGap * 2) - margin;
      const fitsBelow = h <= spaceBelow;
      const fitsAbove = h <= spaceAbove;

      let nextTop: number;
      if (fitsBelow && (!fitsAbove || spaceBelow >= spaceAbove)) {
        nextTop = anchorTop;
      } else if (fitsAbove) {
        nextTop = anchorTop - anchorGap * 2 - h;
      } else {
        // Neither side fits the picker fully — pin to whichever edge gives
        // more room.
        nextTop = spaceBelow >= spaceAbove ? vh - margin - h : margin;
      }
      if (nextTop < margin) nextTop = margin;

      // Fallback: if even after placement the picker would overflow the
      // bottom of the viewport (e.g. anchor is too low and there isn't
      // enough room above either), ask the canvas to pan up so the picker
      // gets the room it needs. Cap the request so we don't shove the
      // anchor off the top of the canvas.
      const popoverBottom = nextTop + h;
      const overflowBottom = popoverBottom - (vh - margin);
      if (overflowBottom > 4) {
        const wrapper = wrapperRef.current;
        const headroom = wrapper ? Math.max(0, anchorTop - wrapper.getBoundingClientRect().top - 24) : overflowBottom;
        const dy = -Math.min(overflowBottom, headroom);
        if (dy < -4) {
          onRequestPan(dy);
          return; // a re-render will follow with the new anchor; skip setPos
        }
      }

      setPos((cur) =>
        cur.left === nextLeft && cur.top === nextTop && cur.ready
          ? cur
          : { left: nextLeft, top: nextTop, ready: true },
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener('resize', recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [anchorLeft, anchorTop, onRequestPan, wrapperRef]);

  // Global Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        className="tr-popover-scrim tr-popover-scrim--fixed"
        onClick={onClose}
      />
      <div
        ref={popoverRef}
        className={`tr-picker tr-picker--clean tr-picker--fixed${pos.ready ? ' is-ready' : ''}`}
        style={{
          left: pos.left,
          top: pos.top,
          visibility: pos.ready ? 'visible' : 'hidden',
        }}
        onWheel={stop}
        onPointerDown={stop}
        onPointerMove={stop}
        onPointerUp={stop}
      >
        <div className="tr-picker__head">
          <div className="tr-picker__title">{headerText}</div>
          <button
            type="button"
            className="tr-picker__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="tr-picker__search">
          <Search size={14} strokeWidth={2} aria-hidden />
          <input
            autoFocus
            type="text"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          />
          {query ? (
            <button
              type="button"
              className="tr-picker__clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          ) : null}
        </div>

        {(integrationsAvailable.length > 0 || hasCoreNonIntegration) ? (
          <div className="tr-picker__featured" onWheel={stop}>
            {hasCoreNonIntegration ? (
              <FeaturedTile
                label="Core"
                accent="#475569"
                lucideIcon="Zap"
                selected={selectedBucket === CORE_BUCKET_ID}
                onClick={() =>
                  setSelectedBucket((cur) => (cur === CORE_BUCKET_ID ? null : CORE_BUCKET_ID))
                }
              />
            ) : null}
            {integrationsAvailable.map((integ) => (
              <FeaturedTile
                key={integ.id}
                label={integ.name}
                accent={integ.color ?? '#3b82f6'}
                integration={integ}
                selected={selectedBucket === integ.id}
                onClick={() =>
                  setSelectedBucket((cur) => (cur === integ.id ? null : integ.id))
                }
              />
            ))}
            {onAddMcp && !wantsTriggerOnly ? (
              <button
                type="button"
                className="tr-picker__feat tr-picker__feat--add"
                onClick={onAddMcp}
                title="Import an MCP server"
              >
                <span className="tr-picker__feat-square" aria-hidden>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span className="tr-picker__feat-label">MCP server</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="tr-picker__rows" onWheel={stop}>
          {ops.length === 0 ? (
            <div className="tr-picker__empty">
              {searchActive ? `No steps match "${query}".` : 'No steps available.'}
            </div>
          ) : (
            ops.map((def) => {
              const integ = def.integrationId
                ? integrationLookup.get(def.integrationId)
                : undefined;
              const subtitle = integ?.name
                ?? CORE_BUNDLE_LABELS[def.category]
                ?? def.category;
              const accent = def.color
                ?? integ?.color
                ?? CATEGORY_META[def.category]?.fg
                ?? '#3b82f6';
              return (
                <button
                  key={def.id}
                  type="button"
                  className="tr-picker__row"
                  onClick={() => onPick(def)}
                  title={def.description}
                  style={{ '--row-accent': accent } as CSSProperties}
                >
                  <span className="tr-picker__row-icon" aria-hidden>
                    <NodeIcon definition={def} size={20} />
                  </span>
                  <span className="tr-picker__row-body">
                    <span className="tr-picker__row-name">
                      {def.operationName ?? def.name}
                    </span>
                    <span className="tr-picker__row-sub">{subtitle}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function FeaturedTile({
  label,
  accent,
  integration,
  selected,
  onClick,
}: {
  label: string;
  accent: string;
  integration?: IntegrationDefinition;
  /** Reserved for future core-bucket icon override. */
  lucideIcon?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tr-picker__feat${selected ? ' tr-picker__feat--selected' : ''}`}
      onClick={onClick}
      style={{ '--feat-accent': accent } as CSSProperties}
      title={label}
    >
      <span className="tr-picker__feat-square" aria-hidden>
        {integration ? (
          <IntegrationIcon integration={integration} size={22} monochrome />
        ) : (
          // Core bucket — render a generic spark icon.
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        )}
      </span>
      <span className="tr-picker__feat-label">{label}</span>
    </button>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
