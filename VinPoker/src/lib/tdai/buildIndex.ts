import type { TdRule } from "./types";

// The rules index = the corpus + its version. The edge function imports the
// committed JSON (rules-index.json); the frontend fallback imports the corpus
// directly — both derive from corpus.ts, so they cannot disagree on content.

export interface RulesIndex {
  version: string;
  generatedFrom: string;
  rules: TdRule[];
}

export function buildRulesIndex(corpus: TdRule[], version: string): RulesIndex {
  return { version, generatedFrom: "src/lib/tdai/corpus.ts", rules: corpus };
}
