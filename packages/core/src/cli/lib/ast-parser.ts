import * as fs from "node:fs";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import type { CallExpression, Literal, ObjectExpression, ArrayExpression } from 'estree';

// Note about TypeScript and acorn parsing:
// Acorn does not support TS syntax natively — if parsing fails, the file is silently skipped;
// for compiled TS projects, it is recommended to parse the JS output from the `dist/` folder.
export interface IdentifierCall {
  name: string;
  options: Record<string, unknown>;
}

export interface ModuleDeclaration {
  name: string;
  imports: string[];
}

export function extractIdentifierCall(
  filePath: string,
  calleeName: string
): IdentifierCall | null {
  let found: IdentifierCall | null = null;
  let code = "";

  try {
    code = fs.readFileSync(filePath, "utf-8");
    const ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    });

    walk.simple(ast, {
      CallExpression(node) {
        const call = node as unknown as CallExpression;
        if (call.callee.type === 'Identifier' && call.callee.name === calleeName) {
          const nameArg = call.arguments[0] as Literal;
          if (nameArg && nameArg.type === "Literal") {
            const name = nameArg.value as string;
            const options: Record<string, unknown> = {};

            const optionsArg = call.arguments[1] as ObjectExpression;
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
                  const arrayVal = prop.value as ArrayExpression;
                  for (const elem of arrayVal.elements) {
                    if (elem && elem.type === "Literal") {
                      arr.push(String(elem.value));
                    }
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
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    // Ignore acorn parse errors for now to allow fallback to operate
  }

  // Fallback: Acorn does not parse TypeScript natively (interfaces, types, strong typings).
  // Regex support is explicitly documented and centralized here as a fallback.
  if (!found && code) {
    const regex = new RegExp(`${calleeName}\\s*\\(\\s*['"]([^'"]+)['"]`, "g");
    let match;
    while ((match = regex.exec(code)) !== null) {
      found = { name: match[1], options: {} };
    }
  }

  return found;
}

export function extractModuleDeclaration(
  indexPath: string,
): ModuleDeclaration | null {
  const result = extractIdentifierCall(indexPath, 'Module');
  if (!result) return null;

  return {
    name: result.name,
    imports: Array.isArray(result.options.imports) ? (result.options.imports as string[]) : [],
  };
}

