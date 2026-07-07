// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner — shift-window preference (pure, auto-fill Patch 3)
// ═══════════════════════════════════════════════════════════════════════════════
// Classifies a shift window by its local start hour and scores a dealer's stated
// preference (dealers.shift_preference: som | muon | linh_hoat) against it.
//   som   (sáng)  : 05:00 ≤ start < 12:00
//   muon  (tối/đêm): start ≥ 15:00  OR  start < 05:00   (evening + overnight)
//   neutral        : 12:00 ≤ start < 15:00  (midday — neither early nor late)
// A flexible / unset dealer (null | linh_hoat) is never penalised or boosted.

import { startHourLocal } from "./time";

export type ShiftWindowClass = "som" | "muon" | "neutral";

export function classifyShiftWindow(startAt: string, tzOffsetMinutes: number): ShiftWindowClass {
  const h = startHourLocal(startAt, tzOffsetMinutes);
  if (h >= 5 && h < 12) return "som";
  if (h >= 15 || h < 5) return "muon";
  return "neutral";
}

export interface PreferenceScore {
  points: number;
  label: string;
}

/** Soft-score a dealer's preference against a window class.
 *  match → +25 · opposite (som vs muon) → −15 · neutral window or flexible dealer → 0. */
export function preferenceScore(
  dealerPreference: string | null | undefined,
  windowClass: ShiftWindowClass
): PreferenceScore {
  if (!dealerPreference || dealerPreference === "linh_hoat") return { points: 0, label: "" };
  if (windowClass === "neutral") return { points: 0, label: "" };
  if (dealerPreference === windowClass) return { points: 25, label: "Đúng ca ưa thích" };
  return { points: -15, label: "Lệch ca ưa thích" };
}
