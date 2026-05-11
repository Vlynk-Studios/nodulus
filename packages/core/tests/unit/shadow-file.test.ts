import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  generateModuleId,
  readShadowFile,
  writeShadowFile,
  ensureShadowFile,
  deleteShadowFile,
} from "../../src/nits/shadow-file.js";
import {
  SHADOW_FILE_NAME,
  isShadowFileRecord,
  type ShadowFileRecord,
} from "../../src/nits/shadow-file.types.js";

vi.mock("node:fs");

describe("Shadow File Identity System", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Types & Validation", () => {
    it("isShadowFileRecord returns true for valid v1 schema", () => {
      const valid: ShadowFileRecord = {
        version: 1,
        id: "mod_a1b2c3d4",
        name: "users",
        createdAt: "2024-01-01T12:00:00Z",
      };
      expect(isShadowFileRecord(valid)).toBe(true);
    });

    it("isShadowFileRecord returns false for invalid schemas", () => {
      expect(isShadowFileRecord(null)).toBe(false);
      expect(isShadowFileRecord(undefined)).toBe(false);
      expect(isShadowFileRecord("string")).toBe(false);
      expect(isShadowFileRecord(1234)).toBe(false); // test number
      expect(isShadowFileRecord({})).toBe(false);

      // Missing ID
      expect(
        isShadowFileRecord({
          name: "users",
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ).toBe(false);

      // Invalid ID
      expect(
        isShadowFileRecord({
          version: 1,
          id: "invalid_format", // not 8 hex chars
          name: "users",
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ).toBe(false);

      // Missing name
      expect(
        isShadowFileRecord({
          version: 1,
          id: "mod_a1b2c3d4",
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ).toBe(false);

      // Empty name
      expect(
        isShadowFileRecord({
          version: 1,
          id: "mod_a1b2c3d4",
          name: "",
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ).toBe(false);

      // Invalid date
      expect(
        isShadowFileRecord({
          version: 1,
          id: "mod_a1b2c3d4",
          name: "users",
          createdAt: "not-a-date",
        }),
      ).toBe(false);

      // Missing version
      expect(
        isShadowFileRecord({
          id: "mod_a1b2c3d4",
          name: "users",
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ).toBe(false);

      // Invalid version type
      expect(
        isShadowFileRecord({
          version: "1",
          id: "mod_a1b2c3d4",
          name: "users",
          createdAt: "2024-01-01T12:00:00Z",
        }),
      ).toBe(false);
    });
  });

  describe("ID Generation", () => {
    it("generateModuleId creates an ID matching the format mod_[8hex]", () => {
      const id = generateModuleId();
      expect(id).toMatch(/^mod_[0-9a-f]{8}$/);
    });

    it("generateModuleId creates unique IDs", () => {
      const id1 = generateModuleId();
      const id2 = generateModuleId();
      expect(id1).not.toBe(id2);
    });

    it("generateModuleId does not throw under any condition", () => {
      expect(() => generateModuleId()).not.toThrow();
    });
  });

  describe("I/O Operations", () => {
    const fakeDirPath = "/fake/module/dir";
    const shadowFilePath = path.join(fakeDirPath, SHADOW_FILE_NAME);

    describe("readShadowFile", () => {
      it("returns valid record if file exists and is valid", () => {
        const validRecord: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validRecord));

        const result = readShadowFile(fakeDirPath);
        expect(result).toEqual(validRecord);
      });

      it("returns null if the file does not exist in the directory - without throwing", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        expect(() => {
          const result = readShadowFile(fakeDirPath);
          expect(result).toBeNull();
        }).not.toThrow();
      });

      it("returns null if the directory does not exist - without throwing", () => {
        // Same check as existsSync, but semantically covering the directory missing case
        vi.mocked(fs.existsSync).mockReturnValue(false);

        expect(() => {
          const result = readShadowFile("/does/not/exist");
          expect(result).toBeNull();
        }).not.toThrow();
      });

      it("returns null and logs warning if reading fails (e.g. permission denied)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = readShadowFile(fakeDirPath);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Shadow file read error"),
        );
        warnSpy.mockRestore();
      });

      it("handles non-Error objects thrown during read", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw "String error";
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = readShadowFile(fakeDirPath);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("String error"),
        );
        warnSpy.mockRestore();
      });

      it("returns null and logs warning if JSON is malformed", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("{ invalid json");
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = readShadowFile(fakeDirPath);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Shadow file corrupted at"),
        );
        warnSpy.mockRestore();
      });

      it("returns null and logs warning if the ID format does not match mod_[8hex]", () => {
        const invalidRecord = { id: "bad_id", name: "test", createdAt: "2024-01-01T00:00:00Z" };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidRecord));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = readShadowFile(fakeDirPath);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("has an invalid structure"),
        );
        warnSpy.mockRestore();
      });

      it("returns null and logs warning if name is empty", () => {
        const invalidRecord = { id: "mod_11223344", name: "", createdAt: "2024-01-01T00:00:00Z" };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidRecord));
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = readShadowFile(fakeDirPath);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("has an invalid structure"),
        );
        warnSpy.mockRestore();
      });

      it("does not mutate the object between successive calls to the same file", () => {
        const validRecord: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00Z",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validRecord));

        const result1 = readShadowFile(fakeDirPath);
        const result2 = readShadowFile(fakeDirPath);

        expect(result1).not.toBe(result2); // different references
        expect(result1).toEqual(result2); // same data
      });
    });

    describe("writeShadowFile", () => {
      it("creates the file with indented JSON format (2 spaces)", () => {
        // Setup readShadowFile to return null so it proceeds to write
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const record: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };

        writeShadowFile(fakeDirPath, record);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenContent = writeCall[1] as string;
        
        // Assert indenting
        expect(writtenContent).toContain('{\n  "version": 1,\n  "id": "mod_11223344",\n  "name": "test",\n');
      });

      it("creates a file that is valid for readShadowFile", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const record: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };

        writeShadowFile(fakeDirPath, record);
        
        // Mock the file system to "return" the written content
        const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(writtenContent);
        
        const readBack = readShadowFile(fakeDirPath);
        expect(readBack).toEqual(record);
      });

      it("does not overwrite an existing valid file", () => {
        const existingRecord: ShadowFileRecord = {
          version: 1,
          id: "mod_00001234",
          name: "test",
          createdAt: "2023-01-01T00:00:00.000Z",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingRecord));

        const newRecord: ShadowFileRecord = {
          version: 1,
          id: "mod_new54321",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };

        writeShadowFile(fakeDirPath, newRecord);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
      });

      it("does not throw if writing fails (e.g., no permissions) - emits warn", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const record: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };

        expect(() => writeShadowFile(fakeDirPath, record)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Could not write shadow file"),
        );
        warnSpy.mockRestore();
      });

      it("handles non-Error objects thrown during write", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw "Write string error";
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const record: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };

        expect(() => writeShadowFile(fakeDirPath, record)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Write string error"),
        );
        warnSpy.mockRestore();
      });

      it("writes only the v1 schema fields (strips extra fields)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const record = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
          domain: "should-be-stripped", // v2 field
          history: [], // v2 field
        };

        writeShadowFile(fakeDirPath, record as any);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toBe(shadowFilePath);
        const writtenObj = JSON.parse(writeCall[1] as string);

        expect(writtenObj).toHaveProperty("version", 1);
        expect(writtenObj).toHaveProperty("id", "mod_11223344");
        expect(writtenObj).toHaveProperty("name", "test");
        expect(writtenObj).toHaveProperty("createdAt");
        expect(writtenObj).not.toHaveProperty("domain");
        expect(writtenObj).not.toHaveProperty("history");
      });
    });

    describe("ensureShadowFile", () => {
      it("returns existing record if valid file is present", () => {
        const validRecord: ShadowFileRecord = {
          version: 1,
          id: "mod_11223344",
          name: "test",
          createdAt: "2024-01-01T00:00:00.000Z",
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validRecord));

        const result = ensureShadowFile(fakeDirPath, "test");

        expect(result).toEqual(validRecord);
        expect(fs.writeFileSync).not.toHaveBeenCalled(); // No rewrite needed
      });

      it("creates a new record and writes it if file is missing (validating name and ISO date)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const result = ensureShadowFile(fakeDirPath, "new_module");

        expect(result.id).toMatch(/^mod_[0-9a-f]{8}$/);
        expect(result.name).toBe("new_module");
        // ISO 8601 validation
        expect(new Date(result.createdAt).toISOString()).toBe(result.createdAt);

        expect(fs.writeFileSync).toHaveBeenCalled();
        const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        expect(JSON.parse(writtenContent)).toEqual(result);
      });

      it("generates new ID, overwrites invalid file and returns fresh record", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("{ bad JSON");
        vi.spyOn(console, "warn").mockImplementation(() => {}); // Suppress warning from read

        const result = ensureShadowFile(fakeDirPath, "corrupted_module");

        expect(result.id).toMatch(/^mod_[0-9a-f]{8}$/);
        expect(result.name).toBe("corrupted_module");
        expect(fs.writeFileSync).toHaveBeenCalled();
        
        // Assert it wrote the new record
        const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        expect(JSON.parse(writtenContent)).toEqual(result);
      });
    });

    describe("deleteShadowFile", () => {
      it("deletes the file if it exists", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        
        deleteShadowFile(fakeDirPath);
        
        expect(fs.unlinkSync).toHaveBeenCalledWith(shadowFilePath);
      });

      it("does not throw if file doesn't exist", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        // fs.unlinkSync doesn't throw if missing since we mock it, but we check logic
        
        expect(() => deleteShadowFile(fakeDirPath)).not.toThrow();
      });

      it("does not throw and logs warning if deletion fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.unlinkSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => deleteShadowFile(fakeDirPath)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Could not delete shadow file"),
        );
        warnSpy.mockRestore();
      });
      it("handles non-Error objects thrown during deletion", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.unlinkSync).mockImplementation(() => {
          throw "Delete string error";
        });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() => deleteShadowFile(fakeDirPath)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Delete string error"),
        );
        warnSpy.mockRestore();
      });
    });
  });
});
