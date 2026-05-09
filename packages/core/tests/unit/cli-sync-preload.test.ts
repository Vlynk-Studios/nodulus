import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { syncPreloadCommand } from '../../src/cli/commands/sync-preload.js';
import { loadConfig } from '../../src/core/config.js';
import { setPinoInstance, createDefaultPinoInstance } from '../../src/core/pino-instance.js';

vi.mock('../../src/core/config.js', () => ({ loadConfig: vi.fn() }));

const makeBaseConfig = (overrides: Record<string, unknown> = {}) => ({
  modules: 'src/modules/*',
  aliases: {} as Record<string, string>,
  prefix: '',
  strict: true,
  resolveAliases: true,
  logger: vi.fn() as any,
  logLevel: 'info' as any,
  logFormat: 'auto' as any,
  nits: { enabled: false },
  requirePreloader: false,
  ...overrides
});

describe('CLI: sync-preload', () => {
  let tmpDir: string;

  const runCommand = async (args: string[] = []) => {
    const cmd = syncPreloadCommand();
    await cmd.parseAsync(['node', 'cli', ...args]);
  };

  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodulus-sync-preload-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app', type: 'module' }));
    fs.writeFileSync(path.join(tmpDir, 'nodulus.config.js'), 'export default {}');
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    setPinoInstance(createDefaultPinoInstance('json', 'info'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    setPinoInstance(createDefaultPinoInstance());
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

  it('--silent produces no output when preload is up to date', async () => {
    // First run: generate the file
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ aliases: { '@shared': './src/shared' } }));
    await runCommand(['--silent']);

    // Capture stdout/stderr
    stdoutSpy.mockClear();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Second run: no changes
    await runCommand(['--silent']);
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('--silent prints one line when preload is updated', async () => {
    // First run with one alias
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ aliases: { '@a': './src/a' } }));
    await runCommand(['--silent']);

    // Second run with a different alias
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ aliases: { '@b': './src/b' } }));
    stdoutSpy.mockClear();
    await runCommand(['--silent']);

    // It should print exactly one line (the info "updated")
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
  });

  it('without --silent, shows next steps block when regenerating', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ aliases: { '@a': './src/a' } }));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    await runCommand([]); // default
    
    expect(consoleSpy).toHaveBeenCalledWith('Your package.json scripts should look like this:');
    // Also assert it includes the generated dev command (defaults to .js in test env)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"nodulus sync-preload --silent && nodulus dev --watch src/app.js"'));
    consoleSpy.mockRestore();
  });

  it('exits with code 1 when loadConfig throws (invalid config)', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('Invalid config: syntax error'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: any) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    await expect(runCommand(['--silent'])).rejects.toThrow('process.exit(1)');
    exitSpy.mockRestore();
  });

  it('exits with code 1 when nodulus.config.js/ts does not exist', async () => {
    // Delete the config file created in beforeEach
    fs.rmSync(path.join(tmpDir, 'nodulus.config.js'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: any) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    await expect(runCommand(['--silent'])).rejects.toThrow('process.exit(1)');
    exitSpy.mockRestore();
  });

  // ── Gap 1: exit code 0 when --silent and preload is already up to date ───────
  it('exit code is 0 (process.exit not called) when --silent and preload is up to date', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ aliases: { '@shared': './src/shared' } }));
    // First run: generate the file
    await runCommand(['--silent']);

    // Second run: no changes — process.exit should never be called
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: any) => {
      throw new Error(`process.exit(${code})`);
    }) as any);

    await expect(runCommand(['--silent'])).resolves.not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  // ── Section 4.2: change detection tests ─────────────────────────────────────
  it('updates preload when modules glob changes (src/modules/* → src/api/*)', async () => {
    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ modules: 'src/modules/*' }));
    await runCommand();
    const preloadPath = path.join(tmpDir, '.nodulus', 'preload.js');
    const v1 = fs.readFileSync(preloadPath, 'utf8');

    vi.mocked(loadConfig).mockResolvedValue(makeBaseConfig({ modules: 'src/api/*' }));
    await runCommand();
    const v2 = fs.readFileSync(preloadPath, 'utf8');

    expect(v1).not.toBe(v2);
    expect(v2).toContain('src/api');
  });

  // ── Section 4.3: improved error messages ─────────────────────────────────────
  it('exits with code 1 and calls process.exit(1) when config fails to load', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('Config file not found'));

    // Track the exact code passed to process.exit without throwing
    // so we can assert toHaveBeenCalledWith(1) directly.
    let capturedCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      capturedCode = code;
      throw new Error('exit'); // still abort execution to stop the command
    }) as any);

    await expect(runCommand()).rejects.toThrow('exit');
    expect(capturedCode).toBe(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
