import { describe, expect, it } from 'vitest';
import { BUILTIN_REGISTRY } from '@tramo/spec';
import {
  buildPatchSchema,
  buildPatchToolSpec,
  formatDocContext,
  parsePatch,
  PatchValidationError,
  validatePatch,
} from '../src/agent/index.js';

describe('validatePatch', () => {
  it('accepts a well-formed add-node patch', () => {
    const out = validatePatch({
      kind: 'add-node',
      node: {
        id: 'n_abcd',
        type: 'log',
        config: {},
      },
    });
    expect(out.kind).toBe('add-node');
  });

  it('rejects missing fields', () => {
    expect(() => validatePatch({ kind: 'add-node' })).toThrow(PatchValidationError);
    expect(() => validatePatch({ kind: 'update-node-config', id: 'n1' })).toThrow();
    expect(() => validatePatch({ kind: 'unknown' })).toThrow();
  });

  it('parsePatch returns a tagged union', () => {
    const ok = parsePatch({ kind: 'remove-node', id: 'n1' });
    expect(ok.ok).toBe(true);

    const bad = parsePatch({ kind: 'remove-node' });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.error).toMatch(/id/);
  });
});

describe('schema builders', () => {
  it('open schema does not constrain node.type', () => {
    const schema = buildPatchSchema(null) as { oneOf: Array<{ properties: Record<string, unknown> }> };
    const addNode = schema.oneOf.find((s) => (s.properties.kind as { const: string }).const === 'add-node')!;
    const nodeTypeField = (addNode.properties.node as { properties: { type: { enum?: string[] } } })
      .properties.type;
    expect(nodeTypeField.enum).toBeUndefined();
  });

  it('registry-constrained schema enumerates known node types', () => {
    const schema = buildPatchSchema(BUILTIN_REGISTRY) as {
      oneOf: Array<{ properties: Record<string, unknown> }>;
    };
    const addNode = schema.oneOf.find((s) => (s.properties.kind as { const: string }).const === 'add-node')!;
    const nodeTypeField = (addNode.properties.node as { properties: { type: { enum?: string[] } } })
      .properties.type;
    expect(nodeTypeField.enum).toContain('http-request');
    expect(nodeTypeField.enum).toContain('ai-prompt');
  });

  it('provider tool specs include the standard tool name', () => {
    const specs = buildPatchToolSpec(BUILTIN_REGISTRY);
    expect(specs.anthropic.name).toBe('apply_patch');
    expect(specs.openai.function.name).toBe('apply_patch');
    expect(specs.openai.type).toBe('function');
  });
});

describe('formatDocContext', () => {
  it('summarizes an empty doc', () => {
    expect(formatDocContext({ version: 1, nodes: [], edges: [], meta: {} })).toMatch(/empty/i);
  });

  it('summarizes nodes and edges', () => {
    const out = formatDocContext({
      version: 1,
      nodes: [
        { id: 'n1', type: 'manual-trigger', config: { payload: '{}' } },
        { id: 'n2', type: 'log', config: { level: 'info' } },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      meta: {},
    });
    expect(out).toMatch(/n1.*manual-trigger/);
    expect(out).toMatch(/n2.*log/);
    expect(out).toMatch(/n1 -> n2/);
  });
});
