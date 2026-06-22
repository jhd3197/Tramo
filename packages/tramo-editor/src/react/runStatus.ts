/**
 * Derive per-node run state from a RunEvent stream so the canvas can light
 * up live. Hosts subscribe to `run()`/`runStream()` events, feed them here,
 * and pass the resulting map (plus `activeNodeId`) into Canvas to highlight
 * the running node, show success/error chips, and trace the active path.
 *
 * The RunEvent shape is duplicated structurally (not imported from
 * @tramo/runtime) so the editor stays browser-only with no runtime dep.
 */

import type { NodeRunStatus } from './NodeView.js';

/** Minimal structural view of the runtime's RunEvent union. */
export type RunEventLike =
  | { type: 'run-start'; nodeOrder: string[] }
  | { type: 'node-start'; nodeId: string }
  | { type: 'node-success'; nodeId: string; output?: unknown; durationMs?: number }
  | { type: 'node-error'; nodeId: string; error: string; durationMs?: number }
  | { type: 'node-skip'; nodeId: string; reason: string }
  | { type: 'node-chunk'; nodeId: string; chunk: string }
  | { type: 'run-suspended' }
  | { type: 'run-end' }
  | { type: string; [k: string]: unknown };

export interface DerivedRunState {
  /** Per-node status for Canvas/NodeView. */
  statuses: Record<string, NodeRunStatus>;
  /** Node currently running (last node-start without a terminal event), if any. */
  activeNodeId: string | null;
  /** Streaming text accumulated per node from node-chunk events. */
  streams: Record<string, string>;
  /** Set of edges (sourceId→targetId) considered "active" — both ends ran. */
  done: Set<string>;
}

export function deriveRunState(events: RunEventLike[]): DerivedRunState {
  const statuses: Record<string, NodeRunStatus> = {};
  const streams: Record<string, string> = {};
  const done = new Set<string>();
  let activeNodeId: string | null = null;

  for (const e of events) {
    switch (e.type) {
      case 'node-start':
        statuses[(e as { nodeId: string }).nodeId] = { status: 'running' };
        activeNodeId = (e as { nodeId: string }).nodeId;
        break;
      case 'node-success': {
        const ev = e as { nodeId: string; output?: unknown; durationMs?: number };
        statuses[ev.nodeId] = { status: 'success', output: ev.output, durationMs: ev.durationMs };
        done.add(ev.nodeId);
        if (activeNodeId === ev.nodeId) activeNodeId = null;
        break;
      }
      case 'node-error': {
        const ev = e as { nodeId: string; error: string; durationMs?: number };
        statuses[ev.nodeId] = { status: 'error', error: ev.error, durationMs: ev.durationMs };
        done.add(ev.nodeId);
        if (activeNodeId === ev.nodeId) activeNodeId = null;
        break;
      }
      case 'node-skip': {
        const ev = e as { nodeId: string; reason: string };
        statuses[ev.nodeId] = { status: 'skip', reason: ev.reason };
        break;
      }
      case 'node-chunk': {
        const ev = e as { nodeId: string; chunk: string };
        streams[ev.nodeId] = (streams[ev.nodeId] ?? '') + ev.chunk;
        break;
      }
      case 'run-end':
      case 'run-suspended':
        activeNodeId = null;
        break;
      default:
        break;
    }
  }

  return { statuses, activeNodeId, streams, done };
}

/** Whether an edge should render as "active" (its source completed). */
export function isEdgeActive(state: DerivedRunState, sourceId: string): boolean {
  return state.done.has(sourceId);
}
