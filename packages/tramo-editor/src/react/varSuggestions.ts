/**
 * varSuggestions — build the list of {{var}} options for a given node's
 * config fields, by walking the DAG and inspecting upstream output ports.
 *
 * Templates resolve against the *immediate* upstream node's emitted value
 * (see @tramo/runtime/src/executors.ts → renderTemplate). When the most
 * recent run results are available, we also enumerate the concrete top-
 * level keys of those values so users see real paths to click.
 */

import {
  buildStepSlugMap,
  getIncomingEdges,
  resolveOutputs,
  type NodeRegistry,
  type WorkflowDoc,
  type WorkflowNode,
} from '@tramo/spec';

export interface VarSuggestion {
  /** Path to insert between `{{ }}`. */
  path: string;
  /** Label shown in the picker UI (technical mono form, e.g. `{{steps.x.y}}`). */
  label: string;
  /**
   * Human-readable display string shown as the *primary* label in the
   * picker. Falls back to `label` when omitted. Examples: `Login`,
   * `Yes branch`, `Whole output`.
   */
  displayName?: string;
  /** Human-readable origin (e.g. node name or port). */
  sourceLabel: string;
  /** Group header — usually the upstream node's display name. */
  group: string;
}

export interface VarSuggestionsOptions {
  /** Most recent per-node run results, keyed by node id (optional). */
  results?: Record<string, unknown>;
  /** Cap on suggestions per upstream node. Default 8. */
  perNodeLimit?: number;
}

const STATE_NODE_TYPES = new Set(['set-var', 'increment-var', 'append-var']);

export function getVarSuggestions(
  doc: WorkflowDoc,
  registry: NodeRegistry,
  nodeId: string,
  opts: VarSuggestionsOptions = {},
): VarSuggestion[] {
  const out: VarSuggestion[] = [];
  const perNodeLimit = opts.perNodeLimit ?? 8;

  // 1) Workflow variables — any state-category node anywhere in the doc
  //    contributes its `name` field as a `vars.NAME` suggestion. We don't
  //    restrict to upstream because the runner walks topologically and
  //    a var may be set further along by a node the user just hasn't
  //    wired yet. Listing the full set keeps the picker forgiving.
  const seenVars = new Set<string>();
  for (const node of doc.nodes) {
    if (node.id === nodeId) continue;
    if (!STATE_NODE_TYPES.has(node.type)) continue;
    const name = String(node.config?.name ?? '').trim();
    if (!name || seenVars.has(name)) continue;
    seenVars.add(name);
    const def = registry.get(node.type);
    out.push({
      path: `vars.${name}`,
      label: `{{vars.${name}}}`,
      displayName: name,
      sourceLabel: def?.name ?? node.type,
      group: 'Workflow variables',
    });
  }

  // 2) Per-edge upstream values — direct input. Keeps the bare `{{key}}`
  //    form available for the immediate parent so simple chains read cleanly.
  const incoming = getIncomingEdges(doc, nodeId);
  const directParentIds = new Set(incoming.map((e) => e.source));
  for (const edge of incoming) {
    const upstream = doc.nodes.find((n) => n.id === edge.source);
    if (!upstream) continue;
    const def = registry.get(upstream.type);
    const group = upstream.label ?? def?.name ?? upstream.type;
    const sourcePort = edge.sourceHandle ?? 'out';

    // Always offer the whole input value first.
    out.push({
      path: 'value',
      label: '{{value}}',
      displayName: 'Whole output',
      sourceLabel: `entire payload from ${group}`,
      group,
    });

    // If we have results from a recent run, list concrete top-level keys
    // of the value that actually arrived on this wire.
    const upstreamResult = opts.results?.[upstream.id];
    const wireValue = pickWireValue(upstreamResult, sourcePort);
    if (wireValue && typeof wireValue === 'object' && !Array.isArray(wireValue)) {
      const keys = Object.keys(wireValue as Record<string, unknown>).slice(0, perNodeLimit);
      for (const k of keys) {
        out.push({
          path: k,
          label: `{{${k}}}`,
          displayName: humanizeKey(k),
          sourceLabel: previewValue((wireValue as Record<string, unknown>)[k]),
          group,
        });
      }
    } else {
      // No run yet — fall back to the declared output ports as a hint.
      const ports = def?.outputs ?? [];
      for (const p of ports) {
        // Only relevant if this wire uses that port.
        if (p.key !== sourcePort && ports.length > 1) continue;
        if (p.key === 'out' && ports.length === 1) continue; // already covered by {{value}}
        out.push({
          path: p.key,
          label: `{{${p.key}}}`,
          displayName: p.label || humanizeKey(p.key),
          sourceLabel: `${p.label} port`,
          group,
        });
      }
    }
  }

  // 3) `steps.<slug>.<key>` — every ancestor (and every other completed
  //    node from the most recent run) becomes addressable, not just the
  //    immediate parents. This is what lets a Telegram step reference
  //    Fetch GitHub user even though Gmail is wired between them.
  const { idToSlug } = buildStepSlugMap(doc, (type) => registry.get(type));
  const ancestors = collectAncestors(doc, nodeId);
  // Also surface any node that produced a result on the most recent run,
  // even if it's not a structural ancestor — useful when wiring is in
  // progress and the user has run the workflow once.
  if (opts.results) {
    for (const id of Object.keys(opts.results)) {
      if (id !== nodeId) ancestors.add(id);
    }
  }

  // Order matches the doc so the picker lists upstreams in roughly the
  // same order as the canvas. Direct parents are skipped here because
  // they already appear above with the bare `{{key}}` form — listing them
  // again as `steps.<slug>.key` is noise.
  for (const node of doc.nodes) {
    if (!ancestors.has(node.id)) continue;
    if (directParentIds.has(node.id)) continue;
    const def = registry.get(node.type);
    const slug = idToSlug.get(node.id) ?? node.id;
    const group = node.label ?? def?.name ?? node.type;

    const result = opts.results?.[node.id];
    const stepValue = unwrapStepValue(result);
    if (stepValue && typeof stepValue === 'object' && !Array.isArray(stepValue)) {
      const keys = Object.keys(stepValue as Record<string, unknown>).slice(0, perNodeLimit);
      // The whole node value first.
      out.push({
        path: `steps.${slug}`,
        label: `{{steps.${slug}}}`,
        displayName: 'Whole output',
        sourceLabel: `from ${group}`,
        group,
      });
      for (const k of keys) {
        out.push({
          path: `steps.${slug}.${k}`,
          label: `{{steps.${slug}.${k}}}`,
          displayName: humanizeKey(k),
          sourceLabel: previewValue((stepValue as Record<string, unknown>)[k]),
          group,
        });
      }
    } else {
      // No run results — fall back to declared output ports.
      out.push({
        path: `steps.${slug}`,
        label: `{{steps.${slug}}}`,
        displayName: 'Whole output',
        sourceLabel: `from ${group}`,
        group,
      });
      const ports = def ? resolveOutputs(def, node) : [];
      for (const p of ports) {
        if (p.key === 'out' && ports.length === 1) continue; // covered by {{steps.<slug>}}
        out.push({
          path: `steps.${slug}.${p.key}`,
          label: `{{steps.${slug}.${p.key}}}`,
          displayName: p.label ? `${p.label} branch` : humanizeKey(p.key),
          sourceLabel: `${p.label} port`,
          group,
        });
      }
    }
  }

  return dedupe(out);
}

/** "user_name" / "userName" / "user-name" → "User name". Falls back to
 *  the raw key when nothing humanisable comes out. */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_\-]+/g, ' ')
    // camelCase → camel Case
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function collectAncestors(doc: WorkflowDoc, nodeId: string): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of getIncomingEdges(doc, cur)) {
      if (e.source === nodeId) continue;
      if (!out.has(e.source)) {
        out.add(e.source);
        stack.push(e.source);
      }
    }
  }
  return out;
}

/** Mirror runtime's `stepValue` — single-`out` results unwrap to the bare
 *  value so `steps.fetch.foo` is the obvious read; multi-port results stay
 *  as `{ port: value }` so consumers can pick a branch. */
function unwrapStepValue(result: unknown): unknown {
  if (result == null || typeof result !== 'object') return result;
  const keys = Object.keys(result as Record<string, unknown>);
  if (keys.length === 1 && keys[0] === 'out') return (result as Record<string, unknown>).out;
  return result;
}

function pickWireValue(upstreamResult: unknown, sourcePort: string): unknown {
  if (upstreamResult == null) return undefined;
  if (typeof upstreamResult === 'object' && sourcePort in (upstreamResult as object)) {
    return (upstreamResult as Record<string, unknown>)[sourcePort];
  }
  // Bare value — same convention as the runner's `out` fallback.
  return upstreamResult;
}

function previewValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v.length > 30 ? `"${v.slice(0, 27)}…"` : `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `array(${v.length})`;
  return 'object';
}

function dedupe(list: VarSuggestion[]): VarSuggestion[] {
  const seen = new Set<string>();
  const out: VarSuggestion[] = [];
  for (const s of list) {
    const k = `${s.group}::${s.path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Convenience — keep here so consumers can re-export node typing too. */
export type { WorkflowNode };
