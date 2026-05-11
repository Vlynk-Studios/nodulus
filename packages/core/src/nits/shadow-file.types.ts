// ─── Constants ────────────────────────────────────────────────────────────────

/** Filename of the shadow identity file placed at each module's root. */
export const SHADOW_FILE_NAME = '.nodulus';

/**
 * Schema version for the shadow file format.
 * Increment only on breaking schema changes.
 * Fields reserved for v2.0.0 (`domain`, `history`, `checksum`) must NOT be added here.
 */
export const SHADOW_FILE_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Shape of the `.nodulus` shadow file written at the root of each module directory.
 *
 * Schema v1 — deliberately minimal. Three fields, no more.
 *
 * @since v1.5.5
 */
export interface ShadowFileRecord {
  /** Schema version. Helps with future migrations. */
  version: number;
  /** Stable NITS module ID. Format: `mod_[0-9a-f]{8}`. Source of truth for identity. */
  id: string;
  /** Module name at the time the file was created. May drift if the user renames the folder. */
  name: string;
  /** ISO 8601 creation timestamp. Set once on first write, never overwritten. */
  createdAt: string;
}

// ─── Type Guard ───────────────────────────────────────────────────────────────

/** Matches ISO 8601 datetime strings (e.g. 2026-05-04T12:00:00Z or with offset). */
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Type guard — returns `true` if `value` is a well-formed `ShadowFileRecord`.
 *
 * Validates:
 * - `version` is a number
 * - `id` matches `/^mod_[0-9a-f]{8}$/`
 * - `name` is a non-empty string
 * - `createdAt` is a valid ISO 8601 datetime string
 */
export function isShadowFileRecord(value: unknown): value is ShadowFileRecord {
  if (!value || typeof value !== 'object') return false;

  const v = value as Record<string, unknown>;

  if (typeof v.version !== 'number')                                 return false;
  if (typeof v.id !== 'string' || !/^mod_[0-9a-f]{8}$/.test(v.id))  return false;
  if (typeof v.name !== 'string' || v.name.trim() === '')             return false;
  if (typeof v.createdAt !== 'string' || !ISO_8601_RE.test(v.createdAt)) return false;

  return true;
}
