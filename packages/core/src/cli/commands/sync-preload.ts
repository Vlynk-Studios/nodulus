import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import { loadConfig } from '../../core/config.js';
import { generatePreloadFile } from '../lib/preload-generator.js';
import { createLogger, defaultLogHandler } from '../../core/logger.js';

const getPkg = () => {
  const depths = ['../package.json', '../../package.json', '../../../package.json'];
  for (const d of depths) {
    try {
      const p = new URL(d, import.meta.url);
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_e) { /* not a valid package.json path, try next */ }
  }
  return {};
};
const pkg = getPkg();

export function syncPreloadCommand(): Command {
  const sync = new Command('sync-preload');

  sync
    .description('Generates .nodulus/preload.js embedding runtime aliases configuration')
    .option('--silent', 'Suppress output when preload is already up to date', false)
    .action(async (options) => {
        const logger = createLogger(defaultLogHandler, 'info', 'alias');
        const cwd = process.cwd();
        
        try {
            const hasJsConfig = fs.existsSync(path.join(cwd, 'nodulus.config.js'));
            const hasTsConfig = fs.existsSync(path.join(cwd, 'nodulus.config.ts'));
            if (!hasJsConfig && !hasTsConfig) {
                logger.error('Could not load nodulus config. Make sure nodulus.config.js exists in the project root.');
                process.exit(1);
            }

            const config = await loadConfig();
            
            const nodulusDir = path.join(cwd, '.nodulus');
            try {
                if (!fs.existsSync(nodulusDir)) {
                    fs.mkdirSync(nodulusDir, { recursive: true });
                }
            } catch (err: any) {
                logger.error(`Cannot create directory at .nodulus: ${err.message}`);
                process.exit(1);
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
                if (!options.silent) {
                    logger.info('Pre-loader is already up to date (no changes).');
                }
                // salir silenciosamente
                return;
            }

            // Regenerar
            try {
                fs.writeFileSync(preloadPath, newContent, 'utf8');
            } catch (err: any) {
                if (err.code === 'EACCES') {
                    logger.error('Cannot write to .nodulus/preload.js — permission denied.');
                } else {
                    logger.error(`Cannot write to .nodulus/preload.js: ${err.message}`);
                }
                process.exit(1);
            }
            
            logger.info(`Pre-loader updated at ${pc.cyan('.nodulus/preload.js')}`);

            if (!options.silent) {
                // Mostrar bloque de next steps solo cuando el usuario corre sync-preload manualmente
                console.log(pc.green('\n✔ Pre-loader sync complete.'));
                console.log('\nTo use the pre-loader, update your package.json scripts:');
                console.log(pc.cyan('  "dev": "nodulus sync-preload --silent && nodulus dev --watch src/app.ts"'));
                console.log(pc.cyan('  "start": "node --import ./.nodulus/preload.js src/app.ts"\n'));
            }

        } catch (err: any) {
            logger.error(`Failed to sync preload: ${err.message}`);
            process.exit(1);
        }
    });

  return sync;
}
