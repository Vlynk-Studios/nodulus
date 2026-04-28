import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
  },
  {
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist/cli',
    sourcemap: true,
    target: 'node20',
  },
  {
    entry: ['src/preload/preload-hook.ts'],
    format: ['esm'],
    outDir: 'dist/preload',
    target: 'node20',
    minify: false,
    sourcemap: true,
  }
]);
