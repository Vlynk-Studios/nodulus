import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { NodulusError } from '../../core/errors.js';

export function createModuleCommand() {
  return new Command('create-module')
    .description('Scaffolds a new Nodulus module')
    .argument('<name>', 'Module name (lowercase, no spaces/special chars)')
    .option('-p, --path <path>', 'Destination folder path (default: src/modules/<name>)')
    .option('--service', 'Include a service file')
    .option('--routes', 'Include a routes file')
    .option('--repository', 'Include a repository file')
    .option('--schema', 'Include a schema file')
    .option('--full', 'Include all files (service, routes, repository, schema)')
    .option('--js', 'Force generate JavaScript (.js) files')
    .option('--ts', 'Force generate TypeScript (.ts) files')
    .action((name: string, options: { path?: string; service?: boolean; routes?: boolean; repository?: boolean; schema?: boolean; full?: boolean; js?: boolean; ts?: boolean }) => {
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new NodulusError('CLI_ERROR', pc.red(`\nError: Invalid module name "${name}". Module names must be lowercase and contain only letters, numbers, or hyphens.\n`));
      }

      // Detect language extension
      let ext: string;
      if (options.js) {
        ext = 'js';
      } else if (options.ts) {
        ext = 'ts';
      } else {
        // Auto-detect typescript project
        const hasTsConfig = fs.existsSync(path.resolve(process.cwd(), 'tsconfig.json'));
        ext = hasTsConfig ? 'ts' : 'js';
      }

      const modulePath = options.path ? path.resolve(process.cwd(), options.path) : path.resolve(process.cwd(), `src/modules/${name}`);

      if (fs.existsSync(modulePath)) {
        throw new NodulusError('CLI_ERROR', pc.red(`\nError: The directory "${modulePath}" already exists. Cannot scaffold module here.\n`));
      }

      fs.mkdirSync(modulePath, { recursive: true });

      const files: Record<string, string> = {
        [`index.${ext}`]: generateIndex(name),
      };

      const includeAll = options.full;

      if (includeAll || options.service) {
        files[`${name}.service.${ext}`] = generateService(name);
      }
      if (includeAll || options.routes) {
        files[`${name}.routes.${ext}`] = generateRoutes(name);
      }
      if (includeAll || options.repository) {
        files[`${name}.repository.${ext}`] = generateRepository(name);
      }
      if (includeAll || options.schema) {
        files[`${name}.schema.${ext}`] = generateSchema(name);
      }

      for (const [filename, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(modulePath, filename), content.trim() + '\n', 'utf-8');
      }

      console.log(pc.green(`\n✔ Module '${name}' created successfully at ${path.relative(process.cwd(), modulePath)}/`));
      for (const filename of Object.keys(files)) {
        console.log(`  ${pc.cyan(filename)}`);
      }
      console.log(`\nNext step: add '${name}' to the imports array of modules that require it.\n`);
    });
}

function generateIndex(name: string): string {
  return `
import { Module } from '@vlynk-studios/nodulus-core'

Module('${name}', {
  imports: [],
  exports: [],
})
`;
}

function generateRoutes(name: string): string {
  return `
import { Controller } from '@vlynk-studios/nodulus-core'
import { Router } from 'express'

Controller('/${name}')

const router = Router()

// Add your routes here
// router.get('/', (req, res) => { ... })

export default router
`;
}

function generateService(name: string): string {
  const capName = name.charAt(0).toUpperCase() + name.slice(1);
  return `
import { Service } from '@vlynk-studios/nodulus-core'

Service('${capName}Service', { module: '${name}' })

export class ${capName}Service {
  // Business logic here
}
`;
}

function generateRepository(name: string): string {
  const capName = name.charAt(0).toUpperCase() + name.slice(1);
  return `
import { Repository } from '@vlynk-studios/nodulus-core'

Repository('${capName}Repository', { module: '${name}', source: 'database' })

export class ${capName}Repository {
  // Database queries here
}
`;
}

function generateSchema(name: string): string {
  const capName = name.charAt(0).toUpperCase() + name.slice(1);
  return `
import { Schema } from '@vlynk-studios/nodulus-core'

// import { z } from 'zod' // Uncomment and install your preferred validation library
Schema('${capName}Schema', { module: '${name}' })

// export const create${capName}Schema = z.object({
//   // Define your schema here
// })
`;
}
