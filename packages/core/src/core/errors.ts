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
  | "PRELOADER_VERSION_MISMATCH";

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

