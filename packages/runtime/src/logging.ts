/**
 * Pluggable logging.
 *
 * The runtime emits two parallel streams: fine-grained per-node `RunEvent`s
 * (via `RunOptions.onEvent`) and a coarse host logger (`RunOptions.logger`).
 * Historically the logger was a bare `Pick<Console, …>`. That's still
 * accepted — `console` itself satisfies the `Logger` interface — but hosts
 * that want structured output (Pino, Winston, OpenTelemetry, a JSON sink)
 * can pass any object with the four level methods, or build one from a
 * single record-handling callback with `createLogger`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

export interface LogRecord {
  level: LogLevel;
  message: string;
  data?: unknown;
  /** Wall-clock ms when the record was created. */
  timestamp: number;
}

/**
 * Build a `Logger` from a single sink that receives a structured record.
 * The `now` injection keeps the function testable and lets callers stamp
 * records however they like.
 */
export function createLogger(
  sink: (record: LogRecord) => void,
  now: () => number = () => Date.now(),
): Logger {
  const at = (level: LogLevel) => (message: string, data?: unknown) =>
    sink({ level, message, data, timestamp: now() });
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

/** A logger that emits one JSON line per record to a write callback (stdout
 *  by default). Handy for shipping to a log aggregator. */
export function createJsonLogger(
  write: (line: string) => void = (line) => {
    if (typeof process !== 'undefined' && process.stdout) process.stdout.write(line + '\n');
  },
  now: () => number = () => Date.now(),
): Logger {
  return createLogger((record) => {
    write(JSON.stringify(record));
  }, now);
}

/** No-op logger — silences the coarse stream entirely. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
