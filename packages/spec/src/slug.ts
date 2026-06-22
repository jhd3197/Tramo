/**
 * Slug helpers for addressing nodes by a human-friendly key in templates
 * and JS expressions (e.g. `{{steps.fetch_github_user.login}}`).
 *
 * Slugs are derived from a node's label or definition name; if both are
 * missing/empty we fall back to the node id so every node always has a
 * stable key. Collisions are resolved deterministically by walking the
 * node list in document order and appending `_2`, `_3`, … to duplicates.
 */

import type { NodeDefinition, WorkflowDoc, WorkflowNode } from './types.js';

/** Convert a free-form label to a safe identifier-like slug. */
export function slugify(raw: string): string {
  // Strip `{{var}}` chips first — labels may embed template tokens that
  // we don't want to bake into the slug (e.g. `Fetch GitHub user {{user}}`
  // should slug to `fetch_github_user`, not `fetch_github_user_user`).
  const withoutTemplates = raw.replace(/\{\{[^}]*\}\}/g, ' ');
  const lowered = withoutTemplates.toLowerCase().normalize('NFKD');
  // Strip combining marks then collapse anything that isn't [a-z0-9] to `_`.
  const stripped = lowered.replace(/\p{M}+/gu, '');
  const replaced = stripped.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return replaced;
}

/**
 * Derive a single node's preferred slug. Does NOT handle collisions —
 * use {@link buildStepSlugMap} when you need uniqueness across a doc.
 */
export function nodeSlug(node: WorkflowNode, def?: NodeDefinition): string {
  const source = (node.label ?? def?.name ?? node.type ?? '').trim();
  const s = slugify(source);
  return s || node.id;
}

/**
 * Build a doc-wide `slug → nodeId` map with collisions disambiguated by
 * suffixing `_2`, `_3`, …. The first node wins the bare slug; later nodes
 * with the same preferred slug get suffixed.
 */
export function buildStepSlugMap(
  doc: WorkflowDoc,
  resolveDef: (type: string) => NodeDefinition | undefined,
): { slugToId: Map<string, string>; idToSlug: Map<string, string> } {
  const slugToId = new Map<string, string>();
  const idToSlug = new Map<string, string>();
  const taken = new Set<string>();

  for (const node of doc.nodes) {
    const base = nodeSlug(node, resolveDef(node.type));
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${base}_${n++}`;
    }
    taken.add(candidate);
    slugToId.set(candidate, node.id);
    idToSlug.set(node.id, candidate);
  }

  return { slugToId, idToSlug };
}
