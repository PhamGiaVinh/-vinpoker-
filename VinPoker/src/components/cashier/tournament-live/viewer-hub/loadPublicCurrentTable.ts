type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Resolve an unselected spectator through the public catalog, never private seats. */
export async function loadPublicCurrentTable(rpc: Rpc, tournamentId: string, tableId: string | null, includeLastHand = true) {
  let scope = tableId;
  if (!scope) {
    const response = await rpc("get_public_tournament_viewer_snapshot_v2", {
      p_tournament_id: tournamentId, p_table_ids: [], p_sections: ["tables"], p_known_revisions: {},
    });
    if (response.error) return response;
    const snapshot = response.data as { ok?: boolean; access?: string; tournamentId?: string; sections?: { tables?: { catalog?: { tableId?: string }[] } } } | null;
    if (snapshot?.access === "revoked") return { data: { access: "revoked" }, error: null };
    if (snapshot?.ok !== true || snapshot.access !== "public" || snapshot.tournamentId !== tournamentId
      || !Array.isArray(snapshot.sections?.tables?.catalog)) {
      return { data: null, error: { message: "invalid_public_table_catalog" } };
    }
    const catalog = snapshot.sections.tables.catalog;
    if (catalog.length === 0) return { data: { access: "public", state: "waiting", tableId: null, tableSessionId: null, hand: null }, error: null };
    scope = catalog[0].tableId ?? null;
    if (!scope) return { data: null, error: { message: "invalid_public_table_catalog" } };
  }
  const response = await rpc("get_public_tournament_table_live_or_last_hand_v2", {
    p_tournament_id: tournamentId, p_tournament_table_id: scope,
  });
  const data = response.data as { access?: string; state?: string; tableId?: string; tableSessionId?: string } | null;
  if (!response.error && !includeLastHand && data?.access === "public" && data.state === "last_completed") {
    return { data: { access: "public", state: "waiting", tableId: data.tableId,
      tableSessionId: data.tableSessionId, hand: null }, error: null };
  }
  return response;
}
