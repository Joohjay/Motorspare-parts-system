type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  [key: string]: unknown;
  requestId?: string;
}

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_LEVEL: Level = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

const CONSOLE_METHOD: Record<Level, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
};

function write(level: Level, message: string, meta?: LogMeta): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const entry: LogMeta = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const method = CONSOLE_METHOD[level];
  if (process.env.NODE_ENV === 'production') {
    console[method](JSON.stringify(entry));
  } else {
    const { timestamp, ...rest } = entry;
    const parts = Object.entries(rest)
      .filter(([key]) => key !== 'level' && key !== 'message')
      .map(([key, value]) => `${key}=${String(value)}`);
    console[method](
      `${timestamp} [${level.toUpperCase()}] ${message}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`,
    );
  }
}

/**
 * Structured logger. Never pass passwords, tokens, cookies or credentials to
 * these functions — secrets must not be logged.
 */
export const logger = {
  debug(message: string, meta?: LogMeta): void {
    write('debug', message, meta);
  },
  info(message: string, meta?: LogMeta): void {
    write('info', message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write('warn', message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write('error', message, meta);
  },
};