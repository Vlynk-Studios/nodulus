# Security Policy

**Package:** `@vlynk-studios/nodulus-core`
**Current Version:** 1.4.0
**Maintained by:** Vlynk Studios & Keiver-dev
**Repository:** https://github.com/Vlynk-Studios/nodulus-core

---

## Supported Versions

Only the latest stable release receives security patches. Older minor versions are not actively maintained.

| Version | Supported          |
| ------- | ------------------ |
| 1.4.x   | ✅ Yes (current)   |
| 1.3.x   | ⚠️ Critical only   |
| < 1.3   | ❌ No              |

---

## Reporting a Vulnerability

If you discover a security vulnerability in `nodulus-core`, **do not open a public GitHub issue**. Instead, please report it responsibly through one of these channels:

- **GitHub Security Advisories:** Open a private advisory at `https://github.com/Vlynk-Studios/nodulus-core/security/advisories/new`
- **Email:** Contact the maintainers directly via the email listed in the repository profile.

Please include the following in your report:

- A clear description of the vulnerability and the affected component.
- Steps to reproduce or a minimal proof-of-concept.
- The potential impact and attack surface.
- The version(s) affected.

We aim to acknowledge all reports within **48 hours** and to provide a resolution timeline within **7 days** of acknowledgment.

---

## Security Architecture Overview

`nodulus-core` is a **build-time and bootstrap-time structural layer** for Express.js applications. It is not a web server, authentication provider, or network-facing service. Its attack surface is confined to:

- The developer's local filesystem during `createApp()` bootstrap.
- The `nodulus check` CLI command during CI/CD analysis.
- The NITS registry file (`.nodulus/registry.json`) written to and read from disk.
- Node.js ESM Hooks registered at runtime for alias resolution.

No user-supplied HTTP request data flows through this library at runtime.

---

## Security Properties by Component

### 1. ESM Alias Resolver (`src/aliases/resolver.ts`)

The alias resolver hooks into the Node.js module resolution pipeline via `node:module`'s `register()` API (requires Node.js ≥ 20.6.0).

**Protections in place:**

- All alias targets are **normalized to absolute paths** during registration, eliminating path-traversal risks from relative aliases containing `../` sequences.
- Alias registration is **content-addressable (idempotent)**: a SHA-based hash of the serialized alias map is stored in `registeredHashes`. Duplicate calls to `createApp()` with the same aliases do not re-register hooks, preventing race conditions in hot-reload scenarios.
- A **singleton promise pattern** (`_registrationPromise`) ensures that concurrent activations from asynchronous bootstrap paths converge safely.
- User-defined aliases always override auto-generated `@modules/*` aliases, providing a predictable priority order that prevents shadowing attacks within the local codebase.

**Known limitation:**

> This resolver is strictly for Node.js ESM pipelines. CJS environments and bundlers (Vite, esbuild) must use `getAliases()` to configure their own resolvers. Passing a CJS project will cause an early `INVALID_ESM_ENV` error before any alias logic executes.

---

### 2. Bootstrap Pipeline (`src/bootstrap/createApp.ts`)

`createApp()` is the main entry point. It orchestrates configuration loading, module discovery, NITS reconciliation, and Express router mounting.

**Protections in place:**

- **Duplicate bootstrap guard:** The function checks for a `__nodulusBootstrapped` flag on the Express `app` object before proceeding. A second call with the same instance throws `DUPLICATE_BOOTSTRAP` immediately, preventing double-registration of routes or state corruption.
- **ESM environment validation:** The function reads `package.json` to verify `"type": "module"` is present before any module loading occurs. Non-ESM projects fail fast with `INVALID_ESM_ENV`.
- **Strict mode:** When `strict: true` (default in non-production environments), undeclared cross-module imports detected at runtime cause an immediate `UNDECLARED_IMPORT` error, enforcing explicit dependency declaration.
- **NITS as an audit-only layer:** NITS I/O errors (disk failures, corrupted registry) are caught and surfaced as `console.warn` messages. They never abort the Express bootstrap, preventing a corrupted registry file from taking down the application server.
- **No user-controlled input:** `createApp()` reads only from `nodulus.config.ts/js` and the local filesystem. No data from HTTP requests or external network sources is processed.

---

### 3. NITS Registry (`src/nits/nits-store.ts`)

The NITS (Nodulus Integrated Tracking System) assigns stable `mod_{hex8}` identities to modules and persists them to `.nodulus/registry.json`.

**Protections in place:**

- **Strict schema validation on load:** `loadNitsRegistry()` rejects any registry file that does not conform to the expected schema. All seven required fields (`name`, `path`, `hash`, `status`, `createdAt`, `lastSeen`, `identifiers`) are validated per module record. A single malformed record causes the entire registry to be discarded and re-initialized (not partially applied), eliminating partial-corruption scenarios.
- **Module ID format validation:** All keys are validated against the `/^mod_[0-9a-f]{8}$/` regex via `isValidModuleId()`. Records with keys that do not match this format are rejected. This prevents injection of arbitrary strings as module identifiers.
- **Version mismatch warning:** If the registry `version` field does not match `NITS_REGISTRY_VERSION`, a warning is emitted. The registry is still loaded (non-breaking), but operators are notified of the schema drift.
- **Atomic writes:** `saveNitsRegistry()` uses a write-then-rename strategy (`registry.json.tmp` → `registry.json`). This ensures the registry is never left in a partially written state even if the process is killed mid-write.
- **Immutable `createdAt` timestamps:** The `createdAt` field is set once on module creation and never overwritten by the reconciler, providing a tamper-evident creation timestamp for each module identity.
- **Clone before save:** The registry object is cloned before being written to disk to prevent accidental mutation of the in-memory object after the save call returns.

**File should be committed to Git:**

> The `_note` field in the registry file explicitly instructs teams to include `.nodulus/registry.json` in version control. Omitting it from Git would cause all module IDs to be regenerated on every fresh clone, defeating the purpose of stable identity tracking.

---

### 4. CLI Analyzer (`src/cli/commands/check.ts`)

The `nodulus check` command performs static AST analysis of the project's source files to detect architectural violations.

**Protections in place:**

- **AST-based analysis only:** The CLI uses `acorn` for parsing. It reads source files from the local filesystem and does not execute them. No `eval()` or dynamic code execution occurs during analysis.
- **Transient file-lock resilience:** File-locking incidents encountered during batch analysis (e.g., from concurrent editors or other processes) are handled gracefully. The pipeline emits a warning and continues rather than crashing (`CLI_ERROR` is caught and reported cleanly).
- **Graph ID mapping fix:** A legacy bug (N-34) where the CLI improperly looked up module IDs by name instead of NITS ID has been fixed in v1.4.0, eliminating a class of identity mapping failures that could cause incorrect violation attribution.
- **`--strict` mode for CI:** When `--strict` is passed, the command exits with code `1` on any violation, enabling hard-gate CI/CD pipelines.
- **`--format json`:** Machine-readable output avoids log injection risks from unescaped module names in terminal output.

---

### 5. Configuration Loading (`src/core/config.ts`)

**Protections in place:**

- Configuration files (`nodulus.config.ts` / `nodulus.config.js`) are loaded from the **current working directory only**. There is no mechanism to load configuration from a remote URL or an arbitrary filesystem path.
- If a `.ts` config file is found in an environment that cannot transpile TypeScript (e.g., production without a loader), the error message explicitly instructs the operator to use a compiled `.js` config or run with `tsx`/`ts-node`. This prevents silent misconfiguration.
- The merge strategy (`options > fileConfig > defaults`) ensures that programmatic options passed to `createApp()` always take precedence over file-based configuration, preventing a malicious config file from overriding a security-sensitive programmatic setting.

---

### 6. Registry Isolation (`src/core/registry.ts`)

- The in-memory module registry is scoped to each `createApp()` call via `AsyncLocalStorage`. This ensures complete isolation between concurrent requests or test runs sharing the same Node.js process.
- **Duplicate name detection:** `registerModule()` validates for name uniqueness *before* mutating internal maps (fixed in v1.4.0 via REGLA-14). A duplicate module name throws `DUPLICATE_MODULE` before any state is written, preventing silent registry overwrites.
- **Internal API surface:** The `InternalRegistry` interface (with mutators like `clearRegistry()`) is explicitly marked `@internal` and not exported from the public `src/index.ts` surface.

---

## Known Security Considerations and Limitations

### Alias Path Injection via `nodulus.config`

Since Nodulus loads `nodulus.config.ts/js` as a native ESM module, a **malicious config file** could theoretically execute arbitrary code during `createApp()`. This is an accepted risk inherent to all config-as-code patterns (similar to `vite.config.ts`, `webpack.config.js`, etc.). Mitigation lies outside the library scope: treat your project's config files as trusted code and review them like any other source file.

### Registry File Tampering

The `.nodulus/registry.json` file is validated on load but is not cryptographically signed. A developer with write access to the repository could manually forge module IDs or timestamps. This is mitigated by the strict `isValidRegistry` and `isValidModuleId` checks, which will reject obviously malformed records, but a carefully crafted valid-looking forgery could be accepted. This is considered acceptable for a developer-tooling package.

### `Controller` Excluded from Semantic Hashing (BUG-1, fixed in v1.4.0)

Prior to v1.4.0, the `Controller` identifier was included in the NITS semantic hash, causing HTTP route paths (e.g., `"/users"`) to be stored as module identifiers. This produced Jaccard = 1.0 false positives between unrelated modules sharing route prefixes, potentially causing NITS to assign the wrong stable ID to a module after a rename. **Fixed in v1.4.0** by removing `Controller` from `targetCallees`; only `Service`, `Repository`, and `Schema` are now semantic identity carriers.

### Node.js Minimum Version

Nodulus requires **Node.js ≥ 20.6.0** for the `--import` flag and native ESM Hooks API (`node:module` `register()`). Running on older Node.js versions will fail at the ESM environment validation step. Ensure your deployment infrastructure and CI pipeline enforce this minimum.

### ESM-Only

Nodulus dropped CommonJS support in v1.0.0. Projects attempting to use Nodulus in a CJS context will receive an `INVALID_ESM_ENV` error immediately. There is no CJS compatibility shim, and none is planned.

---

## Dependency Security

| Dependency    | Version  | Role                                      |
| ------------- | -------- | ----------------------------------------- |
| `commander`   | 14.0.3   | CLI argument parsing                      |
| `fast-glob`   | 3.3.3    | Module directory discovery (glob)         |
| `picocolors`  | 1.1.1    | Terminal color output (logging)           |
| `comment-json`| 4.6.2    | Preserves comments in `tsconfig.json`     |
| `acorn`       | 8.16.0   | AST parser for `nodulus check` (dev/peer) |

All production dependencies are minimal and widely audited. Run `npm audit` regularly to detect upstream vulnerabilities.

**Peer dependency:** `express >= 5.0.0` — Nodulus does not bundle Express and defers all HTTP handling to the host application.

---

## Security-Relevant Changelog Highlights

| Version | Change |
| ------- | ------ |
| **1.4.0** | BUG-1: Removed `Controller` from NITS hash targets (false-positive identity matches). |
| **1.4.0** | BUG-2: Fixed invalid `mod_users_legacy` ID in test fixture bypassing `isValidModuleId`. |
| **1.4.0** | BUG-3: Fixed missing `hash`/`createdAt` fields causing `undefined` keys in `activeHashes` map. |
| **1.4.0** | CODE-2: `isValidRegistry` now validates all 7 required fields per module record. |
| **1.4.0** | REGLA-14: `registerModule` now checks name uniqueness before mutating state. |
| **1.4.0** | REGLA-31: Reconciler now uses `normalizePath` for consistent cross-platform path comparison. |
| **1.4.0** | N-48: Fixed `candidate` records persisting in identity limbo (orphaned registry entries). |
| **1.4.0** | N-46: CLI `nodulus check` no longer crashes on transient file-locking incidents. |
| **1.3.0** | N-25: `loadNitsRegistry` now emits the underlying parse error before soft-resetting a corrupted registry. |
| **1.2.6** | `ALIAS_NOT_FOUND` now fails fast on nonexistent alias targets at bootstrap. |
| **1.2.6** | `UNDECLARED_IMPORT` correctly enforced in strict mode, harmonizing runtime and CLI guarantees. |
| **1.2.5** | Atomic write strategy introduced for `saveNitsRegistry`. |
| **1.2.5** | ESM Hook singleton promise prevents race conditions during concurrent activations. |
| **1.0.0** | Fixed race conditions and duplicate registration errors in hot-reload scenarios. |

---

## Responsible Disclosure Timeline

We follow a **90-day responsible disclosure policy**. If a reported vulnerability is not resolved within 90 days of the initial report, the reporter is free to disclose it publicly. We will always credit researchers who report issues responsibly unless they prefer to remain anonymous.

---

*Last updated: 2026-04-23 — nodulus-core v1.4.0*