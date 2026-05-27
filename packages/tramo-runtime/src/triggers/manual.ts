/**
 * Manual trigger driver: just calls run(). Exists so the trigger interface
 * stays uniform — every trigger type has a `start()` and `stop()`.
 */

import { run } from '../runner.js';
import type { ExecutorRegistry, RunResult, RunOptions, WorkflowDoc } from '../types.js';

export interface ManualTriggerHandle {
  fire: (payload?: unknown) => Promise<RunResult>;
  stop: () => void;
}

export function manual(
  doc: WorkflowDoc,
  registry: ExecutorRegistry,
  options: Omit<RunOptions, 'trigger'> = {},
): ManualTriggerHandle {
  return {
    fire: (payload) => run(doc, registry, { ...options, trigger: payload }),
    stop: () => {},
  };
}
