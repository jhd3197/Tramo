import { describe, expect, it } from 'vitest';
import { applyPatches, emptyDoc, type WorkflowNode } from '@tramo/spec';
import {
  BUILTIN_EXECUTOR_REGISTRY,
  memoryCheckpointStore,
  run,
  type ResumeState,
} from '../src/index.js';

function node(id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, config };
}

const gateDoc = () =>
  applyPatches(emptyDoc(), [
    { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{"amount":500}' }) },
    { kind: 'add-node', node: node('gate', 'approval-gate', { message: 'Send {{amount}}?', gateKey: 'pay' }) },
    { kind: 'add-node', node: node('ok', 'log', { prefix: 'SENT' }) },
    { kind: 'add-node', node: node('no', 'log', { prefix: 'CANCELLED' }) },
    { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'gate' } },
    { kind: 'add-edge', edge: { id: 'e2', source: 'gate', target: 'ok', sourceHandle: 'approved' } },
    { kind: 'add-edge', edge: { id: 'e3', source: 'gate', target: 'no', sourceHandle: 'rejected' } },
  ]).doc;

describe('approval gate — suspend & resume', () => {
  it('suspends at the gate with a pending request', async () => {
    const result = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY);
    expect(result.status).toBe('suspended');
    expect(result.pendingApprovals).toHaveLength(1);
    expect(result.pendingApprovals![0].key).toBe('pay');
    expect(result.pendingApprovals![0].message).toBe('Send 500?');
    // The downstream nodes did not run.
    expect(result.nodeResults.ok).toBeUndefined();
    expect(result.nodeResults.no).toBeUndefined();
    // A checkpoint was produced for resuming.
    expect(result.checkpoint).toBeDefined();
    expect(result.checkpoint!.nodeResults.t).toBeDefined();
    const waiting = result.events.find((e) => e.type === 'node-waiting');
    expect(waiting).toBeDefined();
    const suspendEvt = result.events.find((e) => e.type === 'run-suspended');
    expect(suspendEvt).toBeDefined();
  });

  it('resumes and routes to the approved branch', async () => {
    const first = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY);
    const resumed = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY, {
      resumeFrom: first.checkpoint as ResumeState,
      approvals: { pay: { approved: true, by: 'alice' } },
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.nodeResults.ok).toBeDefined();
    expect(resumed.nodeResults.no).toBeUndefined();
  });

  it('resumes and routes to the rejected branch', async () => {
    const first = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY);
    const resumed = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY, {
      resumeFrom: first.checkpoint as ResumeState,
      approvals: { pay: { approved: false, by: 'bob', comment: 'too much' } },
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.nodeResults.no).toBeDefined();
    expect(resumed.nodeResults.ok).toBeUndefined();
  });

  it('sets expiresAt when a timeout is configured', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: node('t', 'manual-trigger', { payload: '{}' }) },
      { kind: 'add-node', node: node('gate', 'approval-gate', { gateKey: 'g', timeoutSec: 60 }) },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'gate' } },
    ]).doc;
    const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY);
    expect(result.pendingApprovals![0].expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('checkpoint store', () => {
  it('persists and reloads a suspended run end-to-end', async () => {
    const store = memoryCheckpointStore();
    const first = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY, {
      checkpoint: (s) => store.save(s),
    });
    expect(first.status).toBe('suspended');

    // Simulate process restart: reload from the store and resume.
    const ids = await store.list();
    expect(ids).toContain(first.runId);
    const loaded = await store.load(first.runId);
    expect(loaded).not.toBeNull();

    const resumed = await run(gateDoc(), BUILTIN_EXECUTOR_REGISTRY, {
      resumeFrom: loaded!,
      approvals: { pay: { approved: true } },
    });
    expect(resumed.status).toBe('completed');
    expect(resumed.nodeResults.ok).toBeDefined();
    expect(resumed.runId).toBe(first.runId);
  });
});
