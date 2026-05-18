import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import {
  reconcile,
  buildUpdatedNitsRegistry,
  buildNitsIdMap,
} from "../../src/nits/nits-reconciler.js";
import * as nitsHash from "../../src/nits/nits-hash.js";
import { NITS_REGISTRY_VERSION } from "../../src/nits/constants.js";
import type { NitsRegistry, DiscoveredModule } from "../../src/types/nits.js";

vi.mock("../../src/nits/nits-hash.js", async () => {
  const actual = (await vi.importActual("../../src/nits/nits-hash.js")) as any;
  return {
    ...actual,
    hashSimilarity: vi.fn(),
  };
});

describe("NITS Reconciler (Verification Triangle)", () => {
  const cwd = "/project";
  const timestamp = "2024-01-01T00:00:00.000Z";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
  });

  const createEmptyRegistry = (): NitsRegistry => ({
    project: "test",
    version: NITS_REGISTRY_VERSION,
    lastCheck: "",
    modules: {},
  });

  it("Test: first run (previous = null) → all are newModules with generated IDs", async () => {
    const discovered: DiscoveredModule[] = [
      {
        name: "m1",
        dirPath: "/project/src/m1",
        identifiers: ["Id1"],
        hash: "h1",
      },
      {
        name: "m2",
        dirPath: "/project/src/m2",
        identifiers: ["Id2"],
        hash: "h2",
      },
    ];

    const result = reconcile(discovered, null, cwd);

    expect(result.newModules.length).toBe(2);
    expect(result.newModules[0].id).toMatch(/^mod_[0-9a-f]{8}$/);
    expect(result.newModules[1].id).toMatch(/^mod_[0-9a-f]{8}$/);
    expect(result.newModules[0].id).not.toBe(result.newModules[1].id);
  });

  it("Test: run with no changes → all confirmed", async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_1: {
          id: "mod_1",
          name: "users",
          path: "src/users",
          hash: "h1",
          status: "active",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["Id1"],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "users",
        dirPath: "/project/src/users",
        identifiers: ["Id1"],
        hash: "h1",
      },
    ];

    const result = reconcile(discovered, previous, cwd);

    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_1");
    expect(result.newModules.length).toBe(0);
  });

  it("Test: moved module (same hash, different path) → moved with oldPath and newPath", async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_1: {
          id: "mod_1",
          name: "users",
          path: "src/old",
          hash: "h1",
          status: "active",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["Id1"],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "users",
        dirPath: "/project/src/new",
        identifiers: ["Id1"],
        hash: "h1",
      },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(1.0);

    const result = reconcile(discovered, previous, cwd);

    expect(result.moved.length).toBe(1);
    expect(result.moved[0].record.id).toBe("mod_1");
    expect(result.moved[0].oldPath).toBe("src/old");
    expect(result.moved[0].newPath).toBe("src/new");
  });

  it("Test: deleted module → stale, preserved in registry", async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_gone: {
          id: "mod_gone",
          name: "gone",
          path: "src/gone",
          hash: "h1",
          status: "active",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: [],
        },
      },
    };

    const result = reconcile([], previous, cwd);

    expect(result.stale.length).toBe(1);
    expect(result.stale[0].id).toBe("mod_gone");
    expect(result.stale[0].status).toBe("stale");
  });

  it("Test: cloned module → original confirmed, copy in newModules with different ID", async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_orig: {
          id: "mod_orig",
          name: "orig",
          path: "src/orig",
          hash: "h1",
          status: "active",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["Id1"],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "orig",
        dirPath: "/project/src/orig",
        identifiers: ["Id1"],
        hash: "h1",
      }, // Original
      {
        name: "copy",
        dirPath: "/project/src/copy",
        identifiers: ["Id1"],
        hash: "h1",
      }, // Copy
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(1.0);
    
    // We explicitly set clonePolicy: 'new' to ensure this test passes even in CI
    // where the default would be 'error'.
    const result = reconcile(discovered, previous, cwd, { clonePolicy: 'new' });

    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_orig");

    expect(result.newModules.length).toBe(1);
    expect(result.newModules[0].id).not.toBe("mod_orig");
    expect(result.moved.length).toBe(0);
  });

  it('Test: rename from Module("users") to Module("accounts") same path → confirmed, name updated', async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_1: {
          id: "mod_1",
          name: "users",
          path: "src/users",
          hash: "h1",
          status: "active",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["Id1"],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "accounts",
        dirPath: "/project/src/users",
        identifiers: ["Id1"],
        hash: "h1",
      },
    ];

    const result = reconcile(discovered, previous, cwd);

    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_1");
    expect(result.confirmed[0].name).toBe("accounts");
  });

  it("Test: similar hash on two records → both treated as newModules, no movement assumed", async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_a: {
          id: "mod_a",
          name: "a",
          path: "p_a",
          hash: "h",
          status: "stale",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["common"],
        },
        mod_b: {
          id: "mod_b",
          name: "b",
          path: "p_b",
          hash: "h",
          status: "stale",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["common"],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "new",
        dirPath: "/project/src/new",
        identifiers: ["common"],
        hash: "h",
      },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.95);

    const result = reconcile(discovered, previous, cwd);

    expect(result.moved.length).toBe(0);
    expect(result.newModules.length).toBe(1);
    expect(result.stale.length).toBe(2);
  });

  it("Step 3: unique match by name in stale records → candidate", async () => {
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_x: {
          id: "mod_x",
          name: "widget",
          path: "src/old-widget",
          hash: "h_old",
          status: "stale",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: [],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "widget",
        dirPath: "/project/src/new-widget",
        identifiers: [],
        hash: "h_new",
      },
    ];

    // No hash similarity → Step 2 skipped
    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.1);

    const result = reconcile(discovered, previous, cwd);

    // Step 3 should match by name on the stale record
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].record.id).toBe("mod_x");
    expect(result.candidates[0].oldPath).toBe("src/old-widget");
    expect(result.candidates[0].newPath).toBe("src/new-widget");
    expect(result.newModules.length).toBe(0);
  });

  it("Step 3 does NOT rescue an 'active' module that failed Steps 1&2 (DESIGN-1 contract)", async () => {
    // Scenario: a module is 'active' in the registry but its path changed AND
    // its identifier similarity is below threshold. Step 3 must NOT match it
    // by name — the module must go stale for one cycle first (stale-first grace).
    const previous: NitsRegistry = {
      ...createEmptyRegistry(),
      modules: {
        mod_active: {
          id: "mod_active",
          name: "payments",
          path: "src/old-payments",   // Different from discovered → Step 1 fails
          hash: "h_old",
          status: "active",           // ← NOT stale → Step 3 must ignore this
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["OldService"],
        },
      },
    };

    const discovered: DiscoveredModule[] = [
      {
        name: "payments",             // Same name as the active record
        dirPath: "/project/src/new-payments", // Different path → Step 1 fails
        identifiers: [],              // Near-zero similarity → Step 2 fails
        hash: "h_new",
      },
    ];

    // Very low similarity → Step 2 skipped
    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.05);

    const result = reconcile(discovered, previous, cwd);

    // Step 3 must NOT produce a candidate — the 'active' record is not eligible
    expect(result.candidates.length).toBe(0);

    // The discovered module gets a brand-new ID (newModule)
    expect(result.newModules.length).toBe(1);
    expect(result.newModules[0].name).toBe("payments");
    expect(result.newModules[0].id).not.toBe("mod_active");

    // The old active record becomes stale for this cycle
    expect(result.stale.length).toBe(1);
    expect(result.stale[0].id).toBe("mod_active");
    expect(result.stale[0].status).toBe("stale");
  });

  describe("Clone Detection & Identity Conflicts", () => {
    it("Test: identical hash + original in its path + CI environment → throws DUPLICATE_MODULE", async () => {
      const previous: NitsRegistry = {
        project: "test",
        version: NITS_REGISTRY_VERSION,
        lastCheck: "",
        modules: {
          mod_original: {
            id: "mod_original",
            name: "users",
            path: "src/users",
            hash: "same_hash",
            status: "active",
            lastSeen: "",
            identifiers: ["U1"],
            createdAt: "2020-01-01T00:00:00Z",
          },
        },
      };

      const discovered: DiscoveredModule[] = [
        {
          name: "users",
          dirPath: "/project/src/users",
          identifiers: ["U1"],
          hash: "same_hash",
        }, // Original
        {
          name: "clony",
          dirPath: "/project/src/clony",
          identifiers: ["U1"],
          hash: "same_hash",
        }, // Clone
      ];

      expect(() =>
        reconcile(discovered, previous, "/project", { isCi: true }),
      ).toThrow(/Duplicate module content detected/i);
    });

    it('Test: identical hash + original in its path + dev policy "new" → newModules with distinct ID', async () => {
      const previous: NitsRegistry = {
        project: "test",
        version: NITS_REGISTRY_VERSION,
        lastCheck: "",
        modules: {
          mod_original: {
            id: "mod_original",
            name: "users",
            path: "src/users",
            hash: "same_hash",
            status: "active",
            lastSeen: "",
            identifiers: ["U1"],
            createdAt: "2020-01-01T00:00:00Z",
          },
        },
      };

      const discovered: DiscoveredModule[] = [
        {
          name: "users",
          dirPath: "/project/src/users",
          identifiers: ["U1"],
          hash: "same_hash",
        }, // Original
        {
          name: "clony",
          dirPath: "/project/src/clony",
          identifiers: ["U1"],
          hash: "same_hash",
        }, // Clone
      ];

      const result = reconcile(discovered, previous, "/project", {
        clonePolicy: "new",
        isCi: false,
      });

      expect(result.confirmed.length).toBe(1);
      expect(result.confirmed[0].id).toBe("mod_original");

      expect(result.newModules.length).toBe(1);
      expect(result.newModules[0].name).toBe("clony");
      expect(result.newModules[0].id).not.toBe("mod_original");
      expect(result.newModules[0].id).toMatch(/^mod_[0-9a-f]{8}$/);
    });

    it('Test: identical hash + original in its path + dev policy "error" → throws DUPLICATE_MODULE', async () => {
      const previous: NitsRegistry = {
        project: "test",
        version: NITS_REGISTRY_VERSION,
        lastCheck: "",
        modules: {
          mod_original: {
            id: "mod_original",
            name: "users",
            path: "src/users",
            hash: "same_hash",
            status: "active",
            lastSeen: "",
            identifiers: ["U1"],
            createdAt: "2020-01-01T00:00:00Z",
          },
        },
      };

      const discovered: DiscoveredModule[] = [
        {
          name: "users",
          dirPath: "/project/src/users",
          identifiers: ["U1"],
          hash: "same_hash",
        },
        {
          name: "clony",
          dirPath: "/project/src/clony",
          identifiers: ["U1"],
          hash: "same_hash",
        },
      ];

      expect(() =>
        reconcile(discovered, previous, "/project", { clonePolicy: "error" }),
      ).toThrow(/Duplicate module content detected/i);
    });

    it("Test: empty modules (no identifiers) do not collide even if hashes match (N-38)", async () => {
      const discovered: DiscoveredModule[] = [
        {
          name: "skeleton1",
          dirPath: "/project/src/skel1",
          identifiers: [],
          hash: "empty_structure_hash",
        },
        {
          name: "skeleton2",
          dirPath: "/project/src/skel2",
          identifiers: [],
          hash: "empty_structure_hash",
        },
      ];

      const result = reconcile(discovered, null, "/project", { clonePolicy: 'error' });

      // Should have 2 new modules, no error even if hashes match
      expect(result.newModules.length).toBe(2);
      expect(result.newModules[0].name).toBe("skeleton1");
      expect(result.newModules[1].name).toBe("skeleton2");
    });

    it("Test: moved module prevents clones in the same cycle (N-36)", async () => {
      const previous: NitsRegistry = {
        ...createEmptyRegistry(),
        modules: {
          mod1: {
            id: "mod1",
            name: "m1",
            path: "src/old",
            hash: "h1",
            status: "active",
            createdAt: timestamp,
            lastSeen: "",
            identifiers: ["Id1"],
          },
        },
      };

      const discovered: DiscoveredModule[] = [
        {
          name: "m1",
          dirPath: "/project/src/new", // Moved
          identifiers: ["Id1"],
          hash: "h1",
        },
        {
          name: "clone",
          dirPath: "/project/src/clone", // Clone
          identifiers: ["Id1"],
          hash: "h1",
        },
      ];

      vi.mocked(nitsHash.hashSimilarity).mockReturnValue(1.0);

      // In Step 2, mod1 moves to /src/new. This should immediately block /src/clone.
      expect(() =>
        reconcile(discovered, previous, "/project", { clonePolicy: "error" })
      ).toThrow(/Duplicate module content detected/i);
    });
  });

  describe("createdAt immutability", () => {
    it("Test: createdAt is written once and preserved in subsequent reconciliations", async () => {
      const originalDate = "2020-01-01T12:00:00.000Z";

      // 1. Existing registry with a module
      const previous: NitsRegistry = {
        project: "test",
        version: NITS_REGISTRY_VERSION,
        lastCheck: "",
        modules: {
          mod_1: {
            id: "mod_1",
            name: "users",
            path: "src/users",
            hash: "h1",
            status: "active",
            lastSeen: "",
            identifiers: ["Id1"],
            createdAt: originalDate,
          },
        },
      };

      // 2. Discover it again (even with name/hash change, path match preserves ID and createdAt)
      const discovered: DiscoveredModule[] = [
        {
          name: "accounts",
          dirPath: "/project/src/users",
          identifiers: ["Id1"],
          hash: "h_new",
        },
      ];

      const result = reconcile(discovered, previous, "/project");

      expect(result.confirmed.length).toBe(1);
      expect(result.confirmed[0].id).toBe("mod_1");
      expect(result.confirmed[0].createdAt).toBe(originalDate); // Preserved!
      expect(result.confirmed[0].lastSeen).not.toBe(originalDate); // Updated!
    });
  });

  describe("Path Normalization (N-39)", () => {
    it("should normalize Windows-style relative paths to forward slashes", async () => {
      const previous: NitsRegistry = {
        ...createEmptyRegistry(),
        modules: {
          mod_1: {
            id: "mod_1",
            name: "users",
            path: "src/users", // Forward slashes in registry
            hash: "h1",
            status: "active",
            createdAt: timestamp,
            lastSeen: "",
            identifiers: ["Id1"],
          },
        },
      };

      // Simulating a Windows environment where some paths might come in with backslashes
      // even if they are relative.
      const discovered: DiscoveredModule[] = [
        {
          name: "users",
          dirPath: "src\\users", // Windows relative path
          identifiers: ["Id1"],
          hash: "h1",
        },
      ];

      // We expect it to be confirmed because src\users should normalize to src/users
      const result = reconcile(discovered, previous, "/project");

      expect(result.confirmed.length).toBe(1);
      expect(result.confirmed[0].id).toBe("mod_1");
    });
  });
});

describe("buildUpdatedNitsRegistry()", () => {
  const makeRecord = (
    id: string,
    name: string,
    status: "active" | "moved" | "candidate" | "stale" = "active",
  ) => ({
    id,
    name,
    path: `src/${name}`,
    hash: "h",
    status,
    createdAt: "2024-01-01T00:00:00.000Z",
    lastSeen: "",
    identifiers: [],
  });

  it("assembles registry containing confirmed, moved, candidates, newModules, and stale", () => {
    const result = {
      confirmed: [makeRecord("mod_c", "confirmed")],
      moved: [
        {
          record: makeRecord("mod_m", "moved", "moved"),
          oldPath: "old",
          newPath: "new",
          brokenImports: [],
        },
      ],
      candidates: [
        {
          record: makeRecord("mod_k", "candidate", "candidate"),
          oldPath: "old",
          newPath: "new",
          brokenImports: [],
        },
      ],
      newModules: [makeRecord("mod_n", "new")],
      stale: [makeRecord("mod_s", "gone", "stale")],
      deleted: [],
    };

    const registry = buildUpdatedNitsRegistry(result as any, "my-project");

    expect(registry.project).toBe("my-project");
    expect(Object.keys(registry.modules)).toHaveLength(5);
    expect(registry.modules["mod_c"]?.name).toBe("confirmed");
    expect(registry.modules["mod_m"]?.status).toBe("moved");
    expect(registry.modules["mod_k"]?.status).toBe("candidate"); // DESIGN-2: preserved, not downgraded to 'stale'
    expect(registry.modules["mod_n"]?.name).toBe("new");
    expect(registry.modules["mod_s"]?.status).toBe("stale");
  });

  it("candidate record is consistent between buildUpdatedNitsRegistry and buildNitsIdMap (DESIGN-2)", () => {
    // Both functions must agree: candidate keeps its id and uses its actual 'candidate' status.
    // Previously buildUpdatedNitsRegistry forced status:'stale' while buildNitsIdMap
    // used the record as-is — making the two representations contradict each other.
    const candidateRecord = {
      id: "mod_k",
      name: "payments",
      path: "src/new-payments",
      hash: "h_new",
      status: "candidate" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
      lastSeen: "",
      identifiers: [],
    };
    const result = {
      confirmed: [],
      moved: [],
      candidates: [{ record: candidateRecord, oldPath: "src/old-payments", newPath: "src/new-payments", brokenImports: [] }],
      newModules: [],
      stale: [],
      deleted: [],
    };

    // Registry: must preserve 'candidate' status (not downgrade to 'stale')
    const registry = buildUpdatedNitsRegistry(result as any, "test");
    expect(registry.modules["mod_k"]?.status).toBe("candidate");
    expect(registry.modules["mod_k"]?.id).toBe("mod_k");
    expect(registry.modules["mod_k"]?.path).toBe("src/new-payments");

    // IdMap: must include the candidate with the same id (no divergence)
    const idMap = buildNitsIdMap(result as any, "/project");
    const absPath = path.resolve("/project", "src/new-payments");
    expect(idMap.get(absPath)).toBe("mod_k");
  });
});

describe("buildNitsIdMap()", () => {
  it("extracts a map of absolute paths to IDs", () => {
    const record = { id: "mod_123", name: "test", path: "src/test" };
    const result = {
      confirmed: [record],
      moved: [],
      candidates: [],
      newModules: [],
      stale: [],
    };

    const map = buildNitsIdMap(result as any, "/project");

    const expectedPath = path.resolve("/project", "src/test");
    expect(map.get(expectedPath)).toBe("mod_123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T-02: Verification Triangle — gap tests
// ─────────────────────────────────────────────────────────────────────────────

describe("T-02: Verification Triangle — pending gap cases", () => {
  const cwd = "/project";
  const timestamp = "2024-01-01T00:00:00.000Z";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
  });

  const makeRegistry = (
    modules: Record<string, any>
  ): NitsRegistry => ({
    project: "test",
    version: NITS_REGISTRY_VERSION,
    lastCheck: "",
    modules,
  });

  const makeRecord = (
    id: string,
    name: string,
    path: string,
    hash: string,
    status: "active" | "stale" | "candidate" | "moved" = "active",
    identifiers: string[] = ["Id"]
  ) => ({
    id,
    name,
    path,
    hash,
    status,
    createdAt: timestamp,
    lastSeen: "",
    identifiers,
  });

  // ── T-02a: two modules swap paths in the same cycle ──────────────────────
  it("T-02a: modules that swap paths in the same cycle — neither goes stale", () => {
    // mod_a was at src/a, mod_b was at src/b.
    // This cycle: mod_a appears at src/b and mod_b at src/a.
    // Step 1 matches by path: discovered-at-src/b matches prev src/b (mod_b),
    // discovered-at-src/a matches prev src/a (mod_a).
    // Both are confirmed — neither should go stale.
    const previous = makeRegistry({
      mod_a: makeRecord("mod_a", "moduleA", "src/a", "h_a"),
      mod_b: makeRecord("mod_b", "moduleB", "src/b", "h_b"),
    });

    const discovered: DiscoveredModule[] = [
      { name: "moduleA", dirPath: "/project/src/a", identifiers: ["Id"], hash: "h_a" },
      { name: "moduleB", dirPath: "/project/src/b", identifiers: ["Id"], hash: "h_b" },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0);

    const result = reconcile(discovered, previous, cwd);

    // Both modules re-confirmed by path — zero stale
    expect(result.confirmed.length).toBe(2);
    expect(result.stale.length).toBe(0);
    expect(result.moved.length).toBe(0);

    const ids = result.confirmed.map((r) => r.id).sort();
    expect(ids).toEqual(["mod_a", "mod_b"]);
  });

  // ── T-02b: candidate → active stabilisation in next cycle ────────────────
  it("T-02b: a 'candidate' record is confirmed as 'active' by path in the next cycle", () => {
    // Cycle N: module was saved as candidate at new-path.
    // Cycle N+1: discovered at the same new-path → Step 1 matches → active.
    const previous = makeRegistry({
      mod_c: makeRecord("mod_c", "payments", "src/new-payments", "h_p", "candidate"),
    });

    const discovered: DiscoveredModule[] = [
      { name: "payments", dirPath: "/project/src/new-payments", identifiers: ["Id"], hash: "h_p" },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0);

    const result = reconcile(discovered, previous, cwd);

    // Step 1 (path match) has NO status filter — candidate is eligible
    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_c");
    expect(result.confirmed[0].status).toBe("active");
    expect(result.stale.length).toBe(0);
    expect(result.newModules.length).toBe(0);
  });

  // ── T-02c: 10 modules in registry, 0 discovered ──────────────────────────
  it("T-02c: 10 modules in previous registry, 0 discovered → all go stale, zero false positives", () => {
    const modules: Record<string, any> = {};
    for (let i = 0; i < 10; i++) {
      const id = `mod_${String(i).padStart(8, "0")}`;
      modules[id] = makeRecord(id, `m${i}`, `src/m${i}`, `h${i}`);
    }
    const previous = makeRegistry(modules);

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0);

    const result = reconcile([], previous, cwd);

    expect(result.stale.length).toBe(10);
    expect(result.confirmed.length).toBe(0);
    expect(result.moved.length).toBe(0);
    expect(result.newModules.length).toBe(0);
    expect(result.candidates.length).toBe(0);
    // Verify every stale record came from the registry
    const staleIds = result.stale.map((r) => r.id).sort();
    expect(staleIds).toEqual(Object.keys(modules).sort());
  });

  // ── T-02d: clonePolicy:'new' with 3 modules sharing the same hash ─────────
  it("T-02d: clonePolicy:'new' with 3 modules of identical hash → original confirmed, 2 clones in newModules with distinct IDs", () => {
    // Original module is in the registry at src/original.
    // Two additional copies appear this cycle at src/copy1 and src/copy2.
    const previous = makeRegistry({
      mod_orig: makeRecord("mod_orig", "widget", "src/original", "shared_hash"),
    });

    const discovered: DiscoveredModule[] = [
      { name: "widget",  dirPath: "/project/src/original", identifiers: ["Id"], hash: "shared_hash" },
      { name: "widget2", dirPath: "/project/src/copy1",    identifiers: ["Id"], hash: "shared_hash" },
      { name: "widget3", dirPath: "/project/src/copy2",    identifiers: ["Id"], hash: "shared_hash" },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(1.0);

    const result = reconcile(discovered, previous, cwd, { clonePolicy: "new" });

    // Original is confirmed (path match → Step 1)
    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_orig");

    // Two clones become newModules with fresh IDs
    expect(result.newModules.length).toBe(2);

    const cloneIds = result.newModules.map((r) => r.id);
    expect(cloneIds[0]).not.toBe("mod_orig");
    expect(cloneIds[1]).not.toBe("mod_orig");
    expect(cloneIds[0]).not.toBe(cloneIds[1]);
    expect(cloneIds[0]).toMatch(/^mod_[0-9a-f]{8}$/);
    expect(cloneIds[1]).toMatch(/^mod_[0-9a-f]{8}$/);

    // Nothing should be stale or moved
    expect(result.stale.length).toBe(0);
    expect(result.moved.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §1.1: nits-reconciler — completitud y edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("§1.1: reconciler — completitud y edge cases", () => {
  const cwd = "/project";
  const timestamp = "2024-01-01T00:00:00.000Z";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(timestamp));
  });

  const makeRegistry = (modules: Record<string, any>): NitsRegistry => ({
    project: "test",
    version: NITS_REGISTRY_VERSION,
    lastCheck: "",
    modules,
  });

  const makeRec = (
    id: string,
    name: string,
    relPath: string,
    hash: string,
    identifiers: string[] = ["Id"],
    status: "active" | "stale" | "candidate" | "moved" = "active"
  ) => ({
    id,
    name,
    path: relPath,
    hash,
    status,
    createdAt: timestamp,
    lastSeen: "",
    identifiers,
  });

  // ── §1.1-1 [BLOCKER]: similarityThreshold custom ─────────────────────────
  it("[BLOCKER] §1.1-1: custom similarityThreshold — 0.85 rejected with default 0.9, accepted with 0.8", () => {
    // A module whose similarity = 0.85 sits between default (0.9) and custom (0.8).
    // With the default threshold it must NOT be matched (→ newModule).
    // With { similarityThreshold: 0.8 } it MUST be matched (→ moved).
    const previous = makeRegistry({
      mod_x: makeRec("mod_x", "payments", "src/old-payments", "h_old", ["ServiceA", "ServiceB"]),
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "payments",
        dirPath: "/project/src/new-payments",
        identifiers: ["ServiceA", "ServiceB"],
        hash: "h_new",
      },
    ];

    // ── Case 1: default threshold 0.9 — similarity 0.85 falls short ──────────
    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.85);
    const resultDefault = reconcile(discovered, previous, cwd);
    // 0.85 < 0.9 → Step 2 does not match → goes to newModules
    expect(resultDefault.moved.length).toBe(0);
    expect(resultDefault.newModules.length).toBe(1);
    expect(resultDefault.stale.length).toBe(1);  // prev mod_x goes stale

    // ── Case 2: custom threshold 0.8 — similarity 0.85 passes ────────────────
    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.85);
    const resultCustom = reconcile(discovered, previous, cwd, { similarityThreshold: 0.8 });
    // 0.85 >= 0.8 → Step 2 matches → moved
    expect(resultCustom.moved.length).toBe(1);
    expect(resultCustom.moved[0].record.id).toBe("mod_x");
    expect(resultCustom.moved[0].oldPath).toBe("src/old-payments");
    expect(resultCustom.moved[0].newPath).toBe("src/new-payments");
    expect(resultCustom.newModules.length).toBe(0);
    expect(resultCustom.stale.length).toBe(0);
  });

  // ── §1.1-2: path swap → both resolved as `moved` via Jaccard ────────────
  it("§1.1-2: two modules swap destinations — both resolved as moved via Step 2 (no stale)", () => {
    // mod_a was at src/a (identifiers: ["ServiceA"]).
    // mod_b was at src/b (identifiers: ["ServiceB"]).
    // This cycle both modules appear at entirely NEW paths that mirror each other:
    //   - mod_a content (ServiceA) now at src/new-b
    //   - mod_b content (ServiceB) now at src/new-a
    // Step 1 fails for both (no prev records at src/new-b or src/new-a).
    // Step 2 Jaccard matches each to its correct prev record → both in moved.
    const previous = makeRegistry({
      mod_a: makeRec("mod_a", "serviceA", "src/a", "h_a", ["ServiceA"]),
      mod_b: makeRec("mod_b", "serviceB", "src/b", "h_b", ["ServiceB"]),
    });

    const discovered: DiscoveredModule[] = [
      { name: "serviceA", dirPath: "/project/src/new-b", identifiers: ["ServiceA"], hash: "h_a_new" },
      { name: "serviceB", dirPath: "/project/src/new-a", identifiers: ["ServiceB"], hash: "h_b_new" },
    ];

    // Each module uniquely matches its own prev record (1.0 for exact, 0 for cross)
    vi.mocked(nitsHash.hashSimilarity).mockImplementation((prevIds, discIds) => {
      if (prevIds.includes("ServiceA") && discIds.includes("ServiceA")) return 1.0;
      if (prevIds.includes("ServiceB") && discIds.includes("ServiceB")) return 1.0;
      return 0;
    });

    const result = reconcile(discovered, previous, cwd);

    // Both resolved as moved — zero stale, zero new
    expect(result.moved.length).toBe(2);
    expect(result.stale.length).toBe(0);
    expect(result.newModules.length).toBe(0);
    expect(result.confirmed.length).toBe(0);

    const movedIds = result.moved.map((m) => m.record.id).sort();
    expect(movedIds).toEqual(["mod_a", "mod_b"]);
  });

  // ── §1.1-3: single identifier → Jaccard = 1.0 via Step 2 ────────────────
  it("§1.1-3: module with exactly one identifier — similarity 1.0 with identical single identifier", () => {
    // Jaccard with sets of size 1: |{A} ∩ {A}| / |{A} ∪ {A}| = 1/1 = 1.0
    // Verifies the threshold edge case for the minimum viable identifier set.
    const previous = makeRegistry({
      mod_u: makeRec("mod_u", "users", "src/old-users", "h_old", ["UserService"]),
    });

    const discovered: DiscoveredModule[] = [
      { name: "users", dirPath: "/project/src/new-users", identifiers: ["UserService"], hash: "h_new" },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(1.0); // exact match

    const result = reconcile(discovered, previous, cwd);

    // Step 1 fails (different path). Step 2: sim = 1.0 >= 0.9 → moved
    expect(result.moved.length).toBe(1);
    expect(result.moved[0].record.id).toBe("mod_u");
    expect(result.moved[0].record.name).toBe("users");
    expect(result.stale.length).toBe(0);
    expect(result.newModules.length).toBe(0);
  });

  // ── §1.1-4: previous with empty modules{} behaves identically to null ────
  it("§1.1-4: reconcile() with previous={ modules:{} } behaves identically to previous=null", () => {
    const discovered: DiscoveredModule[] = [
      { name: "orders", dirPath: "/project/src/orders", identifiers: ["OrderService"], hash: "h1" },
      { name: "users",  dirPath: "/project/src/users",  identifiers: ["UserService"],  hash: "h2" },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0);

    const resultNull  = reconcile(discovered, null, cwd);
    const resultEmpty = reconcile(discovered, makeRegistry({}), cwd);

    // Both should produce 2 newModules, no stale/moved/confirmed/candidates
    expect(resultNull.newModules.length).toBe(2);
    expect(resultEmpty.newModules.length).toBe(2);

    expect(resultNull.stale.length).toBe(0);
    expect(resultEmpty.stale.length).toBe(0);

    expect(resultNull.moved.length).toBe(0);
    expect(resultEmpty.moved.length).toBe(0);

    // Both generate valid IDs in the same format
    for (const r of [...resultNull.newModules, ...resultEmpty.newModules]) {
      expect(r.id).toMatch(/^mod_[0-9a-f]{8}$/);
    }
  });

  // ── §1.1-6: moved module that also changes name ───────────────────────────
  it("§1.1-6: moved module that simultaneously changes name — record.name reflects new name, oldPath/newPath are correct", () => {
    // prev: Module("users") at src/old-users
    // discovered: Module("accounts") at /project/src/new-accounts (new path, new name, same identifiers)
    // Step 1 fails (path changed). Step 2 matches via Jaccard → moved.
    // record.name must be "accounts" (new name), oldPath = "src/old-users", newPath = "src/new-accounts".
    const previous = makeRegistry({
      mod_u: makeRec("mod_u", "users", "src/old-users", "h_old", ["UserService", "UserRepo"]),
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "accounts",                          // ← name changed
        dirPath: "/project/src/new-accounts",      // ← path changed
        identifiers: ["UserService", "UserRepo"],  // ← same identifiers (sim = 1.0)
        hash: "h_new",
      },
    ];

    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(1.0);

    const result = reconcile(discovered, previous, cwd);

    expect(result.moved.length).toBe(1);
    expect(result.stale.length).toBe(0);
    expect(result.newModules.length).toBe(0);

    const moved = result.moved[0];
    expect(moved.record.id).toBe("mod_u");                    // same ID preserved
    expect(moved.record.name).toBe("accounts");               // NEW name
    expect(moved.oldPath).toBe("src/old-users");              // prev path
    expect(moved.newPath).toBe("src/new-accounts");           // new path
    expect(moved.record.createdAt).toBe(timestamp);           // createdAt preserved
  });
});
