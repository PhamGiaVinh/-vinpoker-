import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const LIB_FILES = [
  "src/lib/series-intelligence/seriesCopilotContextV1.ts",
  "src/lib/series-intelligence/scheduleHealthV1.ts",
  "src/lib/series-intelligence/seriesCopilotResponseV1.ts",
  "src/lib/series-intelligence/seriesCopilotEvidenceValidator.ts",
  "src/lib/series-intelligence/seriesCopilotMockAdapter.ts",
];

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Series Copilot PR1 architecture boundary", () => {
  it("keeps the contract and mock vertical slice free of network, Gemini, Supabase, DB and UI imports", () => {
    for (const file of LIB_FILES) {
      const text = source(file);
      expect(text).not.toMatch(/from ["'][^"']*(?:supabase|gemini|google|components|pages)[^"']*["']/i);
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/\b(?:useQuery|useMutation|createClient|invoke)\b/);
      expect(text).not.toMatch(/SERIES_GEMINI_API_KEY|VITE_[A-Z_]*GEMINI/);
    }
  });

  it("keeps the UI behind one default-off flag and mounts only the local panel", () => {
    const flags = source("src/lib/featureFlags.ts");
    const page = source("src/pages/SeriesIntelligence.tsx");
    expect(flags).toMatch(/seriesVCopilotV1:\s*false/);
    expect(page).toMatch(/FEATURES\.seriesVCopilotV1\s*&&\s*\(\s*<VCopilotPanel\b/);
    expect(page).not.toMatch(/GeminiSeriesCopilotProvider|series-intelligence-copilot/);
  });

  it("does not expose a mutable money action in the V panel", () => {
    const panel = source("src/components/series-intelligence/VCopilotPanel.tsx");
    expect(panel).not.toMatch(/setGtd|updateGtd|saveGtd|applyRecommendation|moneyAction/i);
    expect(panel).not.toMatch(/type=["']number["']/);
  });
});
