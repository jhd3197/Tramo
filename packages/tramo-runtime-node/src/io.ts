/**
 * The IO surface every command takes. Decoupled from `process.stdout`
 * so tests can capture output without spawning child processes.
 */
export interface CommandIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  color: boolean;
}

/** The default IO that writes to the real process streams. */
export function processIO(): CommandIO {
  return {
    stdout: (line) => process.stdout.write(line + '\n'),
    stderr: (line) => process.stderr.write(line + '\n'),
    color: Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1',
  };
}
