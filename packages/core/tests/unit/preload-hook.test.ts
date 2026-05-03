import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initialize, resolve } from '../../src/preload/preload-hook.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { PreloadConfig } from '../../src/preload/index.js';

describe('Pre-loader ESM Hook (preload-hook.ts)', () => {
  const nextResolve = vi.fn((specifier, context) => {
    return Promise.resolve({ url: specifier, shortCircuit: true });
  });

  const config: PreloadConfig = {
    modulesDir: '/abs/src/modules',
    aliases: {
      '@modules': '/abs/src/modules',
      '@shared': '/abs/src/shared',
      '@config': '/abs/src/config',
      // Overlap to test priority (specific > general)
      '@specific': '/abs/src/general',
      '@specific/deep': '/abs/src/deep'
    },
    preloaded: true,
    _version: '1.5.0'
  };

  beforeEach(() => {
    nextResolve.mockClear();
    // Reset module-level config state before each test
    initialize(config);
  });

  it('should not duplicate aliases when initialize() is called multiple times (idempotency)', () => {
    // First call
    initialize(config);
    // Second call (should not do anything or throw error)
    expect(() => initialize(config)).not.toThrow();
  });

  it('resolve() should transform @modules/users into the correct absolute path', async () => {
    await resolve('@modules/users', { conditions: [] }, nextResolve);
    const expectedPath = path.resolve('/abs/src/modules', 'users');
    const expectedUrl = pathToFileURL(expectedPath).href;
    
    expect(nextResolve).toHaveBeenCalledWith(expectedUrl, { conditions: [] });
  });

  it('resolve() should transform subpaths @modules/users/service correctly', async () => {
    await resolve('@modules/users/service', { conditions: [] }, nextResolve);
    const expectedPath = path.resolve('/abs/src/modules', 'users/service');
    const expectedUrl = pathToFileURL(expectedPath).href;
    
    expect(nextResolve).toHaveBeenCalledWith(expectedUrl, { conditions: [] });
  });

  it('resolve() should passthrough imports that are not known aliases', async () => {
    await resolve('./local-file.js', { conditions: [] }, nextResolve);
    expect(nextResolve).toHaveBeenCalledWith('./local-file.js', { conditions: [] });
  });

  it('resolve() should passthrough node:* imports and npm packages', async () => {
    await resolve('node:fs', { conditions: [] }, nextResolve);
    expect(nextResolve).toHaveBeenCalledWith('node:fs', { conditions: [] });

    await resolve('express', { conditions: [] }, nextResolve);
    expect(nextResolve).toHaveBeenCalledWith('express', { conditions: [] });
  });

  it('resolve() should prioritize more specific aliases over general ones when overlapping', async () => {
    // If we resolve '@specific/deep/file', it should map to '/abs/src/deep/file'
    // and NOT to '/abs/src/general/deep/file'.
    
    await resolve('@specific/deep/file', { conditions: [] }, nextResolve);
    const expectedPath = path.resolve('/abs/src/deep', 'file');
    const expectedUrl = pathToFileURL(expectedPath).href;
    
    expect(nextResolve).toHaveBeenCalledWith(expectedUrl, { conditions: [] });
  });

  // ── Gap 2: improved error message includes original alias ────────────────────
  it('attemptResolve() enriches ERR_MODULE_NOT_FOUND with the original alias name', async () => {
    // Simulate nextResolve failing to find the resolved path
    const notFoundError = Object.assign(
      new Error('Cannot find module file:///abs/src/shared/index.js'),
      { code: 'ERR_MODULE_NOT_FOUND' }
    );
    const failingResolve = vi.fn().mockRejectedValue(notFoundError);

    await expect(
      resolve('@shared', { conditions: [] }, failingResolve)
    ).rejects.toMatchObject({
      code: 'ERR_MODULE_NOT_FOUND',
      message: expect.stringContaining("Cannot resolve alias '@shared'"),
    });
  });

  it('attemptResolve() enriches error for sub-path alias (@shared/utils → path not found)', async () => {
    const notFoundError = Object.assign(
      new Error('Cannot find module file:///abs/src/shared/utils'),
      { code: 'ERR_MODULE_NOT_FOUND' }
    );
    const failingResolve = vi.fn().mockRejectedValue(notFoundError);

    await expect(
      resolve('@shared/utils', { conditions: [] }, failingResolve)
    ).rejects.toMatchObject({
      message: expect.stringContaining("Cannot resolve alias '@shared'"),
    });

    // The message should also hint to run sync-preload
    await expect(
      resolve('@shared/utils', { conditions: [] }, failingResolve)
    ).rejects.toMatchObject({
      message: expect.stringContaining('Run: nodulus sync-preload'),
    });
  });

  it('resolve() re-throws ERR_MODULE_NOT_FOUND unchanged when no alias was involved', async () => {
    // A plain relative import that is not an alias should have its error unchanged
    const notFoundError = Object.assign(
      new Error('Cannot find module ./missing-file.js'),
      { code: 'ERR_MODULE_NOT_FOUND' }
    );
    const failingResolve = vi.fn().mockRejectedValue(notFoundError);

    await expect(
      resolve('./missing-file.js', { conditions: [] }, failingResolve)
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("Cannot resolve alias"),
    });
  });
});
