import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import { loadConfig } from '../../core/config.js';
import { buildModuleGraph } from '../lib/graph-builder.js';
import { detectViolations, ViolationType } from '../lib/violations.js';
import { printCheckReport, AYU, type CheckReportData } from '../lib/check-reporter.js';
import { loadNitsRegistry, saveNitsRegistry, initNitsRegistry, inferProjectName, scanShadowFiles } from '../../nits/nits-store.js';
import { createLogger, defaultLogHandler } from '../../core/logger.js';
import { reconcile, buildUpdatedNitsRegistry, buildNitsIdMap } from '../../nits/nits-reconciler.js';
import { computeModuleHash } from '../../nits/nits-hash.js';
import type { DiscoveredModule, NitsModuleRecord } from '../../types/nits.js';

function resolveCorePkgVersion(): string | null {
  const depths = [
    '../../package.json',      // dist/cli/ → packages/core/ (dev/local link)
    '../../../package.json',   // dist/cli/ → node_modules/@vlynk-studios/nodulus-core/ (prod)
    '../../../../package.json',
  ];
  for (const depth of depths) {
    try {
      const url = new URL(depth, import.meta.url);
      if (fs.existsSync(url)) {
        const pkg = JSON.parse(fs.readFileSync(url, 'utf8'));
        if (pkg.name?.includes('nodulus')) return pkg.version;
      }
    } catch {
      // Ignore error and try the next depth
    }
  }
  return null;
}

export function checkCommand(): Command {
  const check = new Command('check');

  check
    .description('Analyzes the project structural integrity to detect architectural violations')
    .option('--strict', 'Exit with code 1 if any violation is found', false)
    .option('--module <moduleName>', 'Filter analysis by a specific module')
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--no-circular', 'Skip circular dependency detection')
    .option('--verbose', 'Show verbose output including internal NITS IDs')
    .action(async (options) => {
        const cwd = process.cwd();
        const config = await loadConfig();

        const logger = createLogger(defaultLogHandler, 'info', 'check');

        // Pre-loader verification
        try {
            const preloadPath = path.join(cwd, '.nodulus', 'preload.js');
            if (!fs.existsSync(preloadPath)) {
                console.log(`\n  ${AYU.orange}⚠  Pre-loader not detected. Run "npx nodulus sync-preload" to optimize alias resolution.\x1b[0m\n`);
            } else {
                const content = fs.readFileSync(preloadPath, 'utf8');
                const versionMatch = content.match(/_version:\s*'([^']+)'/);
                if (versionMatch) {
                    const preloadVersion = versionMatch[1];
                    const currentVersion = resolveCorePkgVersion();
                    
                    if (currentVersion && preloadVersion !== currentVersion) {
                        console.log(`\n  ${AYU.orange}⚠  Pre-loader version mismatch (found v${preloadVersion}, core is v${currentVersion}). Run "npx nodulus sync-preload" to update.\x1b[0m\n`);
                    }
                }
            }
        } catch (err: any) {
            console.log(`\n  ${AYU.orange}⚠  Failed to verify pre-loader status: ${err.message}\x1b[0m\n`);
        }
        
        const graph = await buildModuleGraph(config, cwd);
        let nitsResult: any = null;

        // NITS Reconciliation (Identity Tracking)
        if (config.nits.enabled) {
          try {
            // Read-only shadow file scan — same migration-safe approach as createApp.
            const shadowFileMap = scanShadowFiles(graph.modules.map(n => ({ name: n.name, dirPath: n.dirPath })));

            const discovered: DiscoveredModule[] = [];
            for (const node of graph.modules) {
              const { hash, identifiers } = await computeModuleHash(node.dirPath);
              discovered.push({
                name: node.name,
                dirPath: node.dirPath,
                domain: undefined,
                identifiers,
                hash,
                shadowFile: shadowFileMap.get(node.dirPath),
              });
            }

            const oldRegistry = await loadNitsRegistry(cwd) || initNitsRegistry(inferProjectName(cwd));

            // Layer 1 Filter: Purge compilation artifacts (e.g. dist/) from registry
            const rawGlobs = Array.isArray(config.modules) ? config.modules : 
              (typeof config.modules === 'string' && config.modules.startsWith('{') && config.modules.endsWith('}')) 
                ? config.modules.slice(1, -1).split(',') 
                : [config.modules];
                
            const modulesRoots = rawGlobs.map(g => path.resolve(cwd, g.split('*')[0]).replace(/\\/g, '/'));
            
            for (const [id, mod] of Object.entries(oldRegistry.modules)) {
              const absPath = path.resolve(cwd, mod.path).replace(/\\/g, '/');
              const isWithinRoots = modulesRoots.some(root => absPath.startsWith(root));
              if (!isWithinRoots) {
                logger.warn(`[NITS] Purging artifact from registry: ${mod.path}`);
                delete oldRegistry.modules[id];
              }
            }

            const result = await reconcile(discovered, oldRegistry, cwd, {
              similarityThreshold: config.nits.similarityThreshold
            });
            nitsResult = result;
            const updatedRegistry = buildUpdatedNitsRegistry(result, oldRegistry.project);
            
            await saveNitsRegistry(updatedRegistry, cwd);
            
            const idMap = buildNitsIdMap(result, cwd);

            // Build a lookup from dirPath -> full reconciliation record
            // to populate resolvedBy on the graph nodes.
            const allRecords: NitsModuleRecord[] = [
              ...result.confirmed,
              ...result.moved.map(m => m.record),
              ...result.candidates.map(m => m.record),
              ...result.newModules,
            ];
            const recordByAbsPath = new Map<string, NitsModuleRecord>();
            for (const rec of allRecords) {
              const absPath = path.isAbsolute(rec.path)
                ? rec.path
                : path.resolve(cwd, rec.path);
              recordByAbsPath.set(absPath, rec);
            }

            // Map IDs and resolvedBy back to the graph nodes for reporting
            for (const node of graph.modules) {
              const absPath = path.resolve(node.dirPath);
              node.id = idMap.get(absPath);
              node.resolvedBy = recordByAbsPath.get(absPath)?.resolvedBy;
            }


          } catch (err: any) {
            const logger = createLogger(defaultLogHandler, 'warn', 'check');
            logger.warn(`NITS reconciliation failed: ${err.message}. Analysis will continue...`);
          }
        }

        let nodes = graph.modules;

        if (options.module) {
          graph.modules = graph.modules.filter(n => n.name === options.module);
          nodes = graph.modules;
          if (nodes.length === 0) {
            throw new Error(pc.red(`✗ Error: Module "${options.module}" does not exist.`));
          }
        }

        let violations = detectViolations(graph);

        if (options.circular === false) { 
          violations = violations.filter(v => v.type !== ViolationType.CIRCULAR_DEPENDENCY);
        }

        if (options.format === 'json') {
          console.log(JSON.stringify({ domains: graph.domains, modules: nodes, violations }, null, 2));
          if (options.strict && violations.length > 0) {
            throw new Error('Structural integrity violations found (JSON format)');
          }
          return;
        }

        const reportData: CheckReportData = {
          version:     resolveCorePkgVersion() ?? 'unknown',
          projectName: inferProjectName(cwd),
          modules:     nodes,
          violations,
          nitsResult,
          options: {
            verbose:      options.verbose ?? false,
            strict:       options.strict  ?? false,
            moduleFilter: options.module,
          },
        };

        printCheckReport(reportData);

        if (nitsResult) {
          const staleCount = nitsResult.stale?.length || 0;
          const deletedCount = nitsResult.deleted?.length || 0;
          if (staleCount > 0 || deletedCount > 0) {
            process.exitCode = 1;
          }
        }

        if (options.strict && violations.length > 0) {
          throw new Error('Structural integrity violations found.');
        }
    });

  return check;
}
