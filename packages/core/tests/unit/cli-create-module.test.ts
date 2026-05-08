import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createModuleCommand } from "../../src/cli/commands/create-module.js";

describe("CLI: create-module", () => {
  let _mockConsoleError: any;
  let _mockConsoleLog: any;
  const testModuleDir = path.resolve(
    process.cwd(),
    "tests",
    ".tmp",
    "create-module-test",
  );

  beforeEach(() => {
    _mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    _mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    // Clean up tmp dir if exists
    if (fs.existsSync(testModuleDir)) {
      fs.rmSync(testModuleDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(testModuleDir)) {
      fs.rmSync(testModuleDir, { recursive: true, force: true });
    }
  });

  const runCommand = async (args: string[]) => {
    const cmd = createModuleCommand();
    // commander expects node executable as first arg, script as second
    await cmd.parseAsync(["node", "cli", ...args]);
  };

  it('generates only index.ts by default', async () => {
    await runCommand(['payments', '--path', testModuleDir]);
  
    expect(fs.existsSync(path.join(testModuleDir, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.service.ts'))).toBe(false);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.routes.ts'))).toBe(false);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.repository.ts'))).toBe(false);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.schema.ts'))).toBe(false);
  });

  it('--service generates index and service', async () => {
    await runCommand(['payments', '--path', testModuleDir, '--service']);
  
    expect(fs.existsSync(path.join(testModuleDir, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.service.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.routes.ts'))).toBe(false);
  });

  it('--routes generates index and routes', async () => {
    await runCommand(['payments', '--path', testModuleDir, '--routes']);
  
    expect(fs.existsSync(path.join(testModuleDir, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.routes.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.service.ts'))).toBe(false);
  });

  it('--service --routes generates index, service and routes', async () => {
    await runCommand(['payments', '--path', testModuleDir, '--service', '--routes']);
  
    expect(fs.existsSync(path.join(testModuleDir, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.service.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.routes.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.repository.ts'))).toBe(false);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.schema.ts'))).toBe(false);
  });

  it('--full generates all files', async () => {
    await runCommand(['payments', '--path', testModuleDir, '--full']);
  
    expect(fs.existsSync(path.join(testModuleDir, 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.service.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.routes.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.repository.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, 'payments.schema.ts'))).toBe(true);
  });

  it("throws a descriptive error when name contains uppercase letters or spaces", async () => {
    await expect(
      runCommand(["Invalid Name", "--path", testModuleDir]),
    ).rejects.toThrow(/Invalid module name/i);

    expect(fs.existsSync(testModuleDir)).toBe(false);
  });

  it("forces generation of .js files when --js is passed", async () => {
    await runCommand(["testmodule", "--path", testModuleDir, "--js"]);

    expect(fs.existsSync(path.join(testModuleDir, "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, "index.ts"))).toBe(false);
  });

  it("forces generation of .ts files when --ts is passed", async () => {
    await runCommand(["testmodule", "--path", testModuleDir, "--ts"]);

    expect(fs.existsSync(path.join(testModuleDir, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testModuleDir, "index.js"))).toBe(false);
  });

  it("throws a descriptive error when the target directory already exists", async () => {
    // Pre-create the directory to trigger the clash
    fs.mkdirSync(testModuleDir, { recursive: true });

    await expect(
      runCommand(["testmodule", "--path", testModuleDir]),
    ).rejects.toThrow(/already exists/i);
  });

  it("generates a schema without hardcoding zod dependency", async () => {
    await runCommand(["testmodule", "--path", testModuleDir, "--schema"]);
    
    const schemaFile = path.join(testModuleDir, "testmodule.schema.ts");
    expect(fs.existsSync(schemaFile)).toBe(true);

    const schemaContent = fs.readFileSync(schemaFile, 'utf8');

    // Test: the generated schema does NOT contain import { z } from 'zod' (enabled)
    expect(schemaContent).not.toMatch(/^import\s+\{\s*z\s*\}\s+from\s+['"]zod['"]/m);
    // Test: the generated schema does contain Schema(' call
    expect(schemaContent).toMatch(/Schema\('TestmoduleSchema'/);
    // Ensure the zod import is commented out safely behind a suggestion
    expect(schemaContent).toMatch(/\/\/\s*import\s+\{\s*z\s*\}\s+from\s+['"]zod['"]/);
  });
});
