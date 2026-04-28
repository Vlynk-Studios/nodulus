#!/usr/bin/env node
import { Command } from 'commander'
import { createModuleCommand } from './commands/create-module.js'
import { syncTsconfigCommand } from './commands/sync-tsconfig.js'
import { checkCommand } from './commands/check.js'
import { devCommand } from './commands/dev.js'
import { syncPreloadCommand } from './commands/sync-preload.js'

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const program = new Command()
program
  .name('nodulus')
  .description('Nodulus CLI')
  .version(pkg.version)
  .addCommand(createModuleCommand())
  .addCommand(syncTsconfigCommand())
  .addCommand(checkCommand())
  .addCommand(devCommand())
  .addCommand(syncPreloadCommand())
  .exitOverride();

try {
  await program.parseAsync();
} catch (err: any) {
  if (err.name === 'CommanderError') {
    // Version and help are handled by Commander internally (they print and then throw)
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.help' || err.code === 'commander.version') {
      process.exit(0);
    }
    // Validation errors (missing args, etc.) should just show the message
    console.error(err.message);
    process.exit(err.exitCode || 1);
  }

  // Custom or unexpected errors
  if (err.message && err.message.includes('\nError:')) {
    console.error(err.message);
  } else {
    console.error(`\n${err.message || 'An unknown error occurred'}\n`);
  }
  process.exit(typeof err.exitCode === 'number' ? err.exitCode : 1);
}
