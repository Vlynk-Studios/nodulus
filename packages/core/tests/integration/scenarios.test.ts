import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApp } from "../../src/bootstrap/createApp.js";
import { NodulusError } from "../../src/core/errors.js";
import { loadNitsRegistry } from "../../src/nits/nits-store.js";
import * as pinoModule from "../../src/core/pino-instance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceUrl = pathToFileURL(
  path.resolve(__dirname, "../../src/index.ts"),
).href;

/**
 * Creates a fresh tmp directory with the given files, spies process.cwd(),
 * and provides a fresh mockApp for each invocation. The tmp directory is
 * deleted in `finally` regardless of test outcome.
 *
 * NOTE: ESM caches module execution. Each test MUST use a unique directory so
 * that dynamic imports resolve to uncached URLs. Calling createApp() twice
 * with the same file set will NOT re-execute Module() / Controller() on the
 * second call — therefore every test uses exactly one createApp() call and
 * asserts with rejects.toMatchObject({ code }) instead of try/catch.
 */
const runInTmpApp = async (
  files: Record<string, string>,
  tests: (tmpDir: string, app: ReturnType<typeof makeMockApp>) => Promise<void>,
) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodulus-integration-"));

  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const finalContent = content.replace(/\{\{SOURCE\}\}/g, sourceUrl);
    fs.writeFileSync(fullPath, finalContent);
  }

  // Inject mandatory ESM package.json
  fs.writeFileSync(
    path.join(tmpDir, "package.json"),
    JSON.stringify({ type: "module" }),
  );

  vi.spyOn(process, "cwd").mockReturnValue(tmpDir);

  try {
    await tests(tmpDir, makeMockApp());
  } finally {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

function makeMockApp() {
  return { use: vi.fn() };
}

describe("Integration Tests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // EXPORT_MISMATCH
  // -----------------------------------------------------------------------
  describe("EXPORT_MISMATCH", () => {
    it("throws EXPORT_MISMATCH when exports declares a name that does not exist in index.ts", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/auth/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('auth', { exports: ['NonExistentExport'] });
          export const something = 42;
        `,
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "EXPORT_MISMATCH",
          });
        },
      );
    });

    it("EXPORT_MISMATCH details contains the missing export name", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/auth2/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('auth2', { exports: ['GhostExport'] });
          export const real = 1;
        `,
        },
        async (_, app) => {
          const err = await createApp(app as any).catch((e) => e);
          expect(err).toBeInstanceOf(NodulusError);
          expect((err as NodulusError).code).toBe("EXPORT_MISMATCH");
          expect((err as NodulusError).details).toContain("GhostExport");
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // MISSING_IMPORT
  // -----------------------------------------------------------------------
  describe("MISSING_IMPORT", () => {
    it("throws MISSING_IMPORT when imports references a non-existent module", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users', { imports: ['nonExistentModule'] });
          export const foo = 'bar';
        `,
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "MISSING_IMPORT",
          });
        },
      );
    });

    it("MISSING_IMPORT details references the missing module name", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/consumers/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('consumers', { imports: ['phantomModule'] });
        `,
        },
        async (_, app) => {
          const err = await createApp(app as any).catch((e) => e);
          expect(err).toBeInstanceOf(NodulusError);
          expect((err as NodulusError).details).toContain("phantomModule");
        },
      );
    });

    it("silently filters out empty strings and does not throw MISSING_IMPORT", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/clean/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('clean', { imports: ['', '  '] });
          export const foo = 'bar';
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          expect(result.modules).toHaveLength(1);
          expect(result.modules[0].imports).toEqual([]);
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // CIRCULAR_DEPENDENCY
  // -----------------------------------------------------------------------
  describe("CIRCULAR_DEPENDENCY", () => {
    it("throws CIRCULAR_DEPENDENCY in strict mode when A → B → A", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: true };",
          "src/modules/mod-a/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-a', { imports: ['mod-b'] });
          export const a = 1;
        `,
          "src/modules/mod-a/use.ts": `
          import { b } from '@modules/mod-b';
        `,
          "src/modules/mod-b/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-b', { imports: ['mod-a'] });
          export const b = 2;
        `,
          "src/modules/mod-b/use.ts": `
          import { a } from '@modules/mod-a';
        `,
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "CIRCULAR_DEPENDENCY",
          });
        },
      );
    });

    it("does NOT throw in non-strict mode even with circular dependencies", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/circ-a/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('circ-a', { imports: ['circ-b'] });
          export const a = 1;
        `,
          "src/modules/circ-a/use.ts": `
          import { b } from '@modules/circ-b';
        `,
          "src/modules/circ-b/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('circ-b', { imports: ['circ-a'] });
          export const b = 2;
        `,
          "src/modules/circ-b/use.ts": `
          import { a } from '@modules/circ-a';
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          expect(result.modules).toHaveLength(2);
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // INVALID_CONTROLLER
  // -----------------------------------------------------------------------
  describe("INVALID_CONTROLLER", () => {
    it("throws INVALID_CONTROLLER when controller has no default export Router", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/test/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('test');
          export const testValue = 42;
        `,
          "src/modules/test/bad.controller.ts": `
          import { Controller } from '{{SOURCE}}';
          Controller('/bad');
          export const foo = 'bar';
        `,
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "INVALID_CONTROLLER",
          });
        },
      );
    });

    it("INVALID_CONTROLLER details contains the offending file path", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/badmod/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('badmod');
        `,
          "src/modules/badmod/no-router.ts": `
          import { Controller } from '{{SOURCE}}';
          Controller('/');
          export const notARouter = true;
        `,
        },
        async (_, app) => {
          const err = await createApp(app as any).catch((e) => e);
          expect(err).toBeInstanceOf(NodulusError);
          expect((err as NodulusError).code).toBe("INVALID_CONTROLLER");
          expect((err as NodulusError).details).toContain("no-router");
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // enabled: false
  // -----------------------------------------------------------------------
  describe("enabled: false", () => {
    it("does not mount routes for disabled controllers", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": 'export default { prefix: "/api" };',
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `,
          "src/modules/users/active.routes.ts": `
          import { Controller } from '{{SOURCE}}';
          import { Router } from 'express';
          Controller('/active');
          const router = Router();
          router.get('/test', (req, res) => res.json({ ok: true }));
          export default router;
        `,
          "src/modules/users/disabled.routes.ts": `
          import { Controller } from '{{SOURCE}}';
          import { Router } from 'express';
          Controller('/disabled', { enabled: false });
          const router = Router();
          router.get('/test', (req, res) => res.json({ disabled: true }));
          export default router;
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          const activeRoutes = result.routes.filter(
            (r) => r.controller === "active.routes",
          );
          const disabledRoutes = result.routes.filter(
            (r) => r.controller === "disabled.routes",
          );
          expect(activeRoutes.length).toBeGreaterThan(0);
          expect(disabledRoutes.length).toBe(0);
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Strict Mode Warnings
  // -----------------------------------------------------------------------
  describe("Strict Mode Warnings", () => {
    it("warns about undeclared exports in strict mode but does not interrupt bootstrap", async () => {
      const loggerHandler = vi.fn();

      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: true };",
          "src/modules/test2/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('test2', { exports: ['declaredExport'] });
          export const declaredExport = 1;
          export const undeclaredExport = 2;
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any, { logger: loggerHandler });
          expect(result.modules).toHaveLength(1);

          // Verify we got a warning about the undeclared export
          expect(loggerHandler).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("undeclaredExport"),
            expect.objectContaining({
              name: "test2",
              exportName: "undeclaredExport",
            }),
          );
        },
      );
    });

    it("throws UNUSED_IMPORT in strict mode when a declared import is never used", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: true };",
          "src/modules/mod-x/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-x', { exports: ['x'] });
          export const x = 1;
        `,
          "src/modules/mod-y/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-y', { imports: ['mod-x'] });
          export const y = 1;
        `,
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "UNUSED_IMPORT",
          });
        },
      );
    });

    it("warns about UNUSED_IMPORT in non-strict mode but does not interrupt bootstrap", async () => {
      const loggerHandler = vi.fn();
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/mod-x/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-x', { exports: ['x'] });
          export const x = 1;
        `,
          "src/modules/mod-y/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-y', { imports: ['mod-x'] });
          export const y = 1;
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any, { logger: loggerHandler });
          expect(result.modules).toHaveLength(2);

          expect(loggerHandler).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining(
              'declares import "mod-x" but never uses it',
            ),
            expect.objectContaining({ module: "mod-y", unusedTarget: "mod-x" }),
          );
        },
      );
    });

    it("throws UNDECLARED_IMPORT in strict mode when a module re-exports a type from another module without declaring the import", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: true };",
          "src/modules/mod-a/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-a', { exports: ['RealValue'] });
          export const RealValue = 42;
          export type TypeA = string;
        `,
          "src/modules/mod-b/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('mod-b');
        `,
          "src/modules/mod-b/types.ts": `
          export type { TypeA } from '@modules/mod-a';
        `
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "UNDECLARED_IMPORT",
          });
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Global Prefix
  // -----------------------------------------------------------------------
  describe("Global Prefix /api/v1", () => {
    it("mounts routes under /api/v1 prefix", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": 'export default { prefix: "/api/v1" };',
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `,
          "src/modules/users/routes.ts": `
          import { Controller } from '{{SOURCE}}';
          import { Router } from 'express';
          Controller('/users');
          const router = Router();
          router.get('/list', (req, res) => res.json([]));
          export default router;
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          expect(result.routes[0].path).toBe("/api/v1/users/list");
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Module aliases
  // -----------------------------------------------------------------------
  describe("Module aliases (@config)", () => {
    it("passes @config/database alias to the ESM resolver without error", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": `
          export default {
            aliases: { '@config/database': './src/db' },
            strict: false
          };
        `,
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users');
          export const test = 'ok';
        `,
          "src/db/config.ts": `
          export const dbConfig = { host: 'localhost' };
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          expect(result.modules).toHaveLength(1);
          expect(result.modules[0].name).toBe("users");
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // imports / exports validation
  // -----------------------------------------------------------------------
  describe("Module with imports/exports validation", () => {
    it("correctly validates modules with declared imports and exports", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/shared/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('shared', { exports: ['SharedService'] });
          export class SharedService {
            getData() { return 'data'; }
          }
        `,
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users', { imports: ['shared'], exports: ['UsersService'] });
          export class UsersService {
            getData() { return 'users data'; }
          }
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          expect(result.modules).toHaveLength(2);

          const users = result.modules.find((m) => m.name === "users");
          expect(users?.imports).toContain("shared");
          expect(users?.exports).toContain("UsersService");

          const shared = result.modules.find((m) => m.name === "shared");
          expect(shared?.exports).toContain("SharedService");
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // DUPLICATE_BOOTSTRAP
  // -----------------------------------------------------------------------
  describe("DUPLICATE_BOOTSTRAP", () => {
    it("throws DUPLICATE_BOOTSTRAP when createApp() is called twice on the same Express instance", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/dup/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('dup');
        `,
        },
        async (_, app) => {
          await createApp(app as any);
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "DUPLICATE_BOOTSTRAP",
          });
        },
      );
    });
  });


  // -----------------------------------------------------------------------
  // NodulusApp shape
  // -----------------------------------------------------------------------
  describe("NodulusApp return shape", () => {
    it("returns modules, routes and a registry reference", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": 'export default { prefix: "/api" };',
          "src/modules/shape/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('shape');
        `,
          "src/modules/shape/ctrl.ts": `
          import { Controller } from '{{SOURCE}}';
          import { Router } from 'express';
          Controller('/shape');
          const router = Router();
          router.get('/ping', (req, res) => res.json({ ok: true }));
          export default router;
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any);
          expect(result.modules).toHaveLength(1);
          expect(result.modules[0].name).toBe("shape");
          expect(result.routes).toHaveLength(1);
          expect(result.routes[0]).toMatchObject({
            method: "GET",
            path: "/api/shape/ping",
            module: "shape",
            controller: "ctrl",
          });
          expect(result.registry).toBeDefined();
          expect(typeof result.registry.hasModule).toBe("function");
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // NITS Bootstrap Integration
  // -----------------------------------------------------------------------
  describe('NITS Bootstrap Integration', () => {
    it('creates .nodulus/registry.json on clean bootstrap', async () => {
      await runInTmpApp({
        'src/modules/users/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `
      }, async (tmpDir, app) => {
        await createApp(app as any);
        const registryPath = path.join(tmpDir, '.nodulus', 'registry.json');
        expect(fs.existsSync(registryPath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        expect(content.project).toBe('unknown');
        expect(Object.values(content.modules)).toHaveLength(1);
      });
    });

    it('picks up existing identities from .nodulus/registry.json', async () => {
      const existingId = 'mod_a1b2c3d4'; // Valid hex pattern
      await runInTmpApp({
        '.nodulus/registry.json': JSON.stringify({
          project: 'test',
          version: '1.0.0',
          lastCheck: new Date().toISOString(),
          modules: {
            [existingId]: { 
              id: existingId, 
              name: 'users', 
              path: 'src/modules/users', 
              hash: 'abc1234567',
              status: 'active', 
              createdAt: '2024-01-01T00:00:00.000Z',
              lastSeen: '', 
              identifiers: [] 
            }
          }
        }),
        'package.json': JSON.stringify({ name: 'test-app', type: 'module' }),
        'src/modules/users/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `
      }, async (_, app) => {
        const result = await createApp(app as any);
        expect(result.modules[0].id).toBe(existingId);
      });
    });

    it('continues bootstrap normally if NITS fails (e.g. write error)', async () => {
      const loggerHandler = vi.fn();
      await runInTmpApp({
        'src/modules/users/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `
      }, async (tmpDir, app) => {
        // Mock fs.promises.writeFile to throw for the registry path
        const originalWriteFile = fs.promises.writeFile;
        vi.spyOn(fs.promises, 'writeFile').mockImplementation(function (p, ...args) {
          if (typeof p === 'string' && p.includes('registry.json')) {
            throw new Error('Disk Full');
          }
          // @ts-expect-error - 'this' context and spread arguments typing in dynamic mock
          return originalWriteFile.apply(this, [p, ...args]);
        });

        const result = await createApp(app as any, { logger: loggerHandler });
        expect(result.modules).toHaveLength(1);
        expect(result.modules[0].name).toBe('users');
        
        // Use exact matcher for the warning to match the received 'undefined' for the 3rd arg
        expect(loggerHandler).toHaveBeenCalledWith(
          'warn',
          expect.stringContaining('NITS reconciliation failed: Disk Full'),
          expect.objectContaining({ _module: 'nits' })
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // BUG-2: registry-snapshot-moved fixture — ID format validation
  // -----------------------------------------------------------------------
  describe('NITS Registry — ID format validation (BUG-2)', () => {
    const FIXTURE_DIR = path.resolve(
      __dirname,
      '../fixtures/nits-app'
    );

    it('loads registry-snapshot-moved.json when all IDs are valid hex format', async () => {
      // The fixture is named registry-snapshot-moved.json (not registry.json),
      // so we copy it into a tmp dir that loadNitsRegistry can resolve.
      const fixtureFile = path.join(FIXTURE_DIR, '.nodulus', 'registry-snapshot-moved.json');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-bug2-valid-'));
      const nodulusDir = path.join(tmpDir, '.nodulus');
      fs.mkdirSync(nodulusDir, { recursive: true });
      fs.copyFileSync(fixtureFile, path.join(nodulusDir, 'registry.json'));

      try {
        const registry = await loadNitsRegistry(tmpDir);
        // The fixture has mod_a1b2c3d4 which satisfies /^mod_[0-9a-f]{8}$/
        expect(registry).not.toBeNull();
        expect(registry!.modules['mod_a1b2c3d4']).toBeDefined();
        expect(registry!.modules['mod_a1b2c3d4'].name).toBe('users');
        expect(registry!.modules['mod_a1b2c3d4'].identifiers).toContain('UserService');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns null when the registry contains an invalid module ID (regression: mod_users_legacy)', async () => {
      // Write a temporary registry with the originally broken ID to a tmp dir
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-bug2-'));
      const nitulusDir = path.join(tmpDir, '.nodulus');
      fs.mkdirSync(nitulusDir, { recursive: true });
      fs.writeFileSync(
        path.join(nitulusDir, 'registry.json'),
        JSON.stringify({
          project: 'nits-app',
          version: '1.0.0',
          lastCheck: '2024-01-01T00:00:00.000Z',
          modules: {
            // ❌ This ID would have caused a silent null return (BUG-2)
            'mod_users_legacy': {
              id: 'mod_users_legacy',
              name: 'users',
              path: 'src/legacy/users',
              hash: 'legacy_hash_abc',
              status: 'active',
              createdAt: '2024-01-01T00:00:00.000Z',
              lastSeen: '2024-01-01T00:00:00.000Z',
              identifiers: ['UserService']
            }
          }
        }),
        'utf-8'
      );

      try {
        const registry = await loadNitsRegistry(tmpDir);
        // loadNitsRegistry must reject registries with non-hex IDs
        expect(registry).toBeNull();
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------------
  // Module File Grouping (Prefix Collisions)
  // -----------------------------------------------------------------------
  describe("Module File Grouping (Prefix Collisions)", () => {
    it("groups files correctly when one module name is a prefix of another", async () => {
      // Create a scenario where module 'users' and 'users-admin' exist.
      // If prefix grouping is buggy, a file in 'users-admin' might be wrongly grouped under 'users'.
      // We test this by importing 'users-admin' from 'users-admin/service.ts'.
      // If it's grouped under 'users', it will be seen as an undeclared cross-module import from 'users' to 'users-admin'.
      
      const loggerHandler = vi.fn();

      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `,
          "src/modules/users-admin/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users-admin');
        `,
          "src/modules/users-admin/service.ts": `
          // Valid self-import.
          import { admin } from '@modules/users-admin';
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any, { logger: loggerHandler });
          expect(result.modules).toHaveLength(2);
          
          // Verify that NO warning was emitted about 'users' importing from 'users-admin'
          // meaning the service.ts was correctly attributed to 'users-admin'.
          expect(loggerHandler).not.toHaveBeenCalledWith(
            "warn",
            expect.stringContaining('imports from "users-admin" but it is not declared'),
            expect.anything()
          );
        },
      );
    });

    it("throws UNDECLARED_IMPORT in strict mode when prefix collision mismatch would cause false attribution", async () => {
      // §3.2 — Regression: In strict mode, a file in 'users-admin' that references 'orders'
      // must only produce an error if 'users-admin' itself fails to declare 'orders'.
      // This test verifies that the strict-mode path exercises the correct module attribution
      // and does NOT misattribute the file to 'users'.
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: true };",
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users');
        `,
          "src/modules/users-admin/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users-admin');
        `,
          "src/modules/orders/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('orders', { exports: ['OrderService'] });
          export class OrderService {}
        `,
          // This file belongs to users-admin, uses orders without declaring it.
          // If grouping is buggy and this file lands under 'users', the error would say
          // "users imports from orders" — the test ensures it says "users-admin".
          "src/modules/users-admin/service.ts": `
          import { OrderService } from '@modules/orders';
        `,
        },
        async (_, app) => {
          const err = await createApp(app as any).catch((e) => e);
          expect(err).toBeInstanceOf(NodulusError);
          expect((err as NodulusError).code).toBe("UNDECLARED_IMPORT");
          // The error must reference 'users-admin', not 'users'.
          expect((err as NodulusError).message).toContain("users-admin");
          expect((err as NodulusError).message).not.toMatch(/^Module "users" imports/);
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // §3.2 — Consolidated Glob Regression (Step 5.5)
  // These tests verify that the internal refactor from per-module globs to a
  // single root-level glob + in-memory grouping did NOT alter the observable
  // behaviour of Step 5.5 (undeclared cross-module import detection).
  // -----------------------------------------------------------------------
  describe("Consolidated Glob Regression — Step 5.5 behaviour", () => {
    it("detects undeclared cross-module imports in non-strict mode after the consolidated glob refactor", async () => {
      // §3.2 / §5.5 regression:
      // Module 'payments' uses '@modules/users' in its service file but does NOT
      // declare 'users' in its imports[]. The consolidated glob must still surface
      // this as a WARN (non-strict) — same as before the refactor.
      const loggerHandler = vi.fn();

      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users', { exports: ['UserService'] });
          export class UserService {}
        `,
          "src/modules/payments/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('payments');
        `,
          // payments/service.ts imports from users but 'users' is NOT in payments.imports[]
          "src/modules/payments/service.ts": `
          import { UserService } from '@modules/users';
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any, { logger: loggerHandler });

          // Bootstrap must succeed (non-strict)
          expect(result.modules).toHaveLength(2);

          // Step 5.5 must have fired a WARN for the undeclared import
          expect(loggerHandler).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining(
              'Module "payments" imports from "users" but it is not declared in imports[].',
            ),
            expect.objectContaining({
              _module: "module",
              target: "users",
            }),
          );
        },
      );
    });

    it("throws UNDECLARED_IMPORT in strict mode even with the consolidated glob (Step 5.5 regression)", async () => {
      // §3.2 / §5.5 strict regression:
      // Same undeclared cross-module import scenario, but with strict: true.
      // The consolidated glob must still cause createApp() to reject with UNDECLARED_IMPORT.
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: true };",
          "src/modules/catalog/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('catalog', { exports: ['CatalogService'] });
          export class CatalogService {}
        `,
          "src/modules/checkout/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('checkout');
        `,
          // checkout/handler.ts secretly uses catalog without declaring it
          "src/modules/checkout/handler.ts": `
          import { CatalogService } from '@modules/catalog';
        `,
        },
        async (_, app) => {
          await expect(createApp(app as any)).rejects.toMatchObject({
            code: "UNDECLARED_IMPORT",
          });
        },
      );
    });

    it("does NOT warn about cross-module imports that are correctly declared in imports[] (no false positives)", async () => {
      // §3.2 negative case: when 'notifications' correctly declares 'users' in imports[],
      // and its service.ts references @modules/users, the consolidated glob must NOT fire
      // any UNDECLARED_IMPORT warning. Validates there are no false positives.
      const loggerHandler = vi.fn();

      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/users/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('users', { exports: ['UserService'] });
          export class UserService {}
        `,
          "src/modules/notifications/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('notifications', { imports: ['users'] });
        `,
          // This import is legitimately declared — must produce NO warning
          "src/modules/notifications/mailer.ts": `
          import { UserService } from '@modules/users';
        `,
        },
        async (_, app) => {
          const result = await createApp(app as any, { logger: loggerHandler });
          expect(result.modules).toHaveLength(2);

          // No UNDECLARED_IMPORT warning must be emitted
          const undeclaredWarns = loggerHandler.mock.calls.filter(
            (call) =>
              call[0] === "warn" &&
              typeof call[1] === "string" &&
              call[1].includes("but it is not declared in imports[]"),
          );
          expect(undeclaredWarns).toHaveLength(0);
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Semantic Log Levels Integration
  // -----------------------------------------------------------------------
  describe("Semantic Log Levels Integration", () => {
    let pinoMock: any;
    let createDefaultPinoSpy: any;

    beforeEach(() => {
      pinoMock = {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn().mockReturnThis(),
      };
      
      // Inject our mock. createApp() calls createDefaultPinoInstance() when config loads,
      // so we mock it to return our pinoMock.
      createDefaultPinoSpy = vi.spyOn(pinoModule, 'createDefaultPinoInstance').mockReturnValue(pinoMock);
      pinoModule.setPinoInstance(pinoMock);
    });

    afterEach(() => {
      createDefaultPinoSpy.mockRestore();
    });

    it("verifies that bootstrap with 0 routes emits warn (not info) with alert message", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false };",
          "src/modules/noroutes/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('noroutes');
        `,
        },
        async (_, app) => {
          await createApp(app as any);

          // Find calls to warn
          const warnCalls = pinoMock.warn.mock.calls;
          
          // Verify 0 routes warning was emitted
          const zeroRoutesWarn = warnCalls.find((call: any[]) => 
            call[0] && 
            typeof call[0] === 'object' && 
            call[0].module === 'router' && 
            typeof call[1] === 'string' &&
            call[1].includes('Mounted 0 route(s)')
          );
          expect(zeroRoutesWarn).toBeDefined();
          
          // Verify Bootstrap complete summary warning
          const bootstrapCompleteWarn = warnCalls.find((call: any[]) => 
            call[0] && 
            typeof call[0] === 'object' && 
            call[0].module === 'boot' && 
            typeof call[1] === 'string' &&
            call[1].includes('Bootstrap complete') && 
            call[0] && call[0].routeCount === 0 && call[0].moduleCount === 1
          );
          expect(bootstrapCompleteWarn).toBeDefined();
        },
      );
    });

    it("verifies that ESM alias hook skipped emits at debug level (not visible with logLevel: info)", async () => {
      await runInTmpApp(
        {
          "nodulus.config.js": "export default { strict: false, logLevel: 'debug' };",
          "src/modules/dummy/index.ts": `
          import { Module } from '{{SOURCE}}';
          Module('dummy');
        `,
        },
        async (_, app) => {
          // preloaded is true, so the alias hook should be skipped
          (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = { preloaded: true, aliases: {} };

          await createApp(app as any);

          const debugCalls = pinoMock.debug.mock.calls;
          const infoCalls = pinoMock.info.mock.calls;

          // Check it was emitted as debug
          const aliasSkippedDebug = debugCalls.find((call: any[]) => 
            call[0] && 
            typeof call[0] === 'object' && 
            call[0].module === 'alias' && 
            typeof call[1] === 'string' &&
            call[1].includes('ESM alias hook skipped')
          );
          expect(aliasSkippedDebug).toBeDefined();

          // Check it was NOT emitted as info
          const aliasSkippedInfo = infoCalls.find((call: any[]) => 
            call[0] && 
            typeof call[0] === 'object' && 
            call[0].module === 'alias' && 
            typeof call[1] === 'string' &&
            call[1].includes('ESM alias hook skipped')
          );
          expect(aliasSkippedInfo).toBeUndefined();

          delete (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
        },
      );
    });
  });
});
