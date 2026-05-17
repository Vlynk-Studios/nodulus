import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractModuleImports, scanBrokenImports } from '../../src/nits/import-scanner.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper: write a temp file and return its path
function writeTempFile(content: string, ext = '.ts'): string {
  const tmpPath = path.join(os.tmpdir(), `nodulus-test-${Date.now()}${ext}`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  return tmpPath;
}

describe('NITS Import Scanner', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
  });

  it('should extract AST imports safely avoiding excluded scopes', () => {
    const imports = extractModuleImports(__filename);
    expect(Array.isArray(imports)).toBe(true);
  });

  it('extractModuleImports returns [] for a non-existent file (ENOENT)', () => {
    const result = extractModuleImports('/does/not/exist.ts');
    expect(result).toEqual([]);
  });

  it('extractModuleImports returns [] and warns for a malformed JS file', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = writeTempFile('@@@ this is not valid JS !!!', '.js');
    tmpFiles.push(p);
    const result = extractModuleImports(p);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('extractModuleImports excludes @types, @vitest, @eslint scoped imports', () => {
    const code = [
      "import Foo from '@types/node';",
      "import Ui from '@vitest/ui';",
      "import Core from '@eslint/core';",
      "import auth from '@modules/auth';"
    ].join('\n');
    const p = writeTempFile(code, '.js');
    tmpFiles.push(p);
    const result = extractModuleImports(p);
    expect(result).toHaveLength(1);
    expect(result[0].specifier).toBe('@modules/auth');
  });

  it('extractModuleImports handles type re-exports and import types', () => {
    const code = [
      "import type { Bar } from '@modules/users';",
      "export type { Foo } from '@modules/bar';",
      "export { X } from '@modules/baz';"
    ].join('\n');
    const p = writeTempFile(code, '.ts');
    tmpFiles.push(p);
    const result = extractModuleImports(p);
    expect(result).toHaveLength(3);
    const specifiers = result.map(r => r.specifier);
    expect(specifiers).toContain('@modules/users');
    expect(specifiers).toContain('@modules/bar');
    expect(specifiers).toContain('@modules/baz');
  });

  it('extractModuleImports handles multiline imports', () => {
    const code = [
      "import type {",
      "  X,",
      "  Y",
      "} from '@modules/multiline';",
      "export {",
      "  Z",
      "} from '@modules/multiline2';"
    ].join('\n');
    const p = writeTempFile(code, '.ts');
    tmpFiles.push(p);
    const result = extractModuleImports(p);
    expect(result).toHaveLength(2);
    const specifiers = result.map(r => r.specifier);
    expect(specifiers).toContain('@modules/multiline');
    expect(specifiers).toContain('@modules/multiline2');
  });

  describe('scanBrokenImports', () => {
    it('returns empty array if no moved modules', async () => {
      const result = await scanBrokenImports([], process.cwd());
      expect(result).toEqual([]);
    });

    it('detects broken imports in a project structure', async () => {
      // Setup a project root with a file that imports from an old module
      const projectRoot = path.join(os.tmpdir(), `nodulus-proj-${Date.now()}`);
      fs.mkdirSync(projectRoot, { recursive: true });
      
      const appFile = path.join(projectRoot, 'app.ts');
      fs.writeFileSync(appFile, "import { auth2 } from '@modules/auth';\nimport { billing } from '@billing/payments';", 'utf-8');
      
      const movedModules: any[] = [
        {
          oldPath: 'src/modules/auth',
          newPath: 'src/modules/auth-v2',
          brokenImports: []
        },
        {
          oldPath: 'src/domains/billing/modules/payments',
          newPath: 'src/domains/finances/modules/payments',
          brokenImports: []
        }
      ];

      try {
        const result = await scanBrokenImports(movedModules, projectRoot);
        
        expect(result[0].brokenImports).toHaveLength(1);
        expect(result[0].brokenImports[0].specifier).toBe('@modules/auth');
        expect(result[0].brokenImports[0].file).toBe('app.ts');
        
        expect(result[1].brokenImports).toHaveLength(1);
        expect(result[1].brokenImports[0].specifier).toBe('@billing/payments');
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('does not report imports that already use the new alias', async () => {
      const projectRoot = path.join(os.tmpdir(), `nodulus-proj-new-${Date.now()}`);
      fs.mkdirSync(projectRoot, { recursive: true });
      
      const appFile = path.join(projectRoot, 'app.ts');
      // Case: Using the new alias after move
      fs.writeFileSync(appFile, "import { authv2 } from '@modules/auth-v2';", 'utf-8');
      
      const movedModules: any[] = [
        {
          oldPath: 'src/modules/auth',
          newPath: 'src/modules/auth-v2', // Alias would be @modules/auth-v2
          brokenImports: []
        }
      ];

      try {
        const result = await scanBrokenImports(movedModules, projectRoot);
        expect(result[0].brokenImports).toHaveLength(0);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('returns array with empty brokenImports if moved modules exist but no files use old aliases', async () => {
      const projectRoot = path.join(os.tmpdir(), `nodulus-proj-empty-${Date.now()}`);
      fs.mkdirSync(projectRoot, { recursive: true });
      
      const appFile = path.join(projectRoot, 'app.ts');
      fs.writeFileSync(appFile, "import { something } from '@other/module';", 'utf-8');
      
      const movedModules: any[] = [
        {
          oldPath: 'src/modules/auth',
          newPath: 'src/modules/auth-v2',
          brokenImports: []
        }
      ];

      try {
        const result = await scanBrokenImports(movedModules, projectRoot);
        expect(result).toHaveLength(1);
        expect(result[0].brokenImports).toEqual([]);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('includes correct line number in each BrokenImport', async () => {
      const projectRoot = path.join(os.tmpdir(), `nodulus-proj-lines-${Date.now()}`);
      fs.mkdirSync(projectRoot, { recursive: true });
      
      const appFile = path.join(projectRoot, 'app.ts');
      const content = [
        "// some comments",
        "// more comments",
        "import { auth } from '@modules/auth';",
      ].join('\n');
      
      fs.writeFileSync(appFile, content, 'utf-8');
      
      const movedModules: any[] = [
        {
          oldPath: 'src/modules/auth',
          newPath: 'src/modules/auth-v2',
          brokenImports: []
        }
      ];

      try {
        const result = await scanBrokenImports(movedModules, projectRoot);
        expect(result[0].brokenImports[0].line).toBe(3);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it('correctly identifies sub-path imports as broken', async () => {
      const projectRoot = path.join(os.tmpdir(), `nodulus-proj-sub-${Date.now()}`);
      fs.mkdirSync(projectRoot, { recursive: true });
      
      const appFile = path.join(projectRoot, 'app.ts');
      fs.writeFileSync(appFile, "import { User } from '@modules/users/types';", 'utf-8');
      
      const movedModules: any[] = [
        {
          oldPath: 'src/modules/users',
          newPath: 'src/modules/accounts',
          brokenImports: []
        }
      ];

      try {
        const result = await scanBrokenImports(movedModules, projectRoot);
        expect(result[0].brokenImports).toHaveLength(1);
        expect(result[0].brokenImports[0].specifier).toBe('@modules/users/types');
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  });
});
