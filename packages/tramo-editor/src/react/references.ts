/**
 * Variable references / go-to-definition.
 *
 * Scans node config for `{{steps.<slug>.<path>}}` and `{{vars.<name>}}`
 * tokens, resolves the slug back to its source node, and builds a reverse
 * index so the editor can: (a) jump from a `{{steps.x.y}}` chip to node x,
 * and (b) show "N references" for a selected node and list them. Pure +
 * testable; the UI layer just calls these and wires onClick → setSelection.
 */

import {
  buildStepSlugMap,
  type NodeRegistry,
  type WorkflowDoc,
} from '@tramo/spec';

export interface VarReference {
  /** The node whose config contains the reference. */
  nodeId: string;
  /** The config field key the reference appears in. */
  fieldKey: string;
  /** The full token, e.g. `{{steps.fetch_user.email}}`. */
  token: string;
  /** Reference kind. */
  kind: 'step' | 'var';
  /** For `step` refs, the resolved source node id (undefined if unresolved). */
  targetNodeId?: string;
  /** The slug (step) or variable name (var) referenced. */
  name: string;
  /** Trailing path after the slug/name, e.g. `email`. */
  path?: string;
}

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Extract every `{{…}}` reference from a single node's config. */
export function extractReferences(
  doc: WorkflowDoc,
  registry: NodeRegistry,
  nodeId: string,
): VarReference[] {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const { slugToId } = buildStepSlugMap(doc, (type) => registry.get(type));
  const out: VarReference[] = [];
  for (const [fieldKey, value] of Object.entries(node.config ?? {})) {
    if (typeof value !== 'string' || !value.includes('{{')) continue;
    for (const m of value.matchAll(TOKEN_RE)) {
      const expr = m[1]!.trim();
      const segments = expr.split('.').map((s) => s.trim());
      if (segments[0] === 'steps' && segments.length >= 2) {
        const slug = segments[1]!;
        out.push({
          nodeId,
          fieldKey,
          token: m[0],
          kind: 'step',
          name: slug,
          path: segments.slice(2).join('.') || undefined,
          targetNodeId: slugToId.get(slug),
        });
      } else if (segments[0] === 'vars' && segments.length >= 2) {
        out.push({ nodeId, fieldKey, token: m[0], kind: 'var', name: segments[1]!, path: segments.slice(2).join('.') || undefined });
      }
    }
  }
  return out;
}

/**
 * Build the doc-wide reverse index: for each node id, the list of references
 * that point AT it (via `steps.<slug>`). Use it to render "N references" and
 * a jump list on the selected node.
 */
export function buildReferenceIndex(
  doc: WorkflowDoc,
  registry: NodeRegistry,
): Map<string, VarReference[]> {
  const index = new Map<string, VarReference[]>();
  for (const node of doc.nodes) {
    for (const ref of extractReferences(doc, registry, node.id)) {
      if (ref.kind !== 'step' || !ref.targetNodeId) continue;
      const list = index.get(ref.targetNodeId) ?? [];
      list.push(ref);
      index.set(ref.targetNodeId, list);
    }
  }
  return index;
}

/** All nodes that reference `targetNodeId` via `steps.<slug>`. */
export function findReferences(
  doc: WorkflowDoc,
  registry: NodeRegistry,
  targetNodeId: string,
): VarReference[] {
  return buildReferenceIndex(doc, registry).get(targetNodeId) ?? [];
}

/** Resolve which node a `{{steps.<slug>...}}` token points to. */
export function resolveReferenceTarget(
  doc: WorkflowDoc,
  registry: NodeRegistry,
  token: string,
): string | undefined {
  const m = TOKEN_RE.exec(token);
  TOKEN_RE.lastIndex = 0;
  const expr = (m?.[1] ?? token).trim().replace(/^\{\{|\}\}$/g, '').trim();
  const segments = expr.split('.').map((s) => s.trim());
  if (segments[0] !== 'steps' || segments.length < 2) return undefined;
  const { slugToId } = buildStepSlugMap(doc, (type) => registry.get(type));
  return slugToId.get(segments[1]!);
}
