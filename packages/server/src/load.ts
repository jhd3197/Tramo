/**
 * Load workflow JSON files from a directory into a named catalog. The file
 * name (without `.json`) becomes the workflow id, unless the doc's
 * `meta.name` is set and `useMetaName` is true.
 */

import type { WorkflowDoc } from '@tramo/spec';

export async function loadWorkflowsFromDir(
  dir: string,
  opts: { useMetaName?: boolean } = {},
): Promise<Record<string, WorkflowDoc>> {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const out: Record<string, WorkflowDoc> = {};
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    throw new Error(`@tramo/server: cannot read workflow dir ${dir}: ${(err as Error).message}`);
  }
  for (const file of files) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    let doc: WorkflowDoc;
    try {
      doc = JSON.parse(raw) as WorkflowDoc;
    } catch (err) {
      throw new Error(`@tramo/server: ${file} is not valid JSON: ${(err as Error).message}`);
    }
    const base = file.replace(/\.json$/, '');
    const id = opts.useMetaName && doc.meta?.name ? doc.meta.name : base;
    out[id] = doc;
  }
  return out;
}
