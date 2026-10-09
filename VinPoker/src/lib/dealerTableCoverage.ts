type Table = { id: string; status: string; table_session_id?: string | null };
type Assignment = { table_id: string; table_session_id: string | null; status: string; released_at: string | null };
/** Shared coverage denominator for both Swing summaries; physical tables are not sessions. */
export function dealerTableCoverage(tables: Table[], assignments: Assignment[]) {
  const active = tables.filter((table) => table.status === "active");
  const covered = new Set(assignments.filter((assignment) => assignment.status === "assigned" && !assignment.released_at
    && active.some((table) => table.id === assignment.table_id && !!table.table_session_id && table.table_session_id === assignment.table_session_id))
    .map((assignment) => assignment.table_id));
  return { activeTables: active.length, assignedTables: covered.size };
}
