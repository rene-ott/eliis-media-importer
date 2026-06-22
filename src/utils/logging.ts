/**
 * Tiny leveled logger. Writes human-readable lines to stderr so that stdout
 * stays clean for any future machine-readable output.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, ...rest: unknown[]): void;
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
}

function ts(): string {
  return new Date().toISOString();
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const threshold = LEVEL_ORDER[minLevel];

  function emit(level: LogLevel, msg: string, rest: unknown[]): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = `${ts()} [${level.toUpperCase()}] ${msg}`;
    if (rest.length > 0) {
      console.error(line, ...rest);
    } else {
      console.error(line);
    }
  }

  return {
    debug: (msg, ...rest) => emit('debug', msg, rest),
    info: (msg, ...rest) => emit('info', msg, rest),
    warn: (msg, ...rest) => emit('warn', msg, rest),
    error: (msg, ...rest) => emit('error', msg, rest),
  };
}
