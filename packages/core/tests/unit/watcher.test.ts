/**
 * tests/unit/watcher.test.ts
 *
 * Unit tests for `src/cli/lib/watcher.ts`.
 *
 * Strategy: chokidar is fully mocked. We control FSWatcher events by
 * capturing the listeners registered via `.on()` and firing them manually.
 * Real file system access and timing are never involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { Logger } from '../../src/types/index.js';

// ─── Chokidar mock ────────────────────────────────────────────────────────────
// The mock factory runs ONCE at module load time (hoisted by vi.mock).
// We keep a single stable `mockWatcher` object and call `.mockClear()` in
// beforeEach so that individual tests always start with a clean call history
// without replacing the object reference that `createWatcher` captured.

type EventName = 'add' | 'change' | 'unlink' | 'ready' | 'error';
type EventListener = (...args: unknown[]) => void;

// Mutable map that each test controls by clearing it in beforeEach.
const mockListeners: Map<EventName, EventListener[]> = new Map();

const mockClose: MockInstance = vi.fn().mockResolvedValue(undefined);

const mockWatcher: any = {
  on: vi.fn((event: EventName, listener: EventListener) => {
    if (!mockListeners.has(event)) mockListeners.set(event, []);
    mockListeners.get(event)!.push(listener);
    return mockWatcher; // enable chaining (.on().on())
  }),
  close: mockClose,
};

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => mockWatcher),
  },
}));

// ─── Helper: fire a chokidar event ───────────────────────────────────────────

function emit(event: EventName, ...args: unknown[]): void {
  const listeners = mockListeners.get(event) ?? [];
  for (const fn of listeners) fn(...args);
}

// ─── Helper: build a minimal Logger stub ─────────────────────────────────────

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
}

// ─── Import SUT ───────────────────────────────────────────────────────────────

// Imported after vi.mock so the mocked chokidar is used.
const { createWatcher } = await import('../../src/cli/lib/watcher.js');

// Capture the mocked chokidar.watch reference once at module level.
const chokidarMock = vi.mocked((await import('chokidar')).default);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createWatcher', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = makeLogger();
    // Reset listener registry and spy call histories without replacing objects.
    mockListeners.clear();
    mockClose.mockClear();
    mockWatcher.on.mockClear();
    chokidarMock.watch.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 4.2 — Registers the 3 file events ────────────────────────────────────

  it('registers add, change and unlink event listeners', () => {
    createWatcher({ paths: '/src', logger, onRestart: vi.fn() });

    expect(mockListeners.has('add')).toBe(true);
    expect(mockListeners.has('change')).toBe(true);
    expect(mockListeners.has('unlink')).toBe(true);
  });

  // ── 4.3 — Debounce: multiple rapid changes → single onRestart call ────────

  it('debounce: multiple rapid events within debounceMs trigger onRestart only once', () => {
    const onRestart = vi.fn();
    createWatcher({ paths: '/src', logger, onRestart, debounceMs: 300 });

    emit('change', '/src/a.ts');
    emit('change', '/src/b.ts');
    emit('change', '/src/c.ts');

    // No restart yet — still within debounce window
    expect(onRestart).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    // Only the last queued path triggers onRestart, exactly once
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith('/src/c.ts');
  });

  // ── 4.4 — Debounce reset: timer restarts on each new event ───────────────

  it('debounce: a new event during the window resets the timer', () => {
    const onRestart = vi.fn();
    createWatcher({ paths: '/src', logger, onRestart, debounceMs: 300 });

    emit('change', '/src/a.ts');
    vi.advanceTimersByTime(200); // 200ms into the 300ms window

    // New event resets the timer
    emit('change', '/src/b.ts');
    vi.advanceTimersByTime(200); // still only 200ms since last event

    expect(onRestart).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100); // now 300ms since last event

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith('/src/b.ts');
  });

  // ── 4.5 — close() delegates to chokidar's internal close ─────────────────

  it('close() calls watcher.close()', async () => {
    const handle = createWatcher({ paths: '/src', logger, onRestart: vi.fn() });
    await handle.close();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  // ── 4.6 — ignoreInitial: ready fires, then add does trigger restart ───────

  it('ready event logs "Watching for file changes..."', () => {
    createWatcher({ paths: '/src', logger, onRestart: vi.fn() });

    emit('ready');
    expect(logger.info).toHaveBeenCalledWith('Watching for file changes...', { _module: 'watcher' });
  });

  it('add event after ready triggers onRestart (post-initial-scan file)', () => {
    // ignoreInitial is a chokidar config option — chokidar itself suppresses
    // the initial scan events. Here we verify that our listener correctly
    // invokes scheduleRestart when an 'add' event is delivered.
    const onRestart = vi.fn();
    createWatcher({ paths: '/src', logger, onRestart, debounceMs: 0 });

    emit('ready');
    emit('add', '/src/new-file.ts');
    vi.advanceTimersByTime(0);

    expect(onRestart).toHaveBeenCalledWith('/src/new-file.ts');
  });

  // ── 4.7 — Error events are logged but do not throw ───────────────────────

  it('watcher errors are logged without crashing the process', () => {
    createWatcher({ paths: '/src', logger, onRestart: vi.fn() });

    const boom = new Error('ENOSPC: no space left on device');

    // Must not throw
    expect(() => emit('error', boom)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('ENOSPC: no space left on device'),
      { _module: 'watcher' }
    );
  });

  it('non-Error values in error event are stringified and logged', () => {
    createWatcher({ paths: '/src', logger, onRestart: vi.fn() });

    expect(() => emit('error', 'raw string error')).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('raw string error'),
      { _module: 'watcher' }
    );
  });

  // ── 4.8 — .nodulus/ changes do NOT trigger onRestart ─────────────────────
  //
  // The ignored list is passed to chokidar as a configuration option.
  // Since chokidar is mocked, the actual glob filtering does not run.
  // We verify that createWatcher passes '**/.nodulus' and '**/.nodulus/**' in the `ignored`
  // option — this is the regression-safe contract that prevents the loop:
  //   createApp() updates NITS registry → watcher fires → restart → loop.

  it('passes **/.nodulus and **/.nodulus/** in the ignored list to prevent NITS registry loops', () => {
    createWatcher({ paths: '/src', logger, onRestart: vi.fn() });

    expect(chokidarMock.watch).toHaveBeenCalled();

    const [, watchOptions] = chokidarMock.watch.mock.calls[0] as [unknown, { ignored: unknown[] }];
    const ignoredPatterns = Array.isArray(watchOptions.ignored)
      ? watchOptions.ignored
      : [watchOptions.ignored];

    expect(ignoredPatterns).toContain('**/.nodulus');
    expect(ignoredPatterns).toContain('**/.nodulus/**');
  });

  it('also ignores node_modules, dist, .git and map/d.ts files by default', () => {
    createWatcher({ paths: '/src', logger, onRestart: vi.fn() });

    const [, watchOptions] = chokidarMock.watch.mock.calls[0] as [unknown, { ignored: unknown[] }];
    const ignored = watchOptions.ignored as string[];

    expect(ignored).toContain('**/node_modules/**');
    expect(ignored).toContain('**/.git/**');
    expect(ignored).toContain('**/dist/**');
    expect(ignored).toContain('**/*.d.ts');
    expect(ignored).toContain('**/*.map');
  });
});
