/**
 * Tiny ANSI helper + event pretty-printer. No deps.
 *
 * We don't reach for `chalk` because the surface is small and avoiding
 * the dep keeps the CLI's transitive tree to just `@tramo/runtime` +
 * `@tramo/spec`. Callers that pipe to a non-TTY pass `color: false`.
 */

import type { RunEvent } from '@tramo/runtime';

const RESET = '[0m';
const STYLES = {
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  blue: '[34m',
  magenta: '[35m',
  cyan: '[36m',
  gray: '[90m',
} as const;

type Style = keyof typeof STYLES;

export interface Formatter {
  paint(text: string, style: Style): string;
  formatEvent(event: RunEvent): string;
}

export function makeFormatter(color: boolean): Formatter {
  const paint = color
    ? (text: string, style: Style) => `${STYLES[style]}${text}${RESET}`
    : (text: string) => text;

  return {
    paint,
    formatEvent: (event) => formatEvent(event, paint),
  };
}

function formatEvent(event: RunEvent, paint: (t: string, s: Style) => string): string {
  switch (event.type) {
    case 'run-start':
      return `${paint('▶', 'cyan')} ${paint('run-start', 'bold')} ${paint(event.runId, 'dim')} ${paint(`(${event.nodeOrder.length} nodes)`, 'gray')}`;
    case 'node-start':
      return `  ${paint('●', 'blue')} ${event.nodeId} ${paint('start', 'dim')}`;
    case 'node-success':
      return `  ${paint('✓', 'green')} ${event.nodeId} ${paint(`${event.durationMs}ms`, 'dim')}`;
    case 'node-error':
      return `  ${paint('✗', 'red')} ${event.nodeId} ${paint(`${event.durationMs}ms`, 'dim')} — ${paint(event.error, 'red')}`;
    case 'node-skip':
      return `  ${paint('—', 'yellow')} ${event.nodeId} ${paint(`skip: ${event.reason}`, 'yellow')}`;
    case 'node-log': {
      const colorByLevel: Record<typeof event.level, Style> = {
        debug: 'gray',
        info: 'dim',
        warn: 'yellow',
        error: 'red',
      };
      const tag = paint(`[${event.level}]`, colorByLevel[event.level]);
      const body = event.data !== undefined ? `${event.message} ${paint(safeJson(event.data), 'dim')}` : event.message;
      return `      ${tag} ${event.nodeId}: ${body}`;
    }
    case 'node-chunk':
      return `      ${paint('…', 'gray')} ${event.nodeId}: ${paint(event.chunk, 'dim')}`;
    case 'node-usage': {
      const u = event.usage;
      const tok = `${u.inputTokens ?? 0}→${u.outputTokens ?? 0} tok`;
      const cost = u.costUsd != null ? ` $${u.costUsd.toFixed(4)}` : '';
      return `  ${paint('$', 'magenta')} ${event.nodeId} ${paint(`${tok}${cost}`, 'dim')}`;
    }
    case 'node-waiting':
      return `  ${paint('⏸', 'yellow')} ${event.nodeId} ${paint(`waiting: ${event.reason}`, 'yellow')}`;
    case 'run-suspended':
      return `${paint('⏸', 'yellow')} ${paint('run-suspended', 'bold')} ${paint(`${event.pending.length} approval(s) pending`, 'yellow')}`;
    case 'run-end':
      return event.ok
        ? `${paint('■', 'green')} ${paint('run-end', 'bold')} ${paint('ok', 'green')}`
        : `${paint('■', 'red')} ${paint('run-end', 'bold')} ${paint(`failed: ${event.error ?? ''}`, 'red')}`;
  }
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 200 ? `${s.slice(0, 197)}…` : s;
  } catch {
    return String(value);
  }
}
