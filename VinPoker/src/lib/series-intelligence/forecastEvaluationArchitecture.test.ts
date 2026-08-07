import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_FILES = ["forecastEvaluationTypes.ts", "forecastEvaluationV1.ts", "forecastEvaluationAggregate.ts"];

describe("D2D-A architecture boundary", () => {
  it("keeps the kernel free of UI, persistence and network imports", () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(resolve(HERE, file), "utf8");
      expect(source).not.toMatch(/from ["'](?:react|@supabase|supabase|node-fetch|axios)/);
      expect(source).not.toMatch(/fetch\s*\(/);
      expect(source).not.toMatch(/localStorage|sessionStorage|window\.|document\./);
    }
  });

  it("does not expose calibration, probability or money decision claims", () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(resolve(HERE, file), "utf8");
      expect(source).not.toMatch(/confidence coverage|overlay probability|optimal GTD|recommended GTD|profit recommendation/i);
    }
  });
});
