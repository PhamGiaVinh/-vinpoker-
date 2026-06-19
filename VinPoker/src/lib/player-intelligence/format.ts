// Smart Player Card — pure formatters & action logic (no React, fully testable).
// Label helpers return i18n KEY suffixes (the component resolves them with t()),
// so the honest, locale-safe copy lives in the locale files.
import { ConfidenceLevel, NextActionKey, PlayerIntelligence, ProfileStatus, ScenarioWindow } from "./types";

export function formatProfileStatus(s: ProfileStatus): string {
  return `playerIntelligence.status.${s}`;
}

export function formatConfidence(c: ConfidenceLevel): string {
  return `playerIntelligence.confidence.${c}`;
}

/** Source-quality value → i18n key, with a safe fallback for unknown/missing values. */
export function formatSourceQuality(value: string | null | undefined): string {
  const known = new Set([
    "exact_live",
    "manual",
    "missing",
    "leaderboard_view",
    "itm_places",
    "prize",
    "derived_position",
    "confirmed_entries",
    "current_players_snapshot",
    "legacy_total_entries",
    "configured",
    "default_assumed",
    "online_authenticated",
    "offline_ephemeral",
    "raw_observed",
    "unknown",
  ]);
  return `playerIntelligence.sqValue.${value && known.has(value) ? value : "unknown"}`;
}

/** Fraction (0..1) → integer-percent string, e.g. 0.6836 → "68%". null → null. */
export function formatPercent(fraction: number | null | undefined): string | null {
  if (typeof fraction !== "number" || !isFinite(fraction)) return null;
  return `${Math.round(fraction * 100)}%`;
}

/** Expected count → "~N", e.g. 1.0 → "~1". null → null. */
export function formatExpected(n: number | null | undefined): string | null {
  if (typeof n !== "number" || !isFinite(n)) return null;
  return `~${Math.round(n)}`;
}

export interface ScenarioWindowView {
  tournaments: number;
  expectedText: string | null;
  chanceText: string | null;
}

export function formatScenarioWindow(w: ScenarioWindow): ScenarioWindowView {
  return {
    tournaments: w.tournaments,
    expectedText: formatExpected(w.expectedItm),
    chanceText: formatPercent(w.chanceAtLeastOneItm),
  };
}

export function isScenarioUnlocked(pi: PlayerIntelligence): boolean {
  return pi.scenarioOutlook?.unlocked === true;
}

/** Next-best actions by state. Drill for new players; keep playing to build verified
 *  data; fit-events + progress once the outlook is unlocked. */
export function getNextBestAction(pi: PlayerIntelligence): NextActionKey[] {
  if (isScenarioUnlocked(pi)) return ["see_fit_events", "track_progress"];
  if (pi.profileStatus === "new") return ["play_drill", "join_first_event"];
  return ["keep_playing_recorded"];
}

/** Whether the raw-observed disclaimer copy must be shown (no shrinkage applied). */
export function isRawObservedRate(pi: PlayerIntelligence): boolean {
  return pi.scenarioOutlook?.basedOn?.rateMethod === "raw_observed";
}

// Compliance guard — these must never appear in any Smart Player Card copy.
export const FORBIDDEN_TERMS: string[] = [
  "Model Estimate",
  "Tested Finding",
  "AI predicts",
  "AI dự đoán",
  "guaranteed",
  "chắc chắn",
  "cam kết thắng",
  "cam kết kết quả thắng",
  "dự đoán",
  "sẽ ITM",
];
