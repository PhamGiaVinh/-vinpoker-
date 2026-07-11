import { describe, it, expect } from "vitest";
import {
  buildHandFeedItems,
  filterByTags,
  scoreToCategory,
  bigBlindFromActions,
  type RawHandRow,
  type RawHandPlayer,
  type RawHandAction,
  type RawElimination,
  type RawProfile,
} from "@/components/cashier/tournament-live/viewer-hub/handFeedDerive";
import { evaluate7 } from "@/lib/poker/handEval";

const BB = 250_000;

// One hand carrying all four tags: a big all-in pot, P1 makes a full house and wins,
// P2 is all-in, loses, and is eliminated in 2nd.
const HAND: RawHandRow = {
  id: "h1",
  hand_number: 156,
  created_at: "2026-06-17T01:51:00Z",
  community_cards: ["2♠", "8♠", "Q♥", "Q♣", "J♦"],
  pot_size: 10_000_000,
  button_seat: 1,
  table_id: "ft",
};

const PLAYERS: RawHandPlayer[] = [
  { hand_id: "h1", player_id: "p1", seat_number: 1, starting_stack: 11_900_000, ending_stack: 17_300_000, hole_cards: ["Q♠", "J♥"], is_eliminated: false },
  { hand_id: "h1", player_id: "p2", seat_number: 2, starting_stack: 5_400_000, ending_stack: 0, hole_cards: ["A♦", "8♣"], is_eliminated: true },
];

const ACTIONS: RawHandAction[] = [
  { hand_id: "h1", player_id: "p2", action_type: "post_sb", action_amount: 125_000, action_order: 0 },
  { hand_id: "h1", player_id: "p1", action_type: "post_bb", action_amount: BB, action_order: 1 },
  { hand_id: "h1", player_id: "p1", action_type: "raise", action_amount: 5_400_000, action_order: 2 },
  { hand_id: "h1", player_id: "p2", action_type: "all_in", action_amount: 5_275_000, action_order: 3 },
];

const ELIMS: RawElimination[] = [{ hand_id: "h1", player_id: "p2", position: 2, prize: 0 }];

const PROFILES = new Map<string, RawProfile>([
  ["p1", { user_id: "p1", display_name: "Tuấn", avatar_url: null }],
  ["p2", { user_id: "p2", display_name: "Phú", avatar_url: null }],
]);

function build(viewerPulseV2 = false) {
  return buildHandFeedItems(
    [HAND],
    new Map([["h1", PLAYERS]]),
    new Map([["h1", ACTIONS]]),
    new Map([["h1", ELIMS]]),
    PROFILES,
    { viewerPulseV2 },
  )[0];
}

describe("bigBlindFromActions", () => {
  it("reads the post_bb amount", () => {
    expect(bigBlindFromActions(ACTIONS)).toBe(BB);
  });
  it("returns 0 when no post_bb", () => {
    expect(bigBlindFromActions([])).toBe(0);
  });
});

describe("scoreToCategory", () => {
  it("classifies a full house from a 7-card eval", () => {
    // Q♠ J♥ + 2♠ 8♠ Q♥ Q♣ J♦ -> QQQ over JJ
    const score = evaluate7(["Qs", "Jh", "2s", "8s", "Qh", "Qc", "Jd"]);
    expect(scoreToCategory(score)).toBe("full_house");
  });
  it("classifies a royal flush", () => {
    const score = evaluate7(["As", "Ks", "Qs", "Js", "Ts"]);
    expect(scoreToCategory(score)).toBe("royal_flush");
  });
  it("classifies a pair and high card", () => {
    expect(scoreToCategory(evaluate7(["As", "Ah", "2d", "5c", "9s"]))).toBe("pair");
    expect(scoreToCategory(evaluate7(["As", "Kh", "2d", "5c", "9s"]))).toBe("high_card");
  });
});

describe("buildHandFeedItems", () => {
  const item = build();

  it("computes pot and pot-in-BB from actions", () => {
    // effective contributions: p1 5.4M (uncalled 0.25M refunded), p2 5.4M -> pot 10.8M
    expect(item.potChips).toBe(10_800_000);
    expect(item.potBB).toBe(43.2);
    expect(item.bigBlind).toBe(BB);
  });

  it("derives all four tags", () => {
    expect(item.tags).toContain("all_in");
    expect(item.tags).toContain("big_pot");
    expect(item.tags).toContain("high_hand");
    expect(item.tags).toContain("eliminated");
  });

  it("attributes HIGH HAND to the best revealed hand", () => {
    expect(item.highHand?.playerId).toBe("p1");
    expect(item.highHand?.category).toBe("full_house");
  });

  it("sorts positive chip deltas first but does not infer a winner from the delta", () => {
    expect(item.players[0].playerId).toBe("p1");
    expect(item.players[0].isWinner).toBe(false);
    expect(item.players[0].deltaChips).toBe(5_400_000);
    expect(item.players[0].deltaBB).toBe(21.6);
  });

  it("does not promote guarded client reconstruction into settlement proof", () => {
    const guarded = build(true);
    expect(guarded.showdownResult).toBeNull();
    expect(guarded.players.find((player) => player.playerId === "p1")?.isWinner).toBe(false);
    expect(guarded.players.find((player) => player.playerId === "p2")?.isWinner).toBe(false);
  });

  it("flags the eliminated player with finish position", () => {
    const p2 = item.players.find((p) => p.playerId === "p2")!;
    expect(p2.isEliminated).toBe(true);
    expect(p2.finishPosition).toBe(2);
    expect(p2.isWinner).toBe(false);
  });

  it("falls back to pot_size when there are no actions", () => {
    const noActions = buildHandFeedItems(
      [HAND],
      new Map([["h1", PLAYERS]]),
      new Map(),
      new Map(),
      PROFILES,
    )[0];
    expect(noActions.potChips).toBe(10_000_000); // pot_size column
    expect(noActions.potBB).toBeNull(); // no BB without a post_bb action
  });
});

describe("filterByTags", () => {
  const items = [build()];
  it("passes through when no tags selected", () => {
    expect(filterByTags(items, [])).toHaveLength(1);
  });
  it("keeps items matching a selected tag", () => {
    expect(filterByTags(items, ["big_pot"])).toHaveLength(1);
  });
  it("drops items without any selected tag", () => {
    expect(filterByTags(items, [] as never[]).length).toBe(1);
    const noMatch = filterByTags(items, ["all_in"]).filter((i) => !i.tags.includes("big_pot"));
    expect(noMatch).toHaveLength(0);
  });
});
