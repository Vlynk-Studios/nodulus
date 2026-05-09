import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_PATH = path.resolve(__dirname, '../../');
const BIN_PATH = path.join(CORE_PATH, 'dist/cli/index.js');
const INDEX_PATH = path.join(CORE_PATH, 'dist/index.js');

describe('Pre-loader Integration (preloader.test.ts)', () => {
  const setupTestApp = () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-preloader-integration-'));
    
    // 1. package.json
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'test-preloader-app',
      type: 'module',
    }));

    // 2. nodulus.config.js
    fs.writeFileSync(path.join(tmpDir, 'nodulus.config.js'), `
      export default {
        aliases: {
          '@lib': './src/lib'
        }
      };
    `);

    // 3. src/lib/helper.js
    fs.mkdirSync(path.join(tmpDir, 'src/lib'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/lib/helper.js'), `
      export const GREETING = 'Hello from Alias';
    `);

    return tmpDir;
  };

  it('resolves top-level aliases and shows active status when using --import', () => {
    const tmpDir = setupTestApp();
    
    try {
      // 1. Generate preload.js
      execSync(`node "${BIN_PATH}" sync-preload`, { cwd: tmpDir });

      // 2. Create entrypoint
      fs.writeFileSync(path.join(tmpDir, 'main.js'), `
        import { GREETING } from '@lib/helper.js';
        import { createApp } from '${pathToFileURL(INDEX_PATH).href}';
        
        console.log('MSG:' + GREETING);
        
        const mockApp = { use: () => {} };
        const nodulus = await createApp(mockApp);
        console.log('PRELOADER_ACTIVE:' + nodulus.runtime.preloaderActive);
      `);

      // 3. Run with --import
      const result = spawnSync('node', [
          '--import', './.nodulus/preload.js',
          'main.js'
      ], { cwd: tmpDir, encoding: 'utf8' });

      expect(result.stdout).toContain('MSG:Hello from Alias');
      expect(result.stdout).toContain('PRELOADER_ACTIVE:true');
      expect(result.stdout).not.toContain('Pre-loader not detected');
      
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('emits warning when pre-loader is not detected and resolveAliases is true', () => {
    const tmpDir = setupTestApp();
    
    try {
      fs.writeFileSync(path.join(tmpDir, 'main.js'), `
        import { createApp } from '${pathToFileURL(INDEX_PATH).href}';
        const mockApp = { use: () => {} };
        const nodulus = await createApp(mockApp);
        console.log('PRELOADER_ACTIVE:' + nodulus.runtime.preloaderActive);
      `);

      const result = spawnSync('node', ['main.js'], { cwd: tmpDir, encoding: 'utf8' });

      expect(result.stdout).toContain('Pre-loader not detected. Alias resolution might fail');
      expect(result.stdout).toContain('PRELOADER_ACTIVE:false');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('backward compatibility: still works without --import if using internal resolver (legacy mode)', () => {
    const tmpDir = setupTestApp();
    
    try {
      // Create a module
      fs.mkdirSync(path.join(tmpDir, 'src/modules/users'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/modules/users/index.js'), `
        import { Module } from '${pathToFileURL(INDEX_PATH).href}';
        Module('users');
      `);

      fs.writeFileSync(path.join(tmpDir, 'main.js'), `
        import { createApp } from '${pathToFileURL(INDEX_PATH).href}';
        const mockApp = { use: () => {} };
        const nodulus = await createApp(mockApp);
        console.log('BOOTSTRAPPED:' + nodulus.modules.length);
      `);

      // Should still work because createApp activates the resolver if not active
      const result = spawnSync('node', ['main.js'], { cwd: tmpDir, encoding: 'utf8' });

      expect(result.stdout).toContain('BOOTSTRAPPED:1');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
