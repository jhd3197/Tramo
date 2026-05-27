/**
 * The starting doc shown on first load. Deliberately tiny — a manual
 * trigger feeding a log node — so new users see the simplest possible
 * shape of a tramo workflow and can iterate from there.
 */

import { applyPatches, emptyDoc, newEdgeId, newNodeId, type WorkflowDoc } from 'tramo';

function build(): WorkflowDoc {
  const tId = newNodeId();
  const lId = newNodeId();
  return applyPatches(emptyDoc(), [
    {
      kind: 'add-node',
      node: {
        id: tId,
        type: 'manual-trigger',
        position: { x: 80, y: 160 },
        config: { payload: '{"hello":"world"}' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: lId,
        type: 'log',
        position: { x: 380, y: 160 },
        config: { level: 'info', prefix: 'demo:' },
      },
    },
    {
      kind: 'add-edge',
      edge: { id: newEdgeId(), source: tId, target: lId },
    },
  ]).doc;
}

export const SAMPLE_DOC: WorkflowDoc = build();
