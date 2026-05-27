import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyPatches,
  emptyDoc,
  type WorkflowDoc,
} from 'tramo-spec';
import { runCommand, validateCommand, type CommandIO } from '../src/index.js';

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'tramo-cli-'));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function captureIO(): CommandIO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    color: false,
    out,
    err,
  };
}

async function writeDoc(name: string, doc: WorkflowDoc): Promise<string> {
  const path = join(tmp, name);
  await writeFile(path, JSON.stringify(doc), 'utf8');
  return path;
}

function chainDoc(): WorkflowDoc {
  return applyPatches(emptyDoc(), [
    { kind: 'add-node', node: { id: 't', type: 'manual-trigger', config: { payload: '{"x":2}' } } },
    {
      kind: 'add-node',
      node: { id: 'm', type: 'js-transform', config: { expression: 'return { y: input.x * 21 };' } },
    },
    { kind: 'add-node', node: { id: 'l', type: 'log', config: {} } },
    { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'm' } },
    { kind: 'add-edge', edge: { id: 'e2', source: 'm', target: 'l' } },
  ]).doc;
}

describe('validateCommand', () => {
  it('returns 0 for a well-formed workflow', async () => {
    const file = await writeDoc('ok.json', chainDoc());
    const io = captureIO();
    const code = await validateCommand({ file, io });
    expect(code).toBe(0);
    expect(io.out.join('\n')).toMatch(/ok/);
  });

  it('returns 1 when the file does not exist', async () => {
    const io = captureIO();
    const code = await validateCommand({ file: join(tmp, 'missing.json'), io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/cannot read/);
  });

  it('returns 1 when the JSON is malformed', async () => {
    const file = join(tmp, 'broken.json');
    await writeFile(file, '{not json', 'utf8');
    const io = captureIO();
    const code = await validateCommand({ file, io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/not valid JSON/);
  });

  it('returns 1 when spec version mismatches', async () => {
    const file = await writeDoc('badver.json', { ...chainDoc(), version: 99 as unknown as 1 });
    const io = captureIO();
    const code = await validateCommand({ file, io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/spec version/);
  });

  it('returns 1 for unknown node types', async () => {
    const doc = chainDoc();
    doc.nodes.push({ id: 'x', type: 'made-up-node', config: {} });
    const file = await writeDoc('unknown-type.json', doc);
    const io = captureIO();
    const code = await validateCommand({ file, io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/unknown type/);
  });

  it('returns 1 for edges pointing at missing nodes', async () => {
    const doc = chainDoc();
    doc.edges.push({ id: 'dangling', source: 'ghost', target: 'l' });
    const file = await writeDoc('dangling.json', doc);
    const io = captureIO();
    const code = await validateCommand({ file, io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/not found/);
  });
});

describe('runCommand', () => {
  it('runs a workflow and returns 0', async () => {
    const file = await writeDoc('run-ok.json', chainDoc());
    const io = captureIO();
    const code = await runCommand({ file, io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    expect(text).toMatch(/run-start/);
    expect(text).toMatch(/run-end/);
    expect(text).toMatch(/ok/);
  });

  it('returns 1 when a node throws', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: { id: 't', type: 'manual-trigger', config: {} } },
      {
        kind: 'add-node',
        node: { id: 'boom', type: 'js-transform', config: { expression: 'throw new Error("nope");' } },
      },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'boom' } },
    ]).doc;
    const file = await writeDoc('run-err.json', doc);
    const io = captureIO();
    const code = await runCommand({ file, io });
    expect(code).toBe(1);
    expect(io.out.join('\n')).toMatch(/✗|nope/);
  });

  it('returns 1 when the spec version mismatches (runner-side guard)', async () => {
    const file = await writeDoc('run-badver.json', { ...chainDoc(), version: 99 as unknown as 1 });
    const io = captureIO();
    const code = await runCommand({ file, io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/spec version/);
  });

  it('forwards --trigger payload to root nodes', async () => {
    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: { id: 't', type: 'manual-trigger', config: {} } },
      {
        kind: 'add-node',
        node: { id: 'echo', type: 'js-transform', config: { expression: 'return input;' } },
      },
      { kind: 'add-node', node: { id: 'l', type: 'log', config: {} } },
      { kind: 'add-edge', edge: { id: 'e1', source: 't', target: 'echo' } },
      { kind: 'add-edge', edge: { id: 'e2', source: 'echo', target: 'l' } },
    ]).doc;
    const file = await writeDoc('run-trigger.json', doc);
    const io = captureIO();
    const code = await runCommand({ file, trigger: { hello: 'world' }, io });
    expect(code).toBe(0);
    // The `log` node emits a node-log event containing the trigger payload.
    expect(io.out.join('\n')).toMatch(/hello.*world/);
  });

  it('returns 1 when the file does not exist', async () => {
    const io = captureIO();
    const code = await runCommand({ file: join(tmp, 'absent.json'), io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toMatch(/cannot read/);
  });
});
