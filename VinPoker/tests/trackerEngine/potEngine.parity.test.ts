import { describe, it, expect } from "vitest";
import * as server from "@tracker-engine/potEngine.ts";
import * as client from "@/lib/tracker-poker/potEngine";

// The server pot authority (trackerEngine/potEngine.ts) is a verbatim copy of the
// client display copy (src/lib/tracker-poker/potEngine.ts). This test fails if the
// two ever drift — change both files in the same PR.
describe("pot engine parity (server copy === client copy)", () => {
  const cases = [
    [{ player_id: "A", total_bet: 100, is_folded: false }, { player_id: "B", total_bet: 100, is_folded: false }],
    [{ player_id: "A", total_bet: 500, is_folded: false }, { player_id: "B", total_bet: 1000, is_folded: false }, { player_id: "C", total_bet: 1000, is_folded: false }],
    [{ player_id: "A", total_bet: 200, is_folded: false }, { player_id: "B", total_bet: 500, is_folded: false }, { player_id: "C", total_bet: 1000, is_folded: false }, { player_id: "D", total_bet: 1000, is_folded: false }],
    [{ player_id: "A", total_bet: 1000, is_folded: false }, { player_id: "B", total_bet: 400, is_folded: false }, { player_id: "C", total_bet: 100, is_folded: true }],
    [{ player_id: "A", total_bet: 500, is_folded: false }, { player_id: "B", total_bet: 500, is_folded: false }, { player_id: "C", total_bet: 300, is_folded: true }],
  ];

  it("computePotBreakdown matches on a battery of inputs", () => {
    for (const c of cases) {
      expect(server.computePotBreakdown(c as never)).toEqual(client.computePotBreakdown(c as never));
    }
  });

  it("contributionsFromActions matches", () => {
    const actions = [
      { player_id: "A", action_type: "post_sb", action_amount: 50 },
      { player_id: "B", action_type: "post_bb", action_amount: 100 },
      { player_id: "A", action_type: "raise", action_amount: 250 },
      { player_id: "B", action_type: "fold", action_amount: 0 },
    ];
    expect(server.contributionsFromActions(actions)).toEqual(client.contributionsFromActions(actions));
  });
});
