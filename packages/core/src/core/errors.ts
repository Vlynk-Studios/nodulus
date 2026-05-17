export type NodulusErrorCode =
  | "MODULE_NOT_FOUND"
  | "DUPLICATE_MODULE"
  | "MISSING_IMPORT"
  | "UNDECLARED_IMPORT"
  | "CIRCULAR_DEPENDENCY"
  | "EXPORT_MISMATCH"
  | "INVALID_CONTROLLER"
  | "ALIAS_NOT_FOUND"
  | "ALIAS_INVALID"
  | "DUPLICATE_ALIAS"
  | "DUPLICATE_BOOTSTRAP"
  | "REGISTRY_MISSING_CONTEXT"
  | "INVALID_MODULE_DECLARATION"
  | "DUPLICATE_SERVICE"
  | "DUPLICATE_REPOSITORY"
  | "DUPLICATE_SCHEMA"
  | "INVALID_ESM_ENV"
  | "CLI_ERROR"
  | "UNUSED_IMPORT"
  | "PRELOADER_REQUIRED"
  | "PRELOADER_VERSION_MISMATCH"
  | "MODULE_LOAD_TIMEOUT"
  // ─── NITS structured logging codes (not thrown as exceptions) ─────────────
  /**
   * Emitted via structured log when the reconciler confirms that a stale module
   * is a real deletion (its shadow ID is absent from all discovered modules in
   * the current cycle). Used for observability only — never passed to `new NodulusError()`.
   * @since v1.5.5
   */
  | "NITS_DELETE_CONFIRMED";

export class NodulusError extends Error {
  readonly code: NodulusErrorCode;
  readonly details?: string;

  constructor(code: NodulusErrorCode, message: string, details?: string) {
    super(message);
    this.name = "NodulusError";
    this.code = code;
    this.details = details;
  }
}

