/**
 * Programmatic API for the CLI. Exposed so other Node code can invoke
 * the same commands without shelling out (and so tests can drive them
 * with mock IO).
 */
export { runCommand, type RunOptions } from './run.js';
export { validateCommand, type ValidateOptions } from './validate.js';
export { processIO, type CommandIO } from './io.js';
export { makeFormatter, type Formatter } from './format.js';
