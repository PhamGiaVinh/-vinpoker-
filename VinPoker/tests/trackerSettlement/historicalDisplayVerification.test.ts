import { describe, expect, it } from "vitest";
import {
  HistoricalDisplayVerificationError,
  verifyHistoricalDisplaySettlement,
} from "../../supabase/functions/_shared/trackerSettlement/historicalDisplayVerification.ts";

const sourceChainHash = "a".repeat(64);

function hand(overrides: Record<string, unknown> = {}) {
  return {
    id: "hand-8",
    tournament_id: "tournament-1",
    hand_number: 8,
    table_id: "table-1",
    button_seat: 2,
    community_cards: ["As", "Jd", "Qh", "Jh", "8h"],
    pot_size: 56_100_000,
    side_pots: [],
    status: "completed",
    is_voided: false,
    updated_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

function validInput() {
  return {
    tournamentId: "tournament-1",
    hand: hand(),
    players: [
      { hand_id: "hand-8", player_id: "limitless", entry_number: 1, seat_number: 2, starting_stack: 8_700_000, ending_stack: 8_700_000, hole_cards: ["Jc", "9d"], is_eliminated: false },
      { hand_id: "hand-8", player_id: "kayhan", entry_number: 1, seat_number: 3, starting_stack: 47_400_000, ending_stack: 47_400_000, hole_cards: ["Js", "Ts"], is_eliminated: false },
    ],
    actions: [
      { id: "h8-a1", hand_id: "hand-8", player_id: "limitless", entry_number: 1, street: "preflop", action_type: "call", action_amount: 8_700_000, action_order: 1 },
      { id: "h8-a2", hand_id: "hand-8", player_id: "kayhan", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 47_400_000, action_order: 2 },
    ],
    sourceRevision: 3,
    sourceChainHash,
  };
}

describe("historical display settlement verification", () => {
  it("verifies a completed chop without reading or propagating later hands", async () => {
    const result = await verifyHistoricalDisplaySettlement(validInput());
    expect(result.winnerIds).toEqual(["limitless", "kayhan"]);
    expect(result.publicOutcome.pots[0].allocations).toEqual([
      { potId: "main-0", winnerId: "limitless", amount: 8_700_000, includesOddChip: false },
      { potId: "main-0", winnerId: "kayhan", amount: 8_700_000, includesOddChip: false },
    ]);
    expect(result.publicOutcome.refunds).toEqual([{ playerId: "kayhan", amount: 38_700_000, sourceActionId: "h8-a2" }]);
    expect(result.publicOutcome.handRanks.map((rank) => [rank.playerId, rank.category, rank.kickers, rank.bestFive.length])).toEqual([
      ["limitless", "trips", ["A", "Q"], 5],
      ["kayhan", "trips", ["A", "Q"], 5],
    ]);
    expect(result.publicOutcome).not.toHaveProperty("privateEvidence");
  });

  it("refuses the known Hand #8 stored-stack mismatch instead of showing a false chop", async () => {
    const input = validInput();
    input.players = input.players.map((player) => player.player_id === "limitless"
      ? { ...player, ending_stack: 17_400_000 }
      : { ...player, ending_stack: 38_700_000 });
    await expect(verifyHistoricalDisplaySettlement(input)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "stored_ending_stack_mismatch",
    });
  });

  it("requires complete showdown evidence and rejects malformed player/action identities", async () => {
    const noCards = validInput();
    noCards.players = noCards.players.map((player) => ({ ...player, hole_cards: [] }));
    await expect(verifyHistoricalDisplaySettlement(noCards)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "incomplete_showdown_cards",
    });

    const duplicate = validInput();
    duplicate.players = [...duplicate.players, { ...duplicate.players[0], seat_number: 4 }];
    await expect(verifyHistoricalDisplaySettlement(duplicate)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "duplicate_historical_player",
    });

    const mismatchedAction = validInput();
    mismatchedAction.actions = mismatchedAction.actions.map((action) => ({ ...action, entry_number: 2 }));
    await expect(verifyHistoricalDisplaySettlement(mismatchedAction)).rejects.toMatchObject<Partial<HistoricalDisplayVerificationError>>({
      code: "historical_action_identity_mismatch",
    });
  });

  it("keeps a fold win verified without inventing showdown ranks", async () => {
    const input = validInput();
    input.hand = hand({ community_cards: [], pot_size: 200 });
    input.players = [
      { hand_id: "hand-8", player_id: "A", entry_number: 1, seat_number: 1, starting_stack: 1_000, ending_stack: 1_100, hole_cards: [], is_eliminated: false },
      { hand_id: "hand-8", player_id: "B", entry_number: 1, seat_number: 2, starting_stack: 1_000, ending_stack: 900, hole_cards: [], is_eliminated: false },
    ];
    input.actions = [
      { id: "fold-a1", hand_id: "hand-8", player_id: "A", entry_number: 1, street: "preflop", action_type: "bet", action_amount: 100, action_order: 1 },
      { id: "fold-a2", hand_id: "hand-8", player_id: "B", entry_number: 1, street: "preflop", action_type: "post_bb", action_amount: 100, action_order: 2 },
      { id: "fold-a3", hand_id: "hand-8", player_id: "B", entry_number: 1, street: "preflop", action_type: "fold", action_amount: 0, action_order: 3 },
    ];
    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.winnerIds).toEqual(["A"]);
    expect(result.publicOutcome.handRanks).toEqual([]);
  });

  it("accepts legacy forced-bet labels without changing the stored action evidence", async () => {
    const input = validInput();
    input.hand = hand({
      id: "legacy-hand",
      hand_number: 4,
      button_seat: 1,
      community_cards: [],
      pot_size: 60_000,
    });
    input.players = [
      { hand_id: "legacy-hand", player_id: "A", entry_number: 1, seat_number: 1, starting_stack: 30_000, ending_stack: 60_000, hole_cards: [], is_eliminated: false },
      { hand_id: "legacy-hand", player_id: "B", entry_number: 1, seat_number: 2, starting_stack: 30_000, ending_stack: 0, hole_cards: [], is_eliminated: true },
    ];
    input.actions = [
      { id: "legacy-a1", hand_id: "legacy-hand", player_id: "B", entry_number: 1, street: "preflop", action_type: "small_blind", action_amount: 100, action_order: 1 },
      { id: "legacy-a2", hand_id: "legacy-hand", player_id: "A", entry_number: 1, street: "preflop", action_type: "big_blind", action_amount: 200, action_order: 2 },
      { id: "legacy-a3", hand_id: "legacy-hand", player_id: "B", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 29_900, action_order: 3 },
      { id: "legacy-a4", hand_id: "legacy-hand", player_id: "A", entry_number: 1, street: "preflop", action_type: "call", action_amount: 29_800, action_order: 4 },
      { id: "legacy-a5", hand_id: "legacy-hand", player_id: "B", entry_number: 1, street: "showdown", action_type: "fold", action_amount: 0, action_order: 5 },
    ];

    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.winnerIds).toEqual(["A"]);
    expect(result.publicOutcome.players.find((player) => player.playerId === "A")?.potAward).toBe(60_000);
    expect(result.privateOutcome.privateEvidence?.actions.map((action) => action.actionType)).toEqual([
      "small_blind", "big_blind", "all_in", "call", "fold",
    ]);
  });

  it("allocates main and side pots while keeping each showdown ranking unique", async () => {
    const input = validInput();
    input.hand = hand({ id: "side-pot-hand", hand_number: 9, pot_size: 50, button_seat: 1, community_cards: ["2c", "7d", "9h", "3s", "Kc"] });
    input.players = [
      { hand_id: "side-pot-hand", player_id: "A", entry_number: 1, seat_number: 1, starting_stack: 10, ending_stack: 30, hole_cards: ["As", "Ad"], is_eliminated: false },
      { hand_id: "side-pot-hand", player_id: "B", entry_number: 1, seat_number: 2, starting_stack: 20, ending_stack: 20, hole_cards: ["Qs", "Qd"], is_eliminated: false },
      { hand_id: "side-pot-hand", player_id: "C", entry_number: 1, seat_number: 3, starting_stack: 20, ending_stack: 0, hole_cards: ["Js", "Jd"], is_eliminated: true },
    ];
    input.actions = [
      { id: "side-a1", hand_id: "side-pot-hand", player_id: "A", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 10, action_order: 1 },
      { id: "side-a2", hand_id: "side-pot-hand", player_id: "B", entry_number: 1, street: "preflop", action_type: "all_in", action_amount: 20, action_order: 2 },
      { id: "side-a3", hand_id: "side-pot-hand", player_id: "C", entry_number: 1, street: "preflop", action_type: "call", action_amount: 20, action_order: 3 },
    ];

    const result = await verifyHistoricalDisplaySettlement(input);
    expect(result.publicOutcome.pots.map((pot) => [pot.kind, pot.amount, pot.winnerIds])).toEqual([
      ["main", 30, ["A"]],
      ["side", 20, ["B"]],
    ]);
    expect(result.publicOutcome.handRanks.map((rank) => rank.playerId).sort()).toEqual(["A", "B"]);
  });
});
