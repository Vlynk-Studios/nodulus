import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerShutdown } from '../../src/core/shutdown.js';
import type { Server } from 'node:http';
import type { Logger } from '../../src/types/index.js';

describe('Shutdown Manager', () => {
  let mockLogger: Logger;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register process listeners for SIGINT, SIGTERM, and message', () => {
    registerShutdown({ logger: mockLogger });
    
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should call process.exit(0) even if no server or hook provided', async () => {
    const shutdown = registerShutdown({ logger: mockLogger });
    await shutdown();
    
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(mockLogger.info).toHaveBeenCalledWith('Graceful shutdown initiated...', expect.any(Object));
    expect(mockLogger.info).toHaveBeenCalledWith('Process terminated cleanly.', expect.any(Object));
  });

  it('should close the server if provided', async () => {
    const mockServer = {
      close: vi.fn((cb) => cb())
    } as unknown as Server;

    const shutdown = registerShutdown({ logger: mockLogger, server: mockServer });
    await shutdown();

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith('HTTP server closed.', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should log a warning if server.close yields an error', async () => {
    const mockServer = {
      close: vi.fn((cb) => cb(new Error('Server close error')))
    } as unknown as Server;

    const shutdown = registerShutdown({ logger: mockLogger, server: mockServer });
    await shutdown();

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith('Error closing HTTP server: Server close error', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should call the onShutdown hook if provided', async () => {
    const hookSpy = vi.fn().mockResolvedValue(undefined);
    const shutdown = registerShutdown({ logger: mockLogger, onShutdown: hookSpy });
    await shutdown();

    expect(hookSpy).toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith('onShutdown hook completed.', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should log an error if onShutdown hook throws an Error object', async () => {
    const hookSpy = vi.fn().mockRejectedValue(new Error('Hook failed'));
    const shutdown = registerShutdown({ logger: mockLogger, onShutdown: hookSpy });
    await shutdown();

    expect(hookSpy).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('onShutdown hook threw an error: Hook failed', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should log an error if onShutdown hook throws a string', async () => {
    const hookSpy = vi.fn().mockRejectedValue('String error');
    const shutdown = registerShutdown({ logger: mockLogger, onShutdown: hookSpy });
    await shutdown();

    expect(hookSpy).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith('onShutdown hook threw an error: String error', expect.any(Object));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should not run the shutdown sequence more than once concurrently', async () => {
    const hookSpy = vi.fn().mockResolvedValue(undefined);
    const shutdown = registerShutdown({ logger: mockLogger, onShutdown: hookSpy });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(hookSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it('should trigger shutdown on "nodulus:shutdown" IPC message', async () => {
    registerShutdown({ logger: mockLogger });
    
    const messageCall = onSpy.mock.calls.find((call: any[]) => call[0] === 'message');
    expect(messageCall).toBeDefined();
    
    const messageHandler = messageCall![1] as (msg: any) => void;
    
    // Call handler with target message
    messageHandler('nodulus:shutdown');
    
    // Also call with a different message to ensure it ignores it
    messageHandler('other:message');
    
    // Wait a tick for async shutdown to complete
    await new Promise(resolve => process.nextTick(resolve));
    
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
