#!/usr/bin/env node
/**
 * `tramo-server-full` — like `tramo-server`, but defaults to loading every
 * first-party integration pack (equivalent to `--packs all` / `TRAMO_PACKS=all`).
 *
 *   tramo-server-full ./workflows --port 3000
 *
 * This is the entry the shipped Docker image runs so brand nodes (telegram,
 * github, serverkit, …) execute out of the box. An explicit `--packs` flag or
 * `TRAMO_PACKS` env var still wins, so you can narrow it back to
 * `--packs builtin` or a specific brand list.
 */

import { runCli } from '../cli.js';

runCli(process.argv.slice(2), { defaultPacks: 'all' }).then(
  (code) => { if (code !== undefined) process.exit(code); },
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
