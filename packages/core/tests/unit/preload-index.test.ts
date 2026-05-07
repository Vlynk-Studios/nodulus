import { describe, it, expect, afterEach } from 'vitest';
import { isPreloaderActive, getPreloadConfig } from '../../src/preload/index.js';

describe('Preload API (index.ts)', () => {
  afterEach(() => {
    delete (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
  });

  it('isPreloaderActive() returns true when preloaded is true', () => {
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = { preloaded: true };
    expect(isPreloaderActive()).toBe(true);
  });

  it('isPreloaderActive() returns false when __NODULUS_PRELOAD_CONFIG__ is undefined', () => {
    expect(isPreloaderActive()).toBe(false);
  });

  it('isPreloaderActive() returns false when __NODULUS_PRELOAD_CONFIG__ is defined but preloaded is not true', () => {
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = { someOtherField: true };
    expect(isPreloaderActive()).toBe(false);
  });

  it('getPreloadConfig() returns the object', () => {
    const config = { preloaded: true, _version: '1.5.0' };
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = config;
    expect(getPreloadConfig()).toBe(config);
  });
});
