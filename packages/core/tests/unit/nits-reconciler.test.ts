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

    const result = await reconcile(discovered, null, cwd);

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

    const result = await reconcile(discovered, previous, cwd);

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

    const result = await reconcile(discovered, previous, cwd);

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

    const result = await reconcile([], previous, cwd);

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
    const result = await reconcile(discovered, previous, cwd, { clonePolicy: 'new' });

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

    const result = await reconcile(discovered, previous, cwd);

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

    const result = await reconcile(discovered, previous, cwd);

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

    const result = await reconcile(discovered, previous, cwd);

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

    const result = await reconcile(discovered, previous, cwd);

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

      await expect(
        reconcile(discovered, previous, "/project", { isCi: true }),
      ).rejects.toThrow(/Duplicate module content detected/i);
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

      const result = await reconcile(discovered, previous, "/project", {
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

      await expect(
        reconcile(discovered, previous, "/project", { clonePolicy: "error" }),
      ).rejects.toThrow(/Duplicate module content detected/i);
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

      const result = await reconcile(discovered, null, "/project", { clonePolicy: 'error' });

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
      await expect(
        reconcile(discovered, previous, "/project", { clonePolicy: "error" })
      ).rejects.toThrow(/Duplicate module content detected/i);
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

      const result = await reconcile(discovered, previous, "/project");

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
      const result = await reconcile(discovered, previous, "/project");

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
