import type { Server } from 'node:http';
import type { Logger } from '../types/index.js';

// ─── Shutdown Manager ─────────────────────────────────────────────────────────
//
// Coordinates a single, ordered shutdown sequence:
//
//   1. Close the HTTP server (stop accepting new connections).
//   2. Run the user's `onShutdown()` hook (DB close, cleanup, etc.).
//   3. Exit with code 0.
//
// Both SIGINT (Ctrl+C) and SIGTERM (kill / process manager) are handled.
// A guard prevents double-execution if both signals fire simultaneously.

export interface ShutdownManagerOptions {
  /** HTTP server returned by `app.listen()`. If supplied, it is closed first. */
  server?: Server;
  /** Optional async cleanup hook provided by the user via `createApp({ onShutdown })`. */
  onShutdown?: () => void | Promise<void>;
  /** Logger instance — reuses the same one created during bootstrap. */
  logger: Logger;
}

/**
 * Registers SIGINT and SIGTERM handlers that perform a graceful shutdown:
 *  1. Closes the HTTP server (stops new connections).
 *  2. Runs the optional `onShutdown` hook.
 *  3. Calls `process.exit(0)`.
 *
 * @returns A `shutdown()` function you can call programmatically (e.g. in tests) which also contains an `.unregister()` method to remove the listeners.
 */
export function registerShutdown(options: ShutdownManagerOptions): import('../types/index.js').ShutdownHook {
  const { server, onShutdown, logger } = options;
  let isShuttingDown = false;

  const shutdown = async (): Promise<void> => {
    // ─── Guard ────────────────────────────────────────────────────────────────
    // Prevent double-execution if SIGINT and SIGTERM fire at the same time.
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Graceful shutdown initiated...', { _module: 'shutdown' });

    // ─── Step 1: Close HTTP server ────────────────────────────────────────────
    // Prevents new connections. Existing connections are allowed to finish
    // naturally within the OS timeout window.
    if (server) {
      await new Promise<void>((resolve) => {
        server.close((err) => {
          if (err) {
            logger.warn(`Error closing HTTP server: ${err.message}`, { _module: 'shutdown' });
          } else {
            logger.debug('HTTP server closed.', { _module: 'shutdown' });
          }
          resolve();
        });
      });
    }

    // ─── Step 2: User cleanup hook ────────────────────────────────────────────
    // Runs after the server is closed so in-flight requests have drained.
    if (onShutdown) {
      try {
        await onShutdown();
        logger.debug('onShutdown hook completed.', { _module: 'shutdown' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`onShutdown hook threw an error: ${message}`, { _module: 'shutdown' });
      }
    }

    logger.info('Process terminated cleanly.', { _module: 'shutdown' });
    process.exit(0);
  };

  // ─── Signal & IPC registration ────────────────────────────────────────────
  // Both signals call the same `shutdown` function.
  // The guard ensures only one invocation actually runs.
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  
  const messageHandler = (msg: any) => {
    if (msg === 'nodulus:shutdown') {
      shutdown();
    }
  };

  // Windows-compatible IPC shutdown (used by nodulus dev watcher)
  process.on('message', messageHandler);

  const hook = shutdown as import('../types/index.js').ShutdownHook;
  hook.unregister = () => {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('message', messageHandler);
  };

  return hook;
}
