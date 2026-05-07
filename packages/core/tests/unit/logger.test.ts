import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, useLogger, resolveLogLevel, defaultLogHandler } from '../../src/core/logger.js';
import type { LogHandler } from '../../src/types/index.js';

describe('Logger Utility', () => {
  // ── 3.1 ─ Internal formatter (defaultLogHandler) ─────────────────────────

  describe('defaultLogHandler', () => {
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

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
      const output = stdoutSpy.mock.calls[0][0] as string;

      expect(output).toContain('[Nodulus]');
      expect(output).toContain('info '); // padding
      expect(output).toContain('hello world\n');
    });

    it('should parse module from string prefix [mod]', () => {
      defaultLogHandler('info', '[boot] system started');
      const output = stdoutSpy.mock.calls[0][0] as string;

      expect(output).toContain('[boot]');
      expect(output).toContain('system started\n');
      expect(output).not.toContain('[boot] [boot]'); // should strip from message
    });

    it('should use meta._module for module context', () => {
      defaultLogHandler('info', 'database connected', { _module: 'db' });
      const output = stdoutSpy.mock.calls[0][0] as string;

      expect(output).toContain('[db]');
      expect(output).toContain('database connected\n');
    });

    // ── 3.1 · Alignment test ──────────────────────────────────────────

    it('alignment: output with _module contains [module] padded to 10 chars', () => {
      defaultLogHandler('info', 'ready', { _module: 'boot' });
      const output = stdoutSpy.mock.calls[0][0] as string;

      // Module token "[boot]" (6 chars) must be padded to 10 chars total
      expect(output).toContain('[boot]');
      // The padded module column is 10 chars — there must be at least 4 trailing spaces after [boot]
      expect(output).toMatch(/\[boot\]\s{4}/);
    });

    // ── 3.1 · Module absence test ─────────────────────────────────

    it('absence of module: output is valid and contains 10-space column placeholder', () => {
      defaultLogHandler('info', 'no module here');
      const output = stdoutSpy.mock.calls[0][0] as string;

      // No broken empty bracket should appear
      expect(output).not.toContain('[]');
      // The module column must be filled with 10 spaces (padEnd(10) on '')
      expect(output).toContain(' '.repeat(10));
      expect(output).toContain('no module here\n');
    });

    // ── 3.1 · Color levels test (stderr vs stdout) ────────────────

    it('should write warn/error to stderr', () => {
      defaultLogHandler('warn', 'low disk space');
      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should write error to stderr', () => {
      defaultLogHandler('error', 'fatal failure');
      expect(stderrSpy).toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('should write info/debug to stdout', () => {
      defaultLogHandler('info', 'started');
      expect(stdoutSpy).toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('should write debug to stdout', () => {
      defaultLogHandler('debug', 'verbose detail');
      expect(stdoutSpy).toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  // ── 3.2 ─ resolveLogLevel ────────────────────────────────────────────────

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

    // ── Existing tests — preserved unchanged ──────────────────────────────

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

    // ── 3.2 · NODULUS_LOG_LEVEL test ──────────────────────────────────

    it('NODULUS_LOG_LEVEL=warn (alone) → returns "warn"', () => {
      process.env.NODULUS_LOG_LEVEL = 'warn';
      expect(resolveLogLevel()).toBe('warn');
    });

    it('NODULUS_LOG_LEVEL=debug (alone) → returns "debug"', () => {
      process.env.NODULUS_LOG_LEVEL = 'debug';
      expect(resolveLogLevel()).toBe('debug');
    });

    // ── 3.2 · Priority test: explicit wins over env ────────────────

    it('priority: NODULUS_LOG_LEVEL=warn + explicit="error" → returns "error"', () => {
      process.env.NODULUS_LOG_LEVEL = 'warn';
      expect(resolveLogLevel('error')).toBe('error');
    });

    it('priority: NODULUS_LOG_LEVEL=debug + explicit="warn" → returns "warn"', () => {
      process.env.NODULUS_LOG_LEVEL = 'debug';
      expect(resolveLogLevel('warn')).toBe('warn');
    });
  });

  // ── 3.3 ─ Public API for user applications ───────────────────────────────

  describe('createLogger (string overload — public API)', () => {
    // ── 3.3 · String overload test ──────────────────────────────

    it('createLogger("my-app") returns a functional Logger', () => {
      const log = createLogger('my-app');
      expect(log).toHaveProperty('debug');
      expect(log).toHaveProperty('info');
      expect(log).toHaveProperty('warn');
      expect(log).toHaveProperty('error');
      expect(typeof log.info).toBe('function');
    });

    // ── 3.3 · Format test ─────────────────────────────────────────────

    it('output of createLogger("my-app").info("hello") contains [my-app] and not [Nodulus]', () => {
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      try {
        const log = createLogger('my-app');
        log.info('hello');

        expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('[my-app]'));
        expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('hello\n'));
        expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('[Nodulus]'));
      } finally {
        stdoutSpy.mockRestore();
      }
    });

    // ── 3.3 · Level test ───────────────────────────────────────────────

    it('createLogger("my-app").debug with NODULUS_LOG_LEVEL=info → emits nothing', () => {
      const originalLevel = process.env.NODULUS_LOG_LEVEL;
      process.env.NODULUS_LOG_LEVEL = 'info';

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        const log = createLogger('my-app');
        log.debug('x');

        expect(stdoutSpy).not.toHaveBeenCalled();
        expect(stderrSpy).not.toHaveBeenCalled();
      } finally {
        process.env.NODULUS_LOG_LEVEL = originalLevel;
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }
    });
  });

  describe('createLogger (handler overload — internal API)', () => {
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

  // ── 3.3 (via useLogger) ─ Existing tests, preserved ─────────────────────

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
});
