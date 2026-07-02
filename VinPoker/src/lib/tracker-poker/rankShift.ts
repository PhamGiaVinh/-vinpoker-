// A3 (trackerChipQuickEdit) — pure "rank after this hand" math for ReviewHandPanel's
// leaderboard-delta strip. Kept pure (no React, no Supabase) so it's unit-testable
// without rendering useStandaloneHandInput. Never blocks submit — a caller with no
// leaderboard snapshot simply gets `[]` back.

export interface RankShiftRow {
  player_id: string;
  chip_count: number;
}

export interface RankShiftPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  current_stack: number;
}

export interface RankShift {
  player_id: string;
  seat_number: number;
  display_name: string;
  before: number;
  after: number;
}

function rankOf(list: RankShiftRow[], id: string): number {
  const sorted = [...list].sort((a, b) => b.chip_count - a.chip_count);
  return sorted.findIndex((x) => x.player_id === id) + 1; // 0 → not found
}

/**
 * `leaderboardBefore` — the tournament-wide snapshot fetched when Review is reached
 * (everyone's CURRENT chip_count). Only THIS table's seated players move: their
 * projected chip_count comes from `endingStacks` (falling back to current_stack when
 * a player hasn't had their ending stack edited yet); every other row is unchanged.
 * Only seats whose RANK actually shifts are returned (same stack, different rank at
 * a tie boundary is possible and intentionally reported too).
 */
export function computeRankShifts(
  leaderboardBefore: RankShiftRow[],
  players: RankShiftPlayer[],
  endingStacks: Record<string, number>
): RankShift[] {
  const projected = leaderboardBefore.map((row) => {
    const seated = players.find((pp) => pp.player_id === row.player_id);
    if (!seated) return row;
    const projectedChip = endingStacks[row.player_id] ?? seated.current_stack;
    return { player_id: row.player_id, chip_count: projectedChip };
  });
  return players
    .map((p) => ({
      player_id: p.player_id,
      seat_number: p.seat_number,
      display_name: p.display_name,
      before: rankOf(leaderboardBefore, p.player_id),
      after: rankOf(projected, p.player_id),
    }))
    .filter((r) => r.before > 0 && r.after > 0 && r.before !== r.after);
}
