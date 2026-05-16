import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { syncTsconfigCommand } from "../../src/cli/commands/sync-tsconfig.js";
import { loadConfig } from "../../src/core/config.js";

vi.mock("fast-glob", () => ({ default: vi.fn() }));
vi.mock("../../src/core/config.js", () => ({ loadConfig: vi.fn() }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeBaseConfig = (overrides: Record<string, unknown> = {}) => ({
  modules: "src/modules/*",
  aliases: {} as Record<string, string>,
  prefix: "",
  strict: true,
  resolveAliases: true,
  logger: {} as any,
  logLevel: "info" as const,
  logFormat: "auto" as const,
  requirePreloader: false,
  nits: { enabled: false },
  ...overrides,
});

describe("CLI: sync-tsconfig", () => {
  let _mockConsoleError: any;
  let _mockConsoleLog: any;
  
  const testDir = path.resolve(process.cwd(), "tests", ".tmp", "sync-tsconfig");
  const tsconfigPath = path.join(testDir, "tsconfig.test.json");

  beforeEach(() => {
    _mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    _mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    // Create a fresh test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const runCommand = async (args: string[]) => {
    const cmd = syncTsconfigCommand();
    await cmd.parseAsync(["node", "cli", ...args]);
  };

  it("throws a descriptive error if tsconfig.json does not exist", async () => {
    // The command's .action() catches all errors and calls process.exit(1) rather
    // than re-throwing. We intercept both process.exit and pino's stdout output.
    // (defaultLogHandler → pino writes JSON to process.stdout, not console.error)
    let capturedCode: number | undefined;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      capturedCode = code;
      throw new Error(`process.exit(${code})`); // abort execution
    }) as any);

    const chunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    });

    await expect(runCommand(["--tsconfig", "nonexistent.json"])).rejects.toThrow("process.exit(1)");

    expect(capturedCode).toBe(1);

    // Pino logs the error as a JSON line — verify "nonexistent.json" appears in output
    const output = chunks.join("");
    expect(output).toMatch(/nonexistent\.json/i);

    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("adds paths correctly to a tsconfig without previous paths", async () => {
    // 1. Setup mock tsconfig
    const initialConfig = { compilerOptions: { target: "es2022" } /* no paths */ };
    fs.writeFileSync(tsconfigPath, JSON.stringify(initialConfig, null, 2), "utf8");

    // 2. Setup mock modules & configs
    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig({ aliases: { "@config": "./src/config" } }) as any
    );
    vi.mocked(fg).mockResolvedValue([
      path.resolve(process.cwd(), "src/modules/auth"),
      path.resolve(process.cwd(), "src/modules/users")
    ]);
    
    // Create dummy index files so relative paths work accurately
    fs.mkdirSync(path.resolve(process.cwd(), "src/modules/auth"), { recursive: true });
    fs.writeFileSync(path.resolve(process.cwd(), "src/modules/auth/index.ts"), "");
    fs.mkdirSync(path.resolve(process.cwd(), "src/modules/users"), { recursive: true });
    fs.writeFileSync(path.resolve(process.cwd(), "src/modules/users/index.ts"), "");

    await runCommand(["--tsconfig", tsconfigPath]);

    const result = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    expect(result.compilerOptions.target).toBe("es2022"); // Did not touch other fields
    expect(result.compilerOptions.paths).toBeDefined();
    expect(result.compilerOptions.paths["@modules/auth"]).toEqual(["./src/modules/auth/index.ts"]);
    expect(result.compilerOptions.paths["@modules/auth/*"]).toEqual(["./src/modules/auth/*"]);
    expect(result.compilerOptions.paths["@modules/users"]).toEqual(["./src/modules/users/index.ts"]);
    expect(result.compilerOptions.paths["@modules/users/*"]).toEqual(["./src/modules/users/*"]);
    expect(result.compilerOptions.paths["@config"]).toEqual(["./src/config"]);
    expect(result.compilerOptions.paths["@config/*"]).toEqual(["./src/config/*"]);
    
    // Cleanup generated mock index files
    fs.rmSync(path.resolve(process.cwd(), "src/modules"), { recursive: true, force: true });
  });

  it("overwrites existing paths without modifying the rest of tsconfig, preserving comments", async () => {
    // Note: To test comment preservation we don't use JSON.parse
    const commentedJson = `{
      // testing comment
      "compilerOptions": {
        "paths": {
          "@modules/old": ["./src/modules/old/index.ts"]
        } // another comment
      }
    }`;
    fs.writeFileSync(tsconfigPath, commentedJson, "utf8");

    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig() as any
    );
    vi.mocked(fg).mockResolvedValue([path.resolve(process.cwd(), "src/modules/new")]);
    fs.mkdirSync(path.resolve(process.cwd(), "src/modules/new"), { recursive: true });
    fs.writeFileSync(path.resolve(process.cwd(), "src/modules/new/index.ts"), "");

    await runCommand(["--tsconfig", tsconfigPath]);

    const rawResult = fs.readFileSync(tsconfigPath, "utf8");
    // Ensure comments survived and JSON modified appropriately
    expect(rawResult).toContain("// testing comment");
    expect(rawResult).toContain("// another comment");
    expect(rawResult).toContain('"@modules/new":');
    
    fs.rmSync(path.resolve(process.cwd(), "src/modules"), { recursive: true, force: true });
  });

  it("is idempotent: running twice produces identical output", async () => {
    const initialConfig = { compilerOptions: { target: "es2022", paths: {} } };
    fs.writeFileSync(tsconfigPath, JSON.stringify(initialConfig, null, 2), "utf8");

    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig() as any
    );
    vi.mocked(fg).mockResolvedValue([path.resolve(process.cwd(), "src/modules/auth")]);
    fs.mkdirSync(path.resolve(process.cwd(), "src/modules/auth"), { recursive: true });
    fs.writeFileSync(path.resolve(process.cwd(), "src/modules/auth/index.ts"), "");

    await runCommand(["--tsconfig", tsconfigPath]);
    const pass1 = fs.readFileSync(tsconfigPath, "utf8");

    await runCommand(["--tsconfig", tsconfigPath]);
    const pass2 = fs.readFileSync(tsconfigPath, "utf8");

    expect(pass1).toBe(pass2);
    
    fs.rmSync(path.resolve(process.cwd(), "src/modules"), { recursive: true, force: true });
  });

  it("automatically removes nested module paths and stale config aliases, but respects manual user paths", async () => {
    // Seed config with paths simulating a stale module, a stale config alias (satisfies heuristic), and untouchable manual paths
    const initialConfig = { 
      compilerOptions: { 
        paths: {
          "@modules/stale": ["./src/modules/stale/index.ts"],
          "@config/*": ["./src/config/*"],
          "custom-alias": ["./dist"],
          "@manual/*": ["C:/absolute/manual/*"], // Starts with absolute path, fails heuristic
          "@manual-two/*": ["./src/manual", "./src/manual2"] // Array length > 1, fails heuristic
        }
      } 
    };
    fs.writeFileSync(tsconfigPath, JSON.stringify(initialConfig, null, 2), "utf8");

    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig({ aliases: {} }) as any // @config exists no more!
    );
    // Returning NO active modules -> Should trigger garbage collection of @modules/stale
    vi.mocked(fg).mockResolvedValue([]);

    await runCommand(["--tsconfig", tsconfigPath]);

    const result = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    const paths = result.compilerOptions.paths;
    
    expect(paths["@modules/stale"]).toBeUndefined(); // Effectively cleaned
    expect(paths["@config/*"]).toBeUndefined(); // Stale config alias also cleaned by heuristic
    expect(paths["custom-alias"]).toBeDefined(); // Manual user paths untampered (doesn't end with /*)
    expect(paths["@manual/*"]).toBeDefined(); // Untouched (does not start with ./)
    expect(paths["@manual-two/*"]).toBeDefined(); // Untouched (array length !== 1)
  });

  it("handles strictly module configurations but gracefully generates domains structure when domains configuration exists", async () => {
    const initialConfig = { compilerOptions: { target: "es2022", paths: {} } };
    fs.writeFileSync(tsconfigPath, JSON.stringify(initialConfig, null, 2), "utf8");

    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig({ domains: "src/domains/*", aliases: {} }) as any
    );

    vi.mocked(fg).mockImplementation((glob) => {
      if (typeof glob === 'string') {
        if (glob.includes('modules')) return Promise.resolve([path.resolve(process.cwd(), "src/modules/users")]);
        if (glob.includes('domains')) return Promise.resolve([path.resolve(process.cwd(), "src/domains/billing")]);
      }
      return Promise.resolve([]);
    });

    fs.mkdirSync(path.resolve(process.cwd(), "src/modules/users"), { recursive: true });
    fs.writeFileSync(path.resolve(process.cwd(), "src/modules/users/index.ts"), "");
    
    fs.mkdirSync(path.resolve(process.cwd(), "src/domains/billing"), { recursive: true });
    fs.writeFileSync(path.resolve(process.cwd(), "src/domains/billing/index.ts"), "");

    await runCommand(["--tsconfig", tsconfigPath]);

    const result = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    const paths = result.compilerOptions.paths;

    // Checks modules exist
    expect(paths["@modules/users"]).toEqual(["./src/modules/users/index.ts"]);
    expect(paths["@modules/users/*"]).toEqual(["./src/modules/users/*"]);

    // Checks domain structural layout generated accurately pointing to internal files/folders
    expect(paths["@billing"]).toEqual(["./src/domains/billing/index.ts"]);
    expect(paths["@billing/*"]).toEqual(["./src/domains/billing/*"]);

    fs.rmSync(path.resolve(process.cwd(), "src/modules"), { recursive: true, force: true });
    fs.rmSync(path.resolve(process.cwd(), "src/domains"), { recursive: true, force: true });
  });

  it("handles file-based custom aliases correctly WITHOUT forcing wildcards (N-12)", async () => {
    const initialConfig = { compilerOptions: { paths: {} } };
    fs.writeFileSync(tsconfigPath, JSON.stringify(initialConfig, null, 2), "utf8");

    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig({
        aliases: {
          "@utils": "./src/shared/utils.ts",
          "@lib": "./src/lib/main.js",
          "@styles": "./src/assets/theme.json",
        },
      }) as any
    );
    vi.mocked(fg).mockResolvedValue([]);

    await runCommand(["--tsconfig", tsconfigPath]);

    const result = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    const paths = result.compilerOptions.paths;

    expect(paths["@utils"]).toEqual(["./src/shared/utils.ts"]);
    expect(paths["@utils/*"]).toBeUndefined();
    
    expect(paths["@lib"]).toEqual(["./src/lib/main.js"]);
    expect(paths["@lib/*"]).toBeUndefined();

    expect(paths["@styles"]).toEqual(["./src/assets/theme.json"]);
    expect(paths["@styles/*"]).toBeUndefined();
  });

  it('generates paths for common aliases (@config, @middleware, @shared) correctly (P5/P6)', async () => {
    const initialConfig = { compilerOptions: { paths: {} } };
    fs.writeFileSync(tsconfigPath, JSON.stringify(initialConfig, null, 2), "utf8");

    vi.mocked(loadConfig).mockResolvedValue(
      makeBaseConfig({
        aliases: {
          "@config": "./src/config",
          "@middleware": "./src/middleware",
          "@shared": "./src/shared",
        },
      }) as any
    );
    vi.mocked(fg).mockResolvedValue([]);

    await runCommand(["--tsconfig", tsconfigPath]);

    const result = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
    const paths = result.compilerOptions.paths;

    expect(paths["@config"]).toBeDefined();
    expect(paths["@config/*"]).toBeDefined();
    expect(paths["@middleware"]).toBeDefined();
    expect(paths["@middleware/*"]).toBeDefined();
    expect(paths["@shared"]).toBeDefined();
    expect(paths["@shared/*"]).toBeDefined();
  });
});
