import type { LogLevel, LogHandler, Logger } from '../types/index.js';
import { getPinoInstance } from './pino-instance.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

/**
 * Default log handler. Delegates to internal Pino instance.
 */
export const defaultLogHandler: LogHandler = (level, rawMessage, meta) => {
  const pinoLog = getPinoInstance();

  // Separar _module del resto del meta para no contaminar el log estructurado
  const { _module, ...cleanMeta } = meta ?? {};

  pinoLog[level]({ module: _module, ...cleanMeta }, rawMessage);
};

/**
 * Resolves the effective minimum log level.
 * Priority: explicit logLevel option > NODULUS_LOG_LEVEL > NODE_DEBUG env var > default ('info').
 */
export function resolveLogLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;

  const envLevel = process.env.NODULUS_LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LEVEL_ORDER) {
    return envLevel;
  }

  const nodeDebug = process.env.NODE_DEBUG ?? '';
  if (nodeDebug.split(',').map(s => s.trim()).includes('nodulus')) {
    return 'debug';
  }

  return 'info';
}

/**
 * Resolves the effective log format.
 * Priority: explicit logFormat option > NODULUS_LOG_FORMAT > auto (based on NODE_ENV).
 */
export function resolveLogFormat(explicit?: import('../types/index.js').LogFormat): 'pretty' | 'json' {
  if (explicit && explicit !== 'auto') return explicit;

  const envFormat = process.env.NODULUS_LOG_FORMAT;
  if (envFormat === 'pretty' || envFormat === 'json') {
    return envFormat;
  }

  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

/**
 * Creates a log handler specifically for user applications.
 */
export function createUserLogHandler(name: string): LogHandler {
  return (level, rawMessage, meta) => {
    const pinoLog = getPinoInstance();
    const { _module, ...cleanMeta } = meta ?? {};
    pinoLog[level]({ name, module: _module, ...cleanMeta }, rawMessage);
  };
}

/**
 * Creates a configured Logger instance for user applications.
 * 
 * The logger automatically adapts to the environment:
 * - **Development**: Outputs human-readable, colorized logs via `pino-pretty`, prefixed with `[name]`.
 * - **Production**: Outputs structured NDJSON logs, injecting `"service": "name"` into each log entry.
 * 
 * @example
 * ```ts
 * const log = useLogger('my-app');
 * 
 * // Development output: [18:45:02.123] INFO  [{service}] [{module}] Connected successfully
 * // Production output: {"time":"2026-05-07T...","level":"info","service":"my-app","module":"db","msg":"Connected successfully"}
 * log.info('Connected successfully', { module: 'db' });
 * ```
 * 
 * @param name - The name of the application or service (used as the `service` property).
 */
export function useLogger(name: string): Logger {
  const child = getPinoInstance().child({ service: name });
  return buildLoggerFromPino(child);
}

/**
 * Advanced logger factory for deep configuration and custom handlers.
 *
 * **Overload 1 — string shorthand** (public API):
 * ```ts
 * const log = createLogger('my-app');
 * ```
 * Alias for `useLogger('my-app')`.
 *
 * **Overload 2 — full control** (internal / advanced):
 * Allows providing a custom `LogHandler` and filtering by `minLevel`.
 * 
 * @example
 * // Integration with nodulus.config.ts using a custom handler wrapping Pino:
 * ```ts
 * export default {
 *   logger: (level, msg, meta) => myCustomLogger[level]({ ...meta }, msg),
 *   logLevel: 'debug'
 * };
 * ```
 *
 * @param handlerOrName - A `LogHandler` function OR an application name string.
 * @param minLevel      - Minimum level (only used in the full-control overload).
 * @param module        - Module context (only used in the full-control overload).
 */
export function createLogger(name: string): Logger;
export function createLogger(handler: LogHandler, minLevel: LogLevel, module?: string): Logger;
export function createLogger(
  handlerOrName: LogHandler | string,
  minLevel?: LogLevel,
  module?: string,
): Logger {
  // ── String overload: user-facing convenience API ──────────────────────────
  if (typeof handlerOrName === 'string') {
    const child = getPinoInstance().child({ service: handlerOrName });
    return buildLoggerFromPino(child);
  }

  // ── Handler overload: full-control internal API ───────────────────────────
  return _buildLogger(handlerOrName, minLevel!, module);
}

/**
 * Internal factory. Creates a bound logger that filters by minLevel and
 * delegates to handler.
 */
function _buildLogger(handler: LogHandler, minLevel: LogLevel, module?: string): Logger {
  const minOrder = LEVEL_ORDER[minLevel];

  const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] >= minOrder) {
      const enrichedMeta = module ? { _module: module, ...meta } : meta;
      handler(level, message, enrichedMeta);
    }
  };

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info:  (msg, meta) => emit('info',  msg, meta),
    warn:  (msg, meta) => emit('warn',  msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
  };
}

/**
 * Maps a Pino logger instance to the public Logger interface.
 */
function buildLoggerFromPino(child: import('pino').Logger): Logger {
  return {
    debug: (msg, meta) => child.debug({ ...meta }, msg),
    info:  (msg, meta) => child.info({ ...meta }, msg),
    warn:  (msg, meta) => child.warn({ ...meta }, msg),
    error: (msg, meta) => child.error({ ...meta }, msg),
  };
}
