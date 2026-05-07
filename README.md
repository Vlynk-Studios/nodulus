# Nodulus

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.6-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)

**A structural layer for Express.** Nodulus organises your Node.js application into self-contained modules — handling discovery, route mounting, import aliases, and dependency validation at bootstrap time, with zero overhead at runtime.

> **Node.js ≥ 20.6** · **Express 5.x** · **ESM Only** · **TypeScript included**

---

## Packages

This repository is a npm workspace monorepo. All packages are versioned in lockstep and published independently to npm.

| Package | Description | Version |
|---|---|---|
| [`@vlynk-studios/nodulus-core`](./packages/core) | Core framework — module discovery, routing, aliases, dependency validation, NITS identity tracking | [![npm](https://img.shields.io/npm/v/@vlynk-studios/nodulus-core.svg)](https://www.npmjs.com/package/@vlynk-studios/nodulus-core) |
| [`@vlynk-studios/eslint-plugin-nodulus`](./packages/eslint-plugin-nodulus) | ESLint plugin — static enforcement of Nodulus module boundaries in your editor and CI | [![npm](https://img.shields.io/npm/v/@vlynk-studios/eslint-plugin-nodulus.svg)](https://www.npmjs.com/package/@vlynk-studios/eslint-plugin-nodulus) |

Both packages are independent installs. The ESLint plugin is a companion — not a dependency of the core.

---

## Repository Structure

```
nodulus/
├── packages/
│   ├── core/                        # @vlynk-studios/nodulus-core
│   │   ├── src/
│   │   │   ├── bootstrap/           # createApp() entrypoint
│   │   │   ├── identifiers/         # Module(), Controller(), Service(), ...
│   │   │   ├── aliases/             # ESM hook — runtime alias resolution
│   │   │   ├── nits/                # NITS identity tracking system
│   │   │   ├── cli/                 # nodulus check, create-module, sync-*
│   │   │   ├── core/                # Registry, state, logger, errors
│   │   │   ├── preload/             # Runtime pre-loader hook
│   │   │   └── types/               # Public TypeScript types
│   │   └── tests/
│   │       ├── unit/                # Isolated unit tests
│   │       ├── integration/         # End-to-end bootstrap tests
│   │       └── fixtures/            # Test application stubs
│   │
│   └── eslint-plugin-nodulus/       # @vlynk-studios/eslint-plugin-nodulus
│       ├── src/
│       │   └── rules/               # no-private-imports, no-undeclared-imports
│       └── tests/
│
├── package.json                     # Workspace root
└── tsconfig.json                    # Shared TypeScript base config
```

---

## Development Setup

**Prerequisites:** Node.js ≥ 20.6, npm ≥ 10

```bash
# Clone and install all workspace dependencies
git clone https://github.com/vlynk-studios/nodulus.git
cd nodulus
npm install
```

### Common commands

```bash
# Build all packages
npm run build

# Run all tests across the workspace
npm test

# Type-check all packages
npm run typecheck

# Lint all source and test files
npm run lint
npm run lint:fix
```

To run commands for a specific package, use the `-w` flag:

```bash
npm test -w @vlynk-studios/nodulus-core
npm run build -w @vlynk-studios/eslint-plugin-nodulus
```

---

## Quick Start

Install the core package in your project:

```bash
npm install @vlynk-studios/nodulus-core
npm install express
```

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
  },
})

console.log(`Mounted routes: ${routes.length}`)
export default app
```

Each module declares itself through its `index.ts`:

```ts
// src/modules/users/index.ts
import { Module } from '@vlynk-studios/nodulus-core'

Module('users', {
  imports: ['auth'],
  exports: ['UserService'],
})

export { UserService } from './users.service.js'
```

For full API documentation, configuration reference, and CLI usage, see the [`nodulus-core` README](./packages/core/README.md).

---

## ESLint Plugin

Install the companion plugin for inline editor feedback:

```bash
npm install --save-dev @vlynk-studios/eslint-plugin-nodulus
```

```js
// eslint.config.js
import nodulus from '@vlynk-studios/eslint-plugin-nodulus'

export default [nodulus.configs.recommended]
```

The plugin ships two rules: `no-private-imports` (error) and `no-undeclared-imports` (warn). For setup and configuration details, see the [`eslint-plugin-nodulus` README](./packages/eslint-plugin-nodulus/README.md).

---

## Versioning and Releases

Both packages follow [Semantic Versioning](https://semver.org/) and are released in lockstep from this repository. All notable changes are documented in the respective `CHANGELOG.md` of each package.

---

## Contributing

Contributions, bug reports, and feature requests are welcome. Please open an issue before submitting a pull request for non-trivial changes.

---

## License

MIT — see [LICENSE](./packages/core/LICENSE).

Developed and maintained by **[Vlynk Studios](https://github.com/vlynk-studios)**.