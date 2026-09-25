import { describe, expect, it } from "vitest";
import {
  computeAuthoritativeSettlement,
  normalizeSettlementSourceRpcResult,
  type AuthoritativeSettlementInput,
} from "@settlement/compute.ts";

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
      action("hand-8", "h8-a1", "limitless", "post_sb", 50, 1),
      action("hand-8", "h8-a2", "kayhan", "post_bb", 100, 2),
      action("hand-8", "h8-a3", "limitless", "all_in", 8_699_950, 3),
      action("hand-8", "h8-a4", "kayhan", "all_in", 47_399_900, 4),
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
    expect(result.privateOutcome.refunds).toEqual([{ playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a4" }]);
    expect(result.privateOutcome.players.map((player) => player.endingStack)).toEqual([8_700_000, 47_400_000]);
    expect(result.privateOutcome.handRanks.map((rank) => [rank.category, ...rank.kickers])).toEqual([
      ["trips", "A", "Q"],
      ["trips", "A", "Q"],
    ]);
    expect(result.publicOutcome.handRanks.every((rank) => rank.bestFive.length === 5)).toBe(true);
    expect(result.publicOutcome).not.toHaveProperty("privateEvidence");
  });

  it("settles a fold win without requiring showdown cards", async () => {
    const input = hand8Input();
    input.players = input.players.map((player) => ({ ...player, hole_cards: [] }));
    input.edit = {
      communityCards: [],
      actions: [
        action("hand-8", "fold-a", "limitless", "post_sb", 50, 1),
        action("hand-8", "fold-b", "kayhan", "post_bb", 100, 2),
        action("hand-8", "fold-c", "limitless", "fold", 0, 3),
      ],
    };
    input.liveStacks = input.liveStacks.map((stack) => stack.player_id === "limitless"
      ? { ...stack, chip_count: 17_300_000 }
      : { ...stack, chip_count: 47_400_000 });
    input.players = input.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_300_000 }
      : { ...player, ending_stack: 47_400_000 });
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.pots[0].winnerIds).toEqual(["kayhan"]);
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

  it("rejects an edited all-in amount that exceeds the player's stack", async () => {
    const input = hand8Input();
    input.actions = [
      action("hand-8", "bad-a1", "limitless", "post_sb", 4_350_000, 1),
      action("hand-8", "bad-a2", "kayhan", "post_bb", 8_700_000, 2),
      action("hand-8", "bad-a3", "limitless", "all_in", 17_400_001, 3),
    ];
    input.edit = { actions: input.actions };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:3:AMOUNT_MISMATCH");
  });

  it("replays edited actions with strict call amounts before settlement", async () => {
    const input = hand8Input();
    input.edit = {
      actions: [
        action("hand-8", "edited-a", "kayhan", "bet", 100, 1),
        action("hand-8", "edited-b", "limitless", "call", 50, 2),
      ],
    };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:2:AMOUNT_MISMATCH");
  });

  it("rejects an edited action from a seat that is not the server-derived actor", async () => {
    const input = hand8Input();
    input.edit = {
      actions: [
        action("hand-8", "edited-a", "limitless", "bet", 100, 1),
      ],
    };
    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:1:OUT_OF_TURN");
  });

  it("does not settle a valid but incomplete preflop prefix using synthetic showdown cards", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4 }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Kc", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Qc", "Qd"] },
    ];
    input.actions = [];
    input.edit = {
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
        action("hand-8", "hu-a1", "SB", "post_sb", 50, 1),
        action("hand-8", "hu-a2", "BB", "post_bb", 100, 2),
        action("hand-8", "hu-a3", "SB", "call", 50, 3),
      ],
    };
    // The fixture has no antes or dead money: only the explicit 50/100 blinds are committed.
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 900 },
      { player_id: "BB", entry_number: 1, chip_count: 900 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("incomplete_action_stream");
  });

  it("rejects an edited stream that acts out of turn on the flop", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4 }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Kc", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 900, hole_cards: ["Qc", "Qd"] },
    ];
    input.edit = {
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
      action("hand-8", "hu-a1", "SB", "post_sb", 50, 1),
      action("hand-8", "hu-a2", "BB", "post_bb", 100, 2),
      action("hand-8", "hu-a3", "SB", "call", 50, 3),
      action("hand-8", "hu-a4", "BB", "check", 0, 4),
      { ...action("hand-8", "hu-a5", "SB", "check", 0, 5), street: "flop" },
      ],
    };
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 900 },
      { player_id: "BB", entry_number: 1, chip_count: 900 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("edited_action_invalid:5:OUT_OF_TURN");
  });

  it("rejects duplicate cards across the board and hole-card set", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4, community_cards: [] }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 950, hole_cards: ["As", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 1_050, hole_cards: ["Qc", "Qd"] },
    ];
    input.actions = [];
    input.edit = {
      communityCards: ["As", "Jd", "Qh"],
      holeCards: [{ player_id: "SB", entry_number: 1, hole_cards: ["As", "Kd"] }],
      actions: [
        action("hand-8", "fold-a", "SB", "post_sb", 50, 1),
        action("hand-8", "fold-b", "BB", "post_bb", 100, 2),
        action("hand-8", "fold-c", "SB", "fold", 0, 3),
      ],
    };
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 950 },
      { player_id: "BB", entry_number: 1, chip_count: 1_050 },
    ];

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("invalid_card_set");
  });

  it("keeps a complete all-in runout settleable without betting actions on later streets", async () => {
    const input = hand8Input();
    input.hands = [{ ...hand("hand-8", 8), button_seat: 4 }];
    input.players = [
      { hand_id: "hand-8", player_id: "SB", entry_number: 1, seat_number: 4, starting_stack: 1_000, ending_stack: 2_000, hole_cards: ["Kc", "Kd"] },
      { hand_id: "hand-8", player_id: "BB", entry_number: 1, seat_number: 6, starting_stack: 1_000, ending_stack: 0, hole_cards: ["Qc", "Qd"] },
    ];
    input.actions = [];
    input.edit = {
      communityCards: ["2c", "3d", "4h", "5s", "9c"],
      actions: [
        action("hand-8", "runout-a1", "SB", "post_sb", 50, 1),
        action("hand-8", "runout-a2", "BB", "post_bb", 100, 2),
        action("hand-8", "runout-a3", "SB", "all_in", 950, 3),
        action("hand-8", "runout-a4", "BB", "call", 900, 4),
      ],
    };
    // Ante and dead money are both zero; the pot is the 1,000-chip matched all-in.
    input.liveStacks = [
      { player_id: "SB", entry_number: 1, chip_count: 2_000 },
      { player_id: "BB", entry_number: 1, chip_count: 0 },
    ];

    const result = await computeAuthoritativeSettlement(input);
    expect(result.winnerIds).toEqual(["SB"]);
    expect(result.privateOutcome.totals.committedTotal).toBe(2_000);
  });

  it("rejects invalid board cardinality without exposing card data", async () => {
    const input = hand8Input();
    input.edit = { communityCards: ["As", "Kd"] };

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("invalid_card_set");
  });

  it("validates the recorded action stream when only cards are edited", async () => {
    const input = hand8Input();
    input.actions = [
      action("hand-8", "bad-a1", "limitless", "post_sb", 4_350_000, 1),
      action("hand-8", "bad-a2", "kayhan", "post_bb", 8_700_000, 2),
      action("hand-8", "bad-a3", "limitless", "call", 4_350_000, 3),
    ];
    input.edit = { communityCards: ["As", "Jd", "Qh", "Jh", "8h"] };

    await expect(computeAuthoritativeSettlement(input)).rejects.toThrow("incomplete_action_stream");
  });

  it("requires board cards for the highest betting street but keeps preflop fold-wins cardless", async () => {
    const missingFlop = hand8Input();
    missingFlop.actions = [
      action("hand-8", "flop-a1", "limitless", "post_sb", 50, 1),
      action("hand-8", "flop-a2", "kayhan", "post_bb", 100, 2),
      action("hand-8", "flop-a3", "limitless", "call", 50, 3),
      action("hand-8", "flop-a4", "kayhan", "check", 0, 4),
      { ...action("hand-8", "flop-a5", "kayhan", "check", 0, 5), street: "flop" },
    ];
    missingFlop.edit = { communityCards: [] };
    await expect(computeAuthoritativeSettlement(missingFlop)).rejects.toThrow("incomplete_board_for_street");

    const foldWin = hand8Input();
    foldWin.players = foldWin.players.map((player) => ({ ...player, hole_cards: [] }));
    foldWin.edit = {
      communityCards: [],
      actions: [
        action("hand-8", "cardless-a1", "limitless", "post_sb", 50, 1),
        action("hand-8", "cardless-a2", "kayhan", "post_bb", 100, 2),
        action("hand-8", "cardless-a3", "limitless", "fold", 0, 3),
      ],
    };
    foldWin.liveStacks = [
      { player_id: "limitless", entry_number: 1, chip_count: 17_300_000 },
      { player_id: "kayhan", entry_number: 1, chip_count: 47_400_000 },
    ];
    foldWin.players = foldWin.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_300_000 }
      : { ...player, ending_stack: 47_400_000 });
    await expect(computeAuthoritativeSettlement(foldWin)).resolves.toMatchObject({ winnerIds: ["kayhan"] });
  });

  it("uses the database revision consistently in the outcome and target source anchor", async () => {
    const input = hand8Input();
    input.hands = input.hands.map((value) => ({ ...value, source_revision: 7 }));
    input.sourceRevisionOverride = 7;
    input.sourceChainHashOverride = "a".repeat(64);
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.sourceRevision).toBe(7);
    expect(result.privateOutcome.privateEvidence.sourceChain[0].sourceRevision).toBe(7);
  });

  it("uses the server-selected correction revision for the persisted outcome", async () => {
    const input = hand8Input();
    input.settlementRevisionOverride = 4;
    const result = await computeAuthoritativeSettlement(input);
    expect(result.privateOutcome.settlementRevision).toBe(4);
  });
});

describe("settlement source RPC normalization", () => {
  const sourceChainHash = "a".repeat(64);

  it("unwraps the single-row array returned by a RETURNS TABLE RPC", () => {
    expect(normalizeSettlementSourceRpcResult([{
      source_revision: 7,
      source_chain_hash: sourceChainHash,
      affected_hand_count: 2,
    }])).toEqual({ sourceRevision: 7, sourceChainHash });
  });

  it("rejects missing or malformed source evidence", () => {
    expect(() => normalizeSettlementSourceRpcResult([])).toThrow("invalid_settlement_source");
    expect(() => normalizeSettlementSourceRpcResult([{ source_revision: 0, source_chain_hash: sourceChainHash }]))
      .toThrow("invalid_settlement_source");
    expect(() => normalizeSettlementSourceRpcResult([{ source_revision: 1, source_chain_hash: "not-a-hash" }]))
      .toThrow("invalid_settlement_source");
  });
});
