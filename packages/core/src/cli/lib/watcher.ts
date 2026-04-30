import chokidar from 'chokidar';
import type { WatcherOptions } from '../../types/index.js';

// ─── Default ignored patterns ─────────────────────────────────────────────────
// These are always combined with whatever the user passes in options.ignored.
// .nodulus/** is explicitly ignored to avoid re-triggering on NITS registry
// updates that Nodulus itself generates during bootstrap.

const defaultIgnored = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/*.d.ts',
  '**/*.map',
  '**/.nodulus/**',
  '**/coverage/**',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Starts a Chokidar-based file watcher that invokes `options.onRestart`
 * whenever a relevant file change is detected.
 *
 * Design principles:
 * - Chokidar observes files.
 * - Nodulus manages the restart via the `onRestart` callback.
 * - Express is unaware of the watcher's existence.
 *
 * @param options - Configuration for the watcher.
 * @returns A function that stops the watcher when called.
 */
export function createWatcher(options: WatcherOptions): () => Promise<void> {
  const { paths, debounceMs = 300, onRestart, logger } = options;

  // ─── Merge ignored patterns ──────────────────────────────────────────────
  // User-supplied `ignored` is always appended to the defaults, never
  // replacing them. This guarantees node_modules/.git are always excluded.

  const userIgnored = options.ignored
    ? Array.isArray(options.ignored)
      ? options.ignored
      : [options.ignored]
    : [];

  const mergedIgnored: (string | ((p: string) => boolean))[] = [
    ...defaultIgnored,
    ...(userIgnored as (string | ((p: string) => boolean))[]),
  ];

  // ─── Debounce state ───────────────────────────────────────────────────────
  // A manual debounce using setTimeout/clearTimeout avoids pulling in any
  // utility library. When multiple file-system events fire in rapid succession
  // (e.g. editor atomic-save: write tmp → rename), only the last one triggers
  // the restart.

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRestart(changedPath: string): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      options.onRestart(changedPath);
    }, debounceMs);
  }

  // ─── Chokidar instance ────────────────────────────────────────────────────
  // `ignoreInitial: true`  → do not fire for files already present at startup.
  // `persistent: true`     → keep the event loop alive while watching.
  // `awaitWriteFinish`     → wait until the file stops changing before firing.
  //                          Critical for editors that do atomic writes
  //                          (write to .tmp, then rename to final path).

  const watcher = chokidar.watch(paths, {
    ignored: mergedIgnored,
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 80, // file must be stable for 80ms
      pollInterval: 20,
    },
  });

  // ─── Event listeners ──────────────────────────────────────────────────────

  watcher.on('all', (event, filePath) => {
    logger.debug(`[watcher] ${event}: ${filePath}`);
    scheduleRestart(filePath);
  });

  watcher.on('error', (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[watcher] File system error: ${message}`);
  });

  // ─── Teardown ─────────────────────────────────────────────────────────────
  // Returns a function the caller can await to cleanly close the watcher and
  // cancel any pending debounce before the process exits.

  return async function stop(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await watcher.close();
  };
}
