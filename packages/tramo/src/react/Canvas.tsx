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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Edge } from './Edge.js';
import { NodeView } from './NodeView.js';
import { CATEGORY_META, IntegrationIcon, NodeIcon } from './icons.js';
import { ArrowLeft, Search } from 'lucide-react';
import { PlusButton } from './PlusButton.js';
import { layoutWorkflow, outputOffset, type NodeLayout } from './layout.js';
import { newNodeId, newEdgeId, resolveOutputs, withMcpServers, type IntegrationDefinition, type MCPServerRef, type NodeCategory, type NodeDefinition } from 'tramo-spec';
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

const NODE_WIDTH_DEFAULT = 300;
// Total node height = category pill (~26px) + 6px gap + card (~84px) ≈ 116
const NODE_HEIGHT_DEFAULT = 116;
const PLUS_OFFSET = 36; // distance below a leaf node for the trailing +

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
    () => doc?.meta.mcpServers ?? [],
    [doc?.meta.mcpServers],
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

  /* ---------- pan & zoom ---------- */
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const panState = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Only pan when clicking the canvas background. Anything interactive
    // (node, plus, popover) handles its own pointer events; capturing here
    // would steal the click before it reaches them.
    const target = e.target as HTMLElement;
    if (target.closest('.tr-node-v2, .tr-plus, .tr-popover, .tr-popover-scrim, .tr-empty')) return;
    if (e.button !== 0) return;
    clearSelection();
    panState.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [clearSelection, view.x, view.y]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const s = panState.current;
    if (!s) return;
    setView((v) => ({ ...v, x: s.vx + (e.clientX - s.startX), y: s.vy + (e.clientY - s.startY) }));
  }, []);

  const endPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    panState.current = null;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer was never captured, fine
    }
  }, []);

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!wrapperRef.current) return;
      // Only respond to ctrl/meta + wheel for zoom; plain wheel pans vertically.
      const wantsZoom = e.ctrlKey || e.metaKey;
      const rect = wrapperRef.current.getBoundingClientRect();
      if (wantsZoom) {
        e.preventDefault();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setView((v) => {
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          const nextZoom = clamp(v.zoom * factor, minZoom, maxZoom);
          // Keep the cursor pinned to the same canvas-space point.
          const worldX = (cx - v.x) / v.zoom;
          const worldY = (cy - v.y) / v.zoom;
          return {
            zoom: nextZoom,
            x: cx - worldX * nextZoom,
            y: cy - worldY * nextZoom,
          };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    },
    [maxZoom, minZoom],
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

  const openInsertion = useCallback(
    (target: InsertionTarget) => setInsertion(target),
    [],
  );
  const closeInsertion = useCallback(() => setInsertion(null), []);

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
      className="tr-canvas-v2"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
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

      {insertion && (
        <InsertionPopover
          insertion={insertion}
          view={view}
          registry={registry}
          onPick={handleInsert}
          onClose={closeInsertion}
          onAddMcp={openMcpAdd}
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
  registry,
  onPick,
  onClose,
  onAddMcp,
}: {
  insertion: InsertionTarget;
  view: { x: number; y: number; zoom: number };
  registry: WorkflowHandle['registry'];
  onPick: (def: NodeDefinition) => void;
  onClose: () => void;
  /** Called when the picker's "+ MCP server" tile is clicked. Omitted while
   *  picking a trigger (MCP servers expose actions, not triggers). */
  onAddMcp?: () => void;
}) {
  const left = insertion.screenX * view.zoom + view.x;
  const top = insertion.screenY * view.zoom + view.y + 18;

  const wantsTriggerOnly = insertion.mode === 'first';
  const headerText = wantsTriggerOnly ? 'Choose a trigger' : 'Choose an operation';

  // Pool of nodes given the insertion context.
  const allNodes = useMemo(() => {
    return registry.list().filter((d) =>
      wantsTriggerOnly ? d.category === 'trigger' : d.category !== 'trigger',
    );
  }, [registry, wantsTriggerOnly]);

  // Integrations with at least one available op.
  const integrationsAvailable = useMemo(() => {
    if (wantsTriggerOnly) return [] as IntegrationDefinition[];
    const byInt = registry.byIntegration();
    return registry.integrations().filter((i) => (byInt[i.id]?.length ?? 0) > 0);
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

  return (
    <>
      <div className="tr-popover-scrim" onClick={onClose} />
      <div
        className="tr-picker tr-picker--clean"
        style={{ left, top }}
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

        {!wantsTriggerOnly && (integrationsAvailable.length > 0 || hasCoreNonIntegration) ? (
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
            {onAddMcp ? (
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
    </>
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
