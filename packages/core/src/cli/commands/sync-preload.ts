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
                if (!options.silent) {
                    logger.info('Pre-loader is already up to date (no changes).');
                }
                // salir silenciosamente
                return;
            }

            // Regenerar
            fs.writeFileSync(preloadPath, newContent, 'utf8');
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
