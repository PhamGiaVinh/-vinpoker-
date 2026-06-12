import type { TvLevel } from "@/types/tv";

/**
 * Seconds until the next scheduled break starts, walking the blind structure
 * from the current level. Null when the current level IS a break, when the
 * current level is not in the structure, or when no break lies ahead.
 */
export function computeNextBreak(
  levels: TvLevel[],
  currentLevelNumber: number | null | undefined,
  remainingSeconds: number,
): number | null {
  if (currentLevelNumber == null) return null;
  const index = levels.findIndex((l) => l.levelNumber === currentLevelNumber);
  const current = levels[index];
  if (!current || current.isBreak) return null;
  let total = remainingSeconds;
  for (let i = index + 1; i < levels.length; i++) {
    if (levels[i].isBreak) return total;
    total += levels[i].durationMinutes * 60;
  }
  return null;
}
