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

  it("Step 0: Matches by shadow file ID (moved, different path)", async () => {
    const previous = createRegistry({
      mod_1: {
        id: "mod_1",
        name: "users",
        path: "src/old-users",
        hash: "old_hash",
        status: "active",
        createdAt: timestamp,
        lastSeen: "",
        identifiers: ["User"],
      },
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "users",
        dirPath: "/project/src/new-users",
        identifiers: ["User"],
        hash: "new_hash",
        shadowFile: { id: "mod_1", name: "users", createdAt: timestamp },
      },
    ];

    const result = await reconcile(discovered, previous, cwd);

    expect(result.moved.length).toBe(1);
    expect(result.moved[0].record.id).toBe("mod_1");
    expect(result.moved[0].record.resolvedBy).toBe("shadow-file");
    expect(result.moved[0].newPath).toBe("src/new-users");
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

  it("Legacy behavior: falls through to path/jaccard when shadowFile is missing", async () => {
    const previous = createRegistry({
      mod_2: {
        id: "mod_2",
        name: "payments",
        path: "src/payments",
        hash: "hash1",
        status: "active",
        createdAt: timestamp,
        lastSeen: "",
        identifiers: ["Payment"],
      },
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "payments",
        dirPath: "/project/src/payments",
        identifiers: ["Payment"],
        hash: "hash2", // hash changed
        shadowFile: undefined, // Legacy!
      },
    ];

    // Same path -> matches Step 1
    const result = await reconcile(discovered, previous, cwd);

    expect(result.confirmed.length).toBe(1);
    expect(result.confirmed[0].id).toBe("mod_2");
    expect(result.confirmed[0].resolvedBy).toBe("path"); // Resolved by Step 1, not Step 0
  });
});
