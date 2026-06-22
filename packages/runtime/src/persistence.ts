/**
 * Durable checkpoint storage for resume-after-crash and suspended runs.
 *
 * A `CheckpointStore` persists `ResumeState` snapshots keyed by runId. Pass
 * `checkpoint: (s) => store.save(s)` to `run()` to checkpoint after every
 * layer; on restart, `load(runId)` + `resumeFrom` continues where it left
 * off. Two implementations ship: in-memory (tests, ephemeral) and a JSON
 * file-per-run store (Node hosts). The interface is the extension point for
 * Redis/Postgres/S3 adapters.
 */

import type { ResumeState } from './types.js';

export interface CheckpointStore {
  save(state: ResumeState): Promise<void>;
  load(runId: string): Promise<ResumeState | null>;
  list(): Promise<string[]>;
  delete(runId: string): Promise<void>;
}

/** In-memory store — handy for tests and single-process hosts. */
export function memoryCheckpointStore(): CheckpointStore {
  const map = new Map<string, ResumeState>();
  return {
    async save(state) {
      map.set(state.runId, structuredCloneSafe(state));
    },
    async load(runId) {
      const s = map.get(runId);
      return s ? structuredCloneSafe(s) : null;
    },
    async list() {
      return Array.from(map.keys());
    },
    async delete(runId) {
      map.delete(runId);
    },
  };
}

/**
 * JSON file-per-run store under `dir`. Each run lives at `<dir>/<runId>.json`.
 * Lazily imports `node:fs` so the module stays importable in the browser.
 */
export function fileCheckpointStore(dir: string): CheckpointStore {
  const fileFor = async (runId: string) => {
    const path = await import('node:path');
    return path.join(dir, `${sanitize(runId)}.json`);
  };
  const ensureDir = async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
  };
  return {
    async save(state) {
      await ensureDir();
      const { writeFile, rename } = await import('node:fs/promises');
      const file = await fileFor(state.runId);
      // Write-then-rename for atomicity against a crash mid-write.
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(state), 'utf8');
      await rename(tmp, file);
    },
    async load(runId) {
      try {
        const { readFile } = await import('node:fs/promises');
        const file = await fileFor(runId);
        return JSON.parse(await readFile(file, 'utf8')) as ResumeState;
      } catch {
        return null;
      }
    },
    async list() {
      try {
        const { readdir } = await import('node:fs/promises');
        const files = await readdir(dir);
        return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
      } catch {
        return [];
      }
    },
    async delete(runId) {
      try {
        const { rm } = await import('node:fs/promises');
        await rm(await fileFor(runId), { force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function sanitize(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function structuredCloneSafe<T>(v: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(v)) as T;
}
