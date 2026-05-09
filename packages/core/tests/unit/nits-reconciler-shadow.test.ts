import { describe, it, expect, vi, beforeEach } from "vitest";
import { reconcile } from "../../src/nits/nits-reconciler.js";
import { NITS_REGISTRY_VERSION } from "../../src/nits/constants.js";
import type { NitsRegistry, DiscoveredModule } from "../../src/types/nits.js";
import * as shadowFileAPI from "../../src/nits/shadow-file.js";
import * as nitsHash from "../../src/nits/nits-hash.js";

vi.mock("../../src/nits/nits-hash.js", async () => {
  const actual = await vi.importActual("../../src/nits/nits-hash.js");
  return {
    ...actual,
    hashSimilarity: vi.fn(),
  };
});

vi.mock("../../src/nits/shadow-file.js", async () => {
  const actual = await vi.importActual("../../src/nits/shadow-file.js");
  return {
    ...actual,
    deleteShadowFile: vi.fn(),
    writeShadowFile: vi.fn(),
  };
});

describe("NITS Reconciler - Step 0 (Shadow File Identity)", () => {
  const cwd = "/project";
  const timestamp = "2024-01-01T00:00:00.000Z";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const createRegistry = (modules: NitsRegistry["modules"]): NitsRegistry => ({
    project: "test",
    version: NITS_REGISTRY_VERSION,
    lastCheck: "",
    modules,
  });

  it("Step 0: Matches by shadow file ID (confirmed, same path) without Jaccard", async () => {
    const previous = createRegistry({
      mod_1: {
        id: "mod_1",
        name: "users",
        path: "src/users",
        hash: "old_hash",
        status: "active",
        createdAt: timestamp,
        lastSeen: "",
        identifiers: ["OldUser"],
      },
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "users",
        dirPath: "/project/src/users",
        identifiers: ["NewUserCompleteRewrite"],
        hash: "new_hash",
        shadowFile: { id: "mod_1", name: "users", createdAt: timestamp },
      },
    ];

    // Simulate 0% similarity - normally this would fail Step 2 and go to newModules,
    // but Step 0 shadow-file matching guarantees identity.
    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.0);

    const result = await reconcile(discovered, previous, cwd);

    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_1");
    expect(result.confirmed[0].resolvedBy).toBe("shadow-file");
    expect(nitsHash.hashSimilarity).not.toHaveBeenCalled();
  });

  it("Step 0: Matches by shadow file ID (moved, different path) updates name and ignores identifiers", async () => {
    const previous = createRegistry({
      mod_1: {
        id: "mod_1",
        name: "users",
        path: "src/old-users",
        hash: "old_hash",
        status: "active",
        createdAt: timestamp,
        lastSeen: "",
        identifiers: ["OldUserEntity", "OldUserRepo"],
      },
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "auth-users", // Name changed!
        dirPath: "/project/src/domains/auth/users", // Path changed!
        identifiers: ["NewAuthEntity", "NewAuthRepo"], // Identifiers completely changed!
        hash: "new_hash",
        shadowFile: { id: "mod_1", name: "users", createdAt: timestamp },
      },
    ];

    const result = await reconcile(discovered, previous, cwd);

    expect(result.moved.length).toBe(1);
    expect(result.moved[0].record.id).toBe("mod_1");
    expect(result.moved[0].record.resolvedBy).toBe("shadow-file");
    expect(result.moved[0].oldPath).toBe("src/old-users");
    expect(result.moved[0].newPath).toBe("src/domains/auth/users");
    expect(result.moved[0].record.name).toBe("auth-users"); // Name updated
  });

  it("Step 0: Module has shadow file but ID not in registry -> registered as new with that ID", async () => {
    // This happens e.g., if registry is deleted but .nodulus files remain.
    const previous = createRegistry({});

    const discovered: DiscoveredModule[] = [
      {
        name: "orders",
        dirPath: "/project/src/orders",
        identifiers: ["Order"],
        hash: "hash",
        shadowFile: { id: "mod_xyz12345", name: "orders", createdAt: timestamp },
      },
    ];

    const result = await reconcile(discovered, previous, cwd);

    expect(result.newModules.length).toBe(1);
    expect(result.newModules[0].id).toBe("mod_xyz12345"); // Kept its own ID
    expect(result.newModules[0].resolvedBy).toBe("shadow-file");
  });

  it("Step 0: Clone detection - multiple modules with same shadow file ID", async () => {
    const previous = createRegistry({
      mod_1: {
        id: "mod_1",
        name: "users",
        path: "src/users",
        hash: "hash1",
        status: "active",
        createdAt: timestamp,
        lastSeen: "",
        identifiers: ["User"],
      },
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "users",
        dirPath: "/project/src/users", // Original path
        identifiers: ["User"],
        hash: "hash1",
        shadowFile: { id: "mod_1", name: "users", createdAt: timestamp },
      },
      {
        name: "users-copy",
        dirPath: "/project/src/users-copy", // Copied path
        identifiers: ["User"],
        hash: "hash1",
        shadowFile: { id: "mod_1", name: "users", createdAt: timestamp }, // Cloned .nodulus file!
      },
    ];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await reconcile(discovered, previous, cwd);

    // Original keeps ID
    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_1");

    // Copy gets new ID and causes shadow file rewrite
    expect(result.newModules.length).toBe(1);
    expect(result.newModules[0].id).toMatch(/^mod_[0-9a-f]{8}$/);
    expect(result.newModules[0].id).not.toBe("mod_1");
    expect(result.newModules[0].name).toBe("users-copy");

    // Check that Critical 2 fix is applied
    expect(shadowFileAPI.deleteShadowFile).toHaveBeenCalledWith("/project/src/users-copy");
    expect(shadowFileAPI.writeShadowFile).toHaveBeenCalledWith("/project/src/users-copy", expect.objectContaining({
      id: result.newModules[0].id,
      name: "users-copy"
    }));

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate module identity detected"));
    warnSpy.mockRestore();
  });

  it("Legacy behavior: falls through to Jaccard when shadowFile is missing and path changes", async () => {
    const previous = createRegistry({
      mod_2: {
        id: "mod_2",
        name: "payments",
        path: "src/old-payments",
        hash: "hash1",
        status: "active",
        createdAt: timestamp,
        lastSeen: "",
        identifiers: ["Payment", "Stripe", "PayPal"],
      },
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "payments",
        dirPath: "/project/src/new-payments", // Different path
        identifiers: ["Payment", "Stripe", "PayPal"], // Identical identifiers
        hash: "hash2", // hash changed
        shadowFile: undefined, // Legacy!
      },
    ];

    // Setup jaccard mock to return high similarity
    vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.95);

    const result = await reconcile(discovered, previous, cwd);

    expect(result.moved.length).toBe(1);
    expect(result.moved[0].record.id).toBe("mod_2");
    expect(result.moved[0].record.resolvedBy).toBe("jaccard"); // Resolved by Step 2
    expect(result.moved[0].newPath).toBe("src/new-payments");
  });

  describe("Migration & 2-Cycle Scenarios", () => {
    it("Migration: 2-cycle test - legacy module gets shadow file and uses it on next boot", async () => {
      // Import the post-reconcile function to test the full migration lifecycle
      const { postReconcileEnsureShadowFiles } = await import("../../src/nits/nits-store.js");
      const ensureSpy = vi.spyOn(await import("../../src/nits/shadow-file.js"), "ensureShadowFile");

      // CYCLE 1: Legacy registry and module with NO shadow file
      const previousCycle1 = createRegistry({
        mod_legacy: {
          id: "mod_legacy",
          name: "legacy",
          path: "src/legacy",
          hash: "hash_legacy",
          status: "active",
          createdAt: timestamp,
          lastSeen: "",
          identifiers: ["LegacyId"],
        },
      });

      const discoveredCycle1: DiscoveredModule[] = [
        {
          name: "legacy",
          dirPath: "/project/src/legacy",
          identifiers: ["LegacyId"],
          hash: "hash_legacy",
          shadowFile: undefined, // No shadow file yet!
        },
      ];

      const resultCycle1 = await reconcile(discoveredCycle1, previousCycle1, cwd);
      
      // Legacy module is confirmed via path (resolvedBy: 'path')
      expect(resultCycle1.confirmed.length).toBe(1);
      expect(resultCycle1.confirmed[0].resolvedBy).toBe("path");

      // Post-reconcile: the scanner should generate the shadow file
      const resolvedDirs = new Map([["/project/src/legacy", "legacy"]]);
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/project");
      postReconcileEnsureShadowFiles(resultCycle1, resolvedDirs);
      cwdSpy.mockRestore();
      
      expect(ensureSpy).toHaveBeenCalledWith("/project/src/legacy", "legacy");

      // CYCLE 2: The module now has a shadow file, and let's say it moves!
      const previousCycle2 = createRegistry({
        mod_legacy: resultCycle1.confirmed[0], // Output of cycle 1 is input to cycle 2
      });

      const discoveredCycle2: DiscoveredModule[] = [
        {
          name: "legacy",
          dirPath: "/project/src/new-legacy-path", // Moved!
          identifiers: [], // Completely changed identifiers
          hash: "hash_new",
          shadowFile: { id: "mod_legacy", name: "legacy", createdAt: timestamp }, // Now has shadow file!
        },
      ];

      // Jaccard similarity is 0, path changed -> normally it would fail and be a newModule
      vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.0);

      const resultCycle2 = await reconcile(discoveredCycle2, previousCycle2, cwd);

      // Successfully resolved via shadow file!
      expect(resultCycle2.moved.length).toBe(1);
      expect(resultCycle2.moved[0].record.id).toBe("mod_legacy");
      expect(resultCycle2.moved[0].record.resolvedBy).toBe("shadow-file");
      
      ensureSpy.mockRestore();
    });
  });

  describe("Backward Compatibility", () => {
    it("Works transparently with previous records missing shadow file info", async () => {
      // NitsModuleRecord only has 'id', not 'shadowFileId'. This test just verifies
      // that if ALL discovered modules have NO shadow file, the system acts exactly like pre-v1.5.1
      const previous = createRegistry({
        mod_a: { id: "mod_a", name: "a", path: "src/a", hash: "h1", status: "active", createdAt: timestamp, lastSeen: "", identifiers: ["A"] },
        mod_b: { id: "mod_b", name: "b", path: "src/b", hash: "h2", status: "active", createdAt: timestamp, lastSeen: "", identifiers: ["B"] },
      });

      const discovered: DiscoveredModule[] = [
        { name: "a", dirPath: "/project/src/a", identifiers: ["A"], hash: "h1", shadowFile: undefined },
        { name: "b", dirPath: "/project/src/b", identifiers: ["B"], hash: "h2", shadowFile: undefined },
      ];

      const result = await reconcile(discovered, previous, cwd);

      expect(result.confirmed.length).toBe(2);
      expect(result.confirmed[0].resolvedBy).toBe("path");
      expect(result.confirmed[1].resolvedBy).toBe("path");
      expect(result.moved.length).toBe(0);
      expect(result.newModules.length).toBe(0);
    });
  });

  describe("Edge Cases", () => {
    it("Module with corrupt shadowFile (readShadowFile returned null) falls back to Jaccard", async () => {
      const previous = createRegistry({
        mod_x: { id: "mod_x", name: "x", path: "src/old-x", hash: "h_old", status: "active", createdAt: timestamp, lastSeen: "", identifiers: ["X"] },
      });

      const discovered: DiscoveredModule[] = [
        {
          name: "x",
          dirPath: "/project/src/new-x",
          identifiers: ["X"], // Keeps identifiers
          hash: "h_new",
          shadowFile: undefined, // Simulating scanShadowFiles filtering out corrupt file
        },
      ];

      vi.mocked(nitsHash.hashSimilarity).mockReturnValue(0.99);

      const result = await reconcile(discovered, previous, cwd);

      // Falls through to Jaccard and moves successfully
      expect(result.moved.length).toBe(1);
      expect(result.moved[0].record.resolvedBy).toBe("jaccard");
      expect(result.moved[0].record.id).toBe("mod_x");
    });

    it("All modules move in the same cycle — none become stale if they have Shadow Files", async () => {
      const previous = createRegistry({
        m1: { id: "m1", name: "m1", path: "src/a", hash: "h1", status: "active", createdAt: timestamp, lastSeen: "", identifiers: ["1"] },
        m2: { id: "m2", name: "m2", path: "src/b", hash: "h2", status: "active", createdAt: timestamp, lastSeen: "", identifiers: ["2"] },
      });

      const discovered: DiscoveredModule[] = [
        { name: "m1", dirPath: "/project/src/new/a", identifiers: ["1"], hash: "hx", shadowFile: { id: "m1", name: "m1", createdAt: timestamp } },
        { name: "m2", dirPath: "/project/src/new/b", identifiers: ["2"], hash: "hy", shadowFile: { id: "m2", name: "m2", createdAt: timestamp } },
      ];

      const result = await reconcile(discovered, previous, cwd);

      expect(result.moved.length).toBe(2);
      expect(result.moved[0].record.resolvedBy).toBe("shadow-file");
      expect(result.moved[1].record.resolvedBy).toBe("shadow-file");
      expect(result.stale.length).toBe(0);
      expect(result.newModules.length).toBe(0);
    });

    it("Shadow File name is NOT authoritative for the module name or path, only the ID is", async () => {
      const previous = createRegistry({
        mod_target: { id: "mod_target", name: "old_name", path: "src/target", hash: "h", status: "active", createdAt: timestamp, lastSeen: "", identifiers: ["1"] },
      });

      const discovered: DiscoveredModule[] = [
        {
          name: "real_folder_name", // Actual directory name
          dirPath: "/project/src/real_folder_name", // Actual path
          identifiers: ["1"],
          hash: "h",
          // The shadow file contains outdated or mismatched name metadata
          shadowFile: { id: "mod_target", name: "completely_wrong_name", createdAt: timestamp },
        },
      ];

      const result = await reconcile(discovered, previous, cwd);

      // Should be matched correctly by ID
      expect(result.moved.length).toBe(1);
      expect(result.moved[0].record.id).toBe("mod_target");
      expect(result.moved[0].record.resolvedBy).toBe("shadow-file");
      
      // The authoritative name comes from the DiscoveredModule (which is the directory name)
      // NOT the shadow file metadata.
      expect(result.moved[0].record.name).toBe("real_folder_name");
      expect(result.moved[0].record.name).not.toBe("completely_wrong_name");
    });
  });
});
