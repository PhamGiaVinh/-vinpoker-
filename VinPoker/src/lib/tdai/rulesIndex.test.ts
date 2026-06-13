import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRulesIndex } from "./buildIndex";
import { CORPUS_VERSION, TD_RULES_CORPUS } from "./corpus";

// The edge function imports this committed JSON. This test regenerates it when
// REGEN=1 and otherwise asserts it matches corpus.ts (CI drift guard).
// Regenerate after editing the corpus:
//   REGEN=1 npx vitest run src/lib/tdai/rulesIndex.test.ts
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../supabase/functions/td-ai-assistant/rules-index.json");

describe("rules-index.json parity with corpus.ts", () => {
  const index = buildRulesIndex(TD_RULES_CORPUS, CORPUS_VERSION);

  it("matches the committed edge-function index", () => {
    if (process.env.REGEN) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, JSON.stringify(index, null, 2) + "\n");
    }
    expect(existsSync(OUT)).toBe(true);
    expect(JSON.parse(readFileSync(OUT, "utf8"))).toEqual(index);
  });
});
