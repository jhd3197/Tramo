/**
 * Pack resolution for the host.
 *
 * The stock server loads only the built-in executor registry, so nodes from
 * brand packs (telegram, github, serverkit, …) don't actually execute. This
 * module resolves which packs to load from a mode string — normally the
 * `TRAMO_PACKS` env var or the `--packs` flag — and merges them with the
 * built-in pack via `combinePacks`.
 *
 * Packs are imported dynamically so the default builtin-only path never pulls
 * a single integration into memory (and never fails if an integration package
 * isn't installed). `mode` accepts:
 *
 *   - unset / `builtin` / `none`  → builtin executors only (unchanged default)
 *   - `all`                       → builtin + every first-party integration pack
 *   - `telegram,github,…`         → builtin + the named first-party packs
 */

import {
  BUILTIN_EXECUTOR_REGISTRY,
  BUILTIN_PACK,
  combinePacks,
  type ExecutorRegistry,
} from '@tramo/runtime';
import type { NodeRegistry } from '@tramo/spec';

/** npm names of every first-party integration pack, in workspace order. */
export const FIRST_PARTY_PACKS: readonly string[] = [
  '@tramo/gmail',
  '@tramo/github',
  '@tramo/telegram',
  '@tramo/discord',
  '@tramo/notion',
  '@tramo/openai',
  '@tramo/anthropic',
  '@tramo/linear',
  '@tramo/airtable',
  '@tramo/stripe',
  '@tramo/cloudflare',
  '@tramo/google-drive',
  '@tramo/google-sheets',
  '@tramo/google-tasks',
  '@tramo/outlook',
  '@tramo/postgres',
  '@tramo/twilio',
  '@tramo/youtube',
  '@tramo/x',
  '@tramo/trello',
  '@tramo/box',
  '@tramo/serverkit',
];

// A pack is `defineNodePack(...)` output; keep the shape loose to avoid a hard
// build-time dependency on every integration's types.
type LoadedPack = { id: string; name: string; version: string; entries: readonly unknown[]; integrations: readonly unknown[] };

export interface ResolvedRegistries {
  executors: ExecutorRegistry;
  /** Present only when packs beyond the builtins were merged. */
  nodes?: NodeRegistry;
  /** Ids of the packs that were merged (always includes `builtin`). */
  packIds: string[];
}

/** Map a brand slug (`telegram`) to its npm specifier (`@tramo/telegram`). */
function specifierFor(slug: string): string {
  return slug.startsWith('@tramo/') ? slug : `@tramo/${slug}`;
}

async function importPack(specifier: string): Promise<LoadedPack> {
  const mod = (await import(specifier)) as { default?: LoadedPack };
  if (!mod.default) throw new Error(`@tramo/server: ${specifier} has no default pack export`);
  return mod.default;
}

/**
 * Resolve the executor (and node) registries for a given pack mode. Never
 * mutates global state; returns the builtin registry untouched for the
 * default path.
 */
export async function resolveRegistries(mode: string | undefined): Promise<ResolvedRegistries> {
  const normalized = (mode ?? '').trim().toLowerCase();
  if (normalized === '' || normalized === 'builtin' || normalized === 'none') {
    return { executors: BUILTIN_EXECUTOR_REGISTRY, packIds: ['builtin'] };
  }

  const specifiers =
    normalized === 'all'
      ? [...FIRST_PARTY_PACKS]
      : mode!
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map(specifierFor);

  const packs: LoadedPack[] = [];
  for (const spec of specifiers) {
    try {
      packs.push(await importPack(spec));
    } catch (err) {
      throw new Error(`@tramo/server: failed to load pack ${spec}: ${(err as Error).message}`);
    }
  }

  // `combinePacks` is typed against the runtime's NodePack; the loaded packs
  // are structurally identical (they come from the same `defineNodePack`).
  const combined = combinePacks([BUILTIN_PACK, ...(packs as never[])]);
  return {
    executors: combined.executors,
    nodes: combined.nodes,
    packIds: ['builtin', ...packs.map((p) => p.id)],
  };
}
