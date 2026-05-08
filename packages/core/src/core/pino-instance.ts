import { pino, Logger as PinoLogger } from 'pino';
import { resolveLogLevel } from './logger.js';

let _instance: PinoLogger | null = null;

function createDefaultPinoInstance(): PinoLogger {
  const resolvedLevel = resolveLogLevel();
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    return pino({
      level: resolvedLevel,
      timestamp: pino.stdTimeFunctions.isoTime,
      base: { service: 'nodulus' },
    });
  } else {
    return pino({
      level: resolvedLevel,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '[nodulus] {level} [{module}] {msg}'
        },
      },
    });
  }
}

export function getPinoInstance(): PinoLogger {
  if (!_instance) {
    _instance = createDefaultPinoInstance();
  }
  return _instance;
}

export function setPinoInstance(instance: PinoLogger): void {
  _instance = instance;
}
