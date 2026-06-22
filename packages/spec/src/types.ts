/**
 * Core types for tramo — the workflow-document-of-truth model.
 *
 * Same design principle as htmlstudio's HTML-source-of-truth: one
 * canonical representation (here, WorkflowDoc), mutated by a small
 * union of typed Patches. Humans click in the UI, LLMs emit the
 * same patches via a tool call. One channel, two callers.
 */

/* ====================================================================== */
/* Document                                                                 */
/* ====================================================================== */

export interface WorkflowDoc {
  /** Schema version. Bumped only on breaking changes. */
  version: 1;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  meta: WorkflowMeta;
}

export interface WorkflowMeta {
  name?: string;
  description?: string;
  /** Free-form tags for filtering. */
  tags?: string[];
  /** Last-touched timestamp (ms since epoch). Optional; runtimes/UI may stamp it. */
  updatedAt?: number;
  /**
   * Workflow-level revision number, distinct from the doc-format `version`.
   * Bumped on each save so hosts can roll back, A/B, and reference a specific
   * iteration. The editor increments it; the server can snapshot per revision.
   */
  revision?: number;
  /** Optional human-readable version label, e.g. "v2 — added refund branch". */
  versionTag?: string;
  /**
   * Visual groupings of nodes ("compound nodes"). Purely an editor-side
   * abstraction — the runtime ignores them. A collapsed group can be drawn
   * as a single placeholder; members are addressed by id as usual.
   */
  groups?: NodeGroup[];
  /**
   * MCP servers imported into this workflow. Each entry both persists the
   * server's connection info (URL + optional bearer token) and caches the
   * tools/list response so the picker can render tiles offline. The editor
   * folds these into a dynamic NodeDefinition overlay on top of the static
   * registry; the runtime never reads them directly — node configs carry
   * their own copy of serverUrl + toolName.
   */
  mcpServers?: MCPServerRef[];
}

/**
 * A named, optionally-collapsible group of nodes. Editor-only metadata for
 * abstracting large graphs; the runtime never reads it.
 */
export interface NodeGroup {
  id: string;
  label: string;
  /** Member node ids. */
  nodeIds: string[];
  /** When true, the editor may render the group as one collapsed placeholder. */
  collapsed?: boolean;
  /** Accent color (hex). */
  color?: string;
}

/* ====================================================================== */
/* MCP (Model Context Protocol) — imported servers + cached tool defs       */
/* ====================================================================== */

export interface MCPToolRef {
  /** The exact tool name as returned by the server's tools/list. */
  name: string;
  /** Human-readable description (used as the picker row subtitle). */
  description?: string;
  /** JSON schema for the tool's arguments object. Optional; surfaced as a
   *  hint in the inspector when present. */
  inputSchema?: unknown;
}

export interface MCPServerRef {
  /** Stable slug — used as the integrationId for synthesized tiles and as
   *  the `<serverId>` segment in synthesized NodeDefinition ids. */
  id: string;
  /** Display name shown on the picker tile. */
  name: string;
  /** HTTP endpoint the runtime POSTs JSON-RPC requests to. */
  url: string;
  /** Optional bearer token sent on every call. */
  authToken?: string;
  /** Optional one-line description shown under the tile name. */
  description?: string;
  /** Cached tool list from the last tools/list call. May be stale; the
   *  editor refreshes on demand. */
  tools: MCPToolRef[];
  /** Wall-clock timestamp of the last tools/list refresh. */
  fetchedAt?: number;
}

/**
 * Policy controlling when a node executes relative to its predecessors.
 *
 *   - `on-success` (default): run only when every predecessor produced a
 *     value. Predecessor errors or skips propagate.
 *   - `on-error`: run only when at least one predecessor errored — useful
 *     for fallback / cleanup branches.
 *   - `always`: run regardless of predecessor outcomes (errored, skipped,
 *     or successful). Missing inputs arrive as `undefined`.
 */
export type RunAfter = 'on-success' | 'on-error' | 'always';

/**
 * Per-node retry policy. When a node's executor *throws* (as opposed to
 * returning an `{ error }` envelope on a dedicated port), the runtime can
 * retry it up to `count` extra times, waiting `delayMs` between attempts and
 * scaling that wait by `backoff`. Returning an error envelope is a normal
 * success from the scheduler's view and is never retried.
 */
export interface RetryPolicy {
  /** Maximum number of *additional* attempts after the first one fails. */
  count: number;
  /** Base wait before the first retry, in ms. Default 0. */
  delayMs?: number;
  /**
   * How the wait grows across attempts:
   *   - `fixed`        : delayMs every time (default).
   *   - `linear`       : delayMs × attemptNumber.
   *   - `exponential`  : delayMs × 2^(attemptNumber-1).
   */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** Clamp the computed wait to at most this many ms. */
  maxDelayMs?: number;
  /** Add up to ±50% random jitter to each wait to avoid thundering herds. */
  jitter?: boolean;
}

export interface WorkflowNode {
  /** Stable id, generated by `newNodeId()`. Survives the lifetime of the node. */
  id: string;
  /** References a NodeDefinition.id from the registry. */
  type: string;
  /** Typed against the matching NodeDefinition.fields. */
  config: Record<string, unknown>;
  /** Optional display label override; defaults to NodeDefinition.name. */
  label?: string;
  /** Execution policy relative to predecessors. Defaults to `on-success`. */
  runAfter?: RunAfter;
  /** Optional automatic-retry policy for transient executor failures. */
  retry?: RetryPolicy;
  /**
   * Marks a node as security-sensitive. The runtime can require a matching
   * role in `RunOptions.roles` before executing it; the editor badges it.
   * Pair with the approval gate for human sign-off on dangerous steps.
   */
  sensitive?: boolean;
  /**
   * Role required to execute this node. Checked against `RunOptions.roles`.
   * Undefined = no role gate. Implies `sensitive` for badging purposes.
   */
  requiredRole?: string;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Output port key on `source`. Defaults to 'out' if unspecified. */
  sourceHandle?: string;
  /** Input port key on `target`. Defaults to 'in' if unspecified. */
  targetHandle?: string;
}

/* ====================================================================== */
/* Patches                                                                  */
/* ====================================================================== */

/**
 * Six patch kinds — the only ways to mutate a WorkflowDoc.
 *
 * Mirrors htmlstudio's Patch union in spirit: narrow patches
 * (update-node-config) for surgical edits, broader patches (set-full-doc)
 * for whole-document replacement (e.g. an LLM regeneration).
 *
 * Note: there is no `move-node` patch. Node positions are auto-computed
 * by the canvas engine from the DAG structure — they aren't stored on
 * the doc at all.
 */
export type Patch =
  | { kind: 'add-node'; node: WorkflowNode }
  | { kind: 'update-node-config'; id: string; config: Record<string, unknown>; replace?: boolean }
  | { kind: 'update-node'; id: string; patch: Partial<Pick<WorkflowNode, 'label' | 'runAfter' | 'retry' | 'sensitive' | 'requiredRole'>> }
  | { kind: 'remove-node'; id: string }
  | { kind: 'add-edge'; edge: WorkflowEdge }
  | { kind: 'remove-edge'; id: string }
  | { kind: 'set-full-doc'; doc: WorkflowDoc }
  | { kind: 'upsert-mcp-server'; server: MCPServerRef }
  | { kind: 'remove-mcp-server'; id: string };

export interface PatchResult {
  ok: boolean;
  doc: WorkflowDoc;
  error?: string;
}

/* ====================================================================== */
/* Node definitions (editor-side metadata)                                  */
/* ====================================================================== */

export type PortType =
  | 'any'
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array';

export interface NodePort {
  /** Stable key used in edges' sourceHandle/targetHandle. */
  key: string;
  /** Human-readable label shown in the inspector. */
  label: string;
  /** Hint for the runtime + UI — no hard schema enforcement at v0.1. */
  type: PortType;
  description?: string;
}

export type NodeFieldType =
  | 'text'
  | 'textarea'
  | 'url'
  | 'number'
  | 'boolean'
  | 'select'
  | 'json'
  | 'code'
  | 'rule'
  | 'switch-cases'
  | 'flow-params'
  | 'flow-ref'
  | 'secret';

/* ---------------------------------------------------------------------- */
/* Rule tree — structured condition value used by `rule` fields            */
/* ---------------------------------------------------------------------- */

export type RuleCombinator = 'and' | 'or';

export type RuleOp =
  | '=' | '!='
  | '>' | '>=' | '<' | '<='
  | 'contains' | 'not-contains'
  | 'starts-with' | 'ends-with'
  | 'matches'
  | 'in' | 'not-in'
  | 'is-empty' | 'is-not-empty'
  | 'exists' | 'not-exists'
  | 'is-truthy' | 'is-falsy';

export interface RuleCondition {
  kind: 'condition';
  /** JS expression evaluated against `input`, `vars`, `config`. */
  left: string;
  op: RuleOp;
  /**
   * Right-hand side. By default treated as a literal value. If
   * `rightIsExpr` is true, evaluated as a JS expression instead
   * (e.g. `vars.threshold`). Unary ops ignore this field.
   */
  right?: unknown;
  rightIsExpr?: boolean;
  /** Negate the row's result. */
  not?: boolean;
}

export interface RuleGroup {
  kind: 'group';
  combinator: RuleCombinator;
  rules: RuleNode[];
  not?: boolean;
}

export type RuleNode = RuleCondition | RuleGroup;

export interface NodeFieldOption {
  label: string;
  value: string;
}

export interface NodeField {
  /** Key used in the node's `config` object. */
  key: string;
  type: NodeFieldType;
  label: string;
  help?: string;
  default?: string | number | boolean | null;
  options?: NodeFieldOption[];
  /** Allow empty/null. Default false. */
  optional?: boolean;
  /** For 'code' fields, the language (e.g. 'javascript', 'sql'). */
  language?: string;
}

export type NodeCategory =
  | 'trigger'
  | 'action'
  | 'transform'
  | 'logic'
  | 'state'
  | 'ai'
  | 'io';

export interface NodeDefinition {
  /** Stable id used by WorkflowNode.type and by the runtime's executor map. */
  id: string;
  name: string;
  category: NodeCategory;
  description: string;
  /** Lucide icon name (e.g. "Play", "Globe", "Code"). Rendered when
   *  `iconBrand` is unset. */
  icon: string;
  /** Optional simple-icons slug (e.g. "slack", "github"). When set,
   *  the canvas and palette render the brand SVG instead of `icon`. */
  iconBrand?: string;
  /** Input ports (empty for triggers). */
  inputs: NodePort[];
  /** Output ports. */
  outputs: NodePort[];
  /** Editable fields rendered in the inspector. */
  fields: NodeField[];
  /** Accent color (hex) — used on the canvas node's top stripe. Optional. */
  color?: string;
  /** When set, this node is an *operation* belonging to an integration pack
   *  (e.g. `github`, `discord`). The picker groups operations under their
   *  integration tile; the runtime is unaffected. */
  integrationId?: string;
  /** Short label shown for this operation inside its integration drill-in.
   *  Falls back to `name` when unset — useful when the parent integration
   *  already implies the brand (e.g. "Create issue" instead of "GitHub: Create issue"). */
  operationName?: string;
}

/**
 * IntegrationDefinition — a "pack" that bundles multiple operations under
 * one brand (GitHub, Discord, Telegram, …). The pack itself doesn't run;
 * its `nodes` are the things added to the workflow.
 *
 * The shape is intentionally JSON-friendly so an LLM can be handed a third-
 * party API doc + this schema and emit a new pack file in one shot.
 */
/* ---------------------------------------------------------------------- */
/* Switch cases — value for `switch-cases` fields                          */
/* ---------------------------------------------------------------------- */

/**
 * One labelled branch on a Switch node. `key` is the stable port id used
 * by edges (and must stay stable across renames); `label` is the human-
 * readable name shown on the canvas and in the inspector. `rules` is
 * evaluated by the same engine as the If node — the first matching case
 * wins, and an unmatched input falls through to the implicit `default`
 * port.
 */
export interface SwitchCase {
  key: string;
  label: string;
  rules: RuleGroup;
}

/* ---------------------------------------------------------------------- */
/* Flow params — value for `flow-params` fields (sub-flow I/O contracts)   */
/* ---------------------------------------------------------------------- */

export type FlowParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';

/**
 * One named input or output on a sub-flow's signature. `flow-input` nodes
 * declare params and emit `{ [name]: value }` on their `out` port;
 * `flow-output` nodes declare the return shape and capture `{ [name]:
 * value }` on their `in` port. `call-flow` reads both sides to build its
 * inspector form.
 */
export interface FlowParam {
  name: string;
  type: FlowParamType;
  description?: string;
  /** Default value as a JSON-encoded string. Empty / missing = no default. */
  default?: string;
}

export interface IntegrationDefinition {
  /** Stable slug used as NodeDefinition.integrationId, e.g. 'github'. */
  id: string;
  /** Display name for the tile, e.g. 'GitHub'. */
  name: string;
  /** One-line tagline rendered under the tile name. */
  description: string;
  /** simple-icons slug (preferred) or a lucide name via `icon`. */
  iconBrand?: string;
  icon?: string;
  /** Accent color (hex). Optional; falls back to the operation's color. */
  color?: string;
  /** Coarse picker grouping, e.g. 'Communication', 'Developer', 'Productivity'. */
  category?: string;
}
