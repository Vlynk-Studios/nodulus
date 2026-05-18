import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { loadNitsRegistry, saveNitsRegistry, initNitsRegistry, inferProjectName } from '../../src/nits/nits-store.js';
import { NITS_REGISTRY_VERSION } from '../../src/nits/constants.js';
import fs from 'node:fs';

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn()
    }
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_REGISTRY = {
  project: 'test-project',
  version: NITS_REGISTRY_VERSION,
  lastCheck: '2024-01-01T00:00:00.000Z',
  modules: {}
};

// Helper: make writeFile capture data written to registry.json
function captureWrites(): { getRegistry: () => string } {
  let capturedJson = '';
  vi.mocked(fs.promises.writeFile).mockImplementation(async (filePath, data) => {
    if ((filePath as string).endsWith('.json') || (filePath as string).endsWith('.tmp')) {
      capturedJson = data as string;
    }
  });
  return { getRegistry: () => capturedJson };
}

// ─────────────────────────────────────────────────────────────────────────────
// loadNitsRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('loadNitsRegistry', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns null if the registry file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
  });

  it('returns null if the JSON is corrupted — and does not throw', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue('{ this is not valid json !!!');

    await expect(loadNitsRegistry('/mock/project')).resolves.toBeNull();
  });

  it('returns null if JSON is valid but missing required fields', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      project: 'test'
      // missing: version, lastCheck, modules
    }));

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
  });

  it('returns null if a module entry has a corrupt/invalid NITS ID', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      ...VALID_REGISTRY,
      modules: {
        'not-a-valid-id': {
          id: 'not-a-valid-id', name: 'users', path: 'src/modules/users',
          hash: 'abc', status: 'active', createdAt: '', lastSeen: '', identifiers: []
        }
      }
    }));

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
  });

  it('returns a valid NitsRegistry when the file is well-formed', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(VALID_REGISTRY));

    const result = await loadNitsRegistry('/mock/project');

    expect(result).not.toBeNull();
    expect(result?.project).toBe('test-project');
    expect(result?.version).toBe(NITS_REGISTRY_VERSION);
    expect(result?.modules).toEqual({});
  });

  it('reads from the standardized path .nodulus/registry.json', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(VALID_REGISTRY));

    await loadNitsRegistry('/mock/project');

    const calledPath = vi.mocked(fs.promises.readFile).mock.calls[0][0] as string;
    expect(calledPath.replace(/\\/g, '/')).toContain('.nodulus/registry.json');
  });

  it('handles EACCES/permission errors by returning null', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('EACCES: permission denied'));

    const result = await loadNitsRegistry('/mock');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveNitsRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('saveNitsRegistry', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('creates the .nodulus/ directory if it does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

    await saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project');

    expect(fs.promises.mkdir).toHaveBeenCalledWith(
      expect.stringMatching(/\.nodulus/),
      { recursive: true }
    );
  });

  it('does not call mkdir for the directory when .nodulus/ already exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

    await saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project');

    const mkdirCalls = vi.mocked(fs.promises.mkdir).mock.calls;
    expect(mkdirCalls).toHaveLength(0);
  });

  it('writes the registry using an atomic strategy (writeFile to .tmp then rename)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

    await saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project');

    const writtenPath = vi.mocked(fs.promises.writeFile).mock.calls[0][0] as string;
    const renamedFrom = vi.mocked(fs.promises.rename).mock.calls[0][0] as string;
    const renamedTo = vi.mocked(fs.promises.rename).mock.calls[0][1] as string;

    expect(writtenPath).toContain('registry.json.tmp');
    expect(renamedFrom).toBe(writtenPath);
    expect(renamedTo).toContain('registry.json');
    expect(renamedTo).not.toContain('.tmp');
  });

  it('updates lastCheck to the current time on every save', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const { getRegistry } = captureWrites();

    const before = new Date().toISOString();
    await saveNitsRegistry({ ...VALID_REGISTRY, lastCheck: '1970-01-01T00:00:00.000Z' }, '/mock/project');
    const after = new Date().toISOString();

    const written = JSON.parse(getRegistry());
    expect(written.lastCheck >= before).toBe(true);
    expect(written.lastCheck <= after).toBe(true);
    expect(written.lastCheck).not.toBe('1970-01-01T00:00:00.000Z');
  });

  it('lastCheck changes between two consecutive saves', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const captured: string[] = [];
    vi.mocked(fs.promises.writeFile).mockImplementation(async (filePath, data) => {
      if ((filePath as string).endsWith('.tmp')) {
        captured.push(JSON.parse(data as string).lastCheck);
      }
    });

    await saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project');
    await new Promise(r => setTimeout(r, 5));
    await saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project');

    expect(captured).toHaveLength(2);
    expect(captured[1] >= captured[0]).toBe(true);
  });

  it('save \u2192 load roundtrip: module data is preserved identically', async () => {
    const registryWithModules = {
      ...VALID_REGISTRY,
      modules: {
        'mod_a1b2c3d4': {
          id: 'mod_a1b2c3d4',
          name: 'users',
          path: 'src/modules/users',
          hash: 'abc1234567',
          status: 'active' as const,
          createdAt: '2024-01-01T00:00:00.000Z',
          lastSeen: '2024-01-01T00:00:00.000Z',
          identifiers: ['UserService', 'UserRepository']
        }
      }
    };

    const { getRegistry } = captureWrites();
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await saveNitsRegistry(registryWithModules, '/mock/project');

    // Simulate load reading what was written
    vi.mocked(fs.promises.readFile).mockResolvedValue(getRegistry());

    const loaded = await loadNitsRegistry('/mock/project');

    expect(loaded).not.toBeNull();
    expect(loaded?.modules['mod_a1b2c3d4'].name).toBe('users');
    expect(loaded?.modules['mod_a1b2c3d4'].identifiers).toEqual(['UserService', 'UserRepository']);
    expect(loaded?.modules['mod_a1b2c3d4'].hash).toBe('abc1234567');
  });

  it('writes human-readable JSON (indented)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const { getRegistry } = captureWrites();

    await saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project');

    const written = getRegistry();
    expect(written).toContain('\n');
    expect(written).toContain('  ');
  });

  it('Fix [N-49]: does not mutate the original registry object', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    
    const originalLastCheck = '2000-01-01T00:00:00.000Z';
    const myRegistry = { 
      ...VALID_REGISTRY, 
      lastCheck: originalLastCheck 
    };

    await saveNitsRegistry(myRegistry, '/mock/project');

    // The object passed in should still have its original value
    expect(myRegistry.lastCheck).toBe(originalLastCheck);
  });

  it('handles write errors (e.g. disk full, permissions) by throwing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('ENOSPC: no space left on device'));

    await expect(saveNitsRegistry({ ...VALID_REGISTRY }, '/mock/project'))
      .rejects.toThrow('ENOSPC');
  });
});

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Metadata Helpers
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

describe('Metadata Helpers', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('inferProjectName reads name from package.json', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'my-project' }));

    expect(inferProjectName('/mock')).toBe('my-project');
  });

  it('inferProjectName returns "unknown" if package.json is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(inferProjectName('/mock')).toBe('unknown');
  });

  it('inferProjectName returns "unknown" if package.json has no name field', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    expect(inferProjectName('/mock')).toBe('unknown');
  });

  it('initNitsRegistry creates a valid empty registry', () => {
    const registry = initNitsRegistry('my-app');

    expect(registry.project).toBe('my-app');
    expect(registry.version).toBe(NITS_REGISTRY_VERSION);
    expect(registry.modules).toEqual({});
    expect(typeof registry.lastCheck).toBe('string');
  });

  it('initNitsRegistry falls back to "unknown" if projectName is empty', () => {
    const registry = initNitsRegistry('');

    expect(registry.project).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CODE-2: isValidRegistry per-record field validation
// ─────────────────────────────────────────────────────────────────────────────

describe('CODE-2: loadNitsRegistry — per-record field validation', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const makeValidRecord = (overrides: Record<string, any> = {}) => ({
    id: 'mod_a1b2c3d4',
    name: 'users',
    path: 'src/modules/users',
    hash: 'abc1234567',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-01-01T00:00:00.000Z',
    identifiers: [],
    ...overrides,
  });

  it('returns null when a module record is missing hash (BUG-3 scenario)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      project: 'test', version: NITS_REGISTRY_VERSION, lastCheck: '2024-01-01T00:00:00.000Z',
      modules: { 'mod_a1b2c3d4': makeValidRecord({ hash: undefined }) }
    }));

    const result = await loadNitsRegistry('/mock/project');
    expect(result).toBeNull();
  });

  it('returns null when a module record is missing createdAt (BUG-3 scenario)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      project: 'test', version: NITS_REGISTRY_VERSION, lastCheck: '2024-01-01T00:00:00.000Z',
      modules: { 'mod_a1b2c3d4': makeValidRecord({ createdAt: undefined }) }
    }));

    const result = await loadNitsRegistry('/mock/project');
    expect(result).toBeNull();
  });

  it('returns null when a module record is missing status', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      project: 'test', version: NITS_REGISTRY_VERSION, lastCheck: '2024-01-01T00:00:00.000Z',
      modules: { 'mod_a1b2c3d4': makeValidRecord({ status: undefined }) }
    }));

    const result = await loadNitsRegistry('/mock/project');
    expect(result).toBeNull();
  });

  it('returns the registry when all required fields are present', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify({
      project: 'test', version: NITS_REGISTRY_VERSION, lastCheck: '2024-01-01T00:00:00.000Z',
      modules: { 'mod_a1b2c3d4': makeValidRecord() }
    }));

    const result = await loadNitsRegistry('/mock/project');
    expect(result).not.toBeNull();
    expect(result?.modules['mod_a1b2c3d4'].name).toBe('users');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-01: Type-level validation — identifiers / status enum
// ─────────────────────────────────────────────────────────────────────────────

describe('T-01: loadNitsRegistry — type-level field validation', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const makeRecord = (overrides: Record<string, any> = {}) => ({
    id: 'mod_a1b2c3d4',
    name: 'users',
    path: 'src/modules/users',
    hash: 'abc1234567',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-01-01T00:00:00.000Z',
    identifiers: [],
    ...overrides,
  });

  const seedRegistry = (record: Record<string, any>) =>
    JSON.stringify({
      project: 'test',
      version: NITS_REGISTRY_VERSION,
      lastCheck: '2024-01-01T00:00:00.000Z',
      modules: { 'mod_a1b2c3d4': record },
    });

  it('T-01a: returns null when identifiers is null (null check in isValidRegistry)', async () => {
    // isValidRegistry checks `m[f] === null` — identifiers:null must be rejected.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      seedRegistry(makeRecord({ identifiers: null }))
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/identifiers/));
  });

  it('T-01b: returns null when status is not in NitsStatus enum (strict enum guard added)', async () => {
    // isValidRegistry now validates status against VALID_NITS_STATUSES.
    // 'zombie' is not in ['active','stale','moved','candidate','deleted'] → rejected.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      seedRegistry(makeRecord({ status: 'zombie' }))
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/zombie/));
  });

  it('T-01c: identifiers:[123, 456] still accepted — Array.isArray passes, no element-type guard', async () => {
    // isValidRegistry now uses Array.isArray. [123,456] IS a valid array → accepted.
    // Element types are not validated. Pin this contract: per-element string check = breaking change.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      seedRegistry(makeRecord({ identifiers: [123, 456] }))
    );

    const result = await loadNitsRegistry('/mock/project');

    expect(result).not.toBeNull();
    expect(result?.modules['mod_a1b2c3d4'].identifiers).toEqual([123, 456] as any);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §1.2 [BLOCKER]: nits-store — strict field type validation
// ─────────────────────────────────────────────────────────────────────────────

describe('§1.2 [BLOCKER]: loadNitsRegistry — strict type validation', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const validBase = {
    project: 'test',
    version: NITS_REGISTRY_VERSION,
    lastCheck: '2024-01-01T00:00:00.000Z',
  };

  const validRecord = {
    id: 'mod_a1b2c3d4',
    name: 'users',
    path: 'src/modules/users',
    hash: 'abc1234567',
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-01-01T00:00:00.000Z',
    identifiers: ['UserService'],
  };

  const seed = (overrides: Record<string, any>) =>
    JSON.stringify({
      ...validBase,
      modules: { 'mod_a1b2c3d4': { ...validRecord, ...overrides } },
    });

  it('[BLOCKER] §1.2-1: returns null + descriptive warning when identifiers is null', async () => {
    // identifiers:null is caught by the `=== null` guard BEFORE Array.isArray.
    // The warning must identify both the field name and the module record ID.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(seed({ identifiers: null }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/identifiers/));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/mod_a1b2c3d4/));
  });

  it('[BLOCKER] §1.2-2: returns null + warning when status is outside the NitsStatus enum', async () => {
    // Any value not in ['active','stale','moved','candidate','deleted'] is rejected.
    // Accepting unknown status values would allow reconcile() to operate on undefined state.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(seed({ status: 'zombie' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/zombie/));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/mod_a1b2c3d4/));
  });

  it('§1.2-3: all valid NitsStatus values are accepted (regression guard for VALID_NITS_STATUSES)', async () => {
    // Ensures no legitimate status is accidentally excluded from the set.
    const statuses = ['active', 'stale', 'moved', 'candidate', 'deleted'] as const;
    for (const status of statuses) {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue(seed({ status }));
      const result = await loadNitsRegistry('/mock/project');
      expect(result, `status '${status}' must be accepted`).not.toBeNull();
    }
  });

  it('§1.2-4: returns null when identifiers is a plain object (Array.isArray guard)', async () => {
    // A sparse array mis-serialised as { '0': 'UserService' } is a common corruption pattern.
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      seed({ identifiers: { 0: 'UserService' } })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadNitsRegistry('/mock/project');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/identifiers/));
  });
});
