import { describe, it, expect } from "vitest";
import {
  buildReplayFrames,
  streetFrameIndex,
  detectBigBlind,
  type ReplayHand,
} from "@/lib/tracker-poker/replayEngine";

const PLAYERS = [
  { player_id: "P1", seat_number: 1, display_name: "Alice", starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, display_name: "Bob", starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, display_name: "Cara", starting_stack: 10000 },
];

let order = 0;
const A = (player_id: string, action_type: string, action_amount: number, street = "preflop") => {
  order += 1;
  return { player_id, action_type, action_amount, street, action_order: order };
};

function hand(partial: Partial<ReplayHand>): ReplayHand {
  order = 0;
  return {
    hand_number: 1,
    button_seat: 1,
    community_cards: [],
    players: PLAYERS,
    actions: [],
    ...partial,
  };
}

describe("buildReplayFrames", () => {
  it("produces N+1 frames (frame 0 = initial state)", () => {
    const h = hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100)] });
    const frames = buildReplayFrames(h);
    expect(frames).toHaveLength(3);
    expect(frames[0].index).toBe(0);
    expect(frames[0].latestAction).toBeNull();
    expect(frames[0].potSize).toBe(0);
    // Frame 0 = starting stacks untouched.
    expect(frames[0].seats.every((s) => s.chip_count === 10000)).toBe(true);
  });

  it("fold-walk: pot = blinds, folders flagged, one player left", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "fold", 0),
        A("P2", "fold", 0),
      ],
    });
    const frames = buildReplayFrames(h);
    const final = frames[frames.length - 1];
    expect(final.potSize).toBe(150); // 50 + 100
    const byId = Object.fromEntries(final.seats.map((s) => [s.player_id, s]));
    expect(byId.P1.is_folded).toBe(true);
    expect(byId.P2.is_folded).toBe(true);
    expect(byId.P3.is_folded).toBe(false);
    expect(byId.P2.chip_count).toBe(9950); // posted 50
    expect(byId.P3.chip_count).toBe(9900); // posted 100
  });

  it("board grows 0 -> 3 -> 4 -> 5 as streets advance", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c", "2h", "9s"],
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P3", "check", 0),
        A("P2", "bet", 200, "flop"),
        A("P3", "call", 200, "flop"),
        A("P2", "bet", 300, "turn"),
        A("P3", "call", 300, "turn"),
        A("P2", "check", 0, "river"),
        A("P3", "check", 0, "river"),
      ],
    });
    const frames = buildReplayFrames(h);
    const boardLen = (cards: string[]) => cards.filter(Boolean).length;
    // preflop frames → 0 cards
    expect(boardLen(frames[5].displayCards)).toBe(0); // after P3 check, still preflop
    // first flop action → 3 cards
    const firstFlop = frames.find((f) => f.currentStreet === "flop")!;
    expect(boardLen(firstFlop.displayCards)).toBe(3);
    const firstTurn = frames.find((f) => f.currentStreet === "turn")!;
    expect(boardLen(firstTurn.displayCards)).toBe(4);
    const firstRiver = frames.find((f) => f.currentStreet === "river")!;
    expect(boardLen(firstRiver.displayCards)).toBe(5);
    // displayCards always padded to 5 slots
    expect(frames[0].displayCards).toHaveLength(5);
  });

  it("running pot is monotonic and matches committed total at the end", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "raise", 300),
        A("P2", "call", 250),
        A("P3", "call", 200),
      ],
    });
    const frames = buildReplayFrames(h);
    const pots = frames.map((f) => f.potSize);
    for (let i = 1; i < pots.length; i++) expect(pots[i]).toBeGreaterThanOrEqual(pots[i - 1]);
    expect(pots[pots.length - 1]).toBe(50 + 100 + 300 + 250 + 200);
  });

  it("final showdown pot uses the distributable amount after an uncalled refund", () => {
    const h = hand({
      players: [
        { player_id: "P1", seat_number: 1, display_name: "A", starting_stack: 1000, hole_cards: ["2c", "3c"] },
        { player_id: "P2", seat_number: 2, display_name: "B", starting_stack: 1000, hole_cards: ["4d", "5d"] },
      ],
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      actions: [A("P1", "all_in", 300, "river"), A("P2", "call", 100, "river")],
    });
    const frames = buildReplayFrames(h);
    const final = frames.at(-1)!;
    expect(final.potBreakdown?.totalCommitted).toBe(400);
    expect(final.potBreakdown?.totalPot).toBe(200);
    expect(final.potBreakdown?.uncalled).toEqual({ player_id: "P1", amount: 200 });
    expect(final.potSize).toBe(200);
  });

  it("all-in flags the seat, stack hits 0, never negative", () => {
    const shortHand: ReplayHand = {
      hand_number: 1,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "P1", seat_number: 1, display_name: "Alice", starting_stack: 500 },
        { player_id: "P2", seat_number: 2, display_name: "Bob", starting_stack: 10000 },
      ],
      actions: [A("P1", "all_in", 500), A("P2", "call", 500)],
    };
    const final = buildReplayFrames(shortHand).at(-1)!;
    const p1 = final.seats.find((s) => s.player_id === "P1")!;
    expect(p1.is_all_in).toBe(true);
    expect(p1.chip_count).toBe(0);
    expect(final.seats.every((s) => s.chip_count >= 0)).toBe(true);
  });

  it("short all-in creates a side pot in the frame breakdown", () => {
    const h: ReplayHand = {
      hand_number: 1,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "P1", seat_number: 1, display_name: "A", starting_stack: 500 },
        { player_id: "P2", seat_number: 2, display_name: "B", starting_stack: 10000 },
        { player_id: "P3", seat_number: 3, display_name: "C", starting_stack: 10000 },
      ],
      actions: [A("P1", "all_in", 500), A("P2", "call", 1000), A("P3", "call", 1000)],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.potBreakdown?.mainPot).toBe(1500);
    expect(final.potBreakdown?.sidePots).toHaveLength(1);
    expect(final.potBreakdown?.sidePots[0].amount).toBe(1000);
  });

  it("hole cards reveal only on the final frame, not before", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c", "2h", "9s"],
      players: [
        { player_id: "P1", seat_number: 1, display_name: "A", starting_stack: 10000, hole_cards: ["Ah", "Ad"] },
        { player_id: "P2", seat_number: 2, display_name: "B", starting_stack: 10000, hole_cards: ["Kh", "Qs"] },
        { player_id: "P3", seat_number: 3, display_name: "C", starting_stack: 10000 },
      ],
      actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100), A("P1", "call", 100), A("P3", "fold", 0)],
    });
    const frames = buildReplayFrames(h);
    expect(frames[1].revealHoleCards).toBe(false);
    expect(frames[1].seats.every((s) => !s.hole_cards)).toBe(true);
    const final = frames.at(-1)!;
    expect(final.revealHoleCards).toBe(true);
    expect(final.currentStreet).toBe("showdown");
    expect(final.seats.find((s) => s.player_id === "P1")!.hole_cards).toEqual(["Ah", "Ad"]);
    // a player with no hole_cards stays hidden even on reveal
    expect(final.seats.find((s) => s.player_id === "P3")!.hole_cards).toBeUndefined();
  });

  it("no hole cards → no reveal, street stays at the last action's street", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c"],
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P3", "check", 0),
        A("P2", "bet", 200, "flop"),
        A("P1", "fold", 0, "flop"),
        A("P3", "fold", 0, "flop"),
      ],
    });
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.revealHoleCards).toBe(false);
    expect(final.currentStreet).toBe("flop");
  });

  it("position labels are assigned (BTN present)", () => {
    const h = hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100)] });
    const positions = buildReplayFrames(h)[0].seats.map((s) => s.position);
    expect(positions).toContain("BTN");
  });

  it("is deterministic — rebuilding yields identical frames", () => {
    const make = () =>
      hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100), A("P1", "raise", 300)] });
    expect(buildReplayFrames(make())).toEqual(buildReplayFrames(make()));
  });

  it("handles an empty action list (just the initial frame)", () => {
    const frames = buildReplayFrames(hand({ actions: [] }));
    expect(frames).toHaveLength(1);
    expect(frames[0].potSize).toBe(0);
  });
});

describe("buildReplayFrames — net_won (showdown winner badge)", () => {
  const withEnd = (): ReplayHand => ({
    hand_number: 1,
    button_seat: 1,
    community_cards: ["As", "Kd", "7c", "2h", "9s"],
    players: [
      { player_id: "W", seat_number: 1, display_name: "Winner", starting_stack: 10000, ending_stack: 19400, hole_cards: ["Ah", "Ad"] },
      { player_id: "L", seat_number: 2, display_name: "Loser", starting_stack: 10000, ending_stack: 0, hole_cards: ["Kh", "Qs"] },
    ],
    actions: [
      { player_id: "L", action_type: "all_in", action_amount: 10000, street: "preflop", action_order: 1 },
      { player_id: "W", action_type: "call", action_amount: 10000, street: "preflop", action_order: 2 },
    ],
  });

  it("sets signed net_won ONLY on the final frame", () => {
    const frames = buildReplayFrames(withEnd());
    expect(frames[0].seats.every((s) => s.net_won == null)).toBe(true); // initial
    expect(frames[1].seats.every((s) => s.net_won == null)).toBe(true); // mid-hand
    const final = frames.at(-1)!;
    const by = Object.fromEntries(final.seats.map((s) => [s.player_id, s]));
    expect(by.W.net_won).toBe(9400); // 19400 − 10000 → winner (>0 drives the badge)
    expect(by.L.net_won).toBe(-10000); // 0 − 10000 → loser (<0, no badge)
  });

  it("marks an equal Broadway board as a chop only when the recorded payout matches", () => {
    const h: ReplayHand = {
      hand_number: 8,
      button_seat: 1,
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 1000, ending_stack: 1000, hole_cards: ["2c", "3c"] },
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 1000, ending_stack: 1000, hole_cards: ["4d", "5d"] },
      ],
      actions: [
        { player_id: "A", action_type: "all_in", action_amount: 1000, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "call", action_amount: 1000, street: "preflop", action_order: 2 },
      ],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBe("chop");
    expect(final.showdownWinnerIds).toEqual(["A", "B"]);
    expect(final.seats.filter((s) => s.pot_winner)).toHaveLength(2);
    expect(final.seats.every((s) => s.net_won === 0)).toBe(true);
  });

  it("blocks winner glow when edited cards disagree with the stored payout", () => {
    const h: ReplayHand = {
      hand_number: 8,
      button_seat: 1,
      community_cards: ["As", "Kd", "Qc", "Jh", "Ts"],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 1000, ending_stack: 2000, hole_cards: ["2c", "3c"] },
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 1000, ending_stack: 0, hole_cards: ["4d", "5d"] },
      ],
      actions: [
        { player_id: "A", action_type: "all_in", action_amount: 1000, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "call", action_amount: 1000, street: "preflop", action_order: 2 },
      ],
    };
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.showdownResult).toBe("needs_resettle");
    expect(final.seats.every((s) => s.pot_winner !== true)).toBe(true);
    expect(final.seats.every((s) => s.net_won == null)).toBe(true);
  });

  it("a SHOWDOWN with no ending_stack stays null (engine can't evaluate hands)", () => {
    // Both players are still in at the end (all-in + call) → not a fold-win, so with
    // ending_stack stripped there is no way to know the winner → no glow.
    const h = withEnd();
    h.players = h.players.map((p) => ({ ...p, ending_stack: null }));
    const final = buildReplayFrames(h).at(-1)!;
    expect(final.seats.every((s) => s.net_won == null)).toBe(true);
  });

  it("FOLD-WIN with no ending_stack: the lone survivor still gets net_won (non-showdown glow)", () => {
    const h: ReplayHand = {
      hand_number: 1,
      button_seat: 1,
      community_cards: [],
      players: [
        { player_id: "A", seat_number: 1, display_name: "A", starting_stack: 10000 }, // bettor → winner, no ending_stack
        { player_id: "B", seat_number: 2, display_name: "B", starting_stack: 10000 },
      ],
      actions: [
        { player_id: "A", action_type: "post_sb", action_amount: 50, street: "preflop", action_order: 1 },
        { player_id: "B", action_type: "post_bb", action_amount: 100, street: "preflop", action_order: 2 },
        { player_id: "A", action_type: "raise", action_amount: 250, street: "preflop", action_order: 3 }, // A contributes 50+250=300
        { player_id: "B", action_type: "fold", action_amount: 0, street: "preflop", action_order: 4 },
      ],
    };
    const frames = buildReplayFrames(h);
    // Strictly final-frame-only: no glow on any step before the last.
    expect(frames.slice(0, -1).every((f) => f.seats.every((s) => s.net_won == null))).toBe(true);
    const by = Object.fromEntries(frames.at(-1)!.seats.map((s) => [s.player_id, s]));
    expect(by.A.net_won).toBe(100); // pot 400 − A's 300 contribution → winner glows
    expect(by.B.net_won).toBeNull(); // folder → no glow
  });
});

describe("streetFrameIndex", () => {
  it("maps each present street to the frame it first appears on", () => {
    const h = hand({
      community_cards: ["As", "Kd", "7c", "2h", "9s"],
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P3", "check", 0),
        A("P2", "bet", 200, "flop"),
        A("P3", "call", 200, "flop"),
      ],
    });
    const frames = buildReplayFrames(h);
    const idx = streetFrameIndex(frames);
    expect(idx.preflop).toBe(0);
    expect(idx.flop).toBe(frames.find((f) => f.currentStreet === "flop")!.index);
    expect(idx.flop).toBeGreaterThan(idx.preflop);
  });
});

describe("detectBigBlind", () => {
  it("uses explicit big_blind when present", () => {
    expect(detectBigBlind(hand({ big_blind: 200, actions: [A("P3", "post_bb", 100)] }))).toBe(200);
  });
  it("falls back to the post_bb amount", () => {
    expect(detectBigBlind(hand({ actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100)] }))).toBe(100);
  });
  it("returns 0 when unknown", () => {
    expect(detectBigBlind(hand({ actions: [A("P1", "bet", 300)] }))).toBe(0);
  });
});
