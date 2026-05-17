import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, useLogger, resolveLogLevel, resolveLogFormat, defaultLogHandler } from '../../src/core/logger.js';
import { createDefaultPinoInstance, setPinoInstance } from '../../src/core/pino-instance.js';
import type { LogHandler } from '../../src/types/index.js';

describe('Logger Utility', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Intercept Pino's default stdout destination
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    
    vi.stubEnv('NODULUS_LOG_LEVEL', '');
    vi.stubEnv('NODE_DEBUG', '');
    vi.stubEnv('NODULUS_LOG_FORMAT', '');
    vi.stubEnv('NODE_ENV', 'production'); // Default to JSON for Pino tests
    
    // Reset Pino instance before each test
    setPinoInstance(createDefaultPinoInstance('json', 'info'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('defaultLogHandler & Pino Instance', () => {
    it('en modo JSON emite objeto con campos time, level, module, msg', () => {
      defaultLogHandler('info', 'Hello world', { _module: 'test' });
      
      expect(stdoutSpy).toHaveBeenCalled();
      const rawOutput = stdoutSpy.mock.calls[0][0] as string;
      const logOutput = JSON.parse(rawOutput);
      
      expect(logOutput).toHaveProperty('time');
      expect(logOutput).toHaveProperty('level', 30); // info
      expect(logOutput).toHaveProperty('module', 'test');
      expect(logOutput).toHaveProperty('msg', 'Hello world');
      expect(logOutput).toHaveProperty('service', 'system');
    });

    it('respeta minLevel (mensajes por debajo del nivel no se emiten)', () => {
      // Re-configure to warn
      setPinoInstance(createDefaultPinoInstance('json', 'warn'));
      
      defaultLogHandler('info', 'This should be ignored');
      defaultLogHandler('warn', 'This should be logged');
      
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const logOutput = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(logOutput.msg).toBe('This should be logged');
    });
    
    it('meta con err: new Error() serializa stack en modo JSON', () => {
      const testError = new Error('Database connection failed');
      defaultLogHandler('error', 'Query failed', { err: testError });
      
      expect(stdoutSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      
      expect(logOutput.err).toBeDefined();
      expect(logOutput.err.type).toBe('Error');
      expect(logOutput.err.message).toBe('Database connection failed');
      expect(logOutput.err.stack).toBeDefined();
      expect(logOutput.msg).toBe('Query failed');
    });
  });

  describe('Public API (useLogger & createLogger)', () => {
    it('useLogger("app") crea child logger con campo service: "app" en output JSON', () => {
      const appLogger = useLogger('app');
      appLogger.info('App started');
      
      expect(stdoutSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      
      expect(logOutput.service).toBe('app');
      expect(logOutput.msg).toBe('App started');
    });

    it('createLogger("app") returns identical child logger', () => {
      const appLogger = createLogger('app');
      appLogger.info('App started');
      
      expect(stdoutSpy).toHaveBeenCalled();
      const logOutput = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      
      expect(logOutput.service).toBe('app');
    });
  });

  describe('Configuration Resolution', () => {
    it('resolveLogLevel() con NODULUS_LOG_LEVEL=warn retorna "warn"', () => {
      vi.stubEnv('NODULUS_LOG_LEVEL', 'warn');
      expect(resolveLogLevel()).toBe('warn');
    });

    it('resolveLogLevel() con NODE_DEBUG=nodulus retorna "debug"', () => {
      vi.stubEnv('NODE_DEBUG', 'fs,nodulus,http');
      expect(resolveLogLevel()).toBe('debug');
    });

    it('logFormat: "json" fuerza JSON aunque NODE_ENV no sea producción', () => {
      vi.stubEnv('NODE_ENV', 'development');
      expect(resolveLogFormat('json')).toBe('json');
    });
    
    it('logFormat: "pretty" fuerza pino-pretty aunque NODE_ENV sea producción', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(resolveLogFormat('pretty')).toBe('pretty');
    });
    
    it('NODULUS_LOG_FORMAT=pretty env variable forces format', () => {
      vi.stubEnv('NODULUS_LOG_FORMAT', 'pretty');
      expect(resolveLogFormat()).toBe('pretty');
    });
  });

  describe('createLogger (handler overload — internal API)', () => {
    it('should filter messages below the minimum level for custom handlers', () => {
      const handler = vi.fn() as unknown as LogHandler;
      const log = createLogger(handler, 'warn');

      log.debug('debug message');
      log.info('info message');
      log.warn('warn message');
      log.error('error message');

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith('warn', 'warn message', undefined);
      expect(handler).toHaveBeenCalledWith('error', 'error message', undefined);
    });

    it('should pass meta data correctly and merge module for custom handlers', () => {
      const handler = vi.fn() as unknown as LogHandler;
      const log = createLogger(handler, 'debug', 'test-mod');
      const meta = { foo: 'bar' };

      log.info('test', meta);

      expect(handler).toHaveBeenCalledWith('info', 'test', { _module: 'test-mod', foo: 'bar' });
    });
  });
});
