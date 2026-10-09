import { describe, expect, it, vi } from "vitest";
import { loadPublicCurrentTable } from "./loadPublicCurrentTable";
describe("spectator without private seat authority", () => {
  it("last-hand OFF hides completed fallback without requesting private rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { access: "public", state: "last_completed", tableId: "logical", tableSessionId: "session", hand: { id: "old" } }, error: null });
    const response = await loadPublicCurrentTable(rpc, "tour", "logical", false);
    expect(response.data).toEqual({ access: "public", state: "waiting", tableId: "logical", tableSessionId: "session", hand: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("get_public_tournament_table_live_or_last_hand_v2");
  });
  it("resolves exact public scope without an operational read", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, access: "public", tournamentId: "tour", sections: { tables: { catalog: [{ tableId: "logical" }] } } }, error: null })
      .mockResolvedValueOnce({ data: { access: "public", state: "live" }, error: null });
    await loadPublicCurrentTable(rpc, "tour", null);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["get_public_tournament_viewer_snapshot_v2", "get_public_tournament_table_live_or_last_hand_v2"]);
    expect(rpc.mock.calls[1][1]).toEqual({ p_tournament_id: "tour", p_tournament_table_id: "logical" });
  });
  it("keeps empty, revoked, wrong-scope and network failure distinct", async () => {
    for (const [data, error, expected] of [
      [{ ok: true, access: "public", tournamentId: "tour", sections: { tables: { catalog: [] } } }, null, "waiting"],
      [{ access: "revoked" }, null, "revoked"],
      [{ ok: true, access: "public", tournamentId: "other" }, null, "invalid_public_table_catalog"],
      [null, { message: "503" }, "503"],
    ] as const) {
      const rpc = vi.fn().mockResolvedValue({ data, error });
      const result = await loadPublicCurrentTable(rpc, "tour", null);
      const value = result.data as { state?: string; access?: string } | null;
      expect(result.error?.message ?? value?.state ?? value?.access).toBe(expected);
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
});
