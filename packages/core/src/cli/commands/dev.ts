import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createLogger, defaultLogHandler } from '../../core/logger.js';

export function devCommand(): Command {
  const dev = new Command('dev');

  dev
    .description('Run the Nodulus application in development mode with the pre-loader')
    .argument('<entrypoint>', 'The main entrypoint file (e.g. src/server.ts)')
    .option('--watch', 'Run in watch mode', false)
    .option('--runtime <runtime>', 'Runtime to use (node or tsx)', 'node')
    .action(async (entrypoint, options) => {
        const logger = createLogger(defaultLogHandler, 'info');
        const cwd = process.cwd();
        const preloadPath = path.join(cwd, '.nodulus', 'preload.js');
        const hasPreload = fs.existsSync(preloadPath);

        const args: string[] = [];

        if (hasPreload) {
            args.push('--import', './.nodulus/preload.js');
        } else {
            logger.warn('Pre-loader not detected at .nodulus/preload.js. Running in legacy mode (v1.4.0).');
            logger.warn('It is recommended to run "npx nodulus sync-preload" to enable the pre-loader.');
        }

        if (options.watch) {
            args.push('--watch');
        }

        args.push(entrypoint);

        const isWindows = process.platform === 'win32';
        const useShell = isWindows && options.runtime !== 'node';

        let proc;
        if (useShell) {
            // Avoid DEP0190 and EINVAL by passing a single command string when shell: true
            const commandStr = `${options.runtime} ${args.map(a => `"${a}"`).join(' ')}`;
            proc = spawn(commandStr, {
                stdio: 'inherit',
                cwd,
                shell: true
            });
        } else {
            proc = spawn(options.runtime, args, {
                stdio: 'inherit',
                cwd,
                shell: false
            });
        }

        proc.on('close', (code) => {
            process.exit(code ?? 0);
        });
        
        proc.on('error', (err) => {
            logger.error(`Failed to start runtime: ${err.message}`);
            process.exit(1);
        });
    });

  return dev;
}
