/**
 * Node-pack convention.
 *
 * A `NodePack` bundles a `NodeDefinition` (UI metadata from `@tramo/spec`)
 * with its matching `NodeExecutor` (runtime behaviour from this package)
 * as a single distributable unit. Pack authors ship one npm package that
 * exports a `NodePack`; consumers merge any number of packs into the
 * editor and runtime registries with `combinePacks`.
 *
 * The shape is deliberately minimal: just an id, name, version, and a
 * list of {definition, executor} pairs. No custom React renderers, no
 * field-type extensions, no lifecycle hooks — the spec's existing
 * `NodeField` types and the runtime's existing `ExecutionContext` cover
 * every built-in node, so they should cover most third-party ones too.
 *
 * Strictness choice: `combinePacks` throws on id collisions across
 * packs. Silent shadowing makes accidental conflicts invisible; if
 * users genuinely want to replace a built-in node, they wrap it in a
 * custom pack that omits the conflicting one.
 */

import {
  BUILTIN_NODES,
  createRegistry,
  type IntegrationDefinition,
  type NodeDefinition,
  type NodeRegistry,
} from '@tramo/spec';
import { BUILTIN_EXECUTORS, createExecutorRegistry } from './executors.js';
import type { ExecutorRegistry, NodeExecutor } from './types.js';

export interface NodePackEntry {
  definition: NodeDefinition;
  executor: NodeExecutor;
}

export interface NodePack {
  /** Slug identifying the pack itself (e.g. `'builtin'`, `'slack'`). */
  readonly id: string;
  /** Human-friendly name shown when listing installed packs. */
  readonly name: string;
  /** Semver string; informational, not enforced. */
  readonly version: string;
  /** Frozen list of node entries the pack provides. */
  readonly entries: readonly NodePackEntry[];
  /** Integration metadata the pack contributes (one tile per integration
   *  in the editor's step picker). Operation node ids should match the
   *  `integrationId` on entries' definitions. Optional — packs that ship
   *  only standalone nodes can omit it. */
  readonly integrations: readonly IntegrationDefinition[];
}

export interface DefineNodePackInput {
  id: string;
  name: string;
  version: string;
  entries: NodePackEntry[];
  integrations?: IntegrationDefinition[];
}

const PACK_ID_RE = /^[a-z][a-z0-9-]*(\/[a-z0-9-]+)?$/;

/**
 * Validate and freeze a `NodePack` declaration.
 *
 * Enforced at construction time:
 *   - `id` is a slug (lower-case letters, digits, dashes; optional one
 *     namespace prefix like `my-org/slack`).
 *   - Every entry's `definition.id` equals its `executor.id` — pack
 *     authors can't ship a definition with no executor or vice versa.
 *   - No duplicate node ids within the pack.
 */
export function defineNodePack(input: DefineNodePackInput): NodePack {
  if (!PACK_ID_RE.test(input.id)) {
    throw new Error(
      `defineNodePack: id "${input.id}" must be a slug (a-z, 0-9, dash; optional one namespace prefix like "my-org/slack")`,
    );
  }

  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (entry.definition.id !== entry.executor.id) {
      throw new Error(
        `defineNodePack (${input.id}): entry has mismatched ids — definition "${entry.definition.id}" vs executor "${entry.executor.id}"`,
      );
    }
    if (seen.has(entry.definition.id)) {
      throw new Error(`defineNodePack (${input.id}): duplicate node id "${entry.definition.id}"`);
    }
    seen.add(entry.definition.id);
  }

  return Object.freeze({
    id: input.id,
    name: input.name,
    version: input.version,
    entries: Object.freeze([...input.entries]),
    integrations: Object.freeze([...(input.integrations ?? [])]),
  });
}

/**
 * Build a stub executor for a brand-pack node so authors don't have to
 * hand-write the same logger-and-passthrough block 60 times.
 *
 * Triggers forward the inbound webhook payload (matching the built-in
 * `webhook-trigger` shape). Everything else returns a deterministic
 * `{ ok: true, stub: id, config, input }` envelope downstream templates
 * can build against before a real implementation is wired in.
 */
export function defineStubExecutor(definition: NodeDefinition): NodeExecutor {
  const label = definition.operationName ?? definition.name;
  if (definition.category === 'trigger') {
    return {
      id: definition.id,
      execute: (ctx) => {
        ctx.log.info(`${label} trigger payload`, ctx.inputs.in);
        return { out: ctx.inputs.in ?? { body: null, headers: {}, query: {} } };
      },
    };
  }
  return {
    id: definition.id,
    execute: (ctx) => {
      ctx.log.info(`${label} (stub) — config:`, ctx.config);
      return { out: { ok: true, stub: definition.id, config: ctx.config, input: ctx.inputs.in } };
    },
  };
}

export interface CombinedRegistries {
  /** Editor-side registry of node definitions. Pass to `useWorkflow`. */
  nodes: NodeRegistry;
  /** Runtime-side registry of node executors. Pass to `run()`. */
  executors: ExecutorRegistry;
  /** Lookup from node id back to the pack that contributed it. */
  source: ReadonlyMap<string, string>;
}

/**
 * Merge a list of packs into the registries the editor and runtime need.
 *
 * Throws on any cross-pack node-id collision. To intentionally override
 * a built-in, build a custom pack that omits the original; don't try to
 * shadow it.
 */
export function combinePacks(packs: NodePack[]): CombinedRegistries {
  const source = new Map<string, string>();
  const definitions: NodeDefinition[] = [];
  const executors: NodeExecutor[] = [];
  const integrationMap = new Map<string, IntegrationDefinition>();

  for (const pack of packs) {
    for (const entry of pack.entries) {
      const owner = source.get(entry.definition.id);
      if (owner) {
        throw new Error(
          `combinePacks: node "${entry.definition.id}" is provided by both "${owner}" and "${pack.id}". Wrap one in a custom pack that omits it to override.`,
        );
      }
      source.set(entry.definition.id, pack.id);
      definitions.push(entry.definition);
      executors.push(entry.executor);
    }
    for (const integ of pack.integrations) {
      if (!integrationMap.has(integ.id)) integrationMap.set(integ.id, integ);
    }
  }

  return {
    nodes: createRegistry(definitions, Array.from(integrationMap.values())),
    executors: createExecutorRegistry(executors),
    source,
  };
}

/**
 * The thirteen built-in nodes, exposed as a `NodePack`.
 *
 * Tramo's own built-ins flow through the same convention that
 * third-party packs use — if the API can't ship the built-ins, it isn't
 * good enough for plugins.
 */
export const BUILTIN_PACK: NodePack = defineNodePack({
  id: 'builtin',
  name: 'Tramo built-ins',
  version: '0.1.0',
  entries: BUILTIN_NODES.map((definition) => {
    const direct = BUILTIN_EXECUTORS.find((e) => e.id === definition.id);
    if (direct) return { definition, executor: direct };
    throw new Error(`Internal: no executor registered for built-in node "${definition.id}"`);
  }),
  integrations: [],
});
