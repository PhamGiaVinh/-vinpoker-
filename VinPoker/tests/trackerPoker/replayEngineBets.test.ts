// UAT wave 2 (Fix 3) — buildReplayFrames `trackBets` option. Pins:
//  • option absent → frames DEEP-EQUAL the baseline (no current_bet/total_committed
//    keys anywhere — flag-off replay byte-identical);
//  • per-street current_bet from posts/bets/calls, SWEPT to 0 on the first action of
//    a later street (including for seats that haven't acted on it yet);
//  • all-in seats carry whole-hand total_committed on every later frame (incl. final);
//  • all-in reached via a stack-consuming CALL also carries total_committed;
//  • P0.1 semantics: a raise is a DELTA on the wire — committed 200 + raise-delta 400
//    → street bet 600 (reconstruction goes through streetContribution).
import { describe, it, expect } from "vitest";
import { buildReplayFrames, type ReplayHand } from "@/lib/tracker-poker/replayEngine";

const PLAYERS = [
  { player_id: "P1", seat_number: 1, display_name: "Alice", starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, display_name: "Bob", starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, display_name: "Cara", starting_stack: 600 },
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
    community_cards: ["As", "Kd", "7c", "2h", "9s"],
    players: PLAYERS,
    actions: [],
    ...partial,
  };
}

const seatOf = (frames: ReturnType<typeof buildReplayFrames>, k: number, id: string) =>
  frames[k].seats.find((s) => s.player_id === id)!;

describe("trackBets absent — byte-identical frames", () => {
  it("frames deep-equal the no-options baseline; no bet keys anywhere", () => {
    const h = hand({
      actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100), A("P1", "call", 100)],
    });
    const base = buildReplayFrames(hand({ actions: h.actions }));
    const off = buildReplayFrames(hand({ actions: h.actions }), {});
    expect(off).toEqual(base);
    for (const f of base) {
      for (const s of f.seats) {
        expect("current_bet" in s).toBe(false);
        expect("total_committed" in s).toBe(false);
      }
    }
  });
});

describe("trackBets — street bets + sweep", () => {
  it("posts and calls populate preflop current_bet per seat", () => {
    const h = hand({
      actions: [A("P2", "post_sb", 50), A("P3", "post_bb", 100), A("P1", "call", 100)],
    });
    const frames = buildReplayFrames(h, { trackBets: true });
    expect(seatOf(frames, 1, "P2").current_bet).toBe(50);
    expect(seatOf(frames, 2, "P3").current_bet).toBe(100);
    expect(seatOf(frames, 3, "P1").current_bet).toBe(100);
    expect(seatOf(frames, 3, "P2").current_bet).toBe(50); // untouched by others' actions
  });

  it("P0.1: raise is a DELTA — committed 200 then raise-delta 400 → street bet 600", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 100),
        A("P3", "post_bb", 200),
        A("P1", "call", 200),
        A("P2", "raise", 400), // wire delta: SB adds 400 on top of the 100 post? no — P2 committed 100, raise delta 400 → 500
        A("P3", "raise", 400), // BB committed 200 + delta 400 → 600 street total
      ],
    });
    const frames = buildReplayFrames(h, { trackBets: true });
    expect(seatOf(frames, 4, "P2").current_bet).toBe(500);
    expect(seatOf(frames, 5, "P3").current_bet).toBe(600);
  });

  it("first action of a later street sweeps EVERY seat's current_bet to 0", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "call", 100),
        A("P2", "call", 50),
        A("P2", "check", 0, "flop"), // street boundary — sweep fires here
        A("P3", "bet", 300, "flop"),
      ],
    });
    const frames = buildReplayFrames(h, { trackBets: true });
    // Frame 4 (last preflop action): bets still on the felt.
    expect(seatOf(frames, 4, "P1").current_bet).toBe(100);
    // Frame 5 (first flop action): everyone swept — including P1/P3 who haven't acted.
    expect(seatOf(frames, 5, "P1").current_bet).toBe(0);
    expect(seatOf(frames, 5, "P3").current_bet).toBe(0);
    expect(seatOf(frames, 5, "P2").current_bet).toBe(0);
    // P3's flop bet shows on frame 6.
    expect(seatOf(frames, 6, "P3").current_bet).toBe(300);
  });
});

describe("trackBets — all-in totals", () => {
  it("explicit all_in carries whole-hand total_committed through later frames incl. final", () => {
    // Cara (600) shoves over her BB; Bob covers with plenty behind (no all-in for him).
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P3", "all_in", 500), // BB 100 + 500 = whole 600 stack
        A("P2", "call", 550), // 50 + 550 = 600 committed, 9400 behind
        A("P2", "check", 0, "flop"),
      ],
    });
    const frames = buildReplayFrames(h, { trackBets: true });
    expect(seatOf(frames, 3, "P3").total_committed).toBe(600);
    // After the flop sweep the pill amount survives via total_committed…
    expect(seatOf(frames, 5, "P3").current_bet).toBe(0);
    expect(seatOf(frames, 5, "P3").total_committed).toBe(600);
    // …and on the final frame too.
    expect(seatOf(frames, frames.length - 1, "P3").total_committed).toBe(600);
    // The covering caller (chips behind) never gets the key.
    expect("total_committed" in seatOf(frames, 5, "P2")).toBe(false);
  });

  it("all-in via a stack-consuming CALL (chip→0) also carries total_committed", () => {
    // Cara's whole 600 stack goes in on a call — no explicit all_in action.
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "bet", 600),
        A("P3", "call", 500), // 100 post + 500 = 600 → stack 0
      ],
    });
    const frames = buildReplayFrames(h, { trackBets: true });
    const cara = seatOf(frames, 4, "P3");
    expect(cara.is_all_in).toBe(true);
    expect(cara.total_committed).toBe(600);
  });

  it("a stray action by a folded player still advances the street sweep", () => {
    const h = hand({
      actions: [
        A("P2", "post_sb", 50),
        A("P3", "post_bb", 100),
        A("P1", "fold", 0),
        A("P1", "check", 0, "flop"), // stray — folded player "acts" on the flop
      ],
    });
    const frames = buildReplayFrames(h, { trackBets: true });
    // Sweep fired off the stray action's street: everyone's street bets are 0.
    expect(seatOf(frames, 4, "P2").current_bet).toBe(0);
    expect(seatOf(frames, 4, "P3").current_bet).toBe(0);
  });
});
