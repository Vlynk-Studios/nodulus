import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PreloadConfig } from './index.js';
import type { ResolveHookContext, NextResolve } from '../aliases/resolver.js';

let config: PreloadConfig | null = null;

export function initialize(data: PreloadConfig) {
  config = data;
}

export async function resolve(
  specifier: string,
  context: ResolveHookContext,
  nextResolve: NextResolve
) {
  if (!config) {
    return attemptResolve(specifier, context, nextResolve);
  }

  const aliases = config.aliases;
  const sortedAliases = Object.keys(aliases).sort((a, b) => b.length - a.length);

  for (const alias of sortedAliases) {
    const target = aliases[alias];
    if (alias.endsWith('/*')) {
      const baseAlias = alias.slice(0, -2);
      if (specifier === baseAlias || specifier.startsWith(baseAlias + '/')) {
        const baseTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
        const subPath = specifier.slice(baseAlias.length);
        const resolvedPath = path.resolve(baseTarget, subPath.startsWith('/') ? subPath.slice(1) : subPath);
        return attemptResolve(pathToFileURL(resolvedPath).href, context, nextResolve, alias);
      }
    } else if (specifier === alias) {
      const exactTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
      return attemptResolve(pathToFileURL(exactTarget).href, context, nextResolve, alias);
    } else if (specifier.startsWith(alias + '/')) {
      const baseTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
      const subPath = specifier.slice(alias.length + 1);
      const resolvedPath = path.resolve(baseTarget, subPath);
      return attemptResolve(pathToFileURL(resolvedPath).href, context, nextResolve, alias);
    }
  }

  return attemptResolve(specifier, context, nextResolve);
}

async function attemptResolve(specifier: string, context: ResolveHookContext, nextResolve: NextResolve, originalAlias?: string) {
  try {
    return await nextResolve(specifier, context);
  } catch (err: any) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
      try {
        const tsSpecifier = specifier.slice(0, -3) + '.ts';
        return await nextResolve(tsSpecifier, context);
      } catch {
        // Fallback failed, throw original error
      }
    }
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && originalAlias) {
      let displayPath = specifier;
      if (specifier.startsWith('file://')) {
        try {
          displayPath = fileURLToPath(specifier);
        } catch {
          // ignore
        }
      }
      err.message = `Cannot resolve alias '${originalAlias}' → ${displayPath} not found. Run: nodulus sync-preload\n\nOriginal error:\n${err.message}`;
    }
    throw err;
  }
}
