# Nodulus

[![npm version](https://img.shields.io/npm/v/@vlynk-studios/nodulus-core.svg)](https://www.npmjs.com/package/@vlynk-studios/nodulus-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.6-brightgreen)](https://nodejs.org/)

A lightweight structural layer for Express. Nodulus lets you organise your Node.js application into self-contained modules — handling discovery, route mounting, import aliases, and dependency validation at bootstrap time, with zero overhead at runtime.

> **Node.js ≥ 20.6** · **Express 5.x** · **ESM Only** · **TypeScript included**

---

## Why Nodulus?

Express is minimal by design. Nodulus keeps it that way while adding just enough structure to scale:

- **Module discovery** — point it at a glob `src/modules/*` and it finds, validates, and loads every module automatically.
- **Route mounting** — controllers declare their prefix; `createApp()` wires them to Express via `app.use()`.
- **Import aliases** — `@modules/users`, `@config/database` — no more `../../..` paths.
- **Dependency validation** — declare what your module imports and exports; Nodulus catches mismatches before a single request is handled.
- **No magic at runtime** — after bootstrap, Nodulus is out of the way. Express handles requests exactly as normal.

---

## Packages

Nodulus ships as two focused packages from the same repository:

| Package | Description | npm |
|---|---|---|
| `@vlynk-studios/nodulus-core` | Core framework — module discovery, routing, aliases, validation | [![npm](https://img.shields.io/npm/v/@vlynk-studios/nodulus-core.svg)](https://www.npmjs.com/package/@vlynk-studios/nodulus-core) |
| `@vlynk-studios/eslint-plugin-nodulus` | ESLint plugin — static enforcement of Nodulus module boundaries in your editor and CI | [![npm](https://img.shields.io/npm/v/@vlynk-studios/eslint-plugin-nodulus.svg)](https://www.npmjs.com/package/@vlynk-studios/eslint-plugin-nodulus) |

Both packages are independent installs — use one or both depending on your setup. The ESLint plugin is a companion, not a dependency of the core.

---

## Installation

```bash
npm install @vlynk-studios/nodulus-core
```

Express 5 is a peer dependency:

```bash
npm install express
```

---

## Getting Started with the Pre-loader _(v1.5.0+)_

By default, the Node.js ESM hook activates **inside** `createApp()`. This means aliases like `@config/database` are **not** available in static top-level imports in your server entry file:

```ts
// ❌ This fails if the pre-loader is not active
import { db } from '@config/database.js'  // MODULE_NOT_FOUND

const app = express()
await createApp(app)
```

The **runtime pre-loader** solves this by registering the ESM hook before your code runs.

### Setup (one-time)

**1. Generate the pre-loader file:**
```bash
npx nodulus sync-preload
```

This creates `.nodulus/preload.js` — commit it to version control.

**2. Update your `package.json` scripts:**
```json
{
  "scripts": {
    "dev":   "nodulus dev src/server.ts",
    "start": "node --import ./.nodulus/preload.js src/server.ts"
  }
}
```

**3. Aliases now work everywhere:**
```ts
// ✅ Works with the pre-loader active
import { db } from '@config/database.js'
import { UserService } from '@modules/users'

const app = express()
const { runtime } = await createApp(app)
console.log(runtime.preloaderActive) // true
```

**Re-run `sync-preload` whenever you add or rename aliases.** The command is idempotent — if nothing changed, the file is not rewritten.

> [!NOTE]
> **Backward compatible.** Without the pre-loader, aliases still work inside modules discovered by `createApp()`. Only top-level imports in your entry file require the pre-loader.

---

## Quick start

```ts
// src/app.ts
import express from 'express'
import { createApp } from '@vlynk-studios/nodulus-core'

const app = express()
app.use(express.json())

const { routes } = await createApp(app, {
  modules: 'src/modules/*',
  prefix: '/api/v1',
  aliases: {
    '@config':     './src/config',
    '@middleware': './src/middleware',
    '@shared':     './src/shared',
  },
  strict: process.env.NODE_ENV !== 'production',
  logger: (level, msg) => console[level](`[nodulus] ${msg}`),
})

app.use(errorHandler) // error middleware always last

console.log(`Mounted routes: ${routes.length}`)
export default app
```

> **Note:** Alias resolution runs through the Node.js ESM Hooks API, which activates inside `createApp()` at bootstrap time. Aliases are available to any file that Nodulus imports dynamically during bootstrap (your modules). They are **not** available to static imports in your entry point file (`app.ts`, `server.ts`) before `createApp()` is called. For bundler-based setups, see [Alias resolution with bundlers](#alias-resolution-with-bundlers).

---

## Project structure

Nodulus expects modules in a consistent layout:

```
src/
├── modules/
│   └── users/
│       ├── index.ts            ← required — calls Module('users', ...)
│       ├── users.routes.ts     ← controller (discovered automatically)
│       ├── users.service.ts    ← private business logic
│       └── users.types.ts      ← excluded from controller scan
└── app.ts
```

---

## API

### `createApp(app, options?)`

Bootstraps the entire application. Runs module discovery, alias resolution, controller mounting, and validation in a deterministic sequence. Throws a `NodulusError` before mounting any routes if anything is invalid — the app is never left in a partial state.

```ts
createApp(app: Application, options?: CreateAppOptions): Promise<NodulusApp>
```

| Option | Type | Default | Description |
|---|---|---|---|
| `modules` | `string` | `'src/modules/*'` | Glob pointing to module folders |
| `domains` | `string` | `undefined` | _(v2.0.0+, not yet active)_ Glob pointing to domain folders |
| `shared` | `string` | `undefined` | _(v2.0.0+, not yet active)_ Glob pointing to shared global folders |
| `prefix` | `string` | `''` | Global route prefix (e.g. `'/api/v1'`) |
| `aliases` | `Record<string, string>` | `{}` | Folder or file aliases beyond the auto-generated `@modules/*` |
| `strict` | `boolean` | `true` in dev | Enables circular-dependency detection and undeclared-import errors |
| `resolveAliases` | `boolean` | `true` | Disable if you resolve aliases with a bundler |
| `logger` | `LogHandler` | built-in | Custom log handler (supports Pino, Winston, etc.) |
| `logLevel` | `LogLevel` | `'info'` | Minimum severity for log events |
| `nits` | `NitsConfig` | `{ enabled: true }` | NITS identity tracking configuration |
| `requirePreloader` | `boolean` | `false` | _(v1.5.0+)_ If `true`, `createApp()` throws `PRELOADER_REQUIRED` when the runtime pre-loader is not active |

**`NitsConfig`:**

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Whether to run NITS identity tracking at bootstrap |
| `similarityThreshold` | `number` | dynamic | Jaccard similarity threshold (0.0–1.0) for module movement detection. If omitted, a dynamic value based on module size is used |

Returns `NodulusApp`:

```ts
interface NodulusApp {
  modules:  RegisteredModule[]
  routes:   MountedRoute[]
  registry: NodulusRegistry
  runtime: {                       // v1.5.0+
    preloaderActive:  boolean      // true when --import .nodulus/preload.js is active
    preloaderVersion: string | null
    aliasesAtBoot:    Record<string, string>
  }
}
```

---

### `Module(name, options?)`

Declares a module and registers its metadata in the registry. **Must** be called from the module's `index.ts` (or `index.js`), and the `name` **must match the containing folder name exactly** — Nodulus enforces this as a structural rule.

```ts
// src/modules/orders/index.ts
import { Module } from '@vlynk-studios/nodulus-core'

Module('orders', {
  description: 'Purchase order management',
  imports: ['users', 'payments'],
  exports: ['OrderService', 'createOrderSchema'],
})

export { OrderService }       from './orders.service.js'
export { createOrderSchema }  from './orders.schema.js'
```

| Option | Type | Description |
|---|---|---|
| `imports` | `string[]` | Modules this module depends on |
| `exports` | `string[]` | Public API names — validated against real exports at bootstrap |
| `description` | `string` | Documentation / future tooling |

> **Rule**: The name passed to `Module()` must equal the directory name. `Module('orders')` inside `src/modules/billing/` will throw `INVALID_MODULE_DECLARATION`.

---

### `Controller(prefix, options?)`

Declares a file as an Express controller. The controller name is derived automatically from the filename. The file **must** have a `default export` of an Express `Router`.

```ts
// src/modules/users/users.routes.ts
import { Controller } from '@vlynk-studios/nodulus-core'
import { Router } from 'express'
import { requireAuth } from '@middleware/auth.js'
import { UserService } from './users.service.js'

Controller('/users', {
  middlewares: [requireAuth],
})

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    res.json(await UserService.findAll())
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await UserService.create(req.body))
  } catch (err) {
    next(err)
  }
})

export default router
```

| Parameter | Type | Description |
|---|---|---|
| `prefix` | `string` | Route prefix for this controller (e.g. `'/users'`) |
| `options.middlewares` | `RequestHandler[]` | Middlewares applied to all routes in this controller. Default: `[]` |
| `options.enabled` | `boolean` | If `false`, `createApp()` ignores this controller entirely. Default: `true` |

Nodulus mounts each controller as:

```ts
app.use(globalPrefix + controllerPrefix, ...middlewares, router)
```

---

### Domain Identifiers

Label your business logic with domain identifiers to register them in the Nodulus registry for tracing, tooling, and future framework features. Identifiers are **entirely optional** — a module with no identifiers is completely valid.

```ts
import { Service, Repository, Schema } from '@vlynk-studios/nodulus-core'
import { z } from 'zod'

Service('UserService')
Repository('UserRepository', { source: 'database' })
Schema('UserSchema', { library: 'zod' })
```

Each identifier accepts an optional options object:

**`Service(name, options?)`**

| Option | Type | Description |
|---|---|---|
| `module` | `string` | Module this service belongs to. Inferred from parent folder if omitted |
| `description` | `string` | Documentation |

**`Repository(name, options?)`**

| Option | Type | Description |
|---|---|---|
| `module` | `string` | Module this repository belongs to. Inferred from parent folder if omitted |
| `description` | `string` | Documentation |
| `source` | `'database' \| 'api' \| 'cache' \| 'file' \| string` | Data source type |

**`Schema(name, options?)`**

| Option | Type | Description |
|---|---|---|
| `module` | `string` | Module this schema belongs to. Inferred from parent folder if omitted |
| `description` | `string` | Documentation |
| `library` | `'zod' \| 'joi' \| 'yup' \| 'ajv' \| string` | Validation library used |

Unlike `Controller` or `Module`, these identifiers do not alter runtime execution — they simply register presence and ownership into the `NodulusRegistry`, which is accessible after bootstrap via `result.registry`.

> **Note:** Nodulus is validation-agnostic. While examples use Zod, you can use Joi, TypeBox, or any other library.

---

### Import aliases

Nodulus registers two kinds of aliases:

- **Module aliases** — auto-generated for every discovered module:
  ```
  @modules/<name> → src/modules/<name>/index.ts
  ```
- **Folder or file aliases** — configured in `createApp()` or `nodulus.config.ts`:
  ```
  @config     → src/config/          (directory — supports subpaths automatically)
  @db         → src/config/db.ts     (file — resolves exactly to that file)
  ```

Use them anywhere inside your modules:

```ts
import { UserService } from '@modules/users'
import { db }          from '@config/database.js'
```

> [!IMPORTANT]
> Nodulus is an **ESM-only** framework. It requires `"type": "module"` in your `package.json`.
> Runtime alias resolution uses the Node.js ESM Hooks API and activates inside `createApp()`. Aliases are **not** available in your entry point before `createApp()` is called.

#### Alias resolution with bundlers

For bundler-based projects (Vite, esbuild, etc.), you can disable the runtime hook and inject `getAliases()` directly into your config:

```ts
// vite.config.ts
import { getAliases } from '@vlynk-studios/nodulus-core'

const aliases = await getAliases()

export default {
  resolve: { alias: aliases }
}
```

```ts
// esbuild.config.ts
import { getAliases } from '@vlynk-studios/nodulus-core'
import * as esbuild from 'esbuild'

const aliases = await getAliases()

await esbuild.build({
  entryPoints: ['src/index.ts'],
  alias: aliases,
  bundle: true,
  outfile: 'dist/app.js'
})
```

`getAliases()` accepts a `GetAliasesOptions` object:

| Option | Type | Default | Description |
|---|---|---|---|
| `includeFolders` | `boolean` | `true` | If `false`, config-defined folder aliases are excluded (returns only `@modules/*` aliases) |
| `includeConfigAliases` | `boolean` | `true` | Same as `includeFolders`, takes precedence when both are present |
| `absolute` | `boolean` | `false` | If `true`, returned paths are absolute |

---

### `nodulus.config.ts`

Centralise configuration in the project root. Options passed directly to `createApp()` take priority over the file.

```ts
// nodulus.config.ts
import type { NodulusConfig } from '@vlynk-studios/nodulus-core'

const config: NodulusConfig = {
  modules: 'src/modules/*',
  prefix: '/api/v1',
  strict: process.env.NODE_ENV !== 'production',
  aliases: {
    '@config':     './src/config',
    '@middleware': './src/middleware',
    '@shared':     './src/shared',
  },
  nits: {
    enabled: true,
    similarityThreshold: 0.85  // optional — defaults to dynamic
  }
}

export default config
```

Config file loading order (first match wins):

1. `nodulus.config.ts` — development only (requires a TypeScript loader such as `tsx`)
2. `nodulus.config.js` — always

> **Note:** `nodulus.config.ts` cannot be loaded in production unless your build step compiles it to `.js`. Use `nodulus.config.js` for production deployments, or build it as part of your pipeline.

---

## CLI Tools

Nodulus provides a built-in CLI to enforce conventions and improve developer experience.

### `nodulus create-module <name>`

Scaffolds a perfectly structured module conforming to the framework constraints.

```bash
npx nodulus create-module payments
```

```text
✔ Module 'payments' created successfully at src/modules/payments/
  index.ts
  payments.routes.ts
  payments.service.ts
  payments.repository.ts
  payments.schema.ts
```

| Option | Description |
|---|---|
| `--path <path>` | Sets a custom absolute or relative destination |
| `--no-repository` | Omits the repository file |
| `--no-schema` | Omits the schema file |
| `--ts` | Force TypeScript output (`.ts` files) |
| `--js` | Force JavaScript output (`.js` files) |

> Language is auto-detected from the presence of `tsconfig.json` in the project root when neither `--ts` nor `--js` is specified.

---

### `nodulus sync-tsconfig`

Syncs Nodulus aliases into `tsconfig.json` paths so IDEs and TypeScript recognise `@modules/*` and any folder aliases you've configured.

```bash
npx nodulus sync-tsconfig
```

```text
✔ tsconfig.json updated — 3 module(s), 2 folder alias(es)
Added paths:
  @modules/users      → ./src/modules/users/index.ts
  @modules/auth       → ./src/modules/auth/index.ts
  @config/*           → ./src/config/*
```

Run this command initially, and whenever you create, rename, or drop modules. It behaves idempotently and automatically purges references to modules that no longer exist.

| Option | Description |
|---|---|
| `--tsconfig <path>` | Path to `tsconfig.json`. Default: `tsconfig.json` in the project root |

---

### `nodulus sync-preload` _(v1.5.0+)_

Generates `.nodulus/preload.js` — a static ESM entry point that registers the alias resolution hook **before** your application code runs. This enables aliases in top-level imports of your server entry file.

```bash
npx nodulus sync-preload
```

```text
✔ Pre-loader sync complete.

To use the pre-loader, update your package.json scripts:
  "dev":   "nodulus dev src/server.ts"
  "start": "node --import ./.nodulus/preload.js src/server.ts"
```

The generated file embeds your current alias config and is **idempotent** — running it again with the same config produces no changes. Re-run it whenever you add or rename aliases.

> [!IMPORTANT]
> **Commit `.nodulus/preload.js` to version control.** CI/CD and production environments rely on it being present without needing to run `sync-preload` at deploy time. It is safe to commit — it contains only resolved paths and no secrets.

---

### `nodulus dev` _(v1.5.0+)_

Starts your application in development mode. Automatically injects `--import ./.nodulus/preload.js` if the file exists, ensuring aliases are available before any module loads.

```bash
npx nodulus dev <entrypoint> [--watch] [--runtime <node|tsx>]
```

| Option | Description |
|---|---|
| `--watch` | Run in watch mode using Chokidar (restarts on file changes) |
| `--runtime tsx` | Uses `tsx` instead of `node` for TypeScript without a build step |

If `.nodulus/preload.js` does not exist, `nodulus dev` falls back to legacy mode (v1.4.0 behaviour) with a warning.

---

### `nodulus check`

Performs static architecture analysis by inspecting raw ASTs across your module structure without evaluating your application code.

```bash
npx nodulus check
```

```text
Nodulus Architecture Analysis

✔ orders — OK
✗ payments — 2 problem(s)
  WARN  Private import detected: module "payments" directly imports internal path from "@modules/users/users.repository.js". (payments.service.ts:3)
       Suggestion: Import only the public index: "@modules/users".
✔ users — OK

2 problem(s) found.
```

| Option | Description |
|---|---|
| `--strict` | Exit with code 1 if any violation is found. Ideal for CI gates |
| `--module <name>` | Narrow the analysis to a specific module |
| `--format <json\|text>` | Output format. Use `json` for external pipeline consumption |
| `--no-circular` | Disables cycle detection (`A → B → A`) |

---

## ESLint Plugin

> **Available from v1.3.0** · Package: `@vlynk-studios/eslint-plugin-nodulus`

`nodulus check` validates your architecture on demand or in CI. `@vlynk-studios/eslint-plugin-nodulus` brings the same rules into your editor — so you catch boundary violations the moment you write the import.

```bash
npm install --save-dev @vlynk-studios/eslint-plugin-nodulus
```

### Setup

```js
// eslint.config.js
import nodulus from '@vlynk-studios/eslint-plugin-nodulus'

export default [nodulus.configs.recommended]
```

To configure rules individually:

```js
// eslint.config.js
import nodulus from '@vlynk-studios/eslint-plugin-nodulus'

export default [
  {
    plugins: { nodulus },
    rules: {
      'nodulus/no-private-imports':    'error',
      'nodulus/no-undeclared-imports': 'warn',
    }
  }
]
```

### Rules

| Rule | Severity (recommended) | Description |
|---|---|---|
| `nodulus/no-private-imports` | `error` | Prevents importing internal files from another module directly. Only the public index (`@modules/<name>`) is a valid cross-module import target |
| `nodulus/no-undeclared-imports` | `warn` | Flags cross-module imports from modules not listed in the consuming module's `imports` array |

#### `nodulus/no-private-imports`

```ts
// ✗ error — accessing a private file directly
import { UserRepository } from '@modules/users/users.repository.js'

// ✓ correct — importing through the public index
import { UserService } from '@modules/users'
```

#### `nodulus/no-undeclared-imports`

```ts
// src/modules/orders/index.ts
Module('orders', {
  imports: ['users'],   // 'payments' is not declared
})

// src/modules/orders/orders.service.ts
import { PaymentService } from '@modules/payments'  // ✗ warn — undeclared import
import { UserService }    from '@modules/users'      // ✓ correct
```

### Relationship to `nodulus check`

| | `nodulus check` | `eslint-plugin-nodulus` |
|---|---|---|
| When it runs | On demand / CI step | On save / pre-commit / CI lint step |
| How it works | Full AST analysis across the whole project | Per-file ESLint rule evaluation |
| Circular dependency detection | ✓ | — |
| Editor integration (inline errors) | — | ✓ |
| CI gate | `--strict` flag | `--max-warnings` flag |

---

## NITS Identity Tracking

Nodulus 1.2.5+ includes **NITS (Nodulus Integrated Tracking System)**, which assigns a stable, unique `mod_{hex}` ID to every module. This allows the framework to track modules across renames, moves, and git branch switches — preventing identity loss during refactors.

NITS maintains a state file at `.nodulus/registry.json` in your project root. **This file should be committed to version control.**

### How NITS assigns identities

NITS uses a three-step Verification Triangle algorithm:

1. **Match by path** (maximum confidence) — same directory = same module.
2. **Match by semantic hash** (high confidence, similarity ≥ 0.9) — same `Service`, `Repository`, and `Schema` names across locations = moved module.
3. **Match by name** (medium confidence) — a previously `stale` module with the same name found at a new location = candidate for manual review.

### Resolving merge conflicts

Because `registry.json` tracks project-level state, parallel branches may occasionally produce Git merge conflicts. To resolve them:

1. Accept either side of the conflict to make the JSON valid again.
2. Run `npx nodulus check`.
3. NITS will automatically detect and heal the registry.
4. Commit the updated `.nodulus/registry.json`.

---

## Logging

Nodulus emits structured, color-coded log events throughout the bootstrap pipeline.

### Default behavior

| Environment | Default level | Output |
|---|---|---|
| Development | `info` | Modules loading, routes mounting, startup duration |
| Any | `warn` / `error` | Written to `stderr`; everything else to `stdout` |
| Debug | `debug` | Set `logLevel: 'debug'` in options, or use `NODULUS_LOG_LEVEL=debug` or `NODE_DEBUG=nodulus` |

### Semantic levels

| Level | When Nodulus uses it |
|---|---|
| `debug` | Internal bootstrap state, paths resolved, files scanned |
| `info` | Module loaded, route mounted, bootstrap complete |
| `warn` | Undeclared import (non-strict), unused import (non-strict), NITS fallback warning |
| `error` | Never — Nodulus uses `throw NodulusError` instead |

### Using a custom logger (Pino)

```ts
import pino from 'pino'
const log = pino()

await createApp(app, {
  logger: (level, message, meta) => {
    log[level]({ ...meta, framework: 'nodulus' }, message)
  }
})
```

### Total silence

```ts
await createApp(app, {
  logger: () => {}
})
```

### Using the Nodulus Logger in your app (v1.5.0+)

You can use the same visual style for your own application logs by using `useLogger`. This creates a logger instance that respects your global log level settings and provides aligned, color-coded output.

```ts
import { useLogger } from '@vlynk-studios/nodulus-core'

const log = useLogger('my-app')

log.info('Application started')
// Output: [my-app]  info   Application started
```

### User-space logs

Nodulus **does not** intercept or wrap standard `console.log` calls from your application code.
Messages like `Mounted N route(s)` or `Server running on http://localhost:3000` generated in your `app.ts` or `server.ts` are entirely your responsibility and will output normally without the `[Nodulus]` prefix.

---

## Error handling

All Nodulus errors are instances of `NodulusError` with a machine-readable `code`:

```ts
import { NodulusError } from '@vlynk-studios/nodulus-core'

try {
  await createApp(app, { modules: 'src/modules/*' })
} catch (err) {
  if (err instanceof NodulusError) {
    console.error(err.code)    // 'EXPORT_MISMATCH'
    console.error(err.message) // human-readable description
    console.error(err.details) // additional context (path, module name, etc.)
  }
  process.exit(1)
}
```

| Code | When it's thrown |
|---|---|
| `MODULE_NOT_FOUND` | Discovered folder has no `index.ts` / `index.js`, or `index.ts` does not call `Module()` |
| `INVALID_MODULE_DECLARATION` | `Module()` name doesn't match folder name, or an identifier is declared incorrectly or outside a `createApp()` context |
| `DUPLICATE_MODULE` | Two modules share the same name or NITS ID |
| `DUPLICATE_SERVICE` | Two `Service()` calls share the same name |
| `DUPLICATE_REPOSITORY` | Two `Repository()` calls share the same name |
| `DUPLICATE_SCHEMA` | Two `Schema()` calls share the same name |
| `MISSING_IMPORT` | Module listed in `imports` does not exist in the registry |
| `UNDECLARED_IMPORT` | Module imports from another not listed in `imports` (strict only) |
| `UNUSED_IMPORT` | Module declares an import it never actually uses (strict only) |
| `CIRCULAR_DEPENDENCY` | A dependency cycle was detected (strict only) |
| `EXPORT_MISMATCH` | Name declared in `exports` is not an actual export of `index.ts` |
| `INVALID_CONTROLLER` | Controller file has no `default export` of an Express `Router` |
| `ALIAS_NOT_FOUND` | Configured alias points to a path that does not exist |
| `ALIAS_INVALID` | Wildcard alias (`/*`) points to a file instead of a directory (strict only) |
| `DUPLICATE_ALIAS` | Two aliases resolve to the same name but different paths |
| `DUPLICATE_BOOTSTRAP` | `createApp()` called more than once with the same Express instance |
| `REGISTRY_MISSING_CONTEXT` | A Nodulus API was called outside of a `createApp()` async context |
| `INVALID_ESM_ENV` | `createApp()` called in a non-ESM environment (missing `"type": "module"` in `package.json`) |
| `CLI_ERROR` | A CLI command failed with a validation or runtime error |
| `PRELOADER_REQUIRED` | _(v1.5.0+)_ `requirePreloader: true` and the runtime pre-loader is not active |
| `PRELOADER_VERSION_MISMATCH` | _(v1.5.0+)_ `.nodulus/preload.js` was generated by a different version of `nodulus-core` (warning only, not thrown) |

---

## Advanced usage

### `getRegistry()`

Returns the read-only registry bound to the current async execution context. Only callable within a `createApp()` scope.

> [!CAUTION]
> **@unstable API**: Intended for advanced framework integrations and debugging. Structure may change without a major version bump.

```ts
import { getRegistry } from '@vlynk-studios/nodulus-core'

const registry = getRegistry()
const allModules   = registry.getAllModules()            // RegisteredModule[]
const alias        = registry.resolveAlias('@modules/users')
const allAliases   = registry.getAllAliases()            // Record<string, string>
```

`NodulusRegistry` interface (stable):

```ts
interface NodulusRegistry {
  hasModule(name: string): boolean
  getModule(name: string): RegisteredModule | undefined
  getAllModules(): RegisteredModule[]
  resolveAlias(alias: string): string | undefined
  getAllAliases(): Record<string, string>
}
```

`NodulusRegistryAdvanced` interface (@unstable):

```ts
interface NodulusRegistryAdvanced extends NodulusRegistry {
  getDependencyGraph(): Map<string, string[]>
  findCircularDependencies(): string[][]
}
```

---

## Use cases

### Microservices
Isolate each domain into a module and share types through `@modules/shared`. Each service stays lean with zero cross-cutting concerns.

### Monoliths
Enforce clean module boundaries at bootstrap, not code review. Nodulus catches circular dependencies and missing imports before your server starts.

### Fast prototyping
Scaffold a new feature by creating a folder and an `index.ts`. Nodulus handles all the boilerplate of wiring routes and middlewares.

---

## Requirements

| | Minimum |
|---|---|
| Node.js | 20.6.0 |
| Express | 5.x |
| TypeScript | 5.0+ (optional) |
| ESLint | 8.0+ (optional, for `eslint-plugin-nodulus`) |

> **Why 20.6?** Nodulus uses the Node.js [ESM Hooks API](https://nodejs.org/api/module.html#customization-hooks) (`register`) for runtime alias resolution. Native support without `--experimental-loader` requires Node 20.6+.

---

## ESM Only

Nodulus is built as a pure ESM package. It does not support CommonJS (`require()`).

```ts
import { createApp, Module, Controller } from '@vlynk-studios/nodulus-core'
```

Your project must have `"type": "module"` in `package.json`. Nodulus validates this at bootstrap and throws `INVALID_ESM_ENV` if it is missing.

---

## TypeScript

Types are bundled — no `@types/nodulus` needed.

```ts
import type {
  CreateAppOptions,
  NodulusApp,
  NodulusRegistry,
  NodulusRegistryAdvanced,
  NodulusConfig,
  NitsConfig,
  ModuleOptions,
  ControllerOptions,
  ServiceOptions,
  RepositoryOptions,
  SchemaOptions,
  RegisteredModule,
  MountedRoute,
  GetAliasesOptions,
  ModuleRegistration,
  FeatureRegistration,
  LogLevel,
  LogHandler,
} from '@vlynk-studios/nodulus-core'

// v1.5.0+ pre-loader utilities
import type { PreloadConfig } from '@vlynk-studios/nodulus-core'
import { isPreloaderActive, getPreloadConfig } from '@vlynk-studios/nodulus-core'
```

---

## License

MIT

---

Developed and maintained by **Vlynk Studios**.