/**
 * @tramo/spec — the wire contract shared by the editor and every runtime.
 *
 * Bumping `SPEC_VERSION` is a breaking change to the document format.
 * The runner uses it to refuse documents emitted by an incompatible editor.
 */
export const SPEC_VERSION = 1 as const;

export * from './types.js';
export { newNodeId, newEdgeId, isTramoId } from './ids.js';
export { applyPatch, applyPatches, emptyDoc } from './patches.js';
export {
  findNodeById,
  findEdgeById,
  getOutgoingEdges,
  getIncomingEdges,
  getDownstream,
  getUpstream,
  getRoots,
  getLeaves,
  topoSort,
  type TopoResult,
} from './query.js';
export {
  BUILTIN_NODES,
  BUILTIN_REGISTRY,
  createRegistry,
  resolveOutputs,
  parseRoutes,
  type LlmRoute,
  emptySwitchCase,
  newSwitchCaseKey,
  emptyFlowParam,
  mcpServerToIntegration,
  mcpServerToNodeDefs,
  withMcpServers,
  collectSecrets,
  MCP_NODE_ID_PREFIX,
  type NodeRegistry,
} from './nodes.js';
export {
  emptyRuleGroup,
  evaluateRuleGroup,
  isRuleGroup,
  type RuleEvalEnv,
} from './rules.js';
export { slugify, nodeSlug, buildStepSlugMap } from './slug.js';
