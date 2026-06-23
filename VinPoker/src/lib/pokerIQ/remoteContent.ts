// Remote Poker IQ question bank — pure parsing / validation / merge helpers.
//
// Super Admin authors questions in the panel; they are stored as a JSON array
// under the `app_settings` key below (public read, super_admin write — the same
// pattern as banners / currency_rates / packages). This module is PURE (no
// supabase, no network) so it stays testable and the barrel can re-export it
// without pulling the supabase client into the test env. The actual fetch lives
// in `loadRemoteQuestions.ts`, which is NOT re-exported by the barrel.
import { DRILL_CATEGORIES, DrillHand, DrillOption } from "./types";

/** app_settings key holding the authored DrillHand[] bank. */
export const POKER_IQ_QUESTIONS_KEY = "poker_iq_questions";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const VILLAINS = ["aggro", "nit", "passive", "unknown"] as const;
const CONFIDENCES = ["low", "medium", "high"] as const;
const REVIEW_STATUSES = ["draft", "approved"] as const;

const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const inSet = <T extends string>(set: readonly T[], v: unknown): v is T => typeof v === "string" && (set as readonly string[]).includes(v);

function isValidOption(o: unknown): o is DrillOption {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  if (!isNonEmpty(x.id) || !isStr(x.label)) return false;
  if (typeof x.score !== "number" || !Number.isFinite(x.score) || x.score < 0 || x.score > 100) return false;
  if (x.leaks !== undefined && (!Array.isArray(x.leaks) || !x.leaks.every(isStr))) return false;
  return true;
}

/**
 * Strict shape guard. Protects the live drill from a corrupt / hand-edited bank:
 * the critical invariants the scorer relies on are (a) ≥2 valid options and
 * (b) `preferredBaseline` referencing a real option id.
 */
export function isValidDrillHand(h: unknown): h is DrillHand {
  if (!h || typeof h !== "object") return false;
  const x = h as Record<string, unknown>;
  if (!isNonEmpty(x.id)) return false;
  if (!isStr(x.contentVersion)) return false;
  if (!inSet(REVIEW_STATUSES, x.reviewStatus)) return false;
  if (!inSet(DRILL_CATEGORIES, x.category)) return false;
  if (!inSet(DIFFICULTIES, x.difficulty)) return false;
  if (!inSet(VILLAINS, x.villainProfile)) return false;
  if (!isStr(x.heroHand) || !isStr(x.position)) return false;
  if (typeof x.stackBb !== "number" || !Number.isFinite(x.stackBb) || x.stackBb <= 0) return false;
  if (!isNonEmpty(x.scenario)) return false;
  if (!Array.isArray(x.options) || x.options.length < 2 || !x.options.every(isValidOption)) return false;
  const ids = new Set((x.options as DrillOption[]).map((o) => o.id));
  if (ids.size !== (x.options as DrillOption[]).length) return false; // duplicate option ids
  if (!isNonEmpty(x.preferredBaseline) || !ids.has(x.preferredBaseline as string)) return false;
  if (!Array.isArray(x.acceptableAlternatives) || !x.acceptableAlternatives.every(isStr)) return false;
  if (!isStr(x.explanation)) return false;
  if (!inSet(CONFIDENCES, x.contentConfidence)) return false;
  if (!isStr(x.provenanceNote)) return false;
  return true;
}

/** Parse the raw app_settings value into a list of VALID hands (drafts + approved). */
export function parseQuestionBank(raw: unknown): DrillHand[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidDrillHand);
}

/** Only the hands a coach/TD has approved — the sole content that may ship to players. */
export function approvedHands(hands: DrillHand[]): DrillHand[] {
  return hands.filter((h) => h.reviewStatus === "approved");
}

/**
 * Merge authored hands over a base bank: an authored hand REPLACES a base hand
 * with the same id (override), and a new id is APPENDED after the base order.
 * Pure + order-stable so cohorts stay comparable.
 */
export function mergeHands(base: DrillHand[], extra: DrillHand[]): DrillHand[] {
  const extraById = new Map(extra.map((h) => [h.id, h]));
  const overridden = base.map((h) => extraById.get(h.id) ?? h);
  const baseIds = new Set(base.map((h) => h.id));
  const appended = extra.filter((h) => !baseIds.has(h.id));
  return [...overridden, ...appended];
}
