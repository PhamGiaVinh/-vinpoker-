export type TournamentChipMetrics = {
  activeSeatCount: number;
  tableChipTotal: number;
  averageStack: number | null;
  rosterQuality: "exact" | "partial";
};

/**
 * Tournament stacks and physical inventory are deliberately separate domains.
 * Average stack is exact only when the active-seat snapshot agrees with the
 * tournament's server-reported remaining-player count.
 */
export function deriveTournamentChipMetrics(
  activeSeatStacks: readonly number[],
  playersRemaining: number | null,
): TournamentChipMetrics {
  const validStacks = activeSeatStacks.filter((stack) => Number.isSafeInteger(stack) && stack >= 0);
  const activeSeatCount = validStacks.length;
  const tableChipTotal = validStacks.reduce((total, stack) => total + stack, 0);
  const exact = validStacks.length === activeSeatStacks.length
    && playersRemaining != null
    && playersRemaining === activeSeatCount;

  return {
    activeSeatCount,
    tableChipTotal,
    averageStack: exact && activeSeatCount > 0 ? Math.round(tableChipTotal / activeSeatCount) : null,
    rosterQuality: exact ? "exact" : "partial",
  };
}
