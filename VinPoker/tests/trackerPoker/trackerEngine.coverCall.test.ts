// UAT wave 2 (Fix 1) — cover-call runout waiver (EngineState.coverCallWaiver, set by
// the hook from FEATURES.trackerCoverCallRunout). Pins:
//  • flag OFF (field unset) → behavior byte-identical to today: the lone covering
//    caller "owes" a voluntary action each street (isRoundComplete=false, actor=coverer);
//  • flag ON → once the coverer matched the highest bet, betting for the HAND is
//    closed (complete=true, actor=null) — no pointless per-street CHECK;
//  • every edge case from the design verdict table: mid-street uncalled all-in, HU
//    blind-post variants, deadSb, ≥2 eligible, fold-win guard, 0-eligible parity,
//    short all-in behind, over-the-top reopen, and preflop posts never skipped.
import { describe, it, expect } from "vitest";
import {
  actorToAct,
  isRoundComplete,
  type EngineSeat,
  type EngineState,
  type EngineStreetAction,
} from "@/lib/tracker-poker/trackerEngine";

function seat(n: number, stack: number, o: Partial<EngineSeat> = {}): EngineSeat {
  return {
    player_id: `p${n}`,
    seat_number: n,
    starting_stack: o.starting_stack ?? stack,
    stack,
    street_committed: o.street_committed ?? 0,
    total_committed: o.total_committed ?? 0,
    folded: o.folded ?? false,
    all_in: o.all_in ?? false,
  };
}
const act = (seat_number: number, action_type: string): EngineStreetAction => ({
  player_id: `p${seat_number}`,
  seat_number,
  action_type,
});

function st(over: Partial<EngineState>): EngineState {
  return {
    seats: [],
    buttonSeat: 1,
    street: "flop",
    streetActions: [],
    bigBlind: 200,
    coverCallWaiver: true,
    ...over,
  };
}

// The owner's exact UAT shape at a fresh runout street: 5 all-in, 3 folded, 1 coverer
// with chips behind, nobody has bet this street yet.
const runoutStreetSeats = [
  seat(1, 0, { all_in: true, total_committed: 2_900_000 }),
  seat(2, 0, { all_in: true, total_committed: 10_300_000 }),
  seat(3, 15_000_000, { total_committed: 29_900_000 }), // the coverer
  seat(4, 5_400_000, { folded: true }),
  seat(5, 610_000, { folded: true }),
  seat(6, 8_500_000, { folded: true }),
  seat(7, 0, { all_in: true, total_committed: 21_600_000 }),
  seat(8, 0, { all_in: true, total_committed: 13_500_000 }),
  seat(9, 0, { all_in: true, total_committed: 29_900_000 }),
];

describe("cover-call waiver — flag OFF regression (field unset)", () => {
  it("lone coverer still owes a voluntary action each street (today's behavior)", () => {
    const s = st({ seats: runoutStreetSeats, coverCallWaiver: undefined });
    expect(isRoundComplete(s)).toBe(false);
    expect(actorToAct(s)?.player_id).toBe("p3");
  });
});

describe("cover-call waiver — flag ON", () => {
  it("runout street start: round complete, no actor (no pointless CHECK)", () => {
    const s = st({ seats: runoutStreetSeats });
    expect(isRoundComplete(s)).toBe(true);
    expect(actorToAct(s)).toBeNull();
  });

  it("mid-street uncalled all-in: the eligible caller still owes → NOT complete (unchanged)", () => {
    // A shoves 8k this street; B (eligible) has only 2k in — owes a call.
    const seats = [
      seat(1, 0, { all_in: true, street_committed: 8_000 }),
      seat(2, 20_000, { street_committed: 2_000 }),
    ];
    const s = st({ seats, streetActions: [act(1, "all_in")] });
    expect(isRoundComplete(s)).toBe(false);
    expect(actorToAct(s)?.player_id).toBe("p2");
  });

  it("after the coverer matches the shove → complete, actor null", () => {
    const seats = [
      seat(1, 0, { all_in: true, street_committed: 8_000 }),
      seat(2, 12_000, { street_committed: 8_000 }),
    ];
    const s = st({ seats, streetActions: [act(1, "all_in"), act(2, "call")] });
    expect(isRoundComplete(s)).toBe(true);
    expect(actorToAct(s)).toBeNull();
  });

  it("preflop: blinds are NEVER skipped — SB/BB posts still prompted first", () => {
    // HU preflop before any post: both have chips (2 eligible → waiver can't fire
    // anyway), and the post guard drives the prompts.
    const seats = [seat(1, 10_000), seat(2, 10_000)];
    const s = st({ seats, street: "preflop", buttonSeat: 1, streetActions: [] });
    expect(isRoundComplete(s)).toBe(false);
    expect(actorToAct(s)?.needsPost).toBe("post_sb");
  });

  it("HU: BB all-in FROM THE POST bigger than SB's post → SB owes the call first", () => {
    // Button/SB posted 100 and has chips; BB's whole 300 stack went in on the post.
    const seats = [
      seat(1, 9_900, { street_committed: 100 }),
      seat(2, 0, { all_in: true, street_committed: 300 }),
    ];
    const s = st({
      seats,
      street: "preflop",
      buttonSeat: 1,
      streetActions: [act(1, "post_sb"), act(2, "post_bb")],
    });
    expect(isRoundComplete(s)).toBe(false); // SB owes 200 more
    expect(actorToAct(s)?.player_id).toBe("p1");
  });

  it("HU: BB short all-in post ≤ SB's post → complete right after the posts (runout)", () => {
    const seats = [
      seat(1, 9_900, { street_committed: 100 }),
      seat(2, 0, { all_in: true, street_committed: 80 }), // 80-chip BB stack, all in on the post
    ];
    const s = st({
      seats,
      street: "preflop",
      buttonSeat: 1,
      streetActions: [act(1, "post_sb"), act(2, "post_bb")],
    });
    expect(isRoundComplete(s)).toBe(true);
    expect(actorToAct(s)).toBeNull();
  });

  it("deadSb: waiver still fires on a runout street with the dead-SB flag set", () => {
    const s = st({ seats: runoutStreetSeats, deadSb: true });
    expect(isRoundComplete(s)).toBe(true);
    expect(actorToAct(s)).toBeNull();
  });

  it("fold-win shape (1 live player) → waiver never fires; foldWinner path owns it", () => {
    const seats = [seat(1, 10_000), seat(2, 5_000, { folded: true }), seat(3, 0, { folded: true })];
    // isRoundComplete may be true/false via owes() as today — the waiver must not
    // be the reason. With 1 live player the waiver guard (live<2) refuses.
    const s = st({ seats });
    expect(actorToAct(s)?.player_id ?? null).not.toBeNull(); // normal sweep still asks p1
  });

  it("≥2 eligible actors: normal betting untouched", () => {
    const seats = [seat(1, 10_000), seat(2, 10_000), seat(3, 0, { all_in: true })];
    const s = st({ seats });
    expect(isRoundComplete(s)).toBe(false);
    expect(actorToAct(s)).not.toBeNull();
  });

  it("0 eligible (everyone all-in): complete with AND without the waiver (parity)", () => {
    const seats = [seat(1, 0, { all_in: true }), seat(2, 0, { all_in: true })];
    expect(isRoundComplete(st({ seats }))).toBe(true);
    expect(isRoundComplete(st({ seats, coverCallWaiver: undefined }))).toBe(true);
  });

  it("coverer bets, SHORTER all-in behind → complete (short shove doesn't reopen)", () => {
    const seats = [
      seat(1, 15_000, { street_committed: 5_000 }),
      seat(2, 0, { all_in: true, street_committed: 4_000 }),
    ];
    const s = st({ seats, streetActions: [act(1, "bet"), act(2, "all_in")] });
    expect(isRoundComplete(s)).toBe(true);
    expect(actorToAct(s)).toBeNull();
  });

  it("all-in OVER THE TOP of the coverer's bet → coverer owes again (no waiver)", () => {
    const seats = [
      seat(1, 15_000, { street_committed: 5_000 }),
      seat(2, 0, { all_in: true, street_committed: 8_000 }),
    ];
    const s = st({ seats, streetActions: [act(1, "bet"), act(2, "all_in")] });
    expect(isRoundComplete(s)).toBe(false);
    expect(actorToAct(s)?.player_id).toBe("p1");
  });
});
