import { TD_RULES_CORPUS } from "./corpus";
import type { TdRule, TdRuleCategory } from "./types";

// Maps a TdAnswer back to the domain it came from, by looking up its matched
// rule ids in the corpus. Works for both the offline fallback and the real AI
// answer (the edge function rebuilds citations from the same corpus). Used only
// to label the answer card — never authority.

const CATEGORY_BY_ID = new Map<string, TdRuleCategory>(
  TD_RULES_CORPUS.map((r) => [r.id, r.category ?? "ruling"]),
);

const RULE_BY_ID = new Map<string, TdRule>(TD_RULES_CORPUS.map((r) => [r.id, r]));

/** The full corpus entry behind a citation (so the UI can show its text). */
export function findCorpusRule(ruleId: string): TdRule | undefined {
  return RULE_BY_ID.get(ruleId);
}

/** Most-common category among the matched rules; null when nothing matched. */
export function dominantCategory(matchedRuleIds: string[]): TdRuleCategory | null {
  const counts = new Map<TdRuleCategory, number>();
  for (const id of matchedRuleIds) {
    const cat = CATEGORY_BY_ID.get(id);
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  let best: TdRuleCategory | null = null;
  let bestN = 0;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

/** i18n key for the chip label of each domain. */
export const CATEGORY_I18N_KEY: Record<TdRuleCategory, string> = {
  ruling: "tdAi.category.ruling",
  operations: "tdAi.category.operations",
  floor: "tdAi.category.floor",
  strategy: "tdAi.category.strategy",
};
