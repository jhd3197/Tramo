#!/usr/bin/env node
/**
 * `tramo-server` — boot a long-running host from a directory of workflow JSON.
 *
 *   tramo-server ./workflows --port 3000 [--host 0.0.0.0] [--api-key KEY] [--no-cron]
 *
 * Uses the built-in executor registry. For integration packs, import
 * `createTramoServer` programmatically and pass `combinePacks(...).executors`.
 */

import { BUILTIN_EXECUTOR_REGISTRY, fileCheckpointStore, jsonlAuditSink } from '@tramo/runtime';
import { createTramoServer } from '../http-server.js';
import { loadWorkflowsFromDir } from '../load.js';

interface Args {
  dir: string;
  port: number;
  host: string;
  apiKey?: string;
  cron: boolean;
  checkpointDir?: string;
  auditFile?: string;
}

function parse(argv: string[]): Args | { error: string } {
  let dir: string | undefined;
  let port = Number(process.env.PORT ?? 3000);
  let host = '0.0.0.0';
  let apiKey = process.env.TRAMO_API_KEY;
  let cron = true;
  let checkpointDir: string | undefined;
  let auditFile: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port') port = Number(argv[++i]);
    else if (a === '--host') host = String(argv[++i]);
    else if (a === '--api-key') apiKey = String(argv[++i]);
    else if (a === '--checkpoints') checkpointDir = String(argv[++i]);
    else if (a === '--audit') auditFile = String(argv[++i]);
    else if (a === '--no-cron') cron = false;
    else if (a.startsWith('--')) return { error: `unknown flag: ${a}` };
    else if (!dir) dir = a;
    else return { error: `unexpected argument: ${a}` };
  }
  if (!dir) return { error: 'missing workflow directory argument' };
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: `invalid port: ${port}` };
  return { dir, port, host, apiKey, cron, checkpointDir, auditFile };
}

const HELP = `tramo-server — long-running host for tramo workflows

Usage:
  tramo-server <dir> [--port 3000] [--host 0.0.0.0] [--api-key KEY]
                     [--checkpoints ./state] [--audit ./audit.jsonl] [--no-cron]

<dir> is a directory of workflow .json files (filename = workflow id).
`;

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  const parsed = parse(argv);
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

  const server = createTramoServer({
    workflows,
    executors: BUILTIN_EXECUTOR_REGISTRY,
    apiKey: parsed.apiKey,
    cron: parsed.cron,
    checkpoints: parsed.checkpointDir ? fileCheckpointStore(parsed.checkpointDir) : undefined,
    audit: parsed.auditFile ? jsonlAuditSink(parsed.auditFile) : undefined,
  });

  const boundPort = await server.listen(parsed.port, parsed.host);
  process.stdout.write(`tramo-server — listening on http://${parsed.host}:${boundPort}\n`);
  process.stdout.write(`  loaded ${ids.length} workflow(s): ${ids.join(', ')}\n`);
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

main(process.argv.slice(2)).then(
  (code) => { if (code !== undefined) process.exit(code); },
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
