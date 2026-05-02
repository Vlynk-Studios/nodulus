import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncPreloadCommand } from '../../src/cli/commands/sync-preload.js';
import { loadConfig } from '../../src/core/config.js';

vi.mock('../../src/core/config.js', () => ({ loadConfig: vi.fn() }));

const makeBaseConfig = (overrides: Record<string, unknown> = {}) => ({
  modules: 'src/modules/*',
  aliases: {} as Record<string, string>,
  prefix: '',
  strict: true,
  resolveAliases: true,
  logger: vi.fn() as any,
  logLevel: 'info' as any,
  nits: { enabled: false },
  requirePreloader: false,
  ...overrides
});

describe('CLI: sync-preload', () => {
  let tmpDir: string;

  const runCommand = async () => {
    const cmd = syncPreloadCommand();
    await cmd.parseAsync(['node', 'cli']);
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-sync-preload-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app', type: 'module' }));
    fs.writeFileSync(path.join(tmpDir, 'nodulus.config.js'), 'export default {}');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .nodulus/preload.js with correct content from nodulus.config.js project', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({
      aliases: { '@shared': './src/shared' }
    }));

    await runCommand();

    const preloadPath = path.join(tmpDir, '.nodulus', 'preload.js');
    expect(fs.existsSync(preloadPath)).toBe(true);

    const content = fs.readFileSync(preloadPath, 'utf8');
    expect(content).toContain("import { register } from 'node:module'");
    expect(content).toContain('globalThis.__NODULUS_PRELOAD_CONFIG__');
    expect(content).toContain("preloaded: true");
    expect(content).toContain("_version:");
  });

  it('creates .nodulus/ directory if it does not exist', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig());

    const nodulusDir = path.join(tmpDir, '.nodulus');
    expect(fs.existsSync(nodulusDir)).toBe(false);

    await runCommand();

    expect(fs.existsSync(nodulusDir)).toBe(true);
    expect(fs.existsSync(path.join(nodulusDir, 'preload.js'))).toBe(true);
  });

  it('embeds user aliases from nodulus.config.ts into the generated file', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({
      aliases: {
        '@shared': './src/shared',
        '@config': './src/config',
        '@db': './src/database'
      }
    }));

    await runCommand();

    const content = fs.readFileSync(path.join(tmpDir, '.nodulus', 'preload.js'), 'utf8');
    expect(content).toContain("'@shared':");
    expect(content).toContain("'@config':");
    expect(content).toContain("'@db':");
  });

  it('works the same with a JavaScript project config (nodulus.config.js)', async () => {
    // loadConfig abstracts away .ts vs .js — the command behavior is identical
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({
      aliases: { '@utils': './src/utils' }
    }));

    await runCommand();

    const content = fs.readFileSync(path.join(tmpDir, '.nodulus', 'preload.js'), 'utf8');
    expect(content).toContain("'@utils':");
    expect(content).toContain('preloaded: true');
  });

  it('running twice does not change the file (idempotency)', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({
      aliases: { '@shared': './src/shared' }
    }));

    await runCommand();
    const contentAfterFirst = fs.readFileSync(path.join(tmpDir, '.nodulus', 'preload.js'), 'utf8');
    const mtimeAfterFirst = fs.statSync(path.join(tmpDir, '.nodulus', 'preload.js')).mtimeMs;

    // Small delay to ensure mtime would differ if file was rewritten
    await new Promise(r => setTimeout(r, 20));

    await runCommand();
    const contentAfterSecond = fs.readFileSync(path.join(tmpDir, '.nodulus', 'preload.js'), 'utf8');
    const mtimeAfterSecond = fs.statSync(path.join(tmpDir, '.nodulus', 'preload.js')).mtimeMs;

    expect(contentAfterFirst).toBe(contentAfterSecond);
    // File should NOT be rewritten if content is identical
    expect(mtimeAfterSecond).toBe(mtimeAfterFirst);
  });

  it('updates the file when aliases change in config (re-sync)', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({
      aliases: { '@shared': './src/shared' }
    }));
    await runCommand();
    const contentV1 = fs.readFileSync(path.join(tmpDir, '.nodulus', 'preload.js'), 'utf8');
    expect(contentV1).toContain("'@shared':");
    expect(contentV1).not.toContain("'@newlib':");

    // Simulate user adding a new alias and re-running
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({
      aliases: {
        '@shared': './src/shared',
        '@newlib': './src/newlib'
      }
    }));
    await runCommand();
    const contentV2 = fs.readFileSync(path.join(tmpDir, '.nodulus', 'preload.js'), 'utf8');

    expect(contentV2).toContain("'@shared':");
    expect(contentV2).toContain("'@newlib':");
    expect(contentV2).not.toBe(contentV1);
  });
});
