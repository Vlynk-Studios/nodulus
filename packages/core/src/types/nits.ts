export type NitsStatus = 'active' | 'stale' | 'moved' | 'candidate' | 'deleted';

export interface DiscoveredModule {
  name: string;
  dirPath: string;
  domain?: string;         // Reserved for v2.0.0 (Domain-driven architecture). Always undefined in v1.x.
  identifiers: string[];   // names extracted by nits-hash
  hash: string;
  /**
   * Identity record read from the `.nodulus` shadow file at the module root.
   * Present when the module was created with Nodulus ≥ v1.5.5 or after the first
   * reconciliation that writes the shadow file.
   * `undefined` for legacy modules (created before v1.5.5) — Jaccard is used as fallback.
   * @since v1.5.5
   */
  shadowFile?: import('../nits/shadow-file.types.js').ShadowFileRecord;
}

export interface NitsModuleRecord {
  id: string;          // "mod_8f2a9b1c" — unique persistent identifier
  name: string;        // current module name
  path: string;        // directory path (relative to cwd in registry file)
  domain?: string;     // undefined in v1.x projects without Domain() support
  hash: string;        // content-based signature (see nits-hash.ts)
  status: NitsStatus;
  createdAt: string;   // ISO 8601 timestamp (immutable)
  lastSeen: string;    // ISO 8601 timestamp
  identifiers: string[];
  /**
   * Stable ID from the `.nodulus` shadow file captured at the last reconciliation.
   * Used as primary identity key for Move vs Delete detection.
   * - Present  → shadow-file path is taken; Jaccard is skipped for this record.
   * - Absent   → legacy module (pre-v1.5.5); Jaccard is used as fallback.
   * Optional for full backwards-compatibility with existing `registry.json` files.
   * @since v1.5.5
   */
  shadowFileId?: string;
  /**
   * How identity was resolved for this record in the last reconciliation cycle.
   * - `'shadow-file'` — matched via `.nodulus` ID (highest confidence).
   * - `'path'`        — matched via exact directory path (Step 1 / Jaccard fallback).
   * - `'jaccard'`     — matched via AST hash similarity (Step 2 / Step 3).
   * Only present in the in-memory result; NOT serialised to `registry.json`.
   * Optional so existing registry records without this field remain valid.
   * @since v1.5.5
   */
  resolvedBy?: 'shadow-file' | 'path' | 'jaccard';
}

export interface ReconcileOptions {
  clonePolicy?: 'error' | 'new';
  isCi?: boolean;
  similarityThreshold?: number;
}

export interface NitsRegistry {
  _note?: string;       // Metadata for the human developer
  project: string;
  version: string;      // NITS schema version
  lastCheck: string;    // ISO 8601 timestamp
  modules: Record<string, NitsModuleRecord>; // key: id
}

export interface BrokenImport {
  file: string;
  line: number;
  specifier: string;   // alias pointing to a legacy path
}

export interface MovedModule {
  record: NitsModuleRecord;
  oldPath: string;
  newPath: string;
  brokenImports: BrokenImport[];
}

export interface ReconciliationResult {
  confirmed: NitsModuleRecord[];   // path + hash match
  moved: MovedModule[];            // high confidence move (hash match)
  candidates: MovedModule[];       // medium confidence move (name match)
  stale: NitsModuleRecord[];       // disappeared from disk — unresolved (no shadow ID or shadow ID not seen in this cycle yet)
  deleted: NitsModuleRecord[];     // confirmed delete — shadow ID absent from all discovered modules in this cycle
  newModules: NitsModuleRecord[];  // no match in previous registry
}
