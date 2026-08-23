export interface TournamentTableIdentityRow {
  id: string;
  table_id: string | null;
}

/** Resolve a physical table id to exactly one canonical tournament-table id. */
export function resolveTournamentTableId(
  rows: readonly TournamentTableIdentityRow[],
  physicalTableId: string,
): string | null {
  const matches = rows
    .filter((row) => row.table_id === physicalTableId && row.id.length > 0)
    .map((row) => row.id);
  return matches.length === 1 ? matches[0] : null;
}
