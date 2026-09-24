import type { BlindLevel } from "./blindPresets";

export interface BlindDraftInput {
  startingStack: number;
  targetMinutes: number;
  levelMinutes: number;
  startingDepth: number;
  breakEvery: number;
  breakMinutes: number;
}

/** An editable schedule, not a prediction of when the tournament ends. */
export function suggestBlindDraft(input: BlindDraftInput): BlindLevel[] {
  const { startingStack, targetMinutes, levelMinutes, startingDepth, breakEvery, breakMinutes } = input;
  const whole = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (!whole(startingStack, 1_000, 1_000_000_000) || !whole(targetMinutes, 60, 720) ||
      !whole(levelMinutes, 10, 60) || !whole(startingDepth, 20, 500) ||
      !whole(breakEvery, 1, 12) || !whole(breakMinutes, 0, 60)) {
    throw new RangeError("Check the starting stack, duration, depth and break settings.");
  }

  const rows: BlindLevel[] = [];
  const firstBB = Math.max(100, Math.round(startingStack / startingDepth / 100) * 100);
  let elapsed = 0;
  let playingLevels = 0;
  let previousBB = 0;
  while (elapsed < targetMinutes) {
    if (playingLevels > 0 && playingLevels % breakEvery === 0 && breakMinutes > 0 && elapsed + breakMinutes < targetMinutes) {
      rows.push({ level_number: rows.length + 1, small_blind: 0, big_blind: 0, ante: 0, duration_minutes: breakMinutes, is_break: true });
      elapsed += breakMinutes;
    }
    const proposedBB = Math.min(startingStack * 2, firstBB * 1.4 ** playingLevels);
    const bb = Math.max(previousBB + 100, Math.round(proposedBB / 100) * 100);
    rows.push({ level_number: rows.length + 1, small_blind: Math.max(100, Math.floor(bb / 200) * 100),
      big_blind: bb, ante: bb, duration_minutes: levelMinutes, is_break: false });
    previousBB = bb;
    playingLevels++;
    elapsed += levelMinutes;
  }
  return rows;
}

export function isValidBlindDraft(rows: BlindLevel[]): boolean {
  const whole = (n: number, min: number) => Number.isSafeInteger(n) && n >= min;
  return rows.length > 0 && rows.length <= 200 && rows.some(row => !row.is_break) && rows.every((row, index) =>
    row.level_number === index + 1 && whole(row.duration_minutes, 1) && row.duration_minutes <= 120 &&
    whole(row.small_blind, 0) && whole(row.big_blind, 0) && whole(row.ante, 0) &&
    (row.is_break ? row.small_blind === 0 && row.big_blind === 0 && row.ante === 0
      : row.small_blind > 0 && row.big_blind >= row.small_blind));
}
