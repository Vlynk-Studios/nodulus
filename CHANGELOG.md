# Nodulus — Suite Changelog

All notable changes to the **Nodulus suite** are documented here.
This file covers both [`@vlynk-studios/nodulus-core`](./packages/core) and [`@vlynk-studios/eslint-plugin-nodulus`](./packages/eslint-plugin-nodulus).
Both packages are versioned in lockstep and published independently to npm.

For full technical details, see the individual package changelogs:
→ [`packages/core/CHANGELOG.md`](./packages/core/CHANGELOG.md)
→ [`packages/eslint-plugin-nodulus/CHANGELOG.md`](./packages/eslint-plugin-nodulus/CHANGELOG.md)

---

## [1.5.5] — 2026-05-11

### nodulus-core
- **Shadow File (`.nodulus`)**: Introduced persistent module identity via a local `.nodulus` file in each module directory, ensuring stability across renames and moves.
- **NITS Resolution Overhaul**: Identity resolution now prioritizes the Shadow File ID, followed by path matching, and finally Jaccard similarity as a fallback.
- **CLI Improvements**: `create-module` now automatically generates the `.nodulus` shadow file. `nodulus check --verbose` shows the exact identity resolution method used for each module.

### eslint-plugin-nodulus
- Version synchronized with `nodulus-core@1.5.5`. No new rules or behavioral changes.

---

## [1.5.3] — 2026-05-09

### nodulus-core
- **Pino Logger Integration**: Internal integration with Pino as the high-performance logging engine.
- **Production JSON Logs**: Added support for structured JSON output (`NODE_ENV=production`) with automatic `Error` serialization (`meta.err`) for advanced observability.
- **Dynamic Formatting**: Added `NODULUS_LOG_FORMAT` environment variable (`pretty` | `json` | `auto`) and a `logFormat` option in `nodulus.config.ts`.
- **`useLogger()` Updates**: User-space loggers now spawn Pino child loggers containing a `service` context field in JSON outputs.
- **Semantic Levels adjustments**: Reduced console noise by downgrading `ESM alias hook skipped` to debug level, and upgrading `Mounted 0 route(s)` to warn level.

### eslint-plugin-nodulus
- Version synchronized with `nodulus-core@1.5.3`. No new rules or behavioral changes.

---

## [1.5.2] — 2026-05-08

### nodulus-core
- **`create-module` opt-in flags**: Default scaffolding now generates only `index.ts`. Use `--service`, `--routes`, `--repository`, `--schema`, or `--full` to add additional files explicitly. The old `--no-repository` / `--no-schema` flags have been removed.
- **`nodulus check` ENOENT fix**: Replaced the hardcoded `import.meta.url` depth with a multi-depth resolver (`resolveCorePkgVersion()`) that gracefully skips version checking when no matching `package.json` is found, eliminating the noisy ENOENT warning in monorepo setups.
- **NITS IDs hidden by default**: `nodulus check` no longer prints `[mod_...]` identifiers in its output unless `--verbose` is passed or an identity conflict (moved/candidate module) is detected.

### eslint-plugin-nodulus
- Version synchronized with `nodulus-core@1.5.2`. No new rules or behavioral changes.

---

## [1.5.1] — 2026-05-07

### nodulus-core
- **Regression test suite**: Added comprehensive integration tests (`scenarios.test.ts`) covering the full dependency validation pipeline and module bootstrapping, hardening the system against future regressions.
- **Faster module scanning**: Replaced per-module globs with a single consolidated root-level glob, significantly improving bootstrap performance in large projects.
- **Reliable import detection**: Fixed edge cases where undeclared cross-module imports were missed when module names shared a common prefix.

### eslint-plugin-nodulus
- Version synchronized with `nodulus-core@1.5.1`. No new rules or behavioral changes.

---

## [1.5.0] — 2026-05-01

> **Headline: Runtime Pre-loader.** ESM aliases are now available in top-level `import` statements of your entry file — not just inside dynamically-loaded modules.

### nodulus-core
- **Runtime pre-loader hook**: A new stateless ESM loader hook registered via `node:module`. Embeds your alias config at startup so top-level imports resolve correctly from the first line.
- **`nodulus sync-preload`**: New CLI command that generates `.nodulus/preload.js` — a static entry point that activates the hook. Idempotent and CI-safe.
- **`nodulus dev`**: Drop-in replacement for `node`/`tsx` during development. Auto-injects `--import ./.nodulus/preload.js` when the file is present. Supports `--watch` and `--runtime tsx`.
- **Graceful shutdown (`nodulus.listen()`)**: `createApp()` now returns a `listen(server)` method that registers `SIGINT`/`SIGTERM` handlers, closes the HTTP server cleanly, and runs an optional `onShutdown` callback — eliminating zombie processes and port-in-use errors on restart.
- **Canonical logging system**: Redesigned internal logger with fixed-width columns, metadata-driven context, and a new `useLogger(name)` public API for user-space logging that respects the `NODULUS_LOG_LEVEL` environment variable.
- **`nodulus dev --watch`**: File watching powered by chokidar v5 with configurable debounce.

**Migration (v1.4.0 → v1.5.0):** Fully backward-compatible. Opt into top-level alias resolution:
```bash
npx nodulus sync-preload   # generates .nodulus/preload.js
npx nodulus sync-tsconfig  # keep IDE paths in sync
```
Commit `.nodulus/preload.js` — CI/CD needs it present at runtime.

### eslint-plugin-nodulus
- Version synchronized with `nodulus-core@1.5.0`. No new rules or behavioral changes.

---

## [1.4.0] — 2026-04-23

> **Headline: NITS + Alias Robustness.** Modules now carry persistent identities that survive renames and refactors. Custom aliases are first-class citizens. This release is the direct prerequisite for v2.0.0.

### nodulus-core
- **Nodulus Integrated Tracking System (NITS)**: Each module is assigned a stable `mod_{hex}` ID persisted in `.nodulus/registry.json`. IDs survive git branch switches, file renames, and folder restructurings via a 3-step reconciler (path → AST hash → name).
- **Alias Robustness Engine (P1–P7)**: Complete overhaul of alias resolution. Directory aliases now auto-resolve subpaths, file-based aliases are fully supported, and `sync-tsconfig` generates dual mappings for accurate IDE IntelliSense.
- **Custom aliases as first-class citizens**: `createApp({ aliases: { "@shared": "./src/shared" } })` — directories, files, and wildcards all work predictably.
- **Bootstrap resilience**: NITS is integrated as a non-blocking audit layer. Corrupted registries emit warnings without disrupting app initialization.

### eslint-plugin-nodulus
- Version synchronized with `nodulus-core@1.4.0`. No new rules or behavioral changes.

---

## [1.3.1] — 2026-04-12

### nodulus-core
- Fixed NPM provenance publishing after a Sigstore tag re-spin.
- Dynamic `NitsRegistry.version` field tracking the expected registry format.
- Fixed empty path mappings in `tsconfig.json` alias generation.
- Express v5 forward-compatibility hardening.

### eslint-plugin-nodulus
- Fixed NPM provenance failure — added `repository` and `homepage` fields to `package.json`.
- `plugin.meta.version` is now read dynamically from `package.json`, preventing version desync.
- `no-undeclared-imports` now reads `tsconfig.json` path mappings to correctly resolve application module boundaries.
- AST parser robustness: switched from regex to native Acorn AST for `Module` import resolution.

---

## [1.3.0] — 2026-04-12

> **Headline: ESLint Plugin — Initial Public Release.** `@vlynk-studios/eslint-plugin-nodulus` is now available on npm as a companion to the core.

### nodulus-core
- NITS registry corruption warning: `loadNitsRegistry` now emits a descriptive warning and performs a soft reset on malformed registry files instead of crashing silently.
- NITS reconciler test coverage for identity-conflict healing (Step 2) and dynamic similarity-threshold matching.
- `@domain/*` cross-module import support in the alias resolver.

### eslint-plugin-nodulus ✨ Initial Release
- **`no-private-imports` rule**: Prevents modules from importing private internals from other modules, enforcing Nodulus architectural boundaries statically.
- **`no-undeclared-imports` rule**: Validates that all cross-module imports are explicitly declared in the consuming module's config, catching hidden coupling before it reaches CI.
- Acorn-based AST parser replacing regex for accurate identifier extraction — no false positives.
- `recommended` flat-config preset for zero-config adoption.
- `clearDomainCache()` / `clearSharedAllowedCache()` / `clearModuleImportsCache()` exported for clean test isolation.

---

## [1.2.6] — 2026-04-11

### nodulus-core
- Publish CI now validates that the workflow tag version exactly matches `package.json` before dispatching to npm.
- Coverage baseline: bootstrapped `@vitest/coverage-v8` with dynamic thresholds enforced in CI.
- `UNDECLARED_IMPORT` runtime guard: bootstrapping now correctly intercepts undeclared cross-module dependencies when `strict: true` is set.
- Fixed wildcard alias generation emitting `/*` incorrectly for single-file aliases.

---

## [1.2.5] — 2026-04-11

### nodulus-core
- **NITS preview**: First introduction of the Nodulus Integrated Tracking System — stable `mod_{hex}` IDs assigned to modules and persisted in `.nodulus/registry.json`.
- Configurable registry path via `nits.registryPath` in `nodulus.config.ts`.
- `ModuleRegistration` and `FeatureRegistration` types exported in the public API.
- ESM hook stability: singleton promise pattern prevents race conditions during concurrent alias resolver activations.
- Alias resolution consistency: `@modules/*` now resolves identically at runtime and in `tsconfig.json`.
- Express v5 alignment: `peerDependencies` updated to `express >= 5.0.0`.

---

## [1.2.0] — 2026-04-09

### nodulus-core
- **`nodulus check`**: Static analysis command powered by Acorn AST. Detects circular dependencies, deep private imports, and undeclared cross-module imports before the app loads.
- `--strict` mode: forces a non-zero process exit on any rule violation — CI-ready.
- `--format json`: machine-readable report output for integration with custom tooling.

---

## [1.1.0] — 2026-04-08

### nodulus-core
- Centralized `getCallerInfo` stack trace logic into `src/core/caller.ts`.
- Restricted public API surface: `loadConfig` and `DEFAULTS` are no longer exported.
- `nodulus --version` now reads the version dynamically from `package.json`.
- Fixed misleading `REGISTRY_MISSING_CONTEXT` errors on non-Express identifiers — now correctly throws `INVALID_MODULE_DECLARATION`.
- `sync-tsconfig` correctly removes stale alias entries on re-sync.
- `ERROR_MESSAGES` in `errors.ts` marked as deprecated — will be removed in v2.0.0.

---

## [1.0.0] — 2026-04-05

> **Headline: Initial Release.** Nodulus is a structural layer for Express that handles module discovery, route mounting, import aliases, and dependency validation at bootstrap time — with zero runtime overhead.

### nodulus-core ✨ Initial Release
- **`createApp()`**: Bootstrap pipeline with automatic module discovery, controller registration, performance metrics, and validation.
- **Identifiers**: `Module()`, `Controller()`, `Service()`, `Repository()`, `Schema()` — structural markers that define your domain architecture.
- **ESM Aliases**: `@modules/*` and custom folder aliases via Node.js Hooks API. No bundler required.
- **Strict Mode**: Detects circular dependencies and undeclared cross-module imports at startup.
- **`nodulus` CLI**: Ships with `create-module` (scaffold a new module) and `sync-tsconfig` (keep IDE aliases in sync).
- **Logging**: Color-coded structured output with injectable handlers.
- **Isolation**: Per-execution registry isolation via `AsyncLocalStorage`.
- ESM-only. Requires `"type": "module"` and Node.js ≥ 20.6.0.