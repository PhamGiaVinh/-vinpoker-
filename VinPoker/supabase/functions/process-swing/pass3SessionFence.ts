import type { DealerOperationalTable } from "../_shared/dealerOperationalTables.ts";

/** Inventory absence means unverified/repair required, never permission to release. */
export function isExactOperationalAssignment(
  tables: DealerOperationalTable[],
  assignment: { table_id: string; table_session_id: string | null },
): boolean {
  return !!assignment.table_session_id && tables.some((table) =>
    table.id === assignment.table_id && table.table_session_id === assignment.table_session_id);
}
