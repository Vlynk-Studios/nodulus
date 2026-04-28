import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../../src/bootstrap/createApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceUrl = pathToFileURL(path.resolve(__dirname, '../../src/index.ts')).href;

const runInTmpApp = async (files: Record<string, string>, tests: (tmpDir: string, app: any) => Promise<void>) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-app-step0-test-'));
  
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
    fakeRouter.stack = [];
    export default fakeRouter;
  `
};

describe('createApp - Step 0 (Pre-loader Validation)', () => {
  beforeEach(() => {
    delete (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).__NODULUS_PRELOAD_CONFIG__;
  });

  it('createApp() returns runtime.preloaderActive: true when global is present', async () => {
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = { preloaded: true, aliases: { '@test': 'test' } };
    
    await runInTmpApp(validAppStructure, async (_, app) => {
      const nodulusApp = await createApp(app as any);
      expect(nodulusApp.runtime.preloaderActive).toBe(true);
      expect(nodulusApp.runtime.aliasesAtBoot).toEqual(expect.objectContaining({ '@test': 'test' }));
    });
  });

  it('createApp() returns runtime.preloaderActive: false when global is not present', async () => {
    await runInTmpApp(validAppStructure, async (_, app) => {
      const nodulusApp = await createApp(app as any);
      expect(nodulusApp.runtime.preloaderActive).toBe(false);
    });
  });

  it('createApp() throws PRELOADER_REQUIRED if requirePreloader is true and pre-loader is not active', async () => {
    await runInTmpApp(validAppStructure, async (_, app) => {
      await expect(createApp(app as any, { requirePreloader: true }))
        .rejects.toThrow('The application requires the Nodulus pre-loader to be active');
    });
  });

  it('createApp() emits log.warn when pre-loader is not active (without requirePreloader)', async () => {
    const logger = vi.fn();
    await runInTmpApp(validAppStructure, async (_, app) => {
      await createApp(app as any, { logger });
      expect(logger).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Pre-loader not detected. Alias resolution might fail for top-level imports.'),
        expect.any(Object)
      );
    });
  });

  it('createApp() emits log.warn of version mismatch when _version does not match', async () => {
    const logger = vi.fn();
    (globalThis as any).__NODULUS_PRELOAD_CONFIG__ = { preloaded: true, _version: '0.0.0-mismatch', aliases: {} };
    
    await runInTmpApp(validAppStructure, async (_, app) => {
      await createApp(app as any, { logger });
      expect(logger).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Pre-loader version mismatch'),
        expect.any(Object)
      );
    });
  });
});
