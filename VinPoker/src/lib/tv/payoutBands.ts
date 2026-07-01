import type { TvPrize } from "@/types/tv";

export interface PayoutBandRow { label: string; amount: number }
export interface GroupedPayout { rows: PayoutBandRow[]; truncatedCount: number }

/**
 * Collapse CONSECUTIVE, CONTIGUOUS prize positions sharing the identical amount into one
 * labeled row ("10–12" instead of three duplicate "10"/"11"/"12" rows). Pure display
 * simplification with no archetype knowledge: it naturally renders a LIVE_STANDARD run's
 * banded ranks (10+) as one row per band while individual-ladder archetypes (DAILY/INTL/
 * MULTI/TRITON/CUSTOM — no two ranks share an amount) render exactly one row per rank, same
 * as before. A gap in position (even with equal amounts) never merges, so this can't hide
 * a missing rank.
 */
export function groupPayoutRows(prizes: TvPrize[], maxRows = 15): GroupedPayout {
  const sorted = [...prizes].sort((a, b) => a.position - b.position);
  const groups: PayoutBandRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].position === sorted[j].position + 1 && sorted[j + 1].amount === start.amount) j++;
    const end = sorted[j];
    groups.push({ label: start.position === end.position ? `${start.position}` : `${start.position}–${end.position}`, amount: start.amount });
    i = j + 1;
  }
  const rows = groups.slice(0, maxRows);
  return { rows, truncatedCount: Math.max(0, groups.length - rows.length) };
}
