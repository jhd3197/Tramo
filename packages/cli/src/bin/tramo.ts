#!/usr/bin/env node
/**
 * `tramo` CLI entry. Two subcommands — `run` and `validate` — plus
 * `help`. Argv parsing is hand-rolled to keep the dep tree at zero
 * beyond `@tramo/runtime` and `@tramo/spec`.
 */
import { runCommand } from '../run.js';
import { validateCommand } from '../validate.js';
import { serveCommand } from '../serve.js';
import { processIO } from '../io.js';

interface ParsedArgs {
  command: 'run' | 'validate' | 'serve' | 'help';
  file?: string;
  trigger?: unknown;
  port?: number;
  host?: string;
  color: boolean;
  /** Set when parsing itself failed — carries the message to print. */
  parseError?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help', color: true };
  }

  const sub = argv[0];
  if (sub !== 'run' && sub !== 'validate' && sub !== 'serve' && sub !== 'help') {
    return { command: 'help', color: true, parseError: `unknown command: ${sub}` };
  }
  if (sub === 'help') {
    return { command: 'help', color: true };
  }

  let file: string | undefined;
  let trigger: unknown;
  let port: number | undefined;
  let host: string | undefined;
  let color = true;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--no-color') {
      color = false;
    } else if (arg === '--trigger') {
      const next = argv[++i];
      if (next === undefined) {
        return { command: sub, color, parseError: '--trigger requires a JSON string argument' };
      }
      try {
        trigger = JSON.parse(next);
      } catch (err) {
        return { command: sub, color, parseError: `--trigger: invalid JSON (${(err as Error).message})` };
      }
    } else if (arg === '--port') {
      const next = argv[++i];
      if (next === undefined) {
        return { command: sub, color, parseError: '--port requires a number argument' };
      }
      const n = Number(next);
      if (!Number.isInteger(n) || n < 0 || n > 65535) {
        return { command: sub, color, parseError: `--port: invalid port "${next}"` };
      }
      port = n;
    } else if (arg === '--host') {
      const next = argv[++i];
      if (next === undefined) {
        return { command: sub, color, parseError: '--host requires a value' };
      }
      host = next;
    } else if (arg.startsWith('--')) {
      return { command: sub, color, parseError: `unknown flag: ${arg}` };
    } else if (file === undefined) {
      file = arg;
    } else {
      return { command: sub, color, parseError: `unexpected positional argument: ${arg}` };
    }
  }

  if (file === undefined) {
    return { command: sub, color, parseError: `${sub}: missing workflow file argument` };
  }

  return { command: sub, file, trigger, port, host, color };
}

const HELP = `tramo — run, validate, and serve tramo workflow JSON files

Usage:
  tramo run <file> [--trigger '<json>'] [--no-color]
  tramo validate <file> [--no-color]
  tramo serve <file> [--port 3000] [--host 0.0.0.0] [--no-color]
  tramo help

Examples:
  tramo run workflow.json
  tramo run workflow.json --trigger '{"user":"juan"}'
  tramo validate workflow.json
  tramo serve workflow.json --port 8080

Exit codes:
  0   success
  1   parse error, missing file, validation failure, or a node errored
`;

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const io = processIO();
  if (!parsed.color) io.color = false;

  if (parsed.parseError) {
    io.stderr(`error: ${parsed.parseError}`);
    io.stderr('');
    io.stderr(HELP);
    return 1;
  }

  if (parsed.command === 'help') {
    io.stdout(HELP);
    return 0;
  }

  if (parsed.command === 'run') {
    return runCommand({ file: parsed.file!, trigger: parsed.trigger, io });
  }

  if (parsed.command === 'serve') {
    return serveCommand({
      file: parsed.file!,
      port: parsed.port ?? 3000,
      host: parsed.host ?? '0.0.0.0',
      io,
    });
  }

  return validateCommand({ file: parsed.file!, io });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(1);
  },
);
