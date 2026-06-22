/**
 * @tramo/server — long-running host for tramo workflows.
 *
 * ```ts
 * import { createTramoServer } from '@tramo/server';
 * import { combinePacks, BUILTIN_PACK } from '@tramo/runtime';
 * import GITHUB from '@tramo/github';
 *
 * const { executors, nodes } = combinePacks([BUILTIN_PACK, GITHUB]);
 * const server = createTramoServer({ workflows: { myFlow }, executors, nodes });
 * await server.listen(3000);
 * ```
 */

export { TramoHost } from './host.js';
export type {
  TramoHostOptions,
  WebhookLikeRequest,
  WebhookLikeResponse,
} from './host.js';
export { createTramoServer } from './http-server.js';
export type { TramoServer, TramoServerOptions } from './http-server.js';
export { RunHistory } from './history.js';
export type { RunRecord, RunStats, RunStatus, RunSource } from './history.js';
export { loadWorkflowsFromDir } from './load.js';
