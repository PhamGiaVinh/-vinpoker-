/** Service-only server inventory. No fallback to reusable physical-table status. */
export interface DealerOperationalTable {
  id: string;
  table_session_id: string;
  tournament_id: string | null;
  table_name: string;
  table_type: string;
  shift_id: string | null;
  current_blind_level: number | null;
  opened_at: string | null;
  dealer_open_operation_id: string | null;
}

export async function getDealerOperationalTables(
  admin: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  clubId: string,
): Promise<DealerOperationalTable[]> {
  const { data, error } = await admin.rpc("get_dealer_operational_tables_v1", { p_club_id: clubId });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("dealer_operational_inventory_unverified");
  const ids = new Set<string>();
  for (const row of data) {
    if (!row || typeof row.id !== "string" || typeof row.table_session_id !== "string"
      || !row.id || !row.table_session_id || typeof row.table_name !== "string"
      || !["tournament", "cash", "vip"].includes(row.table_type)
      || (row.table_type === "tournament" && typeof row.tournament_id !== "string") || ids.has(row.id)) {
      throw new Error("dealer_operational_inventory_malformed");
    }
    ids.add(row.id);
  }
  return data;
}
