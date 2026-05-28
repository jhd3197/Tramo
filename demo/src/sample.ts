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

/* ====================================================================== */
/* Sub-flows — registered with the runtime via RunOptions.workflows so the */
/* call-flow node can invoke them.                                          */
/* ====================================================================== */

function buildDoubler(): WorkflowDoc {
  const inId = newNodeId();
  const xfId = newNodeId();
  const outId = newNodeId();
  return applyPatches(emptyDoc(), [
    {
      kind: 'add-node',
      node: {
        id: inId,
        type: 'flow-input',
        config: {
          params: [{ name: 'value', type: 'number' }],
          samplePayload: '{"value": 21}',
        },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: xfId,
        type: 'js-transform',
        label: 'value × 2',
        config: { expression: 'return { doubled: input.value * 2 };' },
      },
    },
    {
      kind: 'add-node',
      node: { id: outId, type: 'flow-output', config: { params: [{ name: 'doubled', type: 'number' }] } },
    },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: inId, target: xfId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: xfId, target: outId } },
  ]).doc;
}

function buildGreeter(): WorkflowDoc {
  const inId = newNodeId();
  const tplId = newNodeId();
  const outId = newNodeId();
  return applyPatches(emptyDoc(), [
    {
      kind: 'add-node',
      node: {
        id: inId,
        type: 'flow-input',
        config: {
          params: [{ name: 'name', type: 'string' }],
          samplePayload: '{"name": "world"}',
        },
      },
    },
    {
      kind: 'add-node',
      node: {
        id: tplId,
        type: 'template',
        config: { template: 'Hello, {{name}}!' },
      },
    },
    { kind: 'add-node', node: { id: outId, type: 'flow-output', config: { params: [{ name: 'greeting', type: 'string' }] } } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: inId, target: tplId } },
    { kind: 'add-edge', edge: { id: newEdgeId(), source: tplId, target: outId } },
  ]).doc;
}

export const SUBFLOW_DOUBLER: WorkflowDoc = buildDoubler();
export const SUBFLOW_GREETER: WorkflowDoc = buildGreeter();
