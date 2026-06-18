import { describe, it, expect } from "vitest";
import {
  blindSeats,
  actorToAct,
  isRoundComplete,
  betToAdded,
  foldWinner,
  settleFoldWin,
  settleSelectedWinners,
  assertChipConservation,
  nextStreetAfter,
  isRunout,
  eligibleActorCount,
  type EngineSeat,
  type EngineState,
  type EngineStreetAction,
} from "@/lib/tracker-poker/trackerEngine";

// ---- builders ---------------------------------------------------------------
function seat(
  n: number,
  stack: number,
  o: Partial<EngineSeat> = {}
): EngineSeat {
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
const post = (seat_number: number, action_type: string): EngineStreetAction => ({
  player_id: `p${seat_number}`,
  seat_number,
  action_type,
});

// =============================================================================
describe("blindSeats — SB/BB from the button", () => {
  it("heads-up: button is the SB, the other player is the BB", () => {
    expect(blindSeats([1, 2], 1)).toEqual({ sbSeat: 1, bbSeat: 2 });
    expect(blindSeats([1, 2], 2)).toEqual({ sbSeat: 2, bbSeat: 1 });
  });
  it("3-handed: SB then BB clockwise from button", () => {
    expect(blindSeats([1, 2, 3], 1)).toEqual({ sbSeat: 2, bbSeat: 3 });
    expect(blindSeats([1, 2, 3], 3)).toEqual({ sbSeat: 1, bbSeat: 2 });
  });
  it("gap-robust (non-contiguous seats)", () => {
    expect(blindSeats([2, 5, 8], 5)).toEqual({ sbSeat: 8, bbSeat: 2 });
  });
});

// =============================================================================
describe("heads-up action order", () => {
  it("preflop: button/SB posts first, then BB", () => {
    const seats = [seat(1, 100), seat(2, 100)]; // 1 = button = SB
    const state: EngineState = { seats, buttonSeat: 1, street: "preflop", streetActions: [] };
    const a = actorToAct(state)!;
    expect(a.seat_number).toBe(1); // SB posts first
    expect(a.needsPost).toBe("post_sb");
  });

  it("preflop: button/SB acts FIRST after both blinds are posted", () => {
    const seats = [
      seat(1, 99, { street_committed: 1, total_committed: 1 }), // SB posted 1
      seat(2, 98, { street_committed: 2, total_committed: 2 }), // BB posted 2
    ];
    const state: EngineState = {
      seats,
      buttonSeat: 1,
      street: "preflop",
      streetActions: [post(1, "post_sb"), post(2, "post_bb")],
      bigBlind: 2,
    };
    const a = actorToAct(state)!;
    expect(a.seat_number).toBe(1); // button/SB acts first preflop
    expect(a.needsPost).toBeUndefined();
    expect(a.toCall).toBe(1); // owes 2 - 1
  });

  it("postflop: BB / non-button acts first", () => {
    const seats = [seat(1, 90), seat(2, 90)];
    const state: EngineState = { seats, buttonSeat: 1, street: "flop", streetActions: [] };
    expect(actorToAct(state)!.seat_number).toBe(2); // BB first postflop
  });
});

// =============================================================================
describe("3-handed action order", () => {
  const base = () => [seat(1, 100), seat(2, 100), seat(3, 100)]; // 1=BTN,2=SB,3=BB

  it("preflop first voluntary actor = UTG (button in 3-handed = left of BB)", () => {
    const seats = [
      seat(1, 100), // BTN / UTG
      seat(2, 99, { street_committed: 1, total_committed: 1 }), // SB
      seat(3, 98, { street_committed: 2, total_committed: 2 }), // BB
    ];
    const state: EngineState = {
      seats,
      buttonSeat: 1,
      street: "preflop",
      streetActions: [post(2, "post_sb"), post(3, "post_bb")],
      bigBlind: 2,
    };
    expect(actorToAct(state)!.seat_number).toBe(1); // UTG = button
  });

  it("6-handed preflop first actor = seat left of BB (true UTG)", () => {
    const seats = [
      seat(1, 100),
      seat(2, 99, { street_committed: 1, total_committed: 1 }),
      seat(3, 98, { street_committed: 2, total_committed: 2 }),
      seat(4, 100),
      seat(5, 100),
      seat(6, 100),
    ];
    const state: EngineState = {
      seats,
      buttonSeat: 1,
      street: "preflop",
      streetActions: [post(2, "post_sb"), post(3, "post_bb")],
      bigBlind: 2,
    };
    expect(actorToAct(state)!.seat_number).toBe(4); // UTG = seat after BB(3)
  });

  it("postflop first actor = first eligible left of button", () => {
    const state: EngineState = { seats: base(), buttonSeat: 1, street: "flop", streetActions: [] };
    expect(actorToAct(state)!.seat_number).toBe(2); // SB = first left of button
  });
});

// =============================================================================
describe("closed clockwise ring — skip folded / all-in", () => {
  it("skips folded and all-in players, wraps clockwise", () => {
    const seats = [
      seat(1, 100, { street_committed: 10 }),
      seat(2, 0, { all_in: true, street_committed: 10 }),
      seat(3, 100, { folded: true }),
      seat(4, 100, { street_committed: 0 }), // owes the 10
    ];
    // last voluntary actor was seat 1 (a bet). Next eligible owing = seat 4.
    const state: EngineState = {
      seats,
      buttonSeat: 1,
      street: "flop",
      streetActions: [{ player_id: "p1", seat_number: 1, action_type: "bet" }],
    };
    expect(actorToAct(state)!.seat_number).toBe(4);
  });

  it("returns null when the betting round is complete", () => {
    const seats = [
      seat(1, 90, { street_committed: 10 }),
      seat(2, 90, { street_committed: 10 }),
    ];
    const state: EngineState = {
      seats,
      buttonSeat: 1,
      street: "flop",
      streetActions: [
        { player_id: "p2", seat_number: 2, action_type: "bet" },
        { player_id: "p1", seat_number: 1, action_type: "call" },
      ],
    };
    expect(actorToAct(state)).toBeNull();
    expect(isRoundComplete(state)).toBe(true);
  });
});

// =============================================================================
describe("betToAdded — 'Bet to' (street total) → chips added; all-in only at stack 0", () => {
  it("raise to 8 with a larger stack is NOT all-in", () => {
    expect(betToAdded(8, 0, 100)).toEqual({ added: 8, allIn: false });
  });
  it("raise to 8 when already committed 2 this street adds 6", () => {
    expect(betToAdded(8, 2, 100)).toEqual({ added: 6, allIn: false });
  });
  it("bet to the whole stack IS all-in", () => {
    expect(betToAdded(100, 0, 100)).toEqual({ added: 100, allIn: true });
  });
  it("short stack: bet to 8 with only 8 behind is all-in", () => {
    expect(betToAdded(8, 0, 8)).toEqual({ added: 8, allIn: true });
  });
  it("bet-to below what is already committed adds nothing (no negative)", () => {
    expect(betToAdded(1, 5, 100)).toEqual({ added: 0, allIn: false });
  });
});

// =============================================================================
describe("round close + street progression", () => {
  it("nextStreetAfter walks preflop→flop→turn→river→showdown then null", () => {
    expect(nextStreetAfter("preflop")).toBe("flop");
    expect(nextStreetAfter("flop")).toBe("turn");
    expect(nextStreetAfter("turn")).toBe("river");
    expect(nextStreetAfter("river")).toBe("showdown");
    expect(nextStreetAfter("showdown")).toBeNull();
  });

  it("flop bet then call closes the round (→ advance to turn)", () => {
    const seats = [seat(1, 90, { street_committed: 10 }), seat(2, 90, { street_committed: 10 })];
    const state: EngineState = {
      seats,
      buttonSeat: 1,
      street: "flop",
      streetActions: [
        { player_id: "p2", seat_number: 2, action_type: "bet" },
        { player_id: "p1", seat_number: 1, action_type: "call" },
      ],
    };
    expect(isRoundComplete(state)).toBe(true);
  });

  it("preflop is NOT complete until both blinds are posted", () => {
    const seats = [seat(1, 100), seat(2, 100)];
    const state: EngineState = { seats, buttonSeat: 1, street: "preflop", streetActions: [] };
    expect(isRoundComplete(state)).toBe(false);
  });

  it("all-in run-out: ≤1 eligible actor among ≥2 live players", () => {
    const seats = [
      seat(1, 0, { all_in: true, total_committed: 100 }),
      seat(2, 0, { all_in: true, total_committed: 100 }),
    ];
    expect(eligibleActorCount(seats)).toBe(0);
    expect(isRunout(seats)).toBe(true);
  });
});

// =============================================================================
describe("fold win", () => {
  it("all but one folds → that player is the winner", () => {
    const seats = [
      seat(1, 80, { folded: true, total_committed: 20 }),
      seat(2, 70, { folded: true, total_committed: 30 }),
      seat(3, 90, { total_committed: 10 }),
    ];
    expect(foldWinner(seats)!.player_id).toBe("p3");
  });

  it("settleFoldWin awards the whole pot to the remaining player", () => {
    const seats = [
      seat(1, 80, { starting_stack: 100, folded: true, total_committed: 20 }),
      seat(2, 90, { starting_stack: 100, total_committed: 10 }),
    ];
    const out = settleFoldWin(seats);
    const byId = Object.fromEntries(out.map((r) => [r.player_id, r.ending_stack]));
    expect(byId.p2).toBe(90 + 30); // pot = 20 + 10
    expect(byId.p1).toBe(80);
    expect(assertChipConservation(seats, out)).toBe(true); // 200 in, 200 out
  });
});

// =============================================================================
describe("chip conservation — fold-win and selected-winner split", () => {
  it("single selected winner collects the pot, chips conserved", () => {
    const seats = [
      seat(1, 50, { starting_stack: 100, total_committed: 50 }),
      seat(2, 70, { starting_stack: 100, total_committed: 30 }),
      seat(3, 80, { starting_stack: 100, total_committed: 20 }),
    ];
    const out = settleSelectedWinners(seats, ["p1"]);
    const byId = Object.fromEntries(out.map((r) => [r.player_id, r.ending_stack]));
    expect(byId.p1).toBe(50 + 100); // pot = 100
    expect(assertChipConservation(seats, out)).toBe(true);
  });

  it("split pot between two winners, odd chip to the earliest seat, chips conserved", () => {
    const seats = [
      seat(1, 50, { starting_stack: 100, total_committed: 50 }),
      seat(2, 50, { starting_stack: 100, total_committed: 50 }),
      seat(3, 99, { starting_stack: 100, total_committed: 1 }), // pot = 101 (odd)
    ];
    const out = settleSelectedWinners(seats, ["p1", "p2"]);
    const byId = Object.fromEntries(out.map((r) => [r.player_id, r.ending_stack]));
    expect(byId.p1).toBe(50 + 51); // earliest seat gets the odd chip
    expect(byId.p2).toBe(50 + 50);
    expect(assertChipConservation(seats, out)).toBe(true);
  });
});

// =============================================================================
describe("all-in players: skipped for action but eligible for showdown/settlement", () => {
  // p1 is all-in (stack 0, fully committed); p2 still has chips behind.
  const allInSeats = () => [
    seat(1, 0, { starting_stack: 100, all_in: true, total_committed: 100 }),
    seat(2, 60, { starting_stack: 100, total_committed: 40 }),
  ];

  it("the all-in player is NEVER asked to act (skipped in the ring)", () => {
    const state: EngineState = { seats: allInSeats(), buttonSeat: 1, street: "river", streetActions: [] };
    expect(actorToAct(state)?.player_id).toBe("p2"); // p1 (all-in) skipped → p2 acts
  });

  it("the all-in player CAN be selected as the showdown winner and collects the pot", () => {
    const seats = allInSeats();
    const out = settleSelectedWinners(seats, ["p1"]);
    const byId = Object.fromEntries(out.map((r) => [r.player_id, r.ending_stack]));
    expect(byId.p1).toBe(0 + 140); // pot = 100 + 40 → all-in player wins it
    expect(byId.p2).toBe(60);
    expect(assertChipConservation(seats, out)).toBe(true); // 200 in, 200 out
  });
});

// =============================================================================
describe("viewer path — settlement output matches record_hand payload shape", () => {
  it("every result has {player_id, ending_stack} the existing write path consumes", () => {
    const seats = [
      seat(1, 80, { starting_stack: 100, folded: true, total_committed: 20 }),
      seat(2, 90, { starting_stack: 100, total_committed: 10 }),
    ];
    const out = settleFoldWin(seats);
    for (const r of out) {
      expect(typeof r.player_id).toBe("string");
      expect(Number.isInteger(r.ending_stack)).toBe(true);
    }
    expect(out.map((r) => r.player_id).sort()).toEqual(["p1", "p2"]);
  });
});
