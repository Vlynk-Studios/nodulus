import pc from 'picocolors';
import type { LogLevel, LogHandler } from '../types/index.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

const LEVEL_STYLE: Record<LogLevel, (msg: string) => string> = {
  debug: (msg) => pc.gray(msg),
  info:  (msg) => pc.cyan(msg),
  warn:  (msg) => pc.yellow(msg),
  error: (msg) => pc.red(msg),
};



/**
 * Default log handler. Writes to process.stdout (info/debug) or process.stderr (warn/error).
 * All lines are prefixed with [Nodulus].
 */
export const defaultLogHandler: LogHandler = (level, rawMessage, meta) => {
  const prefix = pc.gray('[Nodulus]');
  
  // Pad level to 5 chars: 'info ', 'warn ', 'debug', 'error'
  const paddedLevel = level.padEnd(5);
  // Keep original level colors for the label to maintain visual hierarchy
  const coloredLabel = LEVEL_STYLE[level](paddedLevel);

  let moduleName = '';
  let message = rawMessage;

  // Read context from meta._module if present
  if (meta && typeof meta._module === 'string') {
    moduleName = `[${meta._module}]`;
  } else {
    // Fallback: Parse [module] context from the message for internal logs
    const match = rawMessage.match(/^\[([^\]]+)\]\s*(.*)/);
    if (match) {
      moduleName = `[${match[1]}]`;
      message = match[2];
    }
  }

  // Pad module to 10 chars. If empty, it becomes 10 spaces.
  const paddedModule = moduleName.padEnd(10);
  const coloredModule = pc.dim(paddedModule);

  // Color the message based on the level
  let coloredMessage = message;
  switch (level) {
    case 'debug': coloredMessage = pc.gray(message); break;
    case 'info':  coloredMessage = message; /* default */ break;
    case 'warn':  coloredMessage = pc.yellow(message); break;
    case 'error': coloredMessage = pc.red(message); break;
  }

  // Format line: [Nodulus] LEVEL  [módulo]    mensaje
  const line = `${prefix} ${coloredLabel}  ${coloredModule} ${coloredMessage}`;
  
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
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

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message:  string, meta?: Record<string, unknown>): void;
  warn(message:  string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Creates a log handler specifically for user applications.
 * Output format: [name]  LEVEL  message (without Nodulus prefix).
 */
export function createUserLogHandler(name: string): LogHandler {
  return (level, rawMessage) => {
    const prefix = pc.gray(`[${name}]`);
    const paddedLevel = level.padEnd(5);
    const coloredLabel = LEVEL_STYLE[level](paddedLevel);

    let coloredMessage = rawMessage;
    switch (level) {
      case 'debug': coloredMessage = pc.gray(rawMessage); break;
      case 'info':  coloredMessage = rawMessage; break;
      case 'warn':  coloredMessage = pc.yellow(rawMessage); break;
      case 'error': coloredMessage = pc.red(rawMessage); break;
    }

    const line = `${prefix}  ${coloredLabel}  ${coloredMessage}`;
    
    if (level === 'warn' || level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  };
}

/**
 * Creates a configured Logger instance for user applications.
 * 
 * @param name - The name of the application or module (used as prefix).
 */
export function createLogger(name: string): Logger;

/**
 * Creates a bound logger that filters by minLevel and delegates to handler.
 * 
 * @param handler  - Where log events are sent.
 * @param minLevel - Events below this level are discarded.
 * @param module   - Optional module context for logs.
 */
export function createLogger(handler: LogHandler, minLevel: LogLevel, module?: string): Logger;

export function createLogger(arg1: string | LogHandler, minLevel?: LogLevel, module?: string): Logger {
  if (typeof arg1 === 'string') {
    const handler = createUserLogHandler(arg1);
    const resolvedLevel = resolveLogLevel();
    return createLogger(handler, resolvedLevel);
  }

  const handler = arg1;
  const minOrder = LEVEL_ORDER[minLevel!];

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
