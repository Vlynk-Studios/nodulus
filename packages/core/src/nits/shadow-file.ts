import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  SHADOW_FILE_NAME,
  SHADOW_FILE_VERSION,
  isShadowFileRecord,
  type ShadowFileRecord,
} from './shadow-file.types.js';

// ─── ID Generation ────────────────────────────────────────────────────────────

/**
 * Generates a new unique module ID.
 * Format: `mod_` + 8 random lowercase hex characters.
 * Uses `node:crypto` — no external dependencies.
 *
 * @example
 * generateModuleId() // → 'mod_a3f8c1b2'
 */
export function generateModuleId(): string {
  return `mod_${randomBytes(4).toString('hex')}`;
}

// ─── Reader ───────────────────────────────────────────────────────────────────

/**
 * Reads and validates the `.nodulus` shadow file from a module directory.
 *
 * Resolution order:
 *  1. File absent → `null` (silent, expected for legacy modules).
 *  2. File present but JSON-invalid → `null` + `console.warn`.
 *  3. File present but fails `isShadowFileRecord` → `null` + `console.warn`.
 *  4. File valid → returns `ShadowFileRecord`.
 *
 * Never throws. Designed for resilience inside the bootstrap pipeline.
 *
 * @param moduleDirPath - Absolute path to the module's root directory.
 */
export function readShadowFile(moduleDirPath: string): ShadowFileRecord | null {
  const filePath = path.join(moduleDirPath, SHADOW_FILE_NAME);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[NITS] Shadow file read error at "${filePath}": ${msg}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(
      `[NITS] Shadow file corrupted at "${filePath}", will regenerate.`
    );
    return null;
  }

  if (!isShadowFileRecord(parsed)) {
    console.warn(
      `[NITS] Shadow file at "${filePath}" has an invalid structure (id/name/createdAt). Will regenerate.`
    );
    return null;
  }

  return parsed;
}

// ─── Writer ───────────────────────────────────────────────────────────────────

/**
 * Writes a `.nodulus` shadow file to a module directory.
 *
 * **Important:** Does NOT overwrite an existing valid shadow file.
 * Call `readShadowFile` first — if it returns a valid record, skip writing.
 * Use `ensureShadowFile` as the primary entry point to enforce this contract.
 *
 * The write is intentionally synchronous — it runs during scaffolding
 * or the first-time NITS reconciliation, both of which are sequential I/O flows.
 *
 * Never throws. If the write fails (e.g. permission denied), emits a warning
 * and lets the bootstrap continue with a temporary in-memory identity.
 *
 * @param moduleDirPath - Absolute path to the module's root directory.
 * @param record        - The shadow file contents to persist.
 */
export function writeShadowFile(moduleDirPath: string, record: ShadowFileRecord): void {
  const filePath = path.join(moduleDirPath, SHADOW_FILE_NAME);

  // Guard: do not overwrite an existing valid file.
  const existing = readShadowFile(moduleDirPath);
  if (existing !== null) {
    return;
  }

  // Schema v1 — only persist the three canonical fields.
  // Future fields (domain, history, checksum) must NEVER bleed in here.
  const payload: ShadowFileRecord = {
    version:   record.version || SHADOW_FILE_VERSION,
    id:        record.id,
    name:      record.name,
    createdAt: record.createdAt,
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[NITS] Could not write shadow file at "${filePath}": ${msg}. Module will use a temporary identity this run.`
    );
  }
}

// ─── Ensure (main entry point) ────────────────────────────────────────────────

/**
 * Idempotent entry point for shadow file management.
 *
 * - If a valid `.nodulus` file already exists → returns it unchanged.
 * - If missing or invalid → generates a new ID, writes the file, returns the record.
 *
 * This is the function the rest of the codebase should call.
 * Direct calls to `readShadowFile` / `writeShadowFile` are for tests and internal logic.
 *
 * @param moduleDirPath - Absolute path to the module's root directory.
 * @param moduleName    - Module name to embed in the record on first creation.
 */
export function ensureShadowFile(
  moduleDirPath: string,
  moduleName: string,
  existingId?: string
): ShadowFileRecord {
  const existing = readShadowFile(moduleDirPath);
  if (existing !== null) {
    return existing;
  }

  const record: ShadowFileRecord = {
    version:   SHADOW_FILE_VERSION,
    id:        existingId || generateModuleId(),
    name:      moduleName,
    createdAt: new Date().toISOString(),
  };

  writeShadowFile(moduleDirPath, record);
  return record;
}

// ─── Delete (tests / future nodulus clean) ────────────────────────────────────

/**
 * Removes the `.nodulus` shadow file from a module directory.
 * No-op if the file does not exist. Never throws.
 *
 * Intended for use in unit tests and the future `nodulus clean` command.
 *
 * @param moduleDirPath - Absolute path to the module's root directory.
 */
export function deleteShadowFile(moduleDirPath: string): void {
  const filePath = path.join(moduleDirPath, SHADOW_FILE_NAME);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[NITS] Could not delete shadow file at "${filePath}": ${msg}`);
  }
}
