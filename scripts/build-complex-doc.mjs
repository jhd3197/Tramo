import { applyPatches, emptyDoc, newEdgeId, newNodeId } from '@tramo/spec';
import fs from 'node:fs';

const triggerId = newNodeId();
const httpId = newNodeId();
const extractId = newNodeId();
const ifAId = newNodeId();
const templateId = newNodeId();
const ifBId = newNodeId();
const logBYesId = newNodeId();
const delayBNoId = newNodeId();
const switchId = newNodeId();
const respondCaseAId = newNodeId();
const transformCaseBId = newNodeId();
const logDefaultId = newNodeId();
const mergeId = newNodeId();
const finalLogId = newNodeId();

const doc = applyPatches(emptyDoc(), [
  { kind: 'add-node', node: { id: triggerId, type: 'manual-trigger', label: 'Trigger', config: { payload: '{"user":"juan"}' } } },
  { kind: 'add-node', node: { id: httpId, type: 'http-request', label: 'Fetch user', config: { url: 'https://api.github.com/users/{{user}}', method: 'GET', timeoutMs: 8000 } } },
  { kind: 'add-node', node: { id: extractId, type: 'js-transform', label: 'Extract stats', config: { expression: 'return { followers: input.data.followers, repos: input.data.public_repos };' } } },
  { kind: 'add-node', node: { id: ifAId, type: 'if', label: 'Has followers?', config: { condition: 'input.followers > 0' } } },
  { kind: 'add-node', node: { id: templateId, type: 'template', label: 'Render summary', config: { template: '{{steps.extract_stats.followers}} followers' } } },
  { kind: 'add-node', node: { id: ifBId, type: 'if', label: 'Many repos?', config: { condition: 'input.repos > 10' } } },
  { kind: 'add-node', node: { id: logBYesId, type: 'log', label: 'Log many repos', config: { level: 'info' } } },
  { kind: 'add-node', node: { id: delayBNoId, type: 'delay', label: 'Wait', config: { delayMs: 1000 } } },
  { kind: 'add-node', node: { id: switchId, type: 'switch', label: 'Route by size', config: { cases: [{ key: 'case_a', label: 'Small' }, { key: 'case_b', label: 'Medium' }] } } },
  { kind: 'add-node', node: { id: respondCaseAId, type: 'http-respond', label: 'Respond small', config: { statusCode: 200 } } },
  { kind: 'add-node', node: { id: transformCaseBId, type: 'js-transform', label: 'Transform medium', config: { expression: 'return { medium: true };' } } },
  { kind: 'add-node', node: { id: logDefaultId, type: 'log', label: 'Log default', config: { level: 'info' } } },
  { kind: 'add-node', node: { id: mergeId, type: 'merge', label: 'Combine', config: {} } },
  { kind: 'add-node', node: { id: finalLogId, type: 'log', label: 'Final log', config: { level: 'info' } } },

  { kind: 'add-edge', edge: { id: newEdgeId(), source: triggerId, target: httpId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: httpId, target: extractId, sourceHandle: 'out' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: extractId, target: ifAId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: ifAId, target: templateId, sourceHandle: 'yes' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: ifAId, target: ifBId, sourceHandle: 'no' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: ifBId, target: logBYesId, sourceHandle: 'yes' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: ifBId, target: delayBNoId, sourceHandle: 'no' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: templateId, target: switchId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: logBYesId, target: mergeId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: delayBNoId, target: mergeId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: switchId, target: respondCaseAId, sourceHandle: 'case_a' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: switchId, target: transformCaseBId, sourceHandle: 'case_b' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: switchId, target: logDefaultId, sourceHandle: 'default' } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: respondCaseAId, target: mergeId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: transformCaseBId, target: mergeId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: logDefaultId, target: mergeId } },
  { kind: 'add-edge', edge: { id: newEdgeId(), source: mergeId, target: finalLogId } },
]).doc;

fs.writeFileSync('scripts/complex-workflow.json', JSON.stringify(doc, null, 2));
console.log('Complex doc written to scripts/complex-workflow.json');
