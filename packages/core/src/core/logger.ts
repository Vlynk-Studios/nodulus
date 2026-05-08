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

  let moduleName = meta?._module as string | undefined;
  let message = rawMessage;

  // Fallback: Parse [module] context from the message for internal logs
  if (!moduleName) {
    const match = rawMessage.match(/^\[([^\]]+)\]\s*(.*)/);
    if (match) {
      moduleName = match[1];
      message = match[2];
    }
  }

  // Separar _module del resto del meta para no contaminar el log estructurado
  const { _module, ...cleanMeta } = meta ?? {};

  pinoLog[level]({ module: moduleName, ...cleanMeta }, message);
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
 * @param name - The name of the application or module (used as prefix).
 */
export function useLogger(name: string): Logger {
  const handler = createUserLogHandler(name);
  const resolvedLevel = resolveLogLevel();
  return createLogger(handler, resolvedLevel);
}

/**
 * Creates a configured Logger instance for user applications.
 *
 * **Overload 1 — string shorthand** (public API):
 * ```ts
 * const log = createLogger('my-app');
 * log.info('server ready');
 * ```
 * Uses the user-facing handler and resolves the log level
 * from the environment (`NODULUS_LOG_LEVEL` / `NODE_DEBUG`).
 *
 * **Overload 2 — full control** (internal / advanced):
 * ```ts
 * const log = createLogger(handler, 'warn', 'boot');
 * ```
 * Delegates to a custom handler, filters by `minLevel`, and optionally injects
 * `_module` into every log event's meta.
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
    const handler = createUserLogHandler(handlerOrName);
    const resolvedLevel = resolveLogLevel();
    return _buildLogger(handler, resolvedLevel);
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
