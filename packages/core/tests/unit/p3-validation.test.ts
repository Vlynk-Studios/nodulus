import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '../../src/bootstrap/createApp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceUrl = pathToFileURL(path.resolve(__dirname, '../../src/index.ts')).href;

const runInTmpApp = async (files: Record<string, string>, tests: (tmpDir: string, app: any) => Promise<void>) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-p3-test-'));
  
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

describe('P3 Alias Validation', () => {
  const baseStructure = {
    'src/modules/users/index.ts': `
      import { Module } from '{{SOURCE}}';
      Module('users');
    `,
  };

  it('should warn on alias collision with modules', async () => {
    const logger = vi.fn();
    await runInTmpApp(baseStructure, async (tmpDir, app) => {
      // Create a directory for the colliding alias to pass existence check
      fs.mkdirSync(path.join(tmpDir, 'custom-users'));
      
      await createApp(app as any, { 
        logger, 
        aliases: { '@modules/users': './custom-users' },
        strict: false 
      });

      expect(logger).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Alias collision'),
        expect.objectContaining({ _module: 'alias', alias: '@modules/users' })
      );
    });
  });

  it('should throw ALIAS_INVALID in strict mode if wildcard points to a file', async () => {
    await runInTmpApp(baseStructure, async (tmpDir, app) => {
      fs.writeFileSync(path.join(tmpDir, 'config.ts'), 'export default {}');
      
      await expect(createApp(app as any, { 
        aliases: { '@config/*': './config.ts' },
        strict: true 
      })).rejects.toMatchObject({
        code: 'ALIAS_INVALID'
      });
    });
  });

  it('should warn in non-strict mode if wildcard points to a file', async () => {
    const logger = vi.fn();
    await runInTmpApp(baseStructure, async (tmpDir, app) => {
      fs.writeFileSync(path.join(tmpDir, 'config.ts'), 'export default {}');
      
      await createApp(app as any, { 
        logger,
        aliases: { '@config/*': './config.ts' },
        strict: false 
      });

      expect(logger).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Wildcards should only point to directories'),
        expect.objectContaining({ _module: 'alias' })
      );
    });
  });

  it('should support alias to an individual file', async () => {
    await runInTmpApp(baseStructure, async (tmpDir, app) => {
      const filePath = path.join(tmpDir, 'db.ts');
      fs.writeFileSync(filePath, 'export const db = {}');
      
      const nodulusApp = await createApp(app as any, { 
        aliases: { '@db': './db.ts' }
      });

      const aliases = nodulusApp.registry.getAllAliases();
      expect(aliases['@db']).toBe(path.resolve(tmpDir, 'db.ts'));
    });
  });

  it('should emit debug log for custom alias registration', async () => {
    const logger = vi.fn();
    await runInTmpApp(baseStructure, async (tmpDir, app) => {
      fs.mkdirSync(path.join(tmpDir, 'shared'));
      
      await createApp(app as any, { 
        logger,
        logLevel: 'debug',
        aliases: { '@shared': './shared' }
      });

      expect(logger).toHaveBeenCalledWith(
        'debug',
        expect.stringMatching(/Alias registered: @shared → .*shared/),
        expect.objectContaining({ source: 'config' })
      );
    });
  });
});
