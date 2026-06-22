import { readFile } from 'node:fs/promises';
import {
  BUILTIN_REGISTRY,
  SPEC_VERSION,
  type WorkflowDoc,
} from '@tramo/spec';
import { makeFormatter } from './format.js';
import type { CommandIO } from './io.js';

export interface ValidateOptions {
  file: string;
  io: CommandIO;
}

/**
 * `tramo validate <file>` — verifies a workflow doc without running it.
 *
 * Checks:
 *   1. File exists and is valid JSON.
 *   2. `doc.version === SPEC_VERSION`.
 *   3. Every `node.type` resolves in `BUILTIN_REGISTRY`.
 *   4. Every edge endpoint references a node that exists.
 *
 * Returns the exit code the bin entry should propagate.
 */
export async function validateCommand(opts: ValidateOptions): Promise<number> {
  const { file, io } = opts;
  const fmt = makeFormatter(io.color);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    io.stderr(`${fmt.paint('error:', 'red')} cannot read ${file}: ${(err as Error).message}`);
    return 1;
  }

  let doc: WorkflowDoc;
  try {
    doc = JSON.parse(raw) as WorkflowDoc;
  } catch (err) {
    io.stderr(`${fmt.paint('error:', 'red')} ${file} is not valid JSON: ${(err as Error).message}`);
    return 1;
  }

  const problems: string[] = [];

  if (doc.version !== SPEC_VERSION) {
    problems.push(`spec version ${doc.version} is not supported by this CLI (expects ${SPEC_VERSION})`);
  }

  const nodeIds = new Set<string>();
  for (const node of doc.nodes ?? []) {
    nodeIds.add(node.id);
    if (!BUILTIN_REGISTRY.get(node.type)) {
      problems.push(`node "${node.id}": unknown type "${node.type}"`);
    }
  }

  for (const edge of doc.edges ?? []) {
    if (!nodeIds.has(edge.source)) problems.push(`edge ${edge.id}: source "${edge.source}" not found`);
    if (!nodeIds.has(edge.target)) problems.push(`edge ${edge.id}: target "${edge.target}" not found`);
  }

  if (problems.length > 0) {
    io.stderr(`${fmt.paint('invalid', 'red')} ${file}`);
    for (const p of problems) io.stderr(`  ${fmt.paint('•', 'red')} ${p}`);
    return 1;
  }

  io.stdout(
    `${fmt.paint('ok', 'green')} ${file} ${fmt.paint(`(${doc.nodes.length} nodes, ${doc.edges.length} edges, spec v${doc.version})`, 'dim')}`,
  );
  return 0;
}
