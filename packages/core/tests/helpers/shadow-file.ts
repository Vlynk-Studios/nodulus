import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { readShadowFile, writeShadowFile } from '../../src/nits/shadow-file.js';
import type { ShadowFileRecord } from '../../src/nits/shadow-file.types.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

export function createTmpModuleDir(name: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `nodulus-test-${name}-`));
  tmpDirs.push(tmpDir);
  // Create a basic module structure
  fs.mkdirSync(path.join(tmpDir, 'src', 'modules', name), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'modules', name, 'index.ts'), `// mock index\n`);
  return path.join(tmpDir, 'src', 'modules', name);
}

export function writeTmpShadowFile(dirPath: string, record: Partial<ShadowFileRecord>): void {
  const fullRecord: ShadowFileRecord = {
    id: record.id || 'mod_00000000',
    name: record.name || 'test-module',
    createdAt: record.createdAt || new Date().toISOString(),
    version: record.version ?? 1,
    ...record
  };
  writeShadowFile(dirPath, fullRecord);
}

export function readTmpShadowFile(dirPath: string): ShadowFileRecord | null {
  return readShadowFile(dirPath);
}
