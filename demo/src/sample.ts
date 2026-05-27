/**
 * The starting doc shown on first load. Deliberately tiny — a manual
 * trigger feeding a log node — so new users see the simplest possible
 * shape of a tramo workflow and can iterate from there.
 */

import { applyPatches, emptyDoc, newEdgeId, newNodeId, type WorkflowDoc } from 'tramo-spec';

function build(): WorkflowDoc {
  const tId = newNodeId();
  const lId = newNodeId();
  return applyPatches(emptyDoc(), [
    {
      kind: 'add-node',
      node: {
        id: tId,
        type: 'manual-trigger',
        config: { payload: '{"hello":"world"}' },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: lId,
        type: 'log',
        label: 'Log {{payload.hello}}',
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
