import { describe, expect, it } from "vitest";
import { computeVoiceFinishSettlement } from "../../supabase/functions/_shared/trackerSettlement/finishAssist.ts";

const base = {
  handId: "hand-1",
  stateVersion: "a".repeat(64),
  buttonSeat: 1,
  players: [
    { player_id: "p1", entry_number: 1, seat_number: 1, starting_stack: 100, hole_cards: ["Ah", "Ad"], player_name: "A" },
    { player_id: "p2", entry_number: 1, seat_number: 2, starting_stack: 100, hole_cards: ["Kh", "Kd"], player_name: "B" },
  ],
};

describe("Voice Finish settlement", () => {
  it("uses the server evaluator for a complete showdown and produces a stable digest", async () => {
    const input = {
      ...base,
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "call", action_amount: 5, action_order: 3 },
        { player_id: "p2", entry_number: 1, street: "flop", action_type: "bet", action_amount: 20, action_order: 4 },
        { player_id: "p1", entry_number: 1, street: "flop", action_type: "call", action_amount: 20, action_order: 5 },
      ],
      bettingComplete: true,
    };
    const [first, second] = await Promise.all([
      computeVoiceFinishSettlement(input),
      computeVoiceFinishSettlement(input),
    ]);
    expect(first.settlementOrigin).toBe("engine_showdown");
    expect(first.settlementDigest).toBe(second.settlementDigest);
    expect(first.summary.conservation_total).toBe(200);
    expect(first.recordPlayers.reduce((sum, player) => sum + player.ending_stack, 0)).toBe(200);
  });

  it("settles a verified fold win without requiring board or hole cards", async () => {
    const result = await computeVoiceFinishSettlement({
      ...base,
      players: base.players.map((player) => ({ ...player, hole_cards: [] })),
      communityCards: [],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "fold", action_amount: 0, action_order: 3 },
      ],
      bettingComplete: true,
    });
    expect(result.settlementOrigin).toBe("engine_fold_win");
    expect(result.summary.winners).toEqual([expect.objectContaining({ player_id: "p2", amount: 10 })]);
    expect(result.summary.ending_stacks).toContainEqual(expect.objectContaining({ player_id: "p2", amount: 105 }));
  });

  it("fails closed when showdown evidence is incomplete or cards are duplicated", async () => {
    await expect(computeVoiceFinishSettlement({
      ...base,
      communityCards: ["2c", "3d", "4h", "5s"],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "call", action_amount: 5, action_order: 3 },
      ],
      bettingComplete: true,
    })).rejects.toThrow("finish_requires_manual_showdown");
    await expect(computeVoiceFinishSettlement({
      ...base,
      communityCards: ["Ah", "3d", "4h", "5s", "9c"],
      actions: [
        { player_id: "p1", entry_number: 1, street: "preflop", action_type: "post_sb", action_amount: 5, action_order: 1 },
        { player_id: "p2", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 10, action_order: 2 },
      ],
      bettingComplete: true,
    })).rejects.toThrow("finish_duplicate_card");
  });
});
