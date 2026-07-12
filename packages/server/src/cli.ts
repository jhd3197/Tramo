/**
 * CLI core shared by the `tramo-server` bins.
 *
 * Parses argv, loads workflows, resolves the executor registry (builtin by
 * default, or every first-party pack when `TRAMO_PACKS=all` / `--packs all`),
 * constructs the HTTP server, and runs it until a signal arrives.
 */

import { fileCheckpointStore, jsonlAuditSink } from '@tramo/runtime';
import { createTramoServer } from './http-server.js';
import { loadWorkflowsFromDir } from './load.js';
import { resolveRegistries } from './packs.js';

interface Args {
  dir: string;
  port: number;
  host: string;
  apiKey?: string;
  cron: boolean;
  checkpointDir?: string;
  auditFile?: string;
  /** Pack mode: 'all', 'builtin', or a comma-separated brand list. */
  packs?: string;
}

export interface RunCliOptions {
  /** Pack mode applied when neither --packs nor TRAMO_PACKS is set. */
  defaultPacks?: string;
}

function parse(argv: string[], defaults: RunCliOptions): Args | { error: string } {
  let dir: string | undefined;
  let port = Number(process.env.PORT ?? 3000);
  let host = '0.0.0.0';
  let apiKey = process.env.TRAMO_API_KEY;
  let cron = true;
  let checkpointDir: string | undefined;
  let auditFile: string | undefined;
  let packs = process.env.TRAMO_PACKS ?? defaults.defaultPacks;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port') port = Number(argv[++i]);
    else if (a === '--host') host = String(argv[++i]);
    else if (a === '--api-key') apiKey = String(argv[++i]);
    else if (a === '--checkpoints') checkpointDir = String(argv[++i]);
    else if (a === '--audit') auditFile = String(argv[++i]);
    else if (a === '--packs') packs = String(argv[++i]);
    else if (a === '--no-cron') cron = false;
    else if (a.startsWith('--')) return { error: `unknown flag: ${a}` };
    else if (!dir) dir = a;
    else return { error: `unexpected argument: ${a}` };
  }
  if (!dir) return { error: 'missing workflow directory argument' };
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: `invalid port: ${port}` };
  return { dir, port, host, apiKey, cron, checkpointDir, auditFile, packs };
}

const HELP = `tramo-server — long-running host for tramo workflows

Usage:
  tramo-server <dir> [--port 3000] [--host 0.0.0.0] [--api-key KEY]
                     [--packs all|builtin|<brand,brand,…>]
                     [--checkpoints ./state] [--audit ./audit.jsonl] [--no-cron]

<dir> is a directory of workflow .json files (filename = workflow id).

Packs:
  Default loads only the built-in nodes. Pass --packs all (or set
  TRAMO_PACKS=all) to also load every first-party integration pack so brand
  nodes (telegram, github, serverkit, …) execute. A comma-separated list of
  brand slugs loads just those packs.
`;

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  const parsed = parse(argv, options);
  if ('error' in parsed) {
    process.stderr.write(`error: ${parsed.error}\n\n${HELP}`);
    return 1;
  }

  const workflows = await loadWorkflowsFromDir(parsed.dir);
  const ids = Object.keys(workflows);
  if (ids.length === 0) {
    process.stderr.write(`error: no workflow .json files found in ${parsed.dir}\n`);
    return 1;
  }

  const { executors, nodes, packIds } = await resolveRegistries(parsed.packs);

  const server = createTramoServer({
    workflows,
    executors,
    nodes,
    apiKey: parsed.apiKey,
    cron: parsed.cron,
    checkpoints: parsed.checkpointDir ? fileCheckpointStore(parsed.checkpointDir) : undefined,
    audit: parsed.auditFile ? jsonlAuditSink(parsed.auditFile) : undefined,
    reload: () => loadWorkflowsFromDir(parsed.dir),
  });

  const boundPort = await server.listen(parsed.port, parsed.host);
  process.stdout.write(`tramo-server — listening on http://${parsed.host}:${boundPort}\n`);
  process.stdout.write(`  loaded ${ids.length} workflow(s): ${ids.join(', ')}\n`);
  process.stdout.write(`  packs    ${packIds.join(', ')}\n`);
  for (const r of server.host.webhookRoutes()) {
    process.stdout.write(`  webhook  ${r.method.padEnd(6)} ${r.path}  → ${r.workflowId}\n`);
  }
  const crons = server.host.cronEntries();
  if (crons.length && parsed.cron) {
    for (const c of crons) process.stdout.write(`  cron     ${c.expression}  → ${c.workflowId}\n`);
  }
  process.stdout.write(`  api      ${parsed.apiKey ? '(bearer-protected) ' : ''}GET ${'/api/health'}\n`);

  const stop = (sig: string) => {
    process.stdout.write(`\nreceived ${sig}, shutting down…\n`);
    void server.close().then(() => process.exit(0));
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  return new Promise<number>(() => { /* run forever until signal */ });
}
