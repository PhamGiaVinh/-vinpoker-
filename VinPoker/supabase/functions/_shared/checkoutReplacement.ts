/** Never choose an arbitrary table when checkout uncovers ambiguous assignment history. */
export function checkoutReplacementTarget(rows: readonly {
  id: string; table_id: string | null; table_session_id: string | null; status: string;
}[]) {
  const assigned = rows.filter((row) => row.status === "assigned");
  if (assigned.length !== 1) return null;
  const row = assigned[0];
  return row.id && row.table_id && row.table_session_id ? row : null;
}
