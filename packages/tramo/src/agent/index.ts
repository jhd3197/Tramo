/**
 * tramo/agent — framework-agnostic LLM glue.
 *
 * Mirrors htmlstudio/agent: every patch the editor produces also has a
 * JSON-Schema-described tool call shape, so an LLM can build or edit a
 * workflow through the exact same surface a human uses.
 *
 *   - PATCH_JSON_SCHEMA       JSON Schema for the Patch union.
 *   - buildPatchToolSpec()    Builds an Anthropic/OpenAI tool spec
 *                             with the available node-type ids baked in.
 *   - validatePatch()         Runtime guard: unknown blob → typed Patch.
 *   - formatDocContext()      Compact prompt-ready summary of the doc.
 *   - PROMPT presets          Tweak / Build defaults.
 */

import type { NodeRegistry } from '../nodes.js';
import type { Patch, WorkflowDoc, WorkflowNode } from '../types.js';

/* ====================================================================== */
/* JSON Schema for the Patch union                                          */
/* ====================================================================== */

/**
 * Static Draft-07 schema covering the patch union. Node types are kept as
 * plain strings here — call `buildPatchToolSpec(registry)` if you want
 * the schema constrained to specific node ids.
 */
export const PATCH_JSON_SCHEMA = patchSchema(null);

/**
 * Build a JSON Schema for the Patch union, optionally constraining the
 * `node.type` field of `add-node` patches to a known registry. Pass `null`
 * (or omit) to leave `type` as a free string.
 */
export function buildPatchSchema(registry: NodeRegistry | null): object {
  return patchSchema(registry ? registry.list().map((d) => d.id) : null);
}

function patchSchema(nodeTypes: string[] | null): object {
  const nodeTypeField = nodeTypes
    ? { type: 'string', enum: nodeTypes, description: 'Node definition id.' }
    : { type: 'string', description: 'Node definition id (e.g. "http-request").' };

  const workflowNode = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'config'],
    properties: {
      id: { type: 'string', description: 'Stable id (use newNodeId() conventions).' },
      type: nodeTypeField,
      config: { type: 'object' },
      label: { type: 'string' },
    },
  } as const;

  const workflowEdge = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'source', 'target'],
    properties: {
      id: { type: 'string' },
      source: { type: 'string', description: 'Source node id.' },
      target: { type: 'string', description: 'Target node id.' },
      sourceHandle: { type: 'string', description: 'Output port key on source (default "out").' },
      targetHandle: { type: 'string', description: 'Input port key on target (default "in").' },
    },
  } as const;

  const workflowDoc = {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'nodes', 'edges', 'meta'],
    properties: {
      version: { const: 1 },
      nodes: { type: 'array', items: workflowNode },
      edges: { type: 'array', items: workflowEdge },
      meta: { type: 'object' },
    },
  } as const;

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Patch',
    description:
      'One mutation to a tramo WorkflowDoc. Every editable action — add or remove a node or edge, update a node config, or replace the entire doc — maps to exactly one of these kinds. Node positions are auto-computed from the DAG and are not part of the patch surface.',
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'node'],
        properties: { kind: { const: 'add-node' }, node: workflowNode },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id', 'config'],
        properties: {
          kind: { const: 'update-node-config' },
          id: { type: 'string' },
          config: { type: 'object', description: 'Partial config to merge (or replace if replace=true).' },
          replace: { type: 'boolean', description: 'When true, replace the whole config instead of merging.' },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id', 'patch'],
        properties: {
          kind: { const: 'update-node' },
          id: { type: 'string' },
          patch: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string', description: 'Display label override.' },
              runAfter: {
                type: 'string',
                enum: ['on-success', 'on-error', 'always'],
                description: 'Execution policy relative to predecessors.',
              },
            },
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id'],
        properties: { kind: { const: 'remove-node' }, id: { type: 'string' } },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'edge'],
        properties: { kind: { const: 'add-edge' }, edge: workflowEdge },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id'],
        properties: { kind: { const: 'remove-edge' }, id: { type: 'string' } },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'doc'],
        properties: { kind: { const: 'set-full-doc' }, doc: workflowDoc },
      },
    ],
  };
}

/* ====================================================================== */
/* Provider tool specs                                                      */
/* ====================================================================== */

export const PATCH_TOOL_NAME = 'apply_patch';
const TOOL_DESCRIPTION =
  'Apply a single Patch to the tramo workflow document. Always emit exactly one patch per tool call. Prefer narrow patches (update-node-config, add-edge, remove-edge) over broad ones (set-full-doc).';

export interface ProviderToolSpecs {
  anthropic: {
    name: string;
    description: string;
    input_schema: object;
  };
  openai: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: object;
    };
  };
}

/**
 * Returns ready-to-paste tool specs for Anthropic and OpenAI APIs. Pass
 * a registry to constrain `node.type` to the known set; pass null/undefined
 * for an open string.
 */
export function buildPatchToolSpec(registry: NodeRegistry | null = null): ProviderToolSpecs {
  const schema = buildPatchSchema(registry);
  return {
    anthropic: {
      name: PATCH_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      input_schema: schema,
    },
    openai: {
      type: 'function',
      function: {
        name: PATCH_TOOL_NAME,
        description: TOOL_DESCRIPTION,
        parameters: schema,
      },
    },
  };
}

/* ====================================================================== */
/* Doc context formatting                                                   */
/* ====================================================================== */

/**
 * Compact prompt-ready summary of a workflow doc. Lists nodes and edges
 * in a stable, readable form for inclusion in a system or user message.
 */
export function formatDocContext(doc: WorkflowDoc): string {
  if (doc.nodes.length === 0) return 'Workflow is empty (no nodes).';
  const lines: string[] = [`Workflow (${doc.nodes.length} nodes, ${doc.edges.length} edges):`];
  lines.push('Nodes:');
  for (const n of doc.nodes) {
    const cfg = compactConfig(n.config);
    lines.push(`  - ${n.id} (${n.type})${n.label ? ` "${n.label}"` : ''}${cfg ? ` ${cfg}` : ''}`);
  }
  if (doc.edges.length > 0) {
    lines.push('Edges:');
    for (const e of doc.edges) {
      const from = `${e.source}${e.sourceHandle ? `:${e.sourceHandle}` : ''}`;
      const to = `${e.target}${e.targetHandle ? `:${e.targetHandle}` : ''}`;
      lines.push(`  - ${from} -> ${to}`);
    }
  }
  return lines.join('\n');
}

function compactConfig(config: Record<string, unknown>): string {
  const entries = Object.entries(config);
  if (entries.length === 0) return '';
  const pairs = entries
    .slice(0, 4)
    .map(([k, v]) => `${k}=${shortValue(v)}`);
  if (entries.length > 4) pairs.push(`+${entries.length - 4} more`);
  return `{${pairs.join(', ')}}`;
}

function shortValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') {
    const s = v.length > 40 ? `${v.slice(0, 37)}…` : v;
    return JSON.stringify(s);
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return Array.isArray(v) ? `[${v.length}]` : '{…}';
}

/* ====================================================================== */
/* System prompts                                                           */
/* ====================================================================== */

export const TWEAK_SYSTEM_PROMPT = `You are tramo's Tweak agent.

Your only output channel is the \`${PATCH_TOOL_NAME}\` tool. When the user
asks for a change to the workflow, emit exactly ONE patch that expresses
the intent. If the request is ambiguous, reply in plain text with a short
clarifying question and do NOT call the tool.

Rules:
- Prefer narrow patches: update-node-config, add-edge, remove-edge.
- Use add-node when a new step is genuinely needed.
- NEVER use set-full-doc in Tweak mode — that's reserved for Build mode.
- Target nodes/edges by their existing id. Never invent ids for existing
  elements; for new nodes, generate a fresh id like "n_<6-10 chars>".`;

export const BUILD_SYSTEM_PROMPT = `You are tramo's Build agent.

Your only output channel is the \`${PATCH_TOOL_NAME}\` tool. Build mode
replaces the entire workflow with a freshly generated one.

Rules:
- Emit exactly one patch with kind = "set-full-doc".
- The "doc" must include version: 1, nodes, edges, and meta.
- Use only node types listed in the tool schema's enum.
- Connect nodes with edges; default sourceHandle/targetHandle when there's
  only one of each. Trigger nodes have no inputs.
- Do NOT include "position" on nodes — the canvas auto-lays them out
  vertically based on the edge graph.`;

/* ====================================================================== */
/* Runtime validator                                                        */
/* ====================================================================== */

export class PatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchValidationError';
  }
}

/**
 * Narrow an unknown value (typically the parsed JSON from an LLM tool
 * call) into a typed `Patch`. Throws `PatchValidationError` on mismatch.
 */
export function validatePatch(value: unknown): Patch {
  if (!isObject(value)) throw new PatchValidationError('Patch must be an object.');
  const v = value as Record<string, unknown>;
  const kind = v.kind;
  if (typeof kind !== 'string') throw new PatchValidationError('Patch.kind must be a string.');

  switch (kind) {
    case 'add-node':
      return { kind: 'add-node', node: validateNode(v.node, 'add-node.node') };
    case 'update-node-config':
      return {
        kind: 'update-node-config',
        id: requireString(v.id, 'update-node-config.id'),
        config: requireObject(v.config, 'update-node-config.config'),
        ...(typeof v.replace === 'boolean' ? { replace: v.replace } : {}),
      };
    case 'update-node': {
      const inner = requireObject(v.patch, 'update-node.patch');
      const out: Partial<Pick<WorkflowNode, 'label' | 'runAfter'>> = {};
      if (typeof inner.label === 'string') out.label = inner.label;
      if (typeof inner.runAfter === 'string') {
        if (inner.runAfter !== 'on-success' && inner.runAfter !== 'on-error' && inner.runAfter !== 'always') {
          throw new PatchValidationError(`update-node.patch.runAfter must be on-success|on-error|always`);
        }
        out.runAfter = inner.runAfter;
      }
      return {
        kind: 'update-node',
        id: requireString(v.id, 'update-node.id'),
        patch: out,
      };
    }
    case 'remove-node':
      return { kind: 'remove-node', id: requireString(v.id, 'remove-node.id') };
    case 'add-edge':
      return { kind: 'add-edge', edge: validateEdge(v.edge, 'add-edge.edge') };
    case 'remove-edge':
      return { kind: 'remove-edge', id: requireString(v.id, 'remove-edge.id') };
    case 'set-full-doc':
      return { kind: 'set-full-doc', doc: validateDoc(v.doc, 'set-full-doc.doc') };
    default:
      throw new PatchValidationError(`Unknown patch kind: ${JSON.stringify(kind)}`);
  }
}

export function parsePatch(
  value: unknown,
): { ok: true; patch: Patch } | { ok: false; error: string } {
  try {
    return { ok: true, patch: validatePatch(value) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/* ------------------------------ shape helpers ------------------------- */

function validateNode(v: unknown, field: string): WorkflowNode {
  if (!isObject(v)) throw new PatchValidationError(`${field} must be an object.`);
  const o = v as Record<string, unknown>;
  const out: WorkflowNode = {
    id: requireString(o.id, `${field}.id`),
    type: requireString(o.type, `${field}.type`),
    config: requireObject(o.config, `${field}.config`),
    ...(typeof o.label === 'string' ? { label: o.label } : {}),
  };
  if (typeof o.runAfter === 'string') {
    if (o.runAfter !== 'on-success' && o.runAfter !== 'on-error' && o.runAfter !== 'always') {
      throw new PatchValidationError(`${field}.runAfter must be on-success|on-error|always`);
    }
    out.runAfter = o.runAfter;
  }
  return out;
}

function validateEdge(v: unknown, field: string) {
  if (!isObject(v)) throw new PatchValidationError(`${field} must be an object.`);
  const o = v as Record<string, unknown>;
  return {
    id: requireString(o.id, `${field}.id`),
    source: requireString(o.source, `${field}.source`),
    target: requireString(o.target, `${field}.target`),
    ...(typeof o.sourceHandle === 'string' ? { sourceHandle: o.sourceHandle } : {}),
    ...(typeof o.targetHandle === 'string' ? { targetHandle: o.targetHandle } : {}),
  };
}

function validateDoc(v: unknown, field: string): WorkflowDoc {
  if (!isObject(v)) throw new PatchValidationError(`${field} must be an object.`);
  const o = v as Record<string, unknown>;
  if (o.version !== 1) throw new PatchValidationError(`${field}.version must be 1.`);
  if (!Array.isArray(o.nodes)) throw new PatchValidationError(`${field}.nodes must be an array.`);
  if (!Array.isArray(o.edges)) throw new PatchValidationError(`${field}.edges must be an array.`);
  return {
    version: 1,
    nodes: o.nodes.map((n, i) => validateNode(n, `${field}.nodes[${i}]`)),
    edges: o.edges.map((e, i) => validateEdge(e, `${field}.edges[${i}]`)),
    meta: isObject(o.meta) ? (o.meta as WorkflowDoc['meta']) : {},
  };
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string') {
    throw new PatchValidationError(`${field} must be a string (got ${describeType(v)}).`);
  }
  return v;
}

function requireObject(v: unknown, field: string): Record<string, unknown> {
  if (!isObject(v)) {
    throw new PatchValidationError(`${field} must be an object (got ${describeType(v)}).`);
  }
  return v as Record<string, unknown>;
}

function isObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
