import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CreateAppOptions, ResolvedConfig, NodulusConfig } from '../types/index.js';
import { defaultLogHandler, resolveLogLevel } from './logger.js';

const defaultStrict = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

export const DEFAULTS: ResolvedConfig = {
  modules: 'src/modules/*',
  domains: undefined,
  shared: undefined,
  prefix: '',
  aliases: {},
  strict: defaultStrict,
  resolveAliases: true,
  logger: defaultLogHandler,
  logLevel: resolveLogLevel(),
  logFormat: 'auto',
  nits: {
    enabled: true,
    similarityThreshold: undefined, // Use dynamic by default
  },
  requirePreloader: false
};

export const loadConfig = async (options: CreateAppOptions = {}): Promise<ResolvedConfig> => {
  const cwd = process.cwd();
  
  let fileConfig: NodulusConfig = {};
  
  const tsPath = path.join(cwd, 'nodulus.config.ts');
  const jsPath = path.join(cwd, 'nodulus.config.js');
  
  const candidates: string[] = [tsPath, jsPath];

  let configPathToLoad: string | null = null;

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      configPathToLoad = candidate;
      break;
    }
  }

  if (configPathToLoad) {
    try {
      const importUrl = pathToFileURL(configPathToLoad).href;
      const mod = await import(importUrl);
      fileConfig = mod.default || mod.config || mod;
    } catch (error: any) {
      if (configPathToLoad.endsWith('.ts') && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
        throw new Error(
          `[Nodulus] Found "nodulus.config.ts" but your environment cannot load raw TypeScript files.\n` +
          `  - In production: Run "npm run build" to generate a .js config OR use nodulus.config.js.\n` +
          `  - In development: Ensure you are running with a loader like "tsx" or "ts-node".`,
          { cause: error }
        );
      }
      throw new Error(`[Nodulus] Failed to parse or evaluate config file at ${configPathToLoad}: ${error.message}`, { cause: error });
    }
  }

  // Merge strategy: options > fileConfig > defaults
  return {
    modules: options.modules ?? fileConfig.modules ?? DEFAULTS.modules,
    domains: options.domains ?? fileConfig.domains ?? DEFAULTS.domains,
    shared: options.shared ?? fileConfig.shared ?? DEFAULTS.shared,
    prefix: options.prefix ?? fileConfig.prefix ?? DEFAULTS.prefix,
    aliases: {
      ...DEFAULTS.aliases,
      ...(fileConfig.aliases || {}),
      ...(options.aliases || {}) // Options override file aliases
    },
    strict: options.strict ?? fileConfig.strict ?? DEFAULTS.strict,
    resolveAliases: options.resolveAliases ?? fileConfig.resolveAliases ?? DEFAULTS.resolveAliases,
    logger: options.logger ?? fileConfig.logger ?? DEFAULTS.logger,
    logLevel: resolveLogLevel(options.logLevel ?? fileConfig.logLevel),
    logFormat: options.logFormat ?? fileConfig.logFormat ?? DEFAULTS.logFormat,
    nits: {
      enabled: options.nits?.enabled ?? fileConfig.nits?.enabled ?? DEFAULTS.nits.enabled,
      similarityThreshold: options.nits?.similarityThreshold ?? fileConfig.nits?.similarityThreshold ?? DEFAULTS.nits.similarityThreshold,
    },
    requirePreloader: options.requirePreloader ?? fileConfig.requirePreloader ?? DEFAULTS.requirePreloader
  };
};
