import fg from 'fast-glob';
import path from 'node:path';
import fs from 'node:fs';
import { 
  extractModuleDeclaration,
  extractIdentifierCall
} from './ast-parser.js';
import {
  extractModuleImports, 
  type ImportFound 
} from '../../nits/import-scanner.js';
import type { NodulusConfig } from '../../types/index.js';

export interface BaseNode {
  name: string;
  dirPath: string;
  indexPath: string;
  declaredImports: string[];
  actualImports: ImportFound[];
  internalIdentifiers: string[];
}

export interface ModuleNode extends BaseNode {
  id?: string;
  domain?: string;
  submodules?: string[];
  /** How identity was resolved in the last NITS reconciliation cycle. @since v1.5.5 */
  resolvedBy?: 'shadow-file' | 'path' | 'jaccard';
}

export interface SubModuleNode extends BaseNode {
  parentModule: string;
  domain?: string;
}

export interface DomainNode {
  name: string;
  dirPath: string;
  indexPath: string;
  modules: ModuleNode[];
}

export interface ModuleGraph {
  domains: DomainNode[];
  modules: ModuleNode[];
}

export async function buildModuleGraph(config: NodulusConfig, cwd: string): Promise<ModuleGraph> {
  const modulesGlob = config.modules || 'src/modules/*';
  const dirs = await fg(modulesGlob, { cwd, onlyDirectories: true, absolute: true });
  const nodes: ModuleNode[] = [];

  for (const dirPath of dirs) {
    let indexPath = path.join(dirPath, 'index.ts');
    if (!fs.existsSync(indexPath)) {
      indexPath = path.join(dirPath, 'index.js');
      if (!fs.existsSync(indexPath)) {
        continue;
      }
    }

    const declaration = extractModuleDeclaration(indexPath);
    if (!declaration) {
      continue;
    }

    const actualImports: ImportFound[] = [];
    const internalIdentifiers: string[] = [];
    // NOTE: 'Controller' excluded — its first arg is an HTTP route, not a semantic
    // domain identifier. See BUG-1 in nits-hash.ts for full rationale.
    const targetCallees = ['Service', 'Repository', 'Schema'];

    // Also check index file for identifiers
    for (const callee of targetCallees) {
      const result = extractIdentifierCall(indexPath, callee);
      if (result) internalIdentifiers.push(result.name);
    }

    const moduleFiles = await fg('**/*.{ts,js,mts,mjs}', {
      cwd: dirPath,
      absolute: true,
      ignore: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', 'index.*']
    });

    for (const file of moduleFiles) {
      const fileImports = extractModuleImports(file);
      actualImports.push(...fileImports);
      
      for (const callee of targetCallees) {
        const result = extractIdentifierCall(file, callee);
        if (result) internalIdentifiers.push(result.name);
      }
    }

    nodes.push({
      name: declaration.name,
      dirPath,
      indexPath,
      declaredImports: declaration.imports,
      actualImports,
      internalIdentifiers
    });
  }

  return {
    domains: [],
    modules: nodes
  };
}
