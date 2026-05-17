import * as fs from 'node:fs';
import * as path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const domainCache = new Map<string, string | null>();
const sharedAllowedCache = new Map<string, string[] | null>();
const moduleImportsCache = new Map<string, string[]>();

export function getDomainFromFilePath(filePath: string): string | null {
  if (domainCache.has(filePath)) {
    return domainCache.get(filePath)!;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  let result: string | null = null;
  
  const match = normalizedPath.match(/\/domains\/([^/]+)\//);
  if (match && match[1]) {
    result = match[1];
  }

  domainCache.set(filePath, result);
  return result;
}

export interface IdentifierCall {
  name: string;
  options: Record<string, unknown>;
}

function extractIdentifierCall(
  filePath: string,
  calleeName: string
): IdentifierCall | null {
  let found: IdentifierCall | null = null;
  try {
    const code = fs.readFileSync(filePath, "utf-8");
    const ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
    });

    walk.simple(ast, {
      CallExpression(node: any) {
        if (node.callee.type === 'Identifier' && node.callee.name === calleeName) {
          const nameArg = node.arguments[0];
          if (nameArg && nameArg.type === "Literal") {
            const name = nameArg.value as string;
            const options: Record<string, unknown> = {};

            const optionsArg = node.arguments[1];
            if (optionsArg && optionsArg.type === "ObjectExpression") {
              for (const prop of optionsArg.properties) {
                if (prop.type !== 'Property') continue;
                
                let keyName = '';
                if (prop.key.type === "Identifier") {
                  keyName = prop.key.name;
                } else if (prop.key.type === "Literal") {
                  keyName = String(prop.key.value);
                }

                if (keyName && prop.value.type === "ArrayExpression") {
                  const arr: string[] = [];
                  let hasNonLiteral = false;
                  for (const elem of prop.value.elements) {
                    if (elem && elem.type === "Literal") {
                      arr.push(String(elem.value));
                    } else if (elem) {
                      hasNonLiteral = true;
                    }
                  }
                  if (hasNonLiteral) {
                    console.warn(`[System] Warning: Found non-literal element (spread, variable, or expression) in "${keyName}" array at ${filePath}. These won't be statically analyzable.`);
                  }
                  options[keyName] = arr;
                } else if (keyName && prop.value.type === "Literal") {
                  options[keyName] = prop.value.value;
                }
              }
            }
            found = { name, options };
          }
        }
      },
    });
  } catch (_error) {
    return null;
  }
  return found;
}

export function getDomainSharedAllowed(sharedIndexPath: string): string[] | null {
  if (sharedAllowedCache.has(sharedIndexPath)) {
    return sharedAllowedCache.get(sharedIndexPath)!;
  }

  let result: string[] | null = null;
  
  if (fs.existsSync(sharedIndexPath)) {
    const call = extractIdentifierCall(sharedIndexPath, 'DomainShared');
    if (call && Array.isArray(call.options.allowedDomains)) {
      result = call.options.allowedDomains as string[];
    }
  }

  sharedAllowedCache.set(sharedIndexPath, result);
  return result;
}

function resolveModuleIndex(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const extensions = ['.ts', '.js', '.mts', '.mjs'];

  for (const ext of extensions) {
    const candidate = path.join(dir, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  const parentDir = path.dirname(dir);
  for (const ext of extensions) {
    const candidate = path.join(parentDir, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function getModuleImports(filePath: string): string[] | null {
  const indexPath = resolveModuleIndex(filePath);
  if (!indexPath) return null;

  if (moduleImportsCache.has(indexPath)) {
    return moduleImportsCache.get(indexPath)!;
  }

  try {
    const call = extractIdentifierCall(indexPath, 'Module');
    if (!call || !Array.isArray(call.options.imports)) {
      moduleImportsCache.set(indexPath, []);
      return [];
    }

    const result = call.options.imports as string[];
    moduleImportsCache.set(indexPath, result);
    return result;
  } catch (_e) {
    return null;
  }
}

export function clearDomainCache() {
  domainCache.clear();
}

export function clearSharedAllowedCache() {
  sharedAllowedCache.clear();
}

export function clearModuleImportsCache() {
  moduleImportsCache.clear();
}
