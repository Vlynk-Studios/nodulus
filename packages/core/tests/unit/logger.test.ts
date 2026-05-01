import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, useLogger, resolveLogLevel, defaultLogHandler } from '../../src/core/logger.js';
import type { LogHandler } from '../../src/types/index.js';

describe('Logger Utility', () => {
  describe('createLogger', () => {
    it('should filter messages below the minimum level', () => {
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

    it('should pass meta data correctly and merge module', () => {
      const handler = vi.fn() as unknown as LogHandler;
      const log = createLogger(handler, 'debug', 'test-mod');
      const meta = { foo: 'bar' };

      log.info('test', meta);

      expect(handler).toHaveBeenCalledWith('info', 'test', { _module: 'test-mod', foo: 'bar' });
    });

    it('should allow meta._module to override the default module', () => {
      const handler = vi.fn() as unknown as LogHandler;
      const log = createLogger(handler, 'debug', 'default-mod');
      
      log.info('test', { _module: 'override-mod' });

      expect(handler).toHaveBeenCalledWith('info', 'test', { _module: 'override-mod' });
    });
  });

  describe('useLogger', () => {
    it('should create a logger with the given name as prefix', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const log = useLogger('my-app');
      
      log.info('hello');
      
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[my-app]'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('hello\n'));
      expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('[Nodulus]'));
      
      stdoutSpy.mockRestore();
    });
  });

  describe('resolveLogLevel', () => {
    const originalNodeDebug = process.env.NODE_DEBUG;
    const originalNodulusLogLevel = process.env.NODULUS_LOG_LEVEL;

    beforeEach(() => {
      delete process.env.NODE_DEBUG;
      delete process.env.NODULUS_LOG_LEVEL;
    });

    afterEach(() => {
      process.env.NODE_DEBUG = originalNodeDebug;
      process.env.NODULUS_LOG_LEVEL = originalNodulusLogLevel;
    });

    it('should return explicit level if provided', () => {
      expect(resolveLogLevel('error')).toBe('error');
    });

    it('should prioritize NODULUS_LOG_LEVEL over NODE_DEBUG', () => {
      process.env.NODULUS_LOG_LEVEL = 'warn';
      process.env.NODE_DEBUG = 'nodulus';
      expect(resolveLogLevel()).toBe('warn');
    });

    it('should return debug if NODE_DEBUG includes nodulus', () => {
      process.env.NODE_DEBUG = 'other,nodulus,more';
      expect(resolveLogLevel()).toBe('debug');
    });

    it('should return info by default', () => {
      expect(resolveLogLevel()).toBe('info');
    });
  });

  describe('defaultLogHandler', () => {
    let stdoutSpy: any;
    let stderrSpy: any;

    beforeEach(() => {
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    });

    it('should format message with [Nodulus] prefix and alignment', () => {
      defaultLogHandler('info', 'hello world');
      const output = stdoutSpy.mock.calls[0][0];
      
      expect(output).toContain('[Nodulus]');
      expect(output).toContain('info '); // padding
      expect(output).toContain('hello world\n');
    });

    it('should parse module from string prefix [mod]', () => {
      defaultLogHandler('info', '[boot] system started');
      const output = stdoutSpy.mock.calls[0][0];
      
      expect(output).toContain('[boot]');
      expect(output).toContain('system started\n');
      expect(output).not.toContain('[boot] [boot]'); // should strip from message
    });

    it('should use meta._module for module context', () => {
      defaultLogHandler('info', 'database connected', { _module: 'db' });
      const output = stdoutSpy.mock.calls[0][0];
      
      expect(output).toContain('[db]');
      expect(output).toContain('database connected\n');
    });

    it('should keep alignment even with empty module', () => {
      defaultLogHandler('info', 'no module here');
      const output = stdoutSpy.mock.calls[0][0];
      
      // Module column should be 10 spaces
      expect(output).toContain(' '.repeat(10));
    });

    it('should write warn/error to stderr', () => {
      defaultLogHandler('warn', 'low disk space');
      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });
  });
});
