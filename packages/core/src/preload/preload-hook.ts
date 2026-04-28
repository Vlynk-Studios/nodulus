import { pathToFileURL } from 'node:url';
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
    return nextResolve(specifier, context);
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
        return nextResolve(pathToFileURL(resolvedPath).href, context);
      }
    } else if (specifier === alias) {
      const exactTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
      return nextResolve(pathToFileURL(exactTarget).href, context);
    } else if (specifier.startsWith(alias + '/')) {
      const baseTarget = target.endsWith('/*') ? target.slice(0, -2) : target;
      const subPath = specifier.slice(alias.length + 1);
      const resolvedPath = path.resolve(baseTarget, subPath);
      return nextResolve(pathToFileURL(resolvedPath).href, context);
    }
  }

  return nextResolve(specifier, context);
}
