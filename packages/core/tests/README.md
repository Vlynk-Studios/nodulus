# Nodulus Core Tests

This directory contains unit and integration tests for the Nodulus Core framework.

## Shadow File Tests

The `shadow-file.ts` system (NITS v1.5.5) is covered extensively in `tests/unit/shadow-file.test.ts`. These tests ensure that:
- Shadow files are read and written correctly.
- Identities are preserved during migration from legacy registries.
- Corrupted shadow files are handled gracefully without stopping the bootstrap.

### Testing Helper: `createTmpModuleDir`

When writing new tests that involve filesystem interactions, use the `createTmpModuleDir` helper from `tests/helpers/shadow-file.ts`:

```typescript
import { createTmpModuleDir, writeTmpShadowFile } from '../helpers/shadow-file.js';

it('should test something with a real directory', () => {
  const modDir = createTmpModuleDir('my-module');
  // modDir is now an absolute path to a temporary directory with a basic module structure.
  // It will be automatically deleted after the test finishes.
});
```

### Why hardcoded IDs in `nits-app` fixture?

The fixture at `tests/fixtures/nits-app` contains `.nodulus` files and a `registry.json` with hardcoded IDs (e.g., `mod_a1b2c3d4`). 

These are used in `tests/unit/nits-app-lifecycle.test.ts` to simulate complex "moved" and "cloned" scenarios where we need to verify that the reconciler correctly identifies a module by its stable ID, regardless of its current path. Using stable IDs in the fixture allows us to write assertions that check for exact ID preservation across simulated boot cycles.
