import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPatches, emptyDoc } from '@tramo/spec';

// Exercises the compiled bin (run `npm run build` first) — the same entry the
// Docker image boots.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin', 'tramo-server.js');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base: string, child: ChildProcess): Promise<Response> {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with code ${child.exitCode}`);
    try {
      return await fetch(`${base}/api/health`);
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server never became healthy');
}

let child: ChildProcess | undefined;
let dir: string | undefined;

afterEach(() => {
  child?.kill();
  child = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('tramo-server CLI', () => {
  it('boots with an empty workflow dir and picks workflows up on reload', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tramo-cli-'));
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [BIN, dir, '--port', String(port), '--host', '127.0.0.1', '--no-cron'], {
      env: { ...process.env, TRAMO_API_KEY: '', TRAMO_PACKS: 'builtin' },
      stdio: 'ignore',
    });

    const health = await waitForHealth(base, child);
    expect(health.status).toBe(200);
    expect((await health.json()).workflows).toBe(0);

    const doc = applyPatches(emptyDoc(), [
      { kind: 'add-node', node: { id: 't', type: 'manual-trigger', config: {} } },
    ]).doc;
    writeFileSync(join(dir, 'first.json'), JSON.stringify(doc));

    const reload = await fetch(`${base}/api/reload`, { method: 'POST' });
    expect(reload.status).toBe(200);
    const after = await (await fetch(`${base}/api/health`)).json();
    expect(after.workflows).toBe(1);
  });
});
