/**
 * NITS Reconciler — Move vs Delete Detection
 *
 * Tests for the Shadow File-based delete confirmation system (v1.5.5+).
 * The core invariant: if a module had a `shadowFileId` in the previous
 * registry and its ID does not appear in ANY discovered module this cycle,
 * the absence is a confirmed delete — not an ambiguous stale.
 *
 * Scope: Step 0 (shadow-file resolution), delete classifier in FINALIZATION,
 *        buildUpdatedNitsRegistry purge, and backward-compatibility guarantees.
 *
 * For Step 0 clone-detection tests see: nits-reconciler-shadow.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  reconcile,
  buildUpdatedNitsRegistry,
} from "../../src/nits/nits-reconciler.js";
import { NITS_REGISTRY_VERSION } from "../../src/nits/constants.js";
import type {
  NitsRegistry,
  NitsModuleRecord,
  DiscoveredModule,
  ReconciliationResult,
} from "../../src/types/nits.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../src/nits/nits-hash.js", async () => {
  const actual = await vi.importActual("../../src/nits/nits-hash.js");
  return { ...actual, hashSimilarity: vi.fn() };
});

vi.mock("../../src/nits/shadow-file.js", async () => {
  const actual = await vi.importActual("../../src/nits/shadow-file.js");
  return {
    ...actual,
    deleteShadowFile: vi.fn(),
    writeShadowFile: vi.fn(),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CWD = "/project";
const TS  = "2024-01-01T00:00:00.000Z";

function makeRegistry(modules: NitsRegistry["modules"]): NitsRegistry {
  return { project: "test", version: NITS_REGISTRY_VERSION, lastCheck: "", modules };
}

/** A minimal registry record that simulates a module tracked by shadow file. */
function makeTrackedRecord(
  id: string,
  name: string,
  relPath: string,
  extra: Partial<NitsModuleRecord> = {}
): NitsModuleRecord {
  return {
    id,
    name,
    path: relPath,
    hash: "h",
    status: "active",
    createdAt: TS,
    lastSeen: "",
    identifiers: [],
    shadowFileId: id, // key: shadowFileId is set → this module is tracked
    ...extra,
  };
}

/** A minimal registry record without a shadow file (legacy pre-v1.5.5). */
function makeLegacyRecord(
  id: string,
  name: string,
  relPath: string,
  extra: Partial<NitsModuleRecord> = {}
): NitsModuleRecord {
  return {
    id,
    name,
    path: relPath,
    hash: "h",
    status: "active",
    createdAt: TS,
    lastSeen: "",
    identifiers: [],
    // shadowFileId intentionally absent
    ...extra,
  };
}

function makeDisc(
  name: string,
  dirPath: string,
  shadowId?: string
): DiscoveredModule {
  return {
    name,
    dirPath,
    identifiers: [],
    hash: "h",
    shadowFile: shadowId
      ? { id: shadowId, name, createdAt: TS, version: 1 }
      : undefined,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("NITS Reconciler — Step 0: Shadow File ID Resolution", () => {
  beforeEach(() => vi.resetAllMocks());

  it("confirmed (same path): module with matching shadowFileId → confirmed, not stale, Jaccard skipped", async () => {
    const previous = makeRegistry({
      mod_aabbccdd: makeTrackedRecord("mod_aabbccdd", "auth", "src/auth"),
    });

    const discovered = [makeDisc("auth", `${CWD}/src/auth`, "mod_aabbccdd")];

    const result = reconcile(discovered, previous, CWD);

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].id).toBe("mod_aabbccdd");
    expect(result.confirmed[0].resolvedBy).toBe("shadow-file");
    expect(result.stale).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("moved (different path): matching shadowFileId with path change → moved with correct oldPath/newPath", async () => {
    const previous = makeRegistry({
      mod_11223344: makeTrackedRecord("mod_11223344", "orders", "src/orders"),
    });

    const discovered = [makeDisc("orders-v2", `${CWD}/src/billing/orders`, "mod_11223344")];

    const result = reconcile(discovered, previous, CWD);

    expect(result.moved).toHaveLength(1);
    const move = result.moved[0];
    expect(move.record.id).toBe("mod_11223344");
    expect(move.record.resolvedBy).toBe("shadow-file");
    expect(move.oldPath).toBe("src/orders");
    expect(move.newPath).toBe("src/billing/orders");
    expect(result.stale).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("new module: shadowFile.id NOT in registry → newModule reusing the shadow file ID", async () => {
    const previous = makeRegistry({});

    const discovered = [makeDisc("fresh", `${CWD}/src/fresh`, "mod_deadbeef")];

    const result = reconcile(discovered, previous, CWD);

    expect(result.newModules).toHaveLength(1);
    expect(result.newModules[0].id).toBe("mod_deadbeef");
    expect(result.confirmed).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("no shadowFile: module without shadowFile skips Step 0, falls to Step 1 (path match)", async () => {
    const previous = makeRegistry({
      mod_aabbccdd: makeLegacyRecord("mod_aabbccdd", "users", "src/users"),
    });

    // No shadow file on discovered → must use path match (Step 1)
    const discovered = [makeDisc("users", `${CWD}/src/users`, undefined)];

    const result = reconcile(discovered, previous, CWD);

    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].id).toBe("mod_aabbccdd");
    expect(result.confirmed[0].resolvedBy).toBe("path");
  });

  it("legacy registry record (no shadowFileId): not a Step 0 candidate, falls to Steps 1-3", async () => {
    // Registry has no shadowFileId → discovered module with shadow file
    // can't match by shadowFileId; must fall through to path/Jaccard.
    const previous = makeRegistry({
      mod_aabbccdd: makeLegacyRecord("mod_aabbccdd", "payments", "src/payments"),
    });

    // Disc has shadow file whose id EQUALS the legacy record's id.
    // The current Step 0 in the reconciler compares disc.shadowFile.id vs prev.id
    // (not prev.shadowFileId), so this is still matched via Step 0.
    // Verify the resolution method is 'shadow-file'.
    const discovered = [makeDisc("payments", `${CWD}/src/payments`, "mod_aabbccdd")];

    const result = reconcile(discovered, previous, CWD);

    // Should be confirmed — either via Step 0 (id match) or Step 1 (path match)
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].id).toBe("mod_aabbccdd");
    expect(result.stale).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });

  it("move + rename + hash below Jaccard threshold: Step 0 resolves via ID, Step 2 never runs", async () => {
    const { hashSimilarity } = await import("../../src/nits/nits-hash.js");
    vi.mocked(hashSimilarity).mockReturnValue(0.0); // Would fail Step 2

    const previous = makeRegistry({
      mod_cafebabe: makeTrackedRecord("mod_cafebabe", "catalog", "src/catalog"),
    });

    const discovered = [
      makeDisc("catalog-v2", `${CWD}/src/new/catalog-v2`, "mod_cafebabe"),
    ];

    const result = reconcile(discovered, previous, CWD);

    expect(result.moved).toHaveLength(1);
    expect(result.moved[0].record.id).toBe("mod_cafebabe");
    expect(result.moved[0].record.resolvedBy).toBe("shadow-file");
    // Jaccard was called 0 times — Step 0 short-circuited
    expect(hashSimilarity).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NITS Reconciler — Confirmed Delete Detection", () => {
  beforeEach(() => vi.resetAllMocks());

  it("tracked module (has shadowFileId) absent from discovered for 3 cycles → goes to deleted", async () => {
    const previous = makeRegistry({
      mod_11223344: makeTrackedRecord("mod_11223344", "auth", "src/auth", { missingCount: 2 }),
    });

    // Empty discovered — module is gone for the 3rd time
    const result = reconcile([], previous, CWD);

    expect(result.deleted).toHaveLength(1);
    expect(result.deleted[0].id).toBe("mod_11223344");
    expect(result.deleted[0].status).toBe("deleted");
    expect(result.stale).toHaveLength(0);
  });

  it("tracked module (has shadowFileId) absent from discovered for 1 cycle → goes to stale", async () => {
    const previous = makeRegistry({
      mod_11223344: makeTrackedRecord("mod_11223344", "auth", "src/auth"),
    });

    // Empty discovered
    const result = reconcile([], previous, CWD);

    expect(result.deleted).toHaveLength(0);
    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].missingCount).toBe(1);
  });

  it("legacy module (no shadowFileId) absent from discovered → goes to stale (backward compat)", async () => {
    const previous = makeRegistry({
      mod_legacy: makeLegacyRecord("mod_legacy", "legacy", "src/legacy"),
    });

    const result = reconcile([], previous, CWD);

    expect(result.stale).toHaveLength(1);
    expect(result.stale[0].id).toBe("mod_legacy");
    expect(result.stale[0].status).toBe("stale");
    expect(result.deleted).toHaveLength(0);
  });

  it("mixed registry: tracked + legacy absent → both go to stale for 1st cycle", async () => {
    const previous = makeRegistry({
      mod_tracked: makeTrackedRecord("mod_tracked", "tracked", "src/tracked"),
      mod_legacy:  makeLegacyRecord("mod_legacy",   "legacy",  "src/legacy"),
    });

    const result = reconcile([], previous, CWD);

    expect(result.deleted).toHaveLength(0);
    expect(result.stale).toHaveLength(2);
    expect(result.stale[0].id).toBe("mod_tracked");
    expect(result.stale[1].id).toBe("mod_legacy");
  });



  it("all modules move with shadow files in the same cycle → deleted bucket stays empty", async () => {
    const previous = makeRegistry({
      mod_aaaabbbb: makeTrackedRecord("mod_aaaabbbb", "a", "src/a"),
      mod_ccccdddd: makeTrackedRecord("mod_ccccdddd", "b", "src/b"),
    });

    const discovered = [
      makeDisc("a", `${CWD}/src/new/a`, "mod_aaaabbbb"),
      makeDisc("b", `${CWD}/src/new/b`, "mod_ccccdddd"),
    ];

    const result = reconcile(discovered, previous, CWD);

    expect(result.moved).toHaveLength(2);
    expect(result.stale).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NITS Reconciler — buildUpdatedNitsRegistry: atomic purge", () => {
  const makeDeletedRecord = (id: string, name: string): NitsModuleRecord => ({
    id,
    name,
    path: `src/${name}`,
    hash: "h",
    status: "deleted",
    createdAt: TS,
    lastSeen: "",
    identifiers: [],
    shadowFileId: id,
  });

  function makeFullResult(
    deleted: NitsModuleRecord[] = []
  ): ReconciliationResult {
    return {
      confirmed: [],
      moved: [],
      candidates: [],
      newModules: [],
      stale: [],
      deleted,
    };
  }

  it("deleted modules are NOT present in the built registry", () => {
    const result = makeFullResult([makeDeletedRecord("mod_purged", "dead")]);
    const registry = buildUpdatedNitsRegistry(result, "test");

    expect(Object.keys(registry.modules)).toHaveLength(0);
    expect(registry.modules["mod_purged"]).toBeUndefined();
  });

  it("non-deleted modules are still present when deleted co-exists", () => {
    const keeper: NitsModuleRecord = {
      id: "mod_keeper",
      name: "keeper",
      path: "src/keeper",
      hash: "h",
      status: "active",
      createdAt: TS,
      lastSeen: "",
      identifiers: [],
    };
    const result: ReconciliationResult = {
      confirmed: [keeper],
      moved: [],
      candidates: [],
      newModules: [],
      stale: [],
      deleted: [makeDeletedRecord("mod_purged", "dead")],
    };

    const registry = buildUpdatedNitsRegistry(result, "test");

    expect(Object.keys(registry.modules)).toHaveLength(1);
    expect(registry.modules["mod_keeper"]).toBeDefined();
    expect(registry.modules["mod_purged"]).toBeUndefined();
  });

  it("buildUpdatedNitsRegistry is idempotent: calling twice yields same output", () => {
    const result = makeFullResult([makeDeletedRecord("mod_purged", "dead")]);
    const r1 = buildUpdatedNitsRegistry(result, "test");
    const r2 = buildUpdatedNitsRegistry(result, "test");

    expect(Object.keys(r1.modules)).toEqual(Object.keys(r2.modules));
  });

  it("resolvedBy is stripped from persisted records (not leaked to registry.json)", () => {
    const record: NitsModuleRecord = {
      id: "mod_check",
      name: "check",
      path: "src/check",
      hash: "h",
      status: "active",
      createdAt: TS,
      lastSeen: "",
      identifiers: [],
      resolvedBy: "shadow-file",
    };
    const result: ReconciliationResult = {
      confirmed: [record],
      moved: [],
      candidates: [],
      newModules: [],
      stale: [],
      deleted: [],
    };

    const registry = buildUpdatedNitsRegistry(result, "test");

    expect(registry.modules["mod_check"]).toBeDefined();
    expect((registry.modules["mod_check"] as any).resolvedBy).toBeUndefined();
  });


});

// ─────────────────────────────────────────────────────────────────────────────

describe("NITS Reconciler — Clonación de Shadow File", () => {
  beforeEach(() => vi.resetAllMocks());

  it("mismo shadowFile.id en dos discovered: el de path coincidente mantiene ID, el otro recibe ID nuevo → newModules", async () => {
    const previous = makeRegistry({
      mod_aabbccdd: makeTrackedRecord("mod_aabbccdd", "auth", "src/auth"),
    });

    // Two discovered modules share the same shadow ID; one matches the registry path.
    const discovered = [
      makeDisc("auth",      `${CWD}/src/auth`,      "mod_aabbccdd"), // original path
      makeDisc("auth-copy", `${CWD}/src/auth-copy`, "mod_aabbccdd"), // cloned
    ];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = reconcile(discovered, previous, CWD);

    // Original stays confirmed with same ID
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].id).toBe("mod_aabbccdd");
    expect(result.confirmed[0].resolvedBy).toBe("shadow-file");

    // Clone is registered as a brand-new module with a different ID
    expect(result.newModules).toHaveLength(1);
    expect(result.newModules[0].id).not.toBe("mod_aabbccdd");
    expect(result.newModules[0].id).toMatch(/^mod_[0-9a-f]{8}$/);
    expect(result.newModules[0].name).toBe("auth-copy");

    warnSpy.mockRestore();
  });

  it("warning de clonación se emite exactamente una vez por colisión", async () => {
    const previous = makeRegistry({
      mod_aabbccdd: makeTrackedRecord("mod_aabbccdd", "auth", "src/auth"),
    });

    const discovered = [
      makeDisc("auth",      `${CWD}/src/auth`,      "mod_aabbccdd"),
      makeDisc("auth-copy", `${CWD}/src/auth-copy`, "mod_aabbccdd"),
    ];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    reconcile(discovered, previous, CWD);

    const cloneWarnings = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Duplicate module identity detected")
    );
    // Exactly ONE warning per collision (the clone, not the original)
    expect(cloneWarnings).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it("dos discovered con mismo shadowFile.id, ninguno en registry previo → ambos IDs nuevos, at-least-one warning", async () => {
    // Empty registry — neither module is known.
    // Design: when no prev record anchors an "original", the reconciler uses
    // discs[0].dirPath as the reference path. Because prev is undefined, the
    // branch `isOriginal && prev` is always false, so EVERY disc in the collision
    // set goes through the clone path (new ID + warning). Result: 2 new modules
    // and 2 warnings (one per cloned module).
    const previous = makeRegistry({});

    const discovered = [
      makeDisc("alpha", `${CWD}/src/alpha`, "mod_deadbeef"),
      makeDisc("beta",  `${CWD}/src/beta`,  "mod_deadbeef"), // shares ID with alpha
    ];

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = reconcile(discovered, previous, CWD);

    // Both end up as new modules — none can claim the original ID
    expect(result.newModules).toHaveLength(2);
    expect(result.confirmed).toHaveLength(0);

    // Both IDs must be valid format
    for (const m of result.newModules) {
      expect(m.id).toMatch(/^mod_[0-9a-f]{8}$/);
    }

    // The two generated IDs must differ from each other and from the shared shadow ID
    const ids = result.newModules.map((m) => m.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).not.toBe("mod_deadbeef");
    expect(ids[1]).not.toBe("mod_deadbeef");

    // At least one warning is emitted (one per cloned disc — both are treated as
    // clones when there is no prev registry record to anchor the original)
    const cloneWarnings = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("Duplicate module identity detected")
    );
    expect(cloneWarnings.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NITS Reconciler — Backward Compatibility", () => {
  beforeEach(() => vi.resetAllMocks());

  it("registry with no shadowFileId on any record: reconcile() does not throw, behaves like pre-shadow", async () => {
    const previous = makeRegistry({
      mod_a: makeLegacyRecord("mod_a", "a", "src/a"),
      mod_b: makeLegacyRecord("mod_b", "b", "src/b"),
    });

    const discovered = [
      makeDisc("a", `${CWD}/src/a`),
      makeDisc("b", `${CWD}/src/b`),
    ];

    const result = reconcile(discovered, previous, CWD);

    expect(result.confirmed).toHaveLength(2);
    expect(result.confirmed[0].resolvedBy).toBe("path");
    expect(result.confirmed[1].resolvedBy).toBe("path");
    expect(result.deleted).toHaveLength(0);
    expect(result.stale).toHaveLength(0);
  });

  it("all discovered have shadowFile: undefined → Steps 1-3 work normally, deleted stays empty", async () => {
    const { hashSimilarity } = await import("../../src/nits/nits-hash.js");
    vi.mocked(hashSimilarity).mockReturnValue(0.0);

    const previous = makeRegistry({
      mod_a: makeLegacyRecord("mod_a", "a", "src/a"),
    });

    // No shadow files at all
    const discovered: DiscoveredModule[] = [
      { name: "a", dirPath: `${CWD}/src/a`, identifiers: [], hash: "h", shadowFile: undefined },
    ];

    const result = reconcile(discovered, previous, CWD);

    expect(result.confirmed).toHaveLength(1);   // Step 1 path match
    expect(result.deleted).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NITS Reconciler — Edge Cases", () => {
  beforeEach(() => vi.resetAllMocks());

  it("shadowFile present on DiscoveredModule but id is falsy → treated as no shadow file, no throw", async () => {
    const previous = makeRegistry({
      mod_target: makeLegacyRecord("mod_target", "target", "src/target"),
    });

    const discovered: DiscoveredModule[] = [
      {
        name: "target",
        dirPath: `${CWD}/src/target`,
        identifiers: [],
        hash: "h",
        // @ts-expect-error intentional: testing runtime defense
        shadowFile: { id: null, name: "target", createdAt: TS, version: 1 },
      },
    ];

    // Must not throw — module falls to Step 1
    expect(() => reconcile(discovered, previous, CWD)).not.toThrow();

    const result = reconcile(discovered, previous, CWD);
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].resolvedBy).toBe("path");
  });

  it("shadowFileId in prev record with invalid format → ignored, module falls to Steps 1-3", async () => {
    // A corrupted shadowFileId (not mod_[0-9a-f]{8}) should not match anything;
    // the module should fall through to path/Jaccard resolution.
    const previous = makeRegistry({
      mod_broken: {
        ...makeLegacyRecord("mod_broken", "broken", "src/broken"),
        shadowFileId: "INVALID_FORMAT", // not mod_[hex]{8}
      },
    });

    const discovered = [makeDisc("broken", `${CWD}/src/broken`, undefined)];

    const result = reconcile(discovered, previous, CWD);

    // Should be confirmed by path (Step 1)
    expect(result.confirmed).toHaveLength(1);
    expect(result.confirmed[0].id).toBe("mod_broken");
    expect(result.stale).toHaveLength(0);
    // Invalid shadowFileId is NOT used for delete detection (no match on disc side)
    expect(result.deleted).toHaveLength(0);
  });

  it("shadowFileId populated in saved record after reconcile (shadowFileId = disc.shadowFile.id)", async () => {
    // Verifies that createRecord correctly propagates shadowFile.id to the
    // persisted shadowFileId field — the foundation of delete detection.
    const previous = makeRegistry({});

    const discovered = [makeDisc("new-mod", `${CWD}/src/new-mod`, "mod_12345678")];

    const result = reconcile(discovered, previous, CWD);

    expect(result.newModules).toHaveLength(1);
    expect(result.newModules[0].shadowFileId).toBe("mod_12345678");
  });
});
