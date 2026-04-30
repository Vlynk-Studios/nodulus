import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fg from 'fast-glob';
import type { Application } from 'express';
import type { CreateAppOptions, NodulusApp } from '../types/index.js';
import { loadConfig } from '../core/config.js';
import { NodulusError } from '../core/errors.js';
import { createRegistry, registryContext } from '../core/registry.js';
import { activateAliasResolver } from '../aliases/resolver.js';
import { updateAliasCache } from '../aliases/cache.js';
import { createLogger } from '../core/logger.js';
import { performance } from 'node:perf_hooks';
import pc from 'picocolors';
import { extractModuleImports } from '../nits/import-scanner.js';
import { loadNitsRegistry, saveNitsRegistry, initNitsRegistry, inferProjectName } from '../nits/nits-store.js';
import { reconcile, buildUpdatedNitsRegistry, buildNitsIdMap } from '../nits/nits-reconciler.js';
import { reportReconciliation } from '../nits/nits-reporter.js';
import { computeModuleHash } from '../nits/nits-hash.js';
import { normalizePath } from '../core/utils/paths.js';
import type { DiscoveredModule } from '../types/nits.js';

export async function createApp(
  app: Application,
  options: CreateAppOptions = {}
): Promise<NodulusApp> {
  // Step 0 — Prevent Duplicate Bootstrap
  if ((app as any).__nodulusBootstrapped) {
    throw new NodulusError(
      'DUPLICATE_BOOTSTRAP',
      'createApp() was called more than once with the same Express instance.'
    );
  }

  // Step 0.5 — ESM Environment Validation
  let isEsm = false;
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.type === 'module') {
        isEsm = true;
      }
    }
  } catch (_e) {
    // Failsafe
  }

  if (!isEsm) {
    throw new NodulusError(
      'INVALID_ESM_ENV',
      'Nodulus requires an ESM environment. Please ensure "type": "module" is present in your root package.json file.'
    );
  }

  const registry = createRegistry();

  return registryContext.run(registry, async () => {
    const startTime = performance.now();
    try {

  // Step 0.1 — Pre-loader Validation
  const preloadConfig = globalThis.__NODULUS_PRELOAD_CONFIG__;
  const preloaderActive = preloadConfig?.preloaded === true;

  if (options.requirePreloader === true && !preloaderActive) {
    throw new NodulusError(
      'PRELOADER_REQUIRED',
      'The application requires the Nodulus pre-loader to be active.',
      'Run the application with "node --import ./.nodulus/preload.js" or set requirePreloader: false in createApp options.'
    );
  }

  // Step 1 — Load configuration
  const config = await loadConfig(options);
  const log = createLogger(config.logger, config.logLevel, 'boot');

  // Step 1.1 — Pre-loader Warnings
  if (!preloaderActive && config.resolveAliases !== false) {
    log.warn('Pre-loader not detected. Alias resolution might fail for top-level imports. Running in legacy mode (v1.4.0).', { suggestion: 'Run "npx nodulus sync-preload" and use "node --import ./.nodulus/preload.js"' });
  }

  if (preloaderActive) {
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
      const currentVersion = getPkg().version;
      if (preloadConfig?._version && preloadConfig._version !== currentVersion) {
          log.warn(`Pre-loader version mismatch. Pre-loader: ${preloadConfig._version}, Core: ${currentVersion}.`, { suggestion: 'Run "npx nodulus sync-preload" to update it.' });
      }
  }

  if (config.domains || config.shared) {
    log.warn('Infrastructure (domains/shared) is not yet supported in v1.2.x. These keys in configuration will be ignored until v2.0.0.', { _module: 'config' });
  }

  log.info('Bootstrap started', {
    modules: pc.cyan(config.modules),
    prefix: pc.cyan(config.prefix || '(none)'),
    strict: pc.yellow(String(config.strict)),
    nodeVersion: pc.gray(process.version),
  });

  // Step 2 — Resolve modules
  const globPattern = config.modules.replace(/\\/g, '/');
  const moduleDirs = await fg(globPattern, {
    onlyDirectories: true,
    absolute: true,
    cwd: process.cwd()
  });

  moduleDirs.sort();

  const resolvedModules: { name: string, dirPath: string, indexPath: string }[] = [];

  for (const dirPath of moduleDirs) {
    log.debug(`Discovered module directory: ${dirPath}`, { dirPath, _module: 'module' });
    const tsPath = path.join(dirPath, 'index.ts');
    const jsPath = path.join(dirPath, 'index.js');
    
    let indexPath: string | null = null;
    if (fs.existsSync(tsPath)) {
      indexPath = tsPath;
    } else if (fs.existsSync(jsPath)) {
      indexPath = jsPath;
    }

    if (!indexPath) {
      throw new NodulusError(
        'MODULE_NOT_FOUND',
        `No index.ts or index.js found for module. A module directory must have an index file mapping its dependencies.`,
        `Directory: ${dirPath}`
      );
    }
    
    resolvedModules.push({ 
      name: path.basename(dirPath), 
      dirPath, 
      indexPath 
    });
  }

  // Step 2.5 — NITS Identity Reconciliation (Identity tracking audit layer)
  if (config.nits?.enabled !== false) {
    try {
      const discovered: DiscoveredModule[] = [];
      for (const mod of resolvedModules) {
        const { hash, identifiers } = await computeModuleHash(mod.dirPath);
        discovered.push({
          name: mod.name,
          dirPath: mod.dirPath,
          domain: undefined, // Reserved for v2.0 (Domains are not supported in v1.x)
          identifiers,
          hash
        });
      }

      const cwd = process.cwd();
      const oldRegistry = await loadNitsRegistry(cwd) || initNitsRegistry(inferProjectName(cwd));
      const nitsResult = await reconcile(discovered, oldRegistry, cwd, {
        similarityThreshold: config.nits?.similarityThreshold
      });
      
      reportReconciliation(nitsResult, log);
      
      const updatedNits = buildUpdatedNitsRegistry(nitsResult, oldRegistry.project);
      await saveNitsRegistry(updatedNits, cwd);

      // Seed the registry with the reconciled IDs
      const nitsIdMap = buildNitsIdMap(nitsResult, cwd);
      registry.seedNitsIds(nitsIdMap);
      
      log.debug('NITS identity reconciliation complete.', { _module: 'nits' });
    } catch (err: any) {
      log.warn(`NITS reconciliation failed: ${err.message}. Bootstrap will continue with temporary identities.`, { _module: 'nits' });
      log.debug('NITS Error detail:', { error: err, _module: 'nits' });
    }
  }

  // Step 3 — Activate runtime aliases
  if (config.resolveAliases !== false) {
    const pureModuleAliases: Record<string, string> = {};
    for (const mod of resolvedModules) {
      const aliasKey = `@modules/${mod.name}`;
      pureModuleAliases[aliasKey] = mod.indexPath;
      pureModuleAliases[`${aliasKey}/*`] = `${mod.dirPath}/*`;
      
      registry.registerAlias(aliasKey, mod.indexPath);
      registry.registerAlias(`${aliasKey}/*`, `${mod.dirPath}/*`);
    }

    const normalizedConfigAliases: Record<string, string> = {};
    for (const [alias, target] of Object.entries(config.aliases)) {
      if (pureModuleAliases[alias]) {
        log.warn(`Alias collision: User alias "${alias}" overrides an auto-generated module alias. Configuration will take precedence.`, { alias, target, _module: 'alias' });
      }

      const isWildcard = target.endsWith('/*');
      const cleanTarget = isWildcard ? target.slice(0, -2) : target;
      const targetPath = path.isAbsolute(cleanTarget) ? cleanTarget : path.resolve(process.cwd(), cleanTarget);
      
      if (!fs.existsSync(targetPath)) {
        let details = `Alias: ${alias}, Target Path: ${targetPath}`;
        
        // Suggestion hint: if the path doesn't exist, check for index files
        const tsIndex = path.join(targetPath, 'index.ts');
        const jsIndex = path.join(targetPath, 'index.js');
        if (fs.existsSync(tsIndex) || fs.existsSync(jsIndex)) {
            const hintPath = fs.existsSync(tsIndex) ? 'index.ts' : 'index.js';
            details += `\nHint: The directory was not found but it contains an "${hintPath}". Did you mean "${target.endsWith('/') ? target : target + '/'}${hintPath}"?`;
        }

        throw new NodulusError(
          'ALIAS_NOT_FOUND',
          `The target path for alias "${alias}" does not exist.`,
          details
        );
      }

      const stats = fs.statSync(targetPath);
      // Re-add wildcard to the absolute path if it was originally present
      const finalTargetPath = isWildcard ? targetPath + '/*' : targetPath;

      if (!stats.isDirectory() && alias.endsWith('/*')) {
        const msg = `Invalid alias: Alias "${alias}" uses a wildcard "/*" but points to a file: ${targetPath}. Wildcards should only point to directories.`;
        if (config.strict) {
          throw new NodulusError('ALIAS_INVALID', msg);
        } else {
          log.warn(msg, { _module: 'alias' });
        }
      }

      registry.registerAlias(alias, finalTargetPath);
      normalizedConfigAliases[alias] = finalTargetPath;
      log.debug(`Alias registered: ${alias} → ${finalTargetPath}`, { alias, finalTargetPath, source: 'config', _module: 'alias' });
    }

    await activateAliasResolver(pureModuleAliases, normalizedConfigAliases, log);
    updateAliasCache(registry.getAllAliases());
  }

  // Step 4 — Import modules
  for (const mod of resolvedModules) {
    const imported = await import(pathToFileURL(mod.indexPath).href);

    // Correlate the imported module with the one added to the registry based on dirPath
    const allRegistered = registry.getAllModules();
    const registeredMod = allRegistered.find(m => normalizePath(m.path) === normalizePath(mod.dirPath));

    if (!registeredMod) {
      throw new NodulusError(
        'MODULE_NOT_FOUND',
        `No index.ts found calling Module(). Add Module() to the module's index.ts.`,
        `File: ${mod.indexPath}`
      );
    }

    log.info(`Module loaded: ${pc.green(registeredMod.name)}`, {
      _module: 'module',
      name: registeredMod.name,
      imports: registeredMod.imports,
      exports: registeredMod.exports,
      path: registeredMod.path,
    });

    const actualExports = Object.keys(imported).filter(key => key !== 'default');
    const declaredExports = registeredMod.exports || [];

    for (const declared of declaredExports) {
      if (!actualExports.includes(declared)) {
        throw new NodulusError(
          'EXPORT_MISMATCH',
          `A name declared in exports does not exist as a real export of index.ts.`,
          `Module: ${registeredMod.name}, Missing Export: ${declared}`
        );
      }
    }

    if (config.strict) {
      for (const actual of actualExports) {
        if (!declaredExports.includes(actual)) {
          log.warn(
            `Module "${registeredMod.name}" exports "${actual}" but it is not declared in Module() options "exports" array.`,
            { name: registeredMod.name, exportName: actual, _module: 'module' }
          );
        }
      }
    }
  }

  // Step 5 — Validate dependencies
  const allModules = registry.getAllModules();
  for (const mod of allModules) {
    const rawMod = registry.getRawModule(mod.name);
    if (rawMod) {
      rawMod.imports = rawMod.imports.filter((imp: string) => imp && imp.trim() !== '');
      mod.imports = rawMod.imports;
    }

    for (const importName of mod.imports) {
      if (!registry.hasModule(importName)) {
        throw new NodulusError(
          'MISSING_IMPORT',
          `A module declared in imports does not exist in the registry.`,
          `Module "${mod.name}" is trying to import missing module "${importName}"`
        );
      }
    }
  }

  // Step 5.5 — Detect undeclared cross-module imports
  for (const registeredMod of allModules) {
    const rawMod = registry.getRawModule(registeredMod.name);
    if (!rawMod) continue;

    const sourceFiles = await fg('**/*.{ts,js,mts,mjs}', {
      cwd: rawMod.path,
      absolute: true,
      ignore: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', 'index.*']
    });

    const usedImports = new Set<string>();

    for (const file of sourceFiles) {
      const actualImports = extractModuleImports(file);
      for (const imp of actualImports) {
        const parts = imp.specifier.split('/');
        const targetModule = imp.specifier.startsWith('@modules/') ? parts[1] : (parts[1] || parts[0]).replace(/^@/, '');
        if (!targetModule || targetModule === registeredMod.name) continue;

        if (!registry.hasModule(targetModule)) continue;

        usedImports.add(targetModule);

        if (!registeredMod.imports.includes(targetModule)) {
          const message = `Module "${registeredMod.name}" imports from "${targetModule}" but it is not declared in imports[].`;
          const details = `File: ${path.normalize(file)}:${imp.line} — Add "${targetModule}" to Module() imports array for "${registeredMod.name}".`;

          if (config.strict) {
            throw new NodulusError('UNDECLARED_IMPORT', message, details);
          } else {
            log.warn(message, {
              _module: 'module',
              target: targetModule,
              file: path.normalize(file),
              line: imp.line,
            });
          }
        }
      }
    }

    for (const declared of registeredMod.imports) {
      if (!usedImports.has(declared)) {
        const message = `Module "${registeredMod.name}" declares import "${declared}" but never uses it.`;
        if (config.strict) {
          throw new NodulusError('UNUSED_IMPORT', message, `Remove "${declared}" from imports[] in "${registeredMod.name}".`);
        } else {
          log.warn(message, { module: registeredMod.name, unusedTarget: declared, _module: 'module' });
        }
      }
    }
  }

  if (config.strict) {
    const cycles = registry.findCircularDependencies();
    if (cycles.length > 0) {
      const cycleStrings = cycles.map(cycle => cycle.join(' -> ')).join(' | ');
      throw new NodulusError(
        'CIRCULAR_DEPENDENCY',
        `Circular dependency detected. Extract the shared dependency into a separate module.`,
        `Cycles found: ${cycleStrings}`
      );
    }
  }

  // Step 6 — Discover controllers
  for (const mod of allModules) {
    const rawMod = registry.getRawModule(mod.name);
    if (!rawMod) continue;

    const files = await fg('**/*.{ts,js,mts,mjs,cjs}', {
      cwd: mod.path,
      absolute: true,
      ignore: ['**/*.types.*', '**/*.d.ts', '**/*.spec.*', '**/*.test.*', 'index.*']
    });

    files.sort();

    for (let file of files) {
      log.debug(`Scanning controller file: ${file}`, { filePath: file, module: mod.name, _module: 'router' });
      file = path.normalize(file);
      let imported: any;
      try {
        imported = await import(pathToFileURL(file).href);
      } catch (err: any) {
        throw new NodulusError(
          'INVALID_CONTROLLER',
          `Failed to import controller file. Check for syntax errors or missing dependencies.`,
          `File: ${file} — ${err.message}`
        );
      }

      const resolvedFile = normalizePath(file);
      const ctrlMeta = registry.getControllerMetadata(resolvedFile);
      if (ctrlMeta) {
        const isRouter = imported.default && typeof imported.default === 'function' && typeof imported.default.use === 'function';
        if (!isRouter) {
          throw new NodulusError(
            'INVALID_CONTROLLER',
            `Controller has no default export of a Router. Add export default router.`,
            `File: ${file}`
          );
        }
        ctrlMeta.router = imported.default;
        rawMod.controllers.push(ctrlMeta);
      }
    }

    // Note: modules with no controllers are valid (workers, email, listeners, etc.)
    // REGLA-01: Nodulus does not require controllers — they are Express-specific.
  }

  // Step 7 — Mount routes
  const mountedRoutes: import('../types/index.js').MountedRoute[] = [];

  for (const mod of allModules) {
    const rawMod = registry.getRawModule(mod.name);
    if (!rawMod) continue;

    for (const ctrl of rawMod.controllers) {
      if (!ctrl.enabled) {
        log.info(`Controller "${ctrl.name}" is disabled — skipping mount`, {
          _module: 'router',
          module: mod.name,
          prefix: ctrl.prefix,
        });
        continue;
      }

      const fullPath = (config.prefix + ctrl.prefix).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
      if (ctrl.router) {
        if (ctrl.middlewares && ctrl.middlewares.length > 0) {
           app.use(fullPath, ...ctrl.middlewares, ctrl.router);
        } else {
           app.use(fullPath, ctrl.router);
        }

        let foundRoutes = false;
        const extractedRoutes: { method: string, path: string }[] = [];

        if (ctrl.router.stack && Array.isArray(ctrl.router.stack)) {
          for (const layer of ctrl.router.stack) {
            const routeObj = (layer as any).route;
            if (routeObj && routeObj.methods) {
              foundRoutes = true;
              const routePath = routeObj.path;
              const methods = Object.keys(routeObj.methods).filter(m => routeObj.methods[m]).map(m => m.toUpperCase());
              
              for (const method of methods) {
                const fullRoutePath = (fullPath + (routePath === '/' ? '' : routePath)).replace(/\/+/g, '/');
                extractedRoutes.push({ method, path: fullRoutePath });
                mountedRoutes.push({
                  method: method as any,
                  path: fullRoutePath,
                  module: mod.name,
                  controller: ctrl.name
                });
              }
            }
          }
        }

        if (!foundRoutes) {
          extractedRoutes.push({ method: 'USE', path: fullPath });
          mountedRoutes.push({
            method: 'USE',
            path: fullPath,
            module: mod.name,
            controller: ctrl.name
          });
        }

        const methodColors: Record<string, (msg: string) => string> = {
          GET: pc.green, POST: pc.yellow, PUT: pc.cyan, PATCH: pc.magenta, DELETE: pc.red, USE: pc.gray
        };

        for (const route of extractedRoutes) {
          const colorFn = methodColors[route.method] || pc.white;
          log.info(`  ${colorFn(route.method.padEnd(6))} ${pc.white(route.path)}  ${pc.gray(`(${ctrl.name})`)}`, {
            _module: 'router',
            path: route.path,
            module: mod.name,
            controller: ctrl.name,
          });
        }
      }
    }
  }

    (app as any).__nodulusBootstrapped = true;

    const safeRegisteredModules = allModules.map(m => registry.getModule(m.name)!);
    const durationMs = Math.round(performance.now() - startTime);
    log.info(`${pc.green('Bootstrap complete')} — ${pc.cyan(allModules.length)} module(s), ${pc.cyan(mountedRoutes.length)} route(s) in ${pc.yellow(`${durationMs}ms`)}`, {
      moduleCount: allModules.length,
      routeCount: mountedRoutes.length,
      durationMs,
    });

    return {
      modules: safeRegisteredModules,
      routes: mountedRoutes,
      registry,
      runtime: {
        preloaderActive,
        preloaderVersion: preloadConfig?._version ?? null,
        aliasesAtBoot: preloadConfig?.aliases ?? {}
      }
    };

    } catch (err) {
      registry.clearRegistry();
      throw err;
    }
  });
}
