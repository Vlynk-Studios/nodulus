import pc from 'picocolors';
import type { ReconciliationResult } from '../types/nits.js';
import type { Logger } from '../types/index.js';
import { calculateAlias } from './utils.js';

export function reportReconciliation(result: ReconciliationResult, log: Logger): void {
  const hasAlerts = 
    result.moved.length > 0 || 
    result.candidates.length > 0 || 
    result.stale.length > 0 ||
    result.deleted.length > 0;

  if (!hasAlerts) {
    log.debug('no changes detected', { _module: 'nits' });
    return;
  }

  if (result.newModules.length > 0) {
    log.debug(`${result.newModules.length} new modules discovered.`, { _module: 'nits' });
  }

  if (result.moved.length > 0) {
    for (const m of result.moved) {
      const newAlias = calculateAlias(m.newPath);
      let msg = `Movement detected: '${pc.bold(m.record.name)}'\n`;
      msg += `           ${pc.gray('Before:')} ${pc.gray(m.oldPath)}\n`;
      msg += `           ${pc.gray('Now:')} ${pc.cyan(m.newPath)}`;
      
      if (m.brokenImports.length > 0) {
        msg += `\n           ${pc.yellow(`Broken imports (${m.brokenImports.length} file(s)):`)}`;
        for (const imp of m.brokenImports) {
          msg += `\n             ${pc.gray(imp.file)}:${pc.gray(String(imp.line))}  →  ${pc.red(imp.specifier)}`;
        }
        msg += `\n           Update imports to: ${pc.green(newAlias)}`;
      }
      
      log.warn(msg, { _module: 'nits' });
    }
  }

  if (result.stale.length > 0) {
    for (const m of result.stale) {
      let msg = `Module '${pc.bold(m.name)}' not found on disk — marked stale.\n`;
      msg += `           ${pc.gray('Last location:')} ${pc.gray(m.path)}\n`;
      msg += `           Will be removed from registry if absent next cycle.\n`;
      msg += `           If it was moved, ensure the new directory has Module().`;
      
      log.warn(msg, { _module: 'nits' });
    }
  }

  if (result.deleted.length > 0) {
    for (const m of result.deleted) {
      let msg = `Module '${pc.bold(m.name)}' (${pc.gray(m.id)}) confirmed deleted — purged from registry.\n`;
      msg += `           ${pc.gray('Last location:')} ${pc.gray(m.path)}`;
      
      // info, not warn — a confirmed delete is a normal lifecycle event.
      log.info(msg, { _module: 'nits' });
    }
  }

  if (result.candidates.length > 0) {
    for (const m of result.candidates) {
      let msg = `Possible relocation: '${pc.bold(m.record.name)}'\n`;
      msg += `           A module with the same name was found in a new location.\n`;
      msg += `           Please verify manually if it is the same moved module.\n`;
      msg += `           ${pc.gray('New path:')} ${pc.cyan(m.newPath)}`;
      
      log.warn(msg, { _module: 'nits' });
    }
  }

  log.debug(pc.cyan('Identity Reconciliation Summary'), { _module: 'nits' });
  log.debug(pc.gray('----------------------------------------'), { _module: 'nits' });
  
  if (result.confirmed.length > 0) {
    log.debug(`${pc.green('✔')} Confirmed:      ${pc.bold(result.confirmed.length)}`, { _module: 'nits' });
  }
  
  if (result.newModules.length > 0) {
    log.debug(`${pc.blue('✳')} New modules:    ${pc.bold(result.newModules.length)}`, { _module: 'nits' });
  }
  
  if (result.moved.length > 0) {
    log.debug(`${pc.magenta('⇄')} Moved:          ${pc.bold(result.moved.length)}`, { _module: 'nits' });
  }
  
  if (result.candidates.length > 0) {
    log.debug(`${pc.yellow('❓')} Candidates:     ${pc.bold(result.candidates.length)}`, { _module: 'nits' });
  }
  
  if (result.stale.length > 0) {
    log.debug(`${pc.gray('✖')} Stale (disk):  ${pc.bold(result.stale.length)}`, { _module: 'nits' });
  }

  if (result.deleted.length > 0) {
    log.debug(`${pc.red('✗')} Deleted:        ${pc.bold(result.deleted.length)}`, { _module: 'nits' });
  }
  
  log.debug(pc.gray('----------------------------------------\n'), { _module: 'nits' });
}