import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportReconciliation } from '../../src/nits/nits-reporter.js';
import type { ReconciliationResult } from '../../src/types/nits.js';
import type { Logger } from '../../src/types/index.js';

vi.mock('picocolors', () => {
  const identity = (s: any) => s;
  const pcMock = {
    bold: identity,
    gray: identity,
    cyan: identity,
    yellow: identity,
    red: identity,
    green: identity,
    magenta: identity,
    white: identity,
    blue: identity,
  };
  return {
    ...pcMock,
    default: pcMock,
  };
});

const makeModule = (name: string) => ({
  id: `mod_${name}`,
  name,
  path: `src/${name}`,
  hash: 'h',
  status: 'active' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  lastSeen: '',
  identifiers: []
});

const emptyResult = (): ReconciliationResult => ({
  confirmed: [],
  moved: [],
  candidates: [],
  stale: [],
  newModules: [],
  deleted: []
});

describe('reportReconciliation()', () => {
  const createMockLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not print anything (only debug) if there are no significant changes (moved, stale, candidate)', () => {
    const log = createMockLogger();
    const result = { ...emptyResult(), confirmed: [makeModule('users')], newModules: [makeModule('new')] };
    
    reportReconciliation(result, log);
    
    expect(log.warn).not.toHaveBeenCalled();
    expect((log.debug as any).mock.calls[0][0]).toContain('no changes detected');
  });

  it('reports detailed movements', () => {
    const log = createMockLogger();
    const result = { 
      ...emptyResult(), 
      moved: [{
        record: makeModule('users'),
        oldPath: 'src/modules/users',
        newPath: 'src/domains/workspace/modules/users',
        brokenImports: [
          { file: 'src/app.ts', line: 14, specifier: '@modules/users' }
        ]
      }] 
    };
    
    reportReconciliation(result, log);
    
    const warnOutput = (log.warn as any).mock.calls[0][0];
    expect(warnOutput).toMatch(/Movement detected: 'users'/);
    expect(warnOutput).toMatch(/\s{11}Before: src\/modules\/users/);
    expect(warnOutput).toMatch(/\s{11}Now: src\/domains\/workspace\/modules\/users/);
    expect(warnOutput).toMatch(/\s{11}Broken imports \(1 file\(s\)\):/);
    expect(warnOutput).toMatch(/\s{13}src\/app\.ts:14\s{2}→\s{2}@modules\/users/);
    expect(warnOutput).toMatch(/\s{11}Update imports to: @workspace\/users/);
  });

  it('reports stale (missing) modules', () => {
    const log = createMockLogger();
    const result = { 
      ...emptyResult(), 
      stale: [makeModule('payments')] 
    };
    
    reportReconciliation(result, log);
    
    const warnOutput = (log.warn as any).mock.calls[0][0];
    expect(warnOutput).toMatch(/Module 'payments' not found on disk/);
    expect(warnOutput).toMatch(/\s{11}Last location: src\/payments/);
    expect(warnOutput).toMatch(/\s{11}Will be removed from registry if absent next cycle\./);
  });

  it('reports candidates (possible relocations)', () => {
    const log = createMockLogger();
    const result = { 
      ...emptyResult(), 
      candidates: [{
        record: makeModule('orders'),
        oldPath: '?',
        newPath: 'src/domains/billing/modules/orders',
        brokenImports: []
      }] 
    };
    
    reportReconciliation(result, log);
    
    const warnOutput = (log.warn as any).mock.calls[0][0];
    expect(warnOutput).toMatch(/Possible relocation: 'orders'/);
    expect(warnOutput).toMatch(/\s{11}A module with the same name was found in a new location/);
    expect(warnOutput).toMatch(/\s{11}New path: src\/domains\/billing\/modules\/orders/);
  });

  it('logs new modules in debug ONLY if there are other significant changes', () => {
    const log = createMockLogger();
    const res1 = { ...emptyResult(), newModules: [makeModule('new')] };
    reportReconciliation(res1, log);
    expect(log.warn).not.toHaveBeenCalled();
    expect((log.debug as any).mock.calls[0][0]).toContain('no changes detected');

    const res2 = { 
      ...emptyResult(), 
      newModules: [makeModule('new')],
      moved: [{ record: makeModule('m'), oldPath: 'o', newPath: 'n', brokenImports: [] }] 
    };
    reportReconciliation(res2, log);
    const debugCalls = (log.debug as any).mock.calls.map((c: any[]) => c[0]);
    expect(debugCalls.some((c: string) => c.includes('1 new modules discovered'))).toBe(true);
  });

  it('includes reconciliation summary in debug if there are significant changes', () => {
    const log = createMockLogger();
    const result = { ...emptyResult(), moved: [{ record: makeModule('m'), oldPath: 'o', newPath: 'n', brokenImports: [] }] };
    
    reportReconciliation(result, log);
    
    const debugCalls = (log.debug as any).mock.calls.map((c: any[]) => c[0]);
    expect(debugCalls.some((c: string) => c.includes('Identity Reconciliation Summary'))).toBe(true);
    expect(debugCalls.some((c: string) => /Moved:\s{10}1/.test(c))).toBe(true);
  });
});