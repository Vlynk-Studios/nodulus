import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import { loadConfig } from '../../core/config.js';
import { generatePreloadFile } from '../lib/preload-generator.js';
import { createRequire } from 'node:module';
import { createLogger, defaultLogHandler } from '../../core/logger.js';

const require = createRequire(import.meta.url);
const pkg = require('../../../../package.json');

export function syncPreloadCommand(): Command {
  const sync = new Command('sync-preload');

  sync
    .description('Generates .nodulus/preload.js embedding runtime aliases configuration')
    .action(async () => {
        const logger = createLogger(defaultLogHandler, 'info');
        const cwd = process.cwd();
        
        try {
            const config = await loadConfig();
            
            const nodulusDir = path.join(cwd, '.nodulus');
            if (!fs.existsSync(nodulusDir)) {
                fs.mkdirSync(nodulusDir, { recursive: true });
            }

            const preloadPath = path.join(nodulusDir, 'preload.js');
            const newContent = generatePreloadFile(config, pkg.version, cwd);

            let isIdentical = false;
            if (fs.existsSync(preloadPath)) {
                const oldContent = fs.readFileSync(preloadPath, 'utf8');
                if (oldContent === newContent) {
                    isIdentical = true;
                }
            }

            if (isIdentical) {
                logger.info('Pre-loader configuration is already up to date (no changes).');
            } else {
                fs.writeFileSync(preloadPath, newContent, 'utf8');
                logger.info(`Pre-loader generated successfully at ${pc.cyan('.nodulus/preload.js')}`);
            }

            console.log(pc.green('\n✔ Pre-loader sync complete.'));
            console.log('\nTo use the pre-loader, update your package.json scripts:');
            console.log(pc.cyan('  "dev": "nodulus dev src/server.ts"'));
            console.log(pc.cyan('  "start": "node --import ./.nodulus/preload.js src/server.ts"\n'));

        } catch (err: any) {
            logger.error(`Failed to sync preload: ${err.message}`);
            process.exit(1);
        }
    });

  return sync;
}
