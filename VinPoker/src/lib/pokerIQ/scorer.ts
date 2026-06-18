// Pure rule-based scorer for the Poker IQ Drill. No DB, no network, no randomness.
import {
  CategoryScore,
  DRILL_CATEGORIES,
  DrillAnswer,
  DrillCategory,
  DrillHand,
} from "./types";

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/** Average baseline-quality of the answered hands in one category (0..100). */
export function scoreCategory(
  hands: DrillHand[],
  answers: DrillAnswer[],
  category: DrillCategory,
): number {
  const catHands = hands.filter((h) => h.category === category);
  let sum = 0;
  let n = 0;
  for (const h of catHands) {
    const a = answers.find((x) => x.handId === h.id);
    if (!a) continue;
    const opt = h.options.find((o) => o.id === a.optionId);
    if (!opt) continue;
    sum += clamp(opt.score);
    n += 1;
  }
  if (n === 0) return 0;
  return Math.round(sum / n);
}

export function categoryScores(hands: DrillHand[], answers: DrillAnswer[]): CategoryScore[] {
  return DRILL_CATEGORIES.map((category) => ({
    category,
    score: scoreCategory(hands, answers, category),
  }));
}

/** Poker IQ = mean of the categories that actually have answers. */
export function totalScore(categoryScores: CategoryScore[]): number {
  const scored = categoryScores.filter((c) => c.score > 0);
  if (scored.length === 0) return 0;
  return Math.round(scored.reduce((s, c) => s + c.score, 0) / scored.length);
}

/**
 * Provisional drill grade. Thresholds are transparent and tunable — they are NOT
 * a guarantee and the result is always labelled "Tạm tính" / Provisional.
 */
export function gradeFromScore(total: number): string {
  if (total >= 85) return "A-";
  if (total >= 73) return "B+";
  if (total >= 66) return "B";
  if (total >= 58) return "C+";
  if (total >= 50) return "C";
  return "Đang phát triển";
}
