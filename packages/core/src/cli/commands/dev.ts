import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger, defaultLogHandler } from '../../core/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CRASH_RESTART_DELAY_MS = 1000; // delay before auto-restart on unexpected crash
const MAX_RESTART_ATTEMPTS   = 5;    // abort watch mode after this many consecutive crashes

export function devCommand(): Command {
  const dev = new Command('dev');

  dev
    .description('Run the Nodulus application in development mode with the pre-loader')
    .argument('<entrypoint>', 'The main entrypoint file (e.g. src/server.ts)')
    .option('--watch', 'Run in watch mode using chokidar (does not delegate to node --watch)', false)
    .option('--runtime <runtime>', 'Runtime to use (node or tsx)', 'node')
    .action(async (entrypoint, options) => {
        const logger = createLogger(defaultLogHandler, 'info', 'dev');
        const cwd = process.cwd();
        const preloadPath = path.join(cwd, '.nodulus', 'preload.js');
        const hasPreload = fs.existsSync(preloadPath);

        // ─── Build args ────────────────────────────────────────────────────
        // NOTE: --watch is intentionally NOT forwarded to Node/TSX.
        // Nodulus manages the restart cycle via chokidar (see below).

        const args: string[] = [];

        if (hasPreload) {
            args.push('--import', './.nodulus/preload.js');
        } else {
            logger.warn('Pre-loader not detected at .nodulus/preload.js. Running in legacy mode (v1.4.0).');
            logger.warn('It is recommended to run "npx nodulus sync-preload" to enable the pre-loader.');
        }

        args.push(entrypoint);

        // ─── State ─────────────────────────────────────────────────────────

        const isWindows = process.platform === 'win32';
        const useShell  = isWindows && options.runtime !== 'node';

        // true while the watcher is intentionally killing the child to restart.
        // Prevents the 'close' handler from treating a planned kill as a crash.
        let restarting = false;

        // Counts consecutive unexpected crashes in watch mode.
        // Resets to 0 on every watcher-triggered restart (file change).
        let restartCount = 0;

        // ─── Process factory ───────────────────────────────────────────────
        // Encapsulates spawn so it can be called on first start and on every
        // watcher-triggered restart. The returned ChildProcess is assigned to
        // `child` in the outer scope so signal handlers always reference the
        // latest instance.

        function startProcess(): ChildProcess {
            let proc: ChildProcess;

            if (useShell) {
                // Avoid DEP0190 and EINVAL on Windows when shell: true is
                // required (e.g. tsx). Pass a single command string.
                const commandStr = `${options.runtime} ${args.map(a => `"${a}"`).join(' ')}`;
                proc = spawn(commandStr, { stdio: 'inherit', cwd, shell: true });
            } else {
                // 3.2 — On Windows child.kill() sends SIGKILL by default;
                // calling without arguments lets Node pick the right signal
                // per platform. We rely on that here intentionally.
                proc = spawn(options.runtime, args, { stdio: 'inherit', cwd, shell: false });
            }

            proc.on('close', (code) => {
                // ── Planned restart (watcher-triggered kill) ────────────────
                // `restarting` is set by onRestart before calling child.kill().
                // The new child will be spawned after the await in onRestart.
                if (options.watch && restarting) return;

                // ── Unexpected crash in watch mode ──────────────────────────
                // The child exited on its own (syntax error, runtime crash…).
                // Auto-restart with a delay to avoid tight crash loops.
                if (options.watch && code !== 0 && code !== null) {
                    restartCount++;

                    if (restartCount >= MAX_RESTART_ATTEMPTS) {
                        logger.error(
                            `Server crashed ${MAX_RESTART_ATTEMPTS} times in a row. ` +
                            `Fix the error and save a file to restart.`,
                            { _module: 'watcher' }
                        );
                        // Do NOT exit — leave the watcher alive so the user
                        // can fix the file and trigger a fresh restart.
                        return;
                    }

                    logger.warn(
                        `Server exited unexpectedly (code ${code}). ` +
                        `Restarting in ${CRASH_RESTART_DELAY_MS}ms… ` +
                        `(attempt ${restartCount}/${MAX_RESTART_ATTEMPTS})`,
                        { _module: 'watcher' }
                    );

                    setTimeout(() => {
                        child = startProcess();
                    }, CRASH_RESTART_DELAY_MS);

                    return;
                }

                // ── Clean exit in watch mode (code 0 / SIGTERM) ─────────────
                // Do not exit the parent; the watcher stays alive waiting for
                // the next file-change event.
                if (options.watch && (code === null || code === 0)) return;

                // ── Non-watch mode or unrecoverable exit ────────────────────
                process.exit(code ?? 0);
            });

            proc.on('error', (err) => {
                logger.error(`Failed to start runtime: ${err.message}`);
                process.exit(1);
            });

            return proc;
        }

        // ─── Start ─────────────────────────────────────────────────────────

        let child = startProcess();

        // ─── Watch mode ────────────────────────────────────────────────────
        // Only activated when the user explicitly passes --watch.
        // chokidar observes src/. Nodulus manages the restart. Express is
        // completely unaware of the watcher's existence.

        if (options.watch) {
            const { createWatcher } = await import('../lib/watcher.js');

            const watcher = createWatcher({
                paths: [path.join(cwd, 'src')],  // observe src/ by default
                logger,
                onRestart: async (changedPath) => {
                    // Reset the crash counter — a file change means the user
                    // is actively fixing the issue.
                    restartCount = 0;

                    logger.info(`Change detected in ${path.basename(changedPath)}. Restarting...`, { _module: 'watcher' });

                    restarting = true;
                    // child.kill() without args: Node sends SIGTERM on Unix,
                    // TerminateProcess on Windows — correct per 3.2.
                    child.kill();
                    // Brief yield so the OS can reclaim the port before re-spawning.
                    await new Promise<void>(resolve => setTimeout(resolve, 150));
                    restarting = false;

                    child = startProcess();
                }
            });

            // ─── Graceful shutdown (3.1 + 3.3) ────────────────────────────
            // Await watcher.close() before exiting to ensure chokidar's
            // internal FSWatcher is properly torn down (3.3).
            // Called on both SIGINT (Ctrl+C) and SIGTERM (kill / process
            // manager) to cover all exit paths (3.1).

            const shutdown = async () => {
                // 3.3 — watcher.close() returns Promise<void>; must be awaited.
                await watcher.close();
                // child.kill() without args (3.2): platform-appropriate signal.
                child.kill();
                process.exit(0);
            };

            // 3.1 — Register both signals so neither path leaves zombies.
            process.on('SIGINT',  shutdown);
            process.on('SIGTERM', shutdown);
        }
    });

  return dev;
}
