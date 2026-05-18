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

  // ── T-04: dynamic import does not crash extractModuleImports ────────────────

  describe('T-04: extractModuleImports — dynamic imports do not crash', () => {
    it('T-04a: file with import() expression → does not throw and returns static imports', () => {
      const code = [
        "import { Foo } from '@modules/foo';",
        "const bar = import('./algo');",          // dynamic import
        "const baz = import(`./dyn-${expr}`);",  // template-literal dynamic import
      ].join('\n');

      const p = writeTempFile(code, '.ts');
      tmpFiles.push(p);

      let result: any[];
      expect(() => { result = extractModuleImports(p); }).not.toThrow();

      // Static import must still be captured
      expect(result!.some(r => r.specifier === '@modules/foo')).toBe(true);
    });

    it('T-04b: file with ONLY dynamic imports → returns [] and does not throw', () => {
      const code = [
        "const a = import('./a');",
        "const b = await import('./b');",
      ].join('\n');

      const p = writeTempFile(code, '.ts');
      tmpFiles.push(p);

      let result: any[];
      expect(() => { result = extractModuleImports(p); }).not.toThrow();
      // No static @modules/* imports → empty array
      expect(result!).toEqual([]);
    });

    it('T-04c: mixed static + dynamic imports in a .js file → does not throw', () => {
      const code = [
        "import { Auth } from '@modules/auth';",
        "const lazy = import('./lazy-chunk.js');",
      ].join('\n');

      const p = writeTempFile(code, '.js');
      tmpFiles.push(p);

      let result: any[];
      expect(() => { result = extractModuleImports(p); }).not.toThrow();
      expect(result!.some(r => r.specifier === '@modules/auth')).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §1.3 [BLOCKER]: extractModuleImports — dynamic imports must not crash
// ─────────────────────────────────────────────────────────────────────────────
//
// Context: import-scanner.ts uses a regex-based extractor for .ts files.
// The regex `/(?:import|export)\s+(?:[^"';]+\s+from\s+)?["']([^"';]+)["']/g`
// could potentially match the specifier inside `import('./algo')` producing
// `./algo` as a capture group. Since `./algo` does not start with '@' it is
// filtered out, so dynamic imports are silently ignored.
//
// This describe block is the canonical contract:
// "extractModuleImports MUST NOT throw when dynamic imports are present AND
//  MUST still return the static @-prefixed imports from the same file."
// ─────────────────────────────────────────────────────────────────────────────

describe('§1.3 [BLOCKER]: extractModuleImports — dynamic import resilience', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const p of tmpFiles) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    tmpFiles.length = 0;
  });

  function tmp(content: string, ext = '.ts'): string {
    const p = path.join(os.tmpdir(), `nodulus-dyn-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(p, content, 'utf-8');
    tmpFiles.push(p);
    return p;
  }

  it('[BLOCKER] §1.3-1: static + dynamic import() in .ts file — does not throw, returns static import', () => {
    // This is the primary BLOCKER scenario.
    // A .ts file has both a static @modules import AND a dynamic import('./algo').
    // extractModuleImports must:
    //   (a) NOT throw (the regex must not be confused by the import() expression)
    //   (b) Return the static @modules/users import
    //   (c) NOT include ./algo in the result (relative paths are filtered)
    const code = [
      "import { UserService } from '@modules/users';",
      "const chunk = import('./algo');",
    ].join('\n');

    const file = tmp(code);
    let result: ReturnType<typeof extractModuleImports>;

    expect(() => { result = extractModuleImports(file); }).not.toThrow();

    // Static @modules import must be captured
    const specifiers = result!.map(r => r.specifier);
    expect(specifiers).toContain('@modules/users');

    // Relative dynamic import must NOT appear (not an @ specifier)
    expect(specifiers).not.toContain('./algo');
    expect(specifiers.some(s => s.startsWith('.'))).toBe(false);
  });

  it('[BLOCKER] §1.3-1b: captures import type, export type and inline dynamic imports', () => {
    const code = [
      "import type { Foo } from '@modules/foo';",
      "export type { Bar } from '@modules/bar';",
      "const baz = await import('@modules/baz');"
    ].join('\n');

    const file = tmp(code);
    let result: ReturnType<typeof extractModuleImports>;

    expect(() => { result = extractModuleImports(file); }).not.toThrow();

    const specifiers = result!.map(r => r.specifier);
    expect(specifiers).toContain('@modules/foo');
    expect(specifiers).toContain('@modules/bar');
    expect(specifiers).toContain('@modules/baz');
  });

  it('[BLOCKER] §1.3-2: file with ONLY dynamic imports — does not throw, returns []', () => {
    // No static imports at all; only dynamic expressions.
    // Must return an empty array, not throw, not warn.
    const code = [
      "const a = import('./chunk-a');",
      "const b = await import('./chunk-b');",
      "export {};",
    ].join('\n');

    const file = tmp(code);
    let result: ReturnType<typeof extractModuleImports>;

    expect(() => { result = extractModuleImports(file); }).not.toThrow();
    expect(result!).toEqual([]);
  });

  it('§1.3-3: template-literal dynamic import — does not crash, static import still returned', () => {
    // Template literals inside import() can potentially break a naive regex.
    // The static import must survive regardless.
    const code = [
      "import { Auth } from '@modules/auth';",
      "const mod = import(`./plugins/${name}`);",
    ].join('\n');

    const file = tmp(code);
    let result: ReturnType<typeof extractModuleImports>;

    expect(() => { result = extractModuleImports(file); }).not.toThrow();

    const specifiers = result!.map(r => r.specifier);
    expect(specifiers).toContain('@modules/auth');
    // Template literal produces no valid @ specifier
    expect(specifiers.filter(s => !s.startsWith('@'))).toHaveLength(0);
  });

  it('§1.3-4: multiple static imports interleaved with dynamic imports — all static captured, none omitted', () => {
    // Guards against the regex consuming tokens from a dynamic import and then
    // skipping the next static import due to state corruption.
    const code = [
      "import { A } from '@modules/auth';",
      "const lazy1 = import('./lazy');",
      "import { B } from '@modules/billing';",
      "const lazy2 = await import('./lazy2');",
      "import { N } from '@modules/notifications';",
    ].join('\n');

    const file = tmp(code);
    let result: ReturnType<typeof extractModuleImports>;

    expect(() => { result = extractModuleImports(file); }).not.toThrow();

    const specifiers = result!.map(r => r.specifier);
    expect(specifiers).toContain('@modules/auth');
    expect(specifiers).toContain('@modules/billing');
    expect(specifiers).toContain('@modules/notifications');

    // Verify line numbers are monotonically increasing (not corrupted by dynamic import tokens)
    const lines = result!.map(r => r.line);
    expect(lines[0]).toBeLessThan(lines[1]);
    expect(lines[1]).toBeLessThan(lines[2]);
  });

  it('§1.3-5: extractModuleImports on .js file with dynamic import — uses Acorn path, does not throw', () => {
    // .js files go through the Acorn parse path. Acorn natively supports
    // dynamic import() expressions (ecmaVersion:"latest"), so this must pass.
    const code = [
      "import { users } from '@modules/users';",
      "const lazy = import('./lazy.js');",
    ].join('\n');

    const file = tmp(code, '.js');
    let result: ReturnType<typeof extractModuleImports>;

    expect(() => { result = extractModuleImports(file); }).not.toThrow();

    const specifiers = result!.map(r => r.specifier);
    expect(specifiers).toContain('@modules/users');
    expect(specifiers).not.toContain('./lazy.js');
  });
});
