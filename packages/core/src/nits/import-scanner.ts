import * as fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import fg from "fast-glob";
import type { MovedModule } from "../types/nits.js";

import { calculateAlias } from "./utils.js";

export interface ImportFound {
  specifier: string;
  line: number;
  file: string;
}

/**
 * Extracts external module imports from a file using Regex.
 * This is more robust than a non-TS parser for .ts files.
 */
export function extractModuleImports(filePath: string): ImportFound[] {
  const imports: ImportFound[] = [];

  try {
    const code = fs.readFileSync(filePath, "utf-8");
    const isJs = filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs');

    // For JS files, we try to parse with acorn to maintain the "malformed file" warning
    // required by the unit tests.
    if (isJs) {
      try {
        acorn.parse(code, {
          ecmaVersion: "latest",
          sourceType: "module",
        });
      } catch (e: any) {
        console.warn(`[System] [NITS Parser] Warning: Failed to parse imports in "${filePath}".`);
        console.debug(`  Detail: ${e.message}`);
        return [];
      }
    }
    
    // Regex to match imports: import ... from 'specifier' or import 'specifier'
    // Also matches: export ... from 'specifier'
    const importRegex = /(?:import|export)\s+(?:[^"';]+\s+from\s+)?['"]([^"';]+)['"]/g;
    
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      while ((match = importRegex.exec(lines[i])) !== null) {
        const specifier = match[1];
        if (specifier.startsWith("@")) {
          const excludedScopes = [
            "@types", "@typescript-eslint", "@vitest", "@eslint", "@nestjs", 
            "@angular", "@babel", "@jest", "@testing-library", "@vitejs", 
            "@swc", "@puppeteer", "@playwright"
          ];
          
          const isExcluded = excludedScopes.some(scope => specifier.startsWith(scope + "/") || specifier === scope);
          
          if (!isExcluded) {
            imports.push({
              specifier,
              line: i + 1,
              file: filePath,
            });
          }
        }
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
       return [];
    }
    // General fallback warning
    console.warn(`[System] [NITS Parser] Warning: Failed to parse imports in "${filePath}".`);
    console.debug(`  Detail: ${error.message}`);
    return [];
  }

  return imports;
}


/**
 * Given a list of moved modules, scans the entire project for files that
 * are still importing from the old aliases.
 */
export async function scanBrokenImports(
  movedModules: MovedModule[], 
  projectRoot: string
): Promise<MovedModule[]> {
  if (movedModules.length === 0) return [];

  const files = await fg("**/*.{ts,js,mts,mjs}", {
    cwd: projectRoot,
    absolute: true,
    ignore: [
      "**/node_modules/**", 
      "**/dist/**", 
      "**/*.test.*", 
      "**/*.spec.*", 
      "**/*.d.ts"
    ],
  });

  const movedWithAliases = movedModules.map(m => ({
    ...m,
    oldAlias: calculateAlias(m.oldPath)
  }));

  for (const file of files) {
    const imports = extractModuleImports(file);
    if (imports.length === 0) continue;

    for (const imp of imports) {
      for (const moved of movedWithAliases) {
        const alias = moved.oldAlias;
        // Match exact alias or sub-paths (e.g., @modules/users/types)
        if (imp.specifier === alias || imp.specifier.startsWith(alias + "/")) {
          moved.brokenImports.push({
            file: path.relative(projectRoot, file).replace(/\\/g, '/'),
            line: imp.line,
            specifier: imp.specifier
          });
        }
      }
    }
  }

  // Return original MovedModule structure (without temporary _oldAlias)
  return movedWithAliases.map(({ oldAlias: _oldAlias, ...m }) => m as MovedModule);
}
