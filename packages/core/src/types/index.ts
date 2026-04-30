import type { RequestHandler, Router } from 'express';

// ─── Internal registry entries ───────────────────────────────────────────────
// These types are NOT part of the public API. They represent the shape of data
// stored in the registry during bootstrap.

export interface ControllerEntry {
  name: string;
  path: string;
  prefix: string;
  middlewares: RequestHandler[];
  router?: Router;
  enabled: boolean;
}

export interface ModuleEntry {
  nitsId: string;     // NITS specific assigned ID
  name: string;
  path: string;       // absolute path to the module directory
  indexPath: string;  // absolute path to the module's index.ts / index.js
  imports: string[];
  exports: string[];
  controllers: ControllerEntry[];
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Function that receives a log event from Nodulus.
 * 
 * @param level   - Severity level.
 * @param message - Human-readable message.
 * @param meta    - Optional structured data for machine consumption.
 */
export type LogHandler = (
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
) => void;

// ─── Public API types ─────────────────────────────────────────────────────────
// Exported as part of the public surface. Stable between minor versions unless
// documented otherwise.

export interface ModuleOptions {
  /** Modules this module depends on. */
  imports?: string[];
  /**
   * Names of exports that form the public API of this module.
   * Nodulus validates that each name exists as a real export of index.ts.
   * Error EXPORT_MISMATCH if a name is missing.
   */
  exports?: string[];
  /** Description — for documentation and future tooling. */
  description?: string;
}

export interface ControllerOptions {
  /** Middlewares applied to all routes. Mounted before the router. Default: []. */
  middlewares?: RequestHandler[];
  /** If false, createApp() ignores this controller entirely. Default: true. */
  enabled?: boolean;
}

export interface ServiceOptions {
  /** The module this service belongs to. If omitted, inferred from the file's parent folder name. */
  module?: string;
  /** Description — for documentation and future tooling. */
  description?: string;
}

export interface RepositoryOptions {
  /** The module this repository belongs to. If omitted, inferred from the file's parent folder name. */
  module?: string;
  /** Description — for documentation and future tooling. */
  description?: string;
  /** Data source type this repository talks to. */
  source?: 'database' | 'api' | 'cache' | 'file' | string;
}

/** Internal registry entry for a registered service. */
export interface ServiceEntry {
  name: string;
  path: string;
  type: 'service';
  module: string;
  description?: string;
}

/** Internal registry entry for a registered repository. */
export interface RepositoryEntry {
  name: string;
  path: string;
  type: 'repository';
  module: string;
  description?: string;
  source?: string;
}

export interface SchemaOptions {
  /** The module this schema belongs to. If omitted, inferred from the file's parent folder name. */
  module?: string;
  /** Description — for documentation and future tooling. */
  description?: string;
  /** Validation library used to define this schema. */
  library?: 'zod' | 'joi' | 'yup' | 'ajv' | string;
}

/** Internal registry entry for a registered schema. */
export interface SchemaEntry {
  name: string;
  path: string;
  type: 'schema';
  module: string;
  description?: string;
  library?: string;
}

/** Discriminated union for all file-level identifier entries. */
export type FileEntry = ServiceEntry | RepositoryEntry | SchemaEntry;

export interface NitsConfig {
  /** 
   * Custom similarity threshold (0.0 to 1.0). 
   * If omitted, a dynamic threshold based on module size is used.
   */
  similarityThreshold?: number;
  /** Whether to enable NITS identity tracking. Default: true. */
  enabled?: boolean;
}

export interface CreateAppOptions {
  /** Glob pointing to module folders. Default: 'src/modules/*'. */
  modules?: string;
  /** Glob pointing to domain folders (v2.0.0+). Default: undefined. */
  domains?: string;
  /** Glob pointing to shared global folders (v2.0.0+). Default: undefined. */
  shared?: string;
  /** Global route prefix. Example: '/api/v1'. Default: ''. */
  prefix?: string;
  /** 
   * Custom folder or file aliases beyond the auto-generated @modules/* entries.
   * 
   * - **File Aliases**: e.g., `"@db": "./src/db.ts"`. Resolves exactly to that file.
   * - **Directory Aliases**: e.g., `"@shared": "./src/shared"`. Resolves to the folder 
   *   and automatically supports subpaths (e.g., `@shared/utils` -> `./src/shared/utils`).
   * 
   * Default: {}. 
   */
  aliases?: Record<string, string>;
  /**
   * Enables circular dependency detection and undeclared import errors.
   * Default: true in development, false in production.
   */
  strict?: boolean;
  /**
   * If false, the runtime ESM alias hook is not activated.
   * Useful when the project resolves aliases via a bundler. Default: true.
   */
  resolveAliases?: boolean;
  /**
   * Custom log handler. Receives all Nodulus log events.
   * 
   * Default: prints [Nodulus] prefixed messages to stderr (warn/error)
   * and stdout (info). debug is suppressed unless NODE_DEBUG includes 'nodulus'.
   */
  logger?: LogHandler;
  /**
   * Minimum log level. Events below this level are not passed to the handler.
   * Default: 'info' (debug is off unless explicitly set).
   */
  logLevel?: LogLevel;
  /** NITS (Nodulus Integrated Tracking System) configuration. */
  nits?: NitsConfig;
  /**
   * When `true`, `createApp()` throws `PRELOADER_REQUIRED` if the runtime pre-loader
   * is not active (i.e., the process was not started with `--import ./.nodulus/preload.js`).
   *
   * Use this to enforce that top-level alias resolution is always available in
   * environments that require it (e.g. strict production deployments).
   *
   * @default false
   * @since v1.5.0
   */
  requirePreloader?: boolean;
}

/** Resolved configuration used internally (defaults applied). */
export interface ResolvedConfig {
  modules: string;
  domains?: string;
  shared?: string;
  prefix: string;
  aliases: Record<string, string>;
  strict: boolean;
  resolveAliases: boolean;
  logger: LogHandler;
  logLevel: LogLevel;
  nits: {
    enabled: boolean;
    similarityThreshold?: number;
  };
  requirePreloader: boolean;
}

/** A module as it appears in the NodularApp result after bootstrap. */
export interface RegisteredModule {
  id: string;
  name: string;
  path: string;         // absolute path to the module directory
  imports: string[];    // names of modules this module depends on
  exports: string[];    // declared and validated export names
  controllers: string[]; // names of mounted controllers
}

export interface MountedRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'USE';
  path: string;
  module: string;
  controller: string;
}

/** Stable registry interface — guaranteed across minor versions. */
export interface NodulusRegistry {
  hasModule(name: string): boolean;
  getModule(name: string): RegisteredModule | undefined;
  getAllModules(): RegisteredModule[];
  resolveAlias(alias: string): string | undefined;
  getAllAliases(): Record<string, string>;
}

/**
 * Advanced registry interface — exposes internal graph utilities.
 * @unstable May change between minor versions.
 */
export interface NodulusRegistryAdvanced extends NodulusRegistry {
  /** @unstable */
  getDependencyGraph(): Map<string, string[]>;
  /** @unstable */
  findCircularDependencies(): string[][];
}

/** Value returned by createApp() after a successful bootstrap. */
export interface NodulusApp {
  modules: RegisteredModule[];
  routes: MountedRoute[];
  registry: NodulusRegistry;
  /**
   * Runtime metadata about the Nodulus pre-loader.
   * Populated during Step 0 of the bootstrap pipeline.
   * @since v1.5.0
   */
  runtime: {
    /**
     * `true` when the process was started with `--import ./.nodulus/preload.js`,
     * meaning top-level alias resolution is available.
     */
    preloaderActive: boolean;
    /**
     * The version of `nodulus-core` that generated `.nodulus/preload.js`,
     * or `null` if the pre-loader is not active.
     */
    preloaderVersion: string | null;
    /**
     * Snapshot of all aliases that were active at bootstrap time.
     * Empty object when the pre-loader is not active.
     */
    aliasesAtBoot: Record<string, string>;
  };
}

/** Shape of nodulus.config.ts. Options passed directly to createApp() take priority. */
export type NodulusConfig = CreateAppOptions;

export interface GetAliasesOptions {
  /**
   * If false, only returns auto-generated @modules/* aliases.
   * Config-defined aliases (from nodulus.config.ts `aliases`) are excluded.
   * Default: true (returns all aliases).
   */
  includeFolders?: boolean;
  /**
   * If false, config-defined aliases are excluded.
   * Identical to `includeFolders` but with a more descriptive name.
   * If both are present, `includeConfigAliases` takes precedence.
   * Default: true.
   */
  includeConfigAliases?: boolean;
  /** If true, returns absolute paths. Default: false. */
  absolute?: boolean;
}

export interface WatcherOptions {
  /** Paths o globs a observar. Acepta string o array de strings. */
  paths: string | string[];
  /** Globs o funciones a ignorar. Por defecto ignora node_modules y .git */
  ignored?: string | string[] | ((path: string) => boolean);
  /** Debounce en ms antes de reiniciar. Default: 300 */
  debounceMs?: number;
  /** Callback a ejecutar cuando se detecta un cambio. Recibe el path del archivo modificado. */
  onRestart: (changedPath: string) => void | Promise<void>;
  /** Instancia del logger de Nodulus. */
  logger: import('../core/logger.js').Logger; // referencia al Logger interno existente
}
