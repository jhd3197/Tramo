/**
 * varSuggestions — build the list of {{var}} options for a given node's
 * config fields, by walking the DAG and inspecting upstream output ports.
 *
 * Templates resolve against the *immediate* upstream node's emitted value
 * (see tramo-runtime/src/executors.ts → renderTemplate). When the most
 * recent run results are available, we also enumerate the concrete top-
 * level keys of those values so users see real paths to click.
 */

import {
  getIncomingEdges,
  type NodeRegistry,
  type WorkflowDoc,
  type WorkflowNode,
} from 'tramo-spec';

export interface VarSuggestion {
  /** Path to insert between `{{ }}`. */
  path: string;
  /** Label shown in the picker UI. */
  label: string;
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

export function getVarSuggestions(
  doc: WorkflowDoc,
  registry: NodeRegistry,
  nodeId: string,
  opts: VarSuggestionsOptions = {},
): VarSuggestion[] {
  const incoming = getIncomingEdges(doc, nodeId);
  if (incoming.length === 0) return [];

  const out: VarSuggestion[] = [];
  const perNodeLimit = opts.perNodeLimit ?? 8;

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
          sourceLabel: `${p.label} port`,
          group,
        });
      }
    }
  }

  return dedupe(out);
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
