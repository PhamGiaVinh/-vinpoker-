import { describe, expect, it } from "vitest";
import { computeAuthoritativeSettlement, type AuthoritativeSettlementInput } from "@settlement/compute.ts";

const hand = (id: string, number: number, updated = `2026-07-12T00:00:0${number}.000Z`) => ({
  id,
  tournament_id: "tournament-1",
  hand_number: number,
  table_id: "table-1",
  button_seat: 2,
  community_cards: ["As", "Jd", "Qh", "Jh", "8h"],
  pot_size: 0,
  side_pots: [],
  status: "completed",
  is_voided: false,
  updated_at: updated,
  created_at: updated,
});

const action = (handId: string, id: string, playerId: string, type: string, amount: number, order: number) => ({
  id,
  hand_id: handId,
  player_id: playerId,
  entry_number: 1,
  street: "preflop",
  action_type: type,
  action_amount: amount,
  action_order: order,
});

function hand8Input(): AuthoritativeSettlementInput {
  return {
    tournamentId: "tournament-1",
    targetHandId: "hand-8",
    hands: [hand("hand-8", 8)],
    players: [
      { hand_id: "hand-8", player_id: "limitless", entry_number: 1, seat_number: 2, starting_stack: 8_700_000, ending_stack: 17_400_000, hole_cards: ["Jc", "9d"] },
      { hand_id: "hand-8", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 47_400_000, ending_stack: 38_700_000, hole_cards: ["Js", "Ts"] },
    ],
    actions: [
      action("hand-8", "h8-a1", "limitless", "call", 8_700_000, 1),
      action("hand-8", "h8-a2", "kayhan", "all_in", 47_400_000, 2),
    ],
    liveStacks: [
      { player_id: "limitless", entry_number: 1, chip_count: 17_400_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 38_700_000 },
    ],
  };
}

describe("authoritative settlement computation", () => {
  it("settles Hand #8 as a chop with a separate uncalled refund", async () => {
    const result = await computeAuthoritativeSettlement(hand8Input());
    expect(result.privateOutcome.totals).toMatchObject({
      committedTotal: 56_100_000,
      distributablePot: 17_400_000,
      refundTotal: 38_700_000,
    });
    expect(result.privateOutcome.pots[0].winnerIds).toEqual(["limitless", "kayhan"]);
    expect(result.privateOutcome.pots[0].allocations.map((allocation) => allocation.amount)).toEqual([8_700_000, 8_700_000]);
    expect(result.privateOutcome.refunds).toEqual([{ playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a2" }]);
    expect(result.privateOutcome.players.map((player) => player.endingStack)).toEqual([8_700_000, 47_400_000]);
    expect(result.privateOutcome.handRanks.map((rank) => [rank.category, ...rank.kickers])).toEqual([
      ["trips", "A", "Q"],
      ["trips", "A", "Q"],
    ]);
    expect(result.publicOutcome).not.toHaveProperty("privateEvidence");
  });

  it("settles a fold win without requiring showdown cards", async () => {
    const input = hand8Input();
    input.players = input.players.map((player) => ({ ...player, hole_cards: [] }));
    input.edit = {
      actions: [
        action("hand-8", "fold-a", "limitless", "bet", 100, 1),
        action("hand-8", "fold-b", "kayhan", "post_bb", 100, 2),
        action("hand-8", "fold-c", "kayhan", "fold", 0, 3),
      ],
    };
    input.liveStacks = input.liveStacks.map((stack) => stack.player_id === "limitless"
      ? { ...stack, chip_count: 17_300_000 }
      : { ...stack, chip_count: 47_400_000 });
    input.players = input.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_300_000 }
      : { ...player, ending_stack: 47_400_000 });
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.pots[0].winnerIds).toEqual(["limitless"]);
    expect(result.privateOutcome.handRanks).toEqual([]);
  });

  it("propagates corrected stacks to a later hand", async () => {
    const input = hand8Input();
    input.hands = [hand("hand-8", 8), hand("hand-9", 9)];
    input.players = [
      ...input.players,
      { hand_id: "hand-9", player_id: "limitless", entry_number: 1, seat_number: 2, starting_stack: 17_400_000, ending_stack: 17_300_000, hole_cards: [] },
      { hand_id: "hand-9", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 38_700_000, ending_stack: 38_800_000, hole_cards: [] },
    ];
    input.actions = [
      ...input.actions,
      action("hand-9", "h9-a1", "limitless", "bet", 100, 1),
      action("hand-9", "h9-a2", "kayhan", "call", 100, 2),
    ];
    const result = await computeAuthoritativeSettlement(input);
    expect(result.handChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ hand_id: "hand-9", player_id: "limitless", starting_stack: 8_700_000, ending_stack: 8_600_000 }),
      expect.objectContaining({ hand_id: "hand-9", player_id: "kayhan", starting_stack: 47_400_000, ending_stack: 47_500_000 }),
    ]));
  });

  it("rejects an action stream that commits more than the starting stack", async () => {
    const input = hand8Input();
    input.edit = { actions: [action("hand-8", "bad", "limitless", "all_in", 17_400_001, 1)] };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("target_action_exceeds_stack");
  });
});
