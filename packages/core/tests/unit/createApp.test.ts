import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../../src/bootstrap/createApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceUrl = pathToFileURL(path.resolve(__dirname, '../../src/index.ts')).href;

const runInTmpApp = async (files: Record<string, string>, tests: (tmpDir: string, app: any) => Promise<void>) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-app-test-'));
  
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const finalContent = content.replace(/\{\{SOURCE\}\}/g, sourceUrl);
    fs.writeFileSync(fullPath, finalContent);
  }

  // Inject mandatory ESM package.json
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
  
  const mockApp = {
    use: vi.fn(),
  };

  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

  try {
    await tests(tmpDir, mockApp);
  } finally {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

describe('createApp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validAppStructure = {
    'nodulus.config.js': `
      export default { prefix: '/api', strict: false };
    `,
    'src/modules/users/index.ts': `
      import { Module } from '{{SOURCE}}';
      Module('users');
    `,
    'src/modules/users/controller.ts': `
      import { Controller } from '{{SOURCE}}';
      Controller('/users');
      const fakeRouter = function() {};
      fakeRouter.use = function() {};
      fakeRouter.stack = [
        { route: { path: '/me', methods: { get: true } } }
      ];
      export default fakeRouter;
    `
  };

  it('should mount discovered routes and return NodulusApp shape', async () => {
    await runInTmpApp(validAppStructure, async (_, app) => {
      const nodulusApp = await createApp(app as any);

      // Verify mounting occurred
      expect(app.use).toHaveBeenCalledTimes(1);
      
      // Verify the returned properties
      expect(nodulusApp.modules).toHaveLength(1);
      expect(nodulusApp.modules[0].name).toBe('users');
      expect(nodulusApp.routes).toHaveLength(1);
      expect(nodulusApp.routes[0]).toEqual({
        method: 'GET',
        path: '/api/users/me',
        module: 'users',
        controller: 'controller'
      });
      expect(nodulusApp.registry).toBeDefined();
    });
  });

  it('should maintain atomic failure and prevent any route mount if a module is invalid', async () => {
    const invalidAppStructure: Record<string, string> = { ...validAppStructure };
    // This file deliberately fails validation!
    invalidAppStructure['src/modules/auth/index.ts'] = `
      // Missing Module() call!
    `;

    await runInTmpApp(invalidAppStructure, async (_, app) => {
      await expect(createApp(app as any)).rejects.toMatchObject({
        code: 'MODULE_NOT_FOUND'
      });
      
      // Atomic failure guarantee: no routes should be mounted if the pipeline exploded prematurely.
      expect(app.use).not.toHaveBeenCalled();
    });
  });

  describe('Logging', () => {
    it('should emit bootstrap:complete with durationMs > 0', async () => {
      const logger = vi.fn();
      await runInTmpApp(validAppStructure, async (_, app) => {
        await createApp(app as any, { logger });
        
        expect(logger).toHaveBeenCalledWith(
          'info',
          expect.stringContaining('Bootstrap complete'),
          expect.objectContaining({ 
            durationMs: expect.any(Number),
            moduleCount: 1,
            routeCount: 1
          })
        );
        
        const lastCall = logger.mock.calls.find(call => call[1].includes('Bootstrap complete'))!;
        expect(lastCall[2].durationMs).toBeGreaterThan(0);
      });
    });

    it('should respect logLevel and suppress info messages when set to warn', async () => {
      const logger = vi.fn();
      await runInTmpApp(validAppStructure, async (_, app) => {
        await createApp(app as any, { logger, logLevel: 'warn' });
        
        // Modules, routes, and bootstrap completion are 'info' level
        const infoCalls = logger.mock.calls.filter(call => call[0] === 'info');
        expect(infoCalls).toHaveLength(0);
      });
    });

    it('should pass structured metadata for module loading', async () => {
      const logger = vi.fn();
      await runInTmpApp(validAppStructure, async (_, app) => {
        await createApp(app as any, { logger });
        
        expect(logger).toHaveBeenCalledWith(
          'info',
          expect.stringMatching(/Module loaded:.*users/),
          expect.objectContaining({
            _module: 'module',
            name: 'users',
            path: expect.any(String)
          })
        );
      });
    });
    it('should log when skipping a disabled controller', async () => {
      const logger = vi.fn();
      const mockStructure = { ...validAppStructure };
      mockStructure['src/modules/users/controller.ts'] = `
        import { Controller } from '{{SOURCE}}';
        Controller('/users', { enabled: false });
        const fakeRouter = function() {};
        fakeRouter.use = function() {};
        fakeRouter.stack = [];
        export default fakeRouter;
      `;
      
      await runInTmpApp(mockStructure, async (_, app) => {
        await createApp(app as any, { logger });
        
        expect(logger).toHaveBeenCalledWith(
          'info',
          expect.stringContaining('is disabled — skipping mount'),
          expect.objectContaining({ 
            _module: 'router',
            module: 'users' 
          })
        );
      });
    });
  });
  it('should register custom aliases in the registry', async () => {
    const appWithAliases = {
      ...validAppStructure,
      'shared/utils.ts': 'export const foo = 1;'
    };
    
    await runInTmpApp(appWithAliases, async (tmpDir, app) => {
      const nodulusApp = await createApp(app as any, {
        aliases: {
          '@shared': './shared'
        }
      });
      
      const aliases = nodulusApp.registry.getAllAliases();
      expect(aliases['@shared']).toBe(path.resolve(tmpDir, 'shared'));
    });
  });

  it('should expose custom aliases via getAliases() after createApp() (P1/P6)', async () => {
    await runInTmpApp(validAppStructure, async (tmpDir, app) => {
      const configDir = path.join(tmpDir, 'src/config');
      fs.mkdirSync(configDir, { recursive: true });

      await createApp(app as any, {
        aliases: { '@config': './src/config' }
      });
      
      const { getAliases } = await import('../../src/aliases/getAliases.js');
      const aliases = await getAliases({ absolute: true });
      
      expect(aliases['@config']).toBe(path.resolve(tmpDir, 'src/config'));
    });
  });

  it('should support aliases pointing to individual files end-to-end (P3/P6)', async () => {
    const appWithFileAlias = {
      ...validAppStructure,
      'src/shared/database.ts': 'export const db = {};'
    };

    await runInTmpApp(appWithFileAlias, async (tmpDir, app) => {
      const nodulusApp = await createApp(app as any, {
        aliases: { '@db': './src/shared/database.ts' }
      });

      const aliases = nodulusApp.registry.getAllAliases();
      expect(aliases['@db']).toBe(path.resolve(tmpDir, 'src/shared/database.ts'));
      
      const { getAliases } = await import('../../src/aliases/getAliases.js');
      const publicAliases = await getAliases();
      expect(publicAliases['@db']).toBeDefined();
    });
  });

  describe('Module Load Timeout', () => {
    it('should throw MODULE_LOAD_TIMEOUT if top-level await in module exceeds timeout', async () => {
      const appWithHangingModule = {
        ...validAppStructure,
        'src/modules/hang/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('hang');
          await new Promise(() => {}); // Hangs forever
        `
      };

      await runInTmpApp(appWithHangingModule, async (_, app) => {
        await expect(createApp(app as any, { moduleLoadTimeoutMs: 100 })).rejects.toMatchObject({
          code: 'MODULE_LOAD_TIMEOUT'
        });
      });
    });

    it('should throw MODULE_LOAD_TIMEOUT if top-level await in controller exceeds timeout', async () => {
      const appWithHangingController = {
        ...validAppStructure,
        'src/modules/users/hang.controller.ts': `
          import { Controller } from '{{SOURCE}}';
          Controller('/hang');
          await new Promise(() => {}); // Hangs forever
          export default function() {}
        `
      };

      await runInTmpApp(appWithHangingController, async (_, app) => {
        await expect(createApp(app as any, { moduleLoadTimeoutMs: 100 })).rejects.toMatchObject({
          code: 'MODULE_LOAD_TIMEOUT'
        });
      });
    });

    it('should load successfully if top-level await finishes before timeout', async () => {
      const appWithSlowModule = {
        'src/modules/slow/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('slow');
          await new Promise(resolve => setTimeout(resolve, 50));
        `
      };

      await runInTmpApp(appWithSlowModule, async (_, app) => {
        const nodulusApp = await createApp(app as any, { moduleLoadTimeoutMs: 200, strict: false });
        expect(nodulusApp.modules).toHaveLength(1);
        expect(nodulusApp.modules[0].name).toBe('slow');
      });
    });
  });

  // ── T-05: nits.enabled:false — registry.json must not be created ────────────

  describe('T-05: createApp() with nits.enabled:false', () => {
    it('T-05: does not create .nodulus/registry.json when NITS is disabled, and bootstrap succeeds', async () => {
      await runInTmpApp(validAppStructure, async (tmpDir, app) => {
        // Boot with NITS disabled
        const nodulusApp = await createApp(app as any, {
          nits: { enabled: false }
        } as any);

        // Bootstrap should complete normally
        expect(nodulusApp.modules).toHaveLength(1);
        expect(nodulusApp.modules[0].name).toBe('users');

        // registry.json must NOT exist — NITS was disabled
        const registryPath = path.join(tmpDir, '.nodulus', 'registry.json');
        expect(fs.existsSync(registryPath)).toBe(false);
      });
    });
  });

  // ── §1.4: createApp - missing coverage branches ────────────────────────────

  describe('§1.4: createApp - missing coverage branches', () => {
    it('§1.4-1: logs a warning if config.domains or config.shared is provided', async () => {
      const logger = vi.fn();
      await runInTmpApp(validAppStructure, async (_, app) => {
        await createApp(app as any, { domains: ['src/domains/*'], logger } as any);
        expect(logger).toHaveBeenCalledWith(
          'warn',
          expect.stringContaining('Infrastructure (domains/shared) is not yet supported'),
          expect.any(Object)
        );
      });
    });

    it('§1.4-2: logs a warning (or throws if strict) for wildcard alias pointing to a file', async () => {
      const logger = vi.fn();
      const appWithFile = {
        ...validAppStructure,
        'src/utils.ts': 'export const foo = 1;'
      };
      
      // Strict: false -> warning
      await runInTmpApp(appWithFile, async (_, app) => {
        await createApp(app as any, {
          aliases: { '@utils/*': './src/utils.ts' },
          strict: false,
          logger
        } as any);
        expect(logger).toHaveBeenCalledWith(
          'warn',
          expect.stringContaining('Wildcards should only point to directories'),
          expect.any(Object)
        );
      });

      // Strict: true -> throw
      await runInTmpApp(appWithFile, async (_, app) => {
        await expect(createApp(app as any, {
          aliases: { '@utils/*': './src/utils.ts' },
          strict: true,
          logger
        } as any)).rejects.toMatchObject({ code: 'ALIAS_INVALID' });
      });
    });

    it('§1.4-3: skips Step 3 entirely if resolveAliases is false', async () => {
      await runInTmpApp(validAppStructure, async (_, app) => {
        const nodulusApp = await createApp(app as any, { resolveAliases: false } as any);
        // The registry should NOT have the @modules/users alias.
        const aliases = nodulusApp.registry.getAllAliases();
        expect(aliases).not.toHaveProperty('@modules/users');
      });
    });

    it('§1.4-4: throws CIRCULAR_DEPENDENCY when strict mode is true', async () => {
      const circularApp = {
        'src/modules/a/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('a', { imports: ['b'] });
        `,
        'src/modules/a/service.ts': `
          import { b } from '@modules/b';
        `,
        'src/modules/b/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('b', { imports: ['a'] });
        `,
        'src/modules/b/service.ts': `
          import { a } from '@modules/a';
        `
      };

      await runInTmpApp(circularApp, async (_, app) => {
        await expect(createApp(app as any, { strict: true } as any)).rejects.toMatchObject({
          code: 'CIRCULAR_DEPENDENCY'
        });
      });
    });

    it('§1.4-5: logs a warning if a module mounts 0 controllers', async () => {
      const logger = vi.fn();
      const noControllersApp = {
        'src/modules/empty/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('empty');
        `
      };

      await runInTmpApp(noControllersApp, async (_, app) => {
        await createApp(app as any, { logger } as any);
        expect(logger).toHaveBeenCalledWith(
          'warn',
          expect.stringContaining('Mounted 0 route(s)'),
          expect.any(Object)
        );
      });
    });

    it('§1.4-6: throws ALIAS_NOT_FOUND if the target path does not exist', async () => {
      await runInTmpApp(validAppStructure, async (_, app) => {
        await expect(createApp(app as any, {
          aliases: { '@notfound': './does-not-exist' },
        } as any)).rejects.toMatchObject({ code: 'ALIAS_NOT_FOUND' });
      });
    });

    it('§1.4-7: throws INVALID_CONTROLLER if controller import fails due to syntax or runtime error', async () => {
      const badControllerApp = {
        'src/modules/bad/index.ts': `
          import { Module } from '{{SOURCE}}';
          Module('bad');
        `,
        'src/modules/bad/controller.ts': `
          import { Controller } from '{{SOURCE}}';
          Controller('/bad');
          throw new Error('Runtime error during controller evaluation');
        `
      };

      await runInTmpApp(badControllerApp, async (_, app) => {
        await expect(createApp(app as any, {} as any)).rejects.toMatchObject({
          code: 'INVALID_CONTROLLER'
        });
      });
    });
  });
});
