import { readFile } from 'node:fs/promises';
import {
  BUILTIN_EXECUTOR_REGISTRY,
  run,
  type RunEvent,
} from 'tramo-runtime';
import type { WorkflowDoc } from 'tramo-spec';
import { makeFormatter } from './format.js';
import type { CommandIO } from './io.js';

export interface RunOptions {
  file: string;
  /** Optional trigger payload exposed to root nodes via their `in` port. */
  trigger?: unknown;
  io: CommandIO;
}

/**
 * `tramo run <file> [--trigger '<json>']` — executes a workflow once,
 * streams events to stdout, exits 0 on success / 1 on any node error.
 *
 * The CLI only ships the `BUILTIN_EXECUTOR_REGISTRY`. Custom executor
 * packs would need a different entry point — out of scope for v1.
 */
export async function runCommand(opts: RunOptions): Promise<number> {
  const { file, trigger, io } = opts;
  const fmt = makeFormatter(io.color);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    io.stderr(`${fmt.paint('error:', 'red')} cannot read ${file}: ${(err as Error).message}`);
    return 1;
  }

  let doc: WorkflowDoc;
  try {
    doc = JSON.parse(raw) as WorkflowDoc;
  } catch (err) {
    io.stderr(`${fmt.paint('error:', 'red')} ${file} is not valid JSON: ${(err as Error).message}`);
    return 1;
  }

  let sawNodeError = false;
  const onEvent = (event: RunEvent) => {
    if (event.type === 'node-error') sawNodeError = true;
    io.stdout(fmt.formatEvent(event));
  };

  const result = await run(doc, BUILTIN_EXECUTOR_REGISTRY, { trigger, onEvent });

  if (!result.ok) {
    io.stderr(`${fmt.paint('error:', 'red')} ${result.error ?? 'run failed'}`);
    return 1;
  }

  return sawNodeError ? 1 : 0;
}
