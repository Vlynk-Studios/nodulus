import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activateAliasResolver, clearAliasResolverOptions } from '../../src/aliases/resolver.js';
import * as nodeModule from 'node:module';

vi.mock('node:module', async () => {
  const actual = await vi.importActual('node:module') as any;
  return {
    ...actual,
    register: vi.fn()
  };
});

describe('Resolver Guard 2 (anti-double-registration)', () => {
  const dummyLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAliasResolverOptions();
    delete (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
  });

  afterEach(() => {
    delete (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
  });

  it('activateAliasResolver() calls module.register() when global is not present (v1.4.0 behavior)', async () => {
    await activateAliasResolver({ '@modules': '/abs/src/modules' }, {}, dummyLog);
    expect(nodeModule.register).toHaveBeenCalledTimes(1);
  });

  it('activateAliasResolver() does not call module.register() if globalThis.__NODULUS_PRELOAD_CONFIG__.preloaded === true', async () => {
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = {
      preloaded: true,
      aliases: {}
    };

    await activateAliasResolver({ '@modules': '/abs/src/modules' }, {}, dummyLog);
    expect(nodeModule.register).not.toHaveBeenCalled();
    expect(dummyLog.debug).toHaveBeenCalledWith(expect.stringContaining('skipped'), expect.any(Object));
  });

  it('mergeAliasesIntoPreloadConfig() adds aliases without overwriting existing ones', async () => {
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = {
      preloaded: true,
      aliases: {
        '@existing': '/abs/existing'
      }
    };

    await activateAliasResolver({ '@modules': '/abs/src/modules' }, { '@custom': '/abs/src/custom' }, dummyLog);
    
    const config = (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
    expect(config.aliases).toEqual({
      '@existing': '/abs/existing',
      '@modules': expect.stringContaining('modules'),
      '@custom': expect.stringContaining('custom')
    });
  });
});
