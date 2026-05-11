# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.5] - 2026-05-11

### Changed
- **Version Parity**: Synchronized version with `@vlynk-studios/nodulus-core@1.5.5`. No new rules or behavioral changes.

## [1.5.3] - 2026-05-09

### Changed
- **Version Parity**: Synchronized version with `@vlynk-studios/nodulus-core@1.5.3`. No new rules or behavioral changes.

## [1.5.2] - 2026-05-08

### Changed
- **Version Parity**: Synchronized version with `@vlynk-studios/nodulus-core@1.5.2`. No new rules or behavioral changes.

## [1.5.1] - 2026-05-07

### Changed
- **Version Parity**: Synchronized version with `@vlynk-studios/nodulus-core@1.5.1`.

## [1.4.0] - 2026-04-16

### Changed
- **Version Parity**: Synchronized version with `@vlynk-studios/nodulus-core@1.4.0`.

## [1.3.1] - 2026-04-12

### Fixed
- **NPM Provenance Failure**: Added `repository` and `homepage` mappings to `package.json` to satisfy Sigstore supply chain verification.
- **Dynamic Meta Version** [A-01]: The `plugin.meta.version` is now read natively from `package.json` preventing version desync.
- **Parser Robustness** [A-02]: Cleaned up standard Module imports resolution to consume native Acorn AST instead of regular expressions.
- **Rule Domain Ignorance** [A-06]: `no-undeclared-imports` now reads `tsconfig.json` mappings to resolve explicitly typed application bounds.

## [1.3.0] - 2026-04-12

### Added
- **Initial Public Release**: First stable release of `@vlynk-studios/eslint-plugin-nodulus`, published in sync with `@vlynk-studios/nodulus-core@1.3.0`.
- **`no-private-imports` rule**: Enforces that modules do not import private internals from other modules, respecting Nodulus architectural boundaries.
- **`no-undeclared-imports` rule**: Validates that all cross-module imports are explicitly declared in the consuming module's `nodulus.config`, preventing hidden dependency coupling.
- **`src/index.ts` Entrypoint** [N-14]: Canonical plugin entrypoint that registers all rules and flat-config presets without depending on `@typescript-eslint/parser`. Exports a `recommended` config for zero-config adoption.
- **Build Pipeline** [N-15]: Ships a compiled `dist/` bundle via `tsup`, enabling consumption from both flat ESLint configs and CommonJS tooling chains.
- **`acorn`-based AST Parser** [N-16]: `getDomainSharedAllowed` and `extractIdentifierCall` use a proper `acorn` AST walk instead of regex, eliminating false positives when parsing TypeScript option objects.
- **Cache Invalidation API** [N-23]: Exports `clearDomainCache()`, `clearSharedAllowedCache()`, and `clearModuleImportsCache()` from the internal `module-resolver` to allow clean test isolation.
- **`@domain/*` Import Detection** [N-04]: `extractModuleImports` captures any `@`-scoped import path, filtering known third-party NPM scopes to avoid false positives.

### Changed
- **`extractIdentifierCall` Robustness** [N-26]: Spread elements and non-literal variable references inside import option arrays are now handled gracefully with a warning instead of crashing.

### Fixed
- **Graceful Option Parsing**: Non-literal array elements in rule options no longer cause unhandled exceptions in the rule visitor.
