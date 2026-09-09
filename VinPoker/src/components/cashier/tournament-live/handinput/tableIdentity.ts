export interface TournamentTableIdentityRow {
  id: string;
  table_id: string | null;
}

/** Resolve a table id from the roster RPC to exactly one canonical tournament-table id. */
export function resolveTournamentTableId(
  rows: readonly TournamentTableIdentityRow[],
  tableId: string,
): string | null {
  const matches = rows
    .filter((row) => (row.id === tableId || row.table_id === tableId) && row.id.length > 0)
    .map((row) => row.id);
  return matches.length === 1 ? matches[0] : null;
}
