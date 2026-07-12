#!/usr/bin/env node
/**
 * `tramo-server` — boot a long-running host from a directory of workflow JSON.
 *
 *   tramo-server ./workflows --port 3000 [--host 0.0.0.0] [--api-key KEY]
 *                [--packs all|builtin|<brand,…>] [--no-cron]
 *
 * Loads the built-in executor registry by default. Set `TRAMO_PACKS=all`
 * (or pass `--packs all`) to also load every first-party integration pack so
 * brand nodes (telegram, github, serverkit, …) execute. For programmatic
 * control, import `createTramoServer` and pass `combinePacks(...).executors`.
 */

import { runCli } from '../cli.js';

runCli(process.argv.slice(2)).then(
  (code) => { if (code !== undefined) process.exit(code); },
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
