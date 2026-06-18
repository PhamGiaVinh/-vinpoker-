// Style tag (archetype), strengths, and leaks — derived from category subscores.
// Deterministic, transparent rules. No black box.
import { Archetype, CategoryScore, DrillCategory, LeakTag, StrengthTag } from "./types";

function asMap(cs: CategoryScore[]): Record<DrillCategory, number> {
  const m = {} as Record<DrillCategory, number>;
  for (const c of cs) m[c.category] = c.score;
  return m;
}

/** Classify a player's style from their subscore profile. */
export function classifyArchetype(cs: CategoryScore[]): Archetype {
  const s = asMap(cs);
  const disc = s.preflop_discipline ?? 0;
  const pos = s.position_steal ?? 0;
  const aggro = s.vs_aggro ?? 0;
  const nit = s.vs_nit_passive ?? 0;
  const tp = s.tournament_pressure ?? 0;

  if (disc >= 72 && nit >= 72 && (pos < 72 || aggro < 72)) return "tight_solid";
  if (aggro >= 75 && pos >= 75) return "aggressive_builder";
  if (tp >= 78 && nit >= 70) return "final_table_hunter";
  if (aggro >= 75 && tp < 60) return "high_variance_attacker";
  if (pos < 60 && aggro < 60 && disc >= 62) return "passive_caller";
  if (tp >= 72 && aggro < 66) return "bubble_survivor";
  if (tp < 60 && pos < 66) return "short_stack_specialist";
  return "rising_grinder";
}

const LEAK_BY_CATEGORY: Record<DrillCategory, LeakTag> = {
  preflop_discipline: "overcall_oop",
  position_steal: "tight_btn_co",
  vs_aggro: "overfold_vs_aggro",
  vs_nit_passive: "spew_vs_nit",
  tournament_pressure: "resteal_15_25",
};

const STRENGTH_BY_CATEGORY: Record<DrillCategory, StrengthTag> = {
  preflop_discipline: "preflop_discipline",
  position_steal: "position_aware",
  vs_aggro: "low_spew",
  vs_nit_passive: "read_nit",
  tournament_pressure: "icm_aware",
};

/** Private leak tags: weakest categories below threshold (lowest first), capped. */
export function deriveLeaks(cs: CategoryScore[], threshold = 75, max = 3): LeakTag[] {
  return [...cs]
    .filter((c) => c.score < threshold)
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((c) => LEAK_BY_CATEGORY[c.category]);
}

/**
 * Strengths: strongest categories at/above threshold (highest first). If the
 * profile is steady overall (decent total, no badly-broken category) we also
 * surface "low_spew" so a positive identity always shows.
 */
export function deriveStrengths(cs: CategoryScore[], total: number, threshold = 78, max = 3): StrengthTag[] {
  const strong = [...cs]
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((c) => STRENGTH_BY_CATEGORY[c.category]);

  const minScore = cs.length ? Math.min(...cs.map((c) => c.score)) : 0;
  if (total >= 68 && minScore >= 50 && !strong.includes("low_spew")) {
    strong.push("low_spew");
  }
  return strong.slice(0, max);
}
