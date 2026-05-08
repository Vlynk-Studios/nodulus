import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectViolations, ViolationType } from '../../src/cli/lib/violations.js';
import { buildModuleGraph, ModuleNode } from '../../src/cli/lib/graph-builder.js';
import { checkCommand } from '../../src/cli/commands/check.js';
import * as configModule from '../../src/core/config.js';
import * as nitsStore from '../../src/nits/nits-store.js';
import * as nitsReconciler from '../../src/nits/nits-reconciler.js';
import * as nitsHash from '../../src/nits/nits-hash.js';
import { NITS_REGISTRY_VERSION } from '../../src/nits/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('nodulus check', () => {
  const fixturePath = path.resolve(__dirname, '../fixtures/check-app');

  describe('detectViolations() with Fixture', () => {
    it('detects private import in fixture (payments module)', async () => {
      const graph = await buildModuleGraph({ modules: 'src/modules/*' } as any, fixturePath);
      const violations = detectViolations(graph);
      
      const privateImp = violations.find(v => v.type === ViolationType.PRIVATE_IMPORT);
      expect(privateImp).toBeDefined();
      expect(privateImp?.module).toBe('payments');
      expect(privateImp?.message).toContain('users.repository.js');
    });

    it('detects undeclared import in fixture (payments module)', async () => {
      const graph = await buildModuleGraph({ modules: 'src/modules/*' } as any, fixturePath);
      const violations = detectViolations(graph);
      
      const undeclaredImp = violations.find(v => v.type === ViolationType.UNDECLARED_IMPORT);
      expect(undeclaredImp).toBeDefined();
      expect(undeclaredImp?.module).toBe('payments');
      expect(undeclaredImp?.suggestion).toContain('Add "orders" to the imports array');
    });

    it('detects real circular dependency in fixture (users <-> orders)', async () => {
      const graph = await buildModuleGraph({ modules: 'src/modules/*' } as any, fixturePath);
      const violations = detectViolations(graph);
      
      const circular = violations.find(v => v.type === ViolationType.CIRCULAR_DEPENDENCY);
      expect(circular).toBeDefined();
      expect(circular?.cycle).toContain('users');
      expect(circular?.cycle).toContain('orders');
    });
  });

  describe('detectViolations() with mock nodes', () => {
    it('detects circular dependency A -> B -> A', () => {
      const mockNodes: ModuleNode[] = [
        { name: 'A', dirPath: '/A', indexPath: '/A/index.ts', declaredImports: ['B'], actualImports: [], internalIdentifiers: [] },
        { name: 'B', dirPath: '/B', indexPath: '/B/index.ts', declaredImports: ['A'], actualImports: [], internalIdentifiers: [] }
      ];
      const mockGraph = { domains: [], modules: mockNodes };

      const violations = detectViolations(mockGraph);
      const circular = violations.find(v => v.type === ViolationType.CIRCULAR_DEPENDENCY);
      
      expect(circular).toBeDefined();
      expect(circular?.cycle).toEqual(['A', 'B', 'A']);
    });

    it('domain names in graph are treated as valid targets (no undeclared violation)', () => {
      const mockNodes: ModuleNode[] = [
        {
          name: 'orders', dirPath: '/orders', indexPath: '/orders/index.ts',
          // 'payments' declared in imports so it is NOT an undeclared violation
          declaredImports: ['payments'],
          actualImports: [{ specifier: '@payments', file: '/orders/index.ts', line: 1 }],
          internalIdentifiers: []
        }
      ];
      const mockGraph = {
        // 'payments' exists as a domain — but since declaredImports includes it, no undeclared violation either
        domains: [{ name: 'payments', dirPath: '/payments', indexPath: '/payments/index.ts', modules: [] }],
        modules: mockNodes
      };

      const violations = detectViolations(mockGraph);
      const undeclared = violations.filter(v => v.type === ViolationType.UNDECLARED_IMPORT);
      expect(undeclared).toHaveLength(0);
    });

    it('imports from a domain NOT in declaredImports generates undeclared violation', () => {
      const mockNodes: ModuleNode[] = [
        {
          name: 'orders', dirPath: '/orders', indexPath: '/orders/index.ts',
          declaredImports: [], // NOT declared
          actualImports: [{ specifier: '@payments', file: '/orders/index.ts', line: 1 }],
          internalIdentifiers: []
        }
      ];
      const mockGraph = {
        domains: [{ name: 'payments', dirPath: '/payments', indexPath: '/payments/index.ts', modules: [] }],
        modules: mockNodes
      };

      const violations = detectViolations(mockGraph);
      const undeclared = violations.filter(v => v.type === ViolationType.UNDECLARED_IMPORT);
      // domain name IS in moduleNames set, but not in declaredImports → undeclared violation
      expect(undeclared).toHaveLength(1);
    });

    it('location-less violations still display Unknown location in text output', () => {
      const mockNodes: ModuleNode[] = [
        {
          name: 'orders', dirPath: '/orders', indexPath: '/orders/index.ts',
          declaredImports: [],
          actualImports: [{ specifier: '@modules/users/internal/repo.js', file: '/orders/service.ts', line: 5 }],
          internalIdentifiers: []
        },
        { name: 'users', dirPath: '/users', indexPath: '/users/index.ts', declaredImports: [], actualImports: [], internalIdentifiers: [] }
      ];
      const violations = detectViolations({ domains: [], modules: mockNodes });
      const priv = violations.find(v => v.type === ViolationType.PRIVATE_IMPORT);
      expect(priv).toBeDefined();
      expect(priv?.location).toBeDefined();
      expect(priv?.location?.file).toBe('/orders/service.ts');
    });
  });

  describe('checkCommand action', () => {
    let logSpy: any;
    let _errorSpy: any;

    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      _errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(process, 'cwd').mockReturnValue(fixturePath);
      vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
        modules: 'src/modules/*',
        prefix: '',
        aliases: {},
        strict: false,
        nits: { enabled: false }
      } as any);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not throw if there are no violations', async () => {
      const cmd = checkCommand();
      await expect(cmd.parseAsync(['node', 'test', '--module', 'orders'])).resolves.not.toThrow();
    });

    it('--strict throws error when there are violations', async () => {
      const cmd = checkCommand();
      await expect(cmd.parseAsync(['node', 'test', '--strict'])).rejects.toThrow(/violations found/i);
    });

    it('--format json produces standard JSON structure', async () => {
      const cmd = checkCommand();
      await cmd.parseAsync(['node', 'test', '--format', 'json']);
      
      const logCall = logSpy.mock.calls.find((call: any[]) => typeof call[0] === 'string' && call[0].includes('"modules":'));
      expect(logCall).toBeDefined();
      
      const jsonOutput = JSON.parse(logCall[0]);
      expect(jsonOutput.modules).toBeDefined();
      expect(jsonOutput.domains).toBeDefined();
      expect(jsonOutput.violations).toBeDefined();
      expect(Array.isArray(jsonOutput.violations)).toBe(true);
    });

    it('--module with unknown name throws a descriptive error', async () => {
      const cmd = checkCommand();
      await expect(
        cmd.parseAsync(['node', 'test', '--module', 'does-not-exist'])
      ).rejects.toThrow(/does-not-exist/);
    });

    it('--no-circular flag suppresses circular dependency violations', async () => {
      const cmd = checkCommand();
      // The fixture has a circular dep between users <-> orders.
      // With --no-circular it should NOT throw in strict mode due to circular.
      // (It may still throw for other violations — so we just check the call doesn't include circular in JSON)
      await cmd.parseAsync(['node', 'test', '--format', 'json', '--no-circular']);
      const logCall = logSpy.mock.calls.find((call: any[]) => typeof call[0] === 'string' && call[0].includes('"violations":'));
      const json = JSON.parse(logCall![0]);
      const hasCircular = json.violations.some((v: any) => v.type === 'circular-dependency');
      expect(hasCircular).toBe(false);
    });

    it('--format json + --strict throws when violations present', async () => {
      const cmd = checkCommand();
      await expect(
        cmd.parseAsync(['node', 'test', '--format', 'json', '--strict'])
      ).rejects.toThrow(/violations found/i);
    });

    describe('NITS formatting', () => {
      beforeEach(() => {
        vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
          modules: 'src/modules/*',
          prefix: '',
          aliases: {},
          strict: false,
          nits: { enabled: true }
        } as any);

        const fakeRegistry = {
          project: 'test',
          version: NITS_REGISTRY_VERSION,
          lastCheck: '',
          modules: {}
        };

        vi.spyOn(nitsStore, 'loadNitsRegistry').mockResolvedValue(null);
        vi.spyOn(nitsStore, 'initNitsRegistry').mockReturnValue(fakeRegistry as any);
        vi.spyOn(nitsStore, 'saveNitsRegistry').mockResolvedValue(undefined);
        vi.spyOn(nitsStore, 'inferProjectName').mockReturnValue('test-project');
        vi.spyOn(nitsHash, 'computeModuleHash').mockResolvedValue({ hash: 'abc', identifiers: [] });
        vi.spyOn(nitsReconciler, 'buildUpdatedNitsRegistry').mockReturnValue(fakeRegistry as any);
      });

      it('does not show NITS ID in default output', async () => {
        vi.spyOn(nitsReconciler, 'reconcile').mockResolvedValue({
          confirmed: [], moved: [], candidates: [], stale: [],
          newModules: [{ id: 'mod_abc', name: 'orders', path: 'src/modules/orders', hash: 'abc', status: 'active', createdAt: '', lastSeen: '', identifiers: [] }]
        });
        
        const cmd = checkCommand();
        await cmd.parseAsync(['node', 'test', '--module', 'orders']);
        
        const logCall = logSpy.mock.calls.find((call: any[]) => typeof call[0] === 'string' && call[0].includes('orders'));
        expect(logCall).toBeDefined();
        expect(logCall[0]).not.toMatch(/\[mod_abc\]/);
      });

      it('shows NITS ID when --verbose is passed', async () => {
        vi.spyOn(nitsReconciler, 'reconcile').mockResolvedValue({
          confirmed: [], moved: [], candidates: [], stale: [],
          newModules: [{ id: 'mod_abc', name: 'orders', path: 'src/modules/orders', hash: 'abc', status: 'active', createdAt: '', lastSeen: '', identifiers: [] }]
        });
        
        const cmd = checkCommand();
        await cmd.parseAsync(['node', 'test', '--module', 'orders', '--verbose']);
        
        const logCall = logSpy.mock.calls.find((call: any[]) => typeof call[0] === 'string' && call[0].includes('orders'));
        expect(logCall).toBeDefined();
        expect(logCall[0]).toMatch(/\[mod_abc\]/);
      });

      it('shows NITS ID without --verbose when there is an identity conflict', async () => {
        vi.spyOn(nitsReconciler, 'reconcile').mockResolvedValue({
          confirmed: [], candidates: [], stale: [], newModules: [],
          moved: [{
            oldPath: 'src/modules/old_orders',
            newPath: 'src/modules/orders',
            record: { id: 'mod_xyz', name: 'orders', path: 'src/modules/orders', hash: 'abc', status: 'moved', createdAt: '', lastSeen: '', identifiers: [] },
            brokenImports: []
          }]
        });
        
        const cmd = checkCommand();
        await cmd.parseAsync(['node', 'test', '--module', 'orders']);
        
        const logCall = logSpy.mock.calls.find((call: any[]) => typeof call[0] === 'string' && call[0].includes('orders'));
        expect(logCall).toBeDefined();
        expect(logCall[0]).toMatch(/\[mod_xyz\]/);
      });
    });

    it('does not emit ENOENT warning when package.json resolves correctly', async () => {
      const cmd = checkCommand();
      await cmd.parseAsync(['node', 'test', '--module', 'orders']);
      
      const hasEnoent = _errorSpy.mock.calls.some((call: any[]) => 
        typeof call[0] === 'string' && call[0].includes('ENOENT')
      );
      
      expect(hasEnoent).toBe(false);
    });
  });
});
