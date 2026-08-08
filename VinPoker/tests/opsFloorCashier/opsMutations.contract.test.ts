import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  OPS_CASHIER_MUTATIONS_ENABLED,
  confirmOfflineBuyIn,
  createTournament,
  deleteTournament,
  updateTournamentLive,
} from "@/ops/opsMutations";

function clientWith(result = { data: { ok: true }, error: null }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as unknown as SupabaseClient<Database>;
}

describe("Ops canonical mutation seams", () => {
  it("uses the owner-bound create RPC with server contract arguments", async () => {
    const client = clientWith();
    await createTournament(client, {
      clubId: "club-1", name: "Daily", startTime: "2026-08-08T12:00:00.000Z",
      buyIn: 100000, startingStack: 30000, minutesPerLevel: 20, lateRegCloseLevel: 6,
    });
    expect(client.rpc).toHaveBeenCalledWith("ops_create_tournament", expect.objectContaining({
      p_club_id: "club-1", p_buy_in: 100000, p_starting_stack: 30000,
    }));
  });

  it("routes live and delete actions through canonical RPCs", async () => {
    const client = clientWith();
    await updateTournamentLive(client, { tournamentId: "tour-1", status: "break", playersRemaining: 8, level: 2 });
    await deleteTournament(client, "tour-1");
    expect(client.rpc).toHaveBeenNthCalledWith(1, "ops_update_tournament_live", expect.objectContaining({
      p_tournament_id: "tour-1", p_status: "break", p_players_remaining: 8, p_level: 2,
    }));
    expect(client.rpc).toHaveBeenNthCalledWith(2, "ops_delete_tournament_safe", {
      p_tournament_id: "tour-1", p_reason: "ops_floor_delete",
    });
  });

  it("keeps cashier money paths fail-closed outside explicit Preview", async () => {
    expect(OPS_CASHIER_MUTATIONS_ENABLED).toBe(false);
    await expect(confirmOfflineBuyIn(clientWith(), {
      tournamentId: "tour-1", playerName: "Player", idempotencyKey: "retry-1",
    })).rejects.toThrow("money_path_disabled");
  });
});
