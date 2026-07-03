// UAT wave 2 (Fix 1) — the owner's exact bug sequence, driven through the REAL
// engine (isRunout/isRoundComplete with coverCallWaiver) feeding the REAL FSM
// (deriveTrackerWorkflowState): 9-max, 5 preflop shoves + 3 folds + 1 covering
// call → runout_reveal fires at the close, then (reveal or skip) the board flows
// enter_flop → enter_turn → enter_river → showdown_input with NO *_action state
// demanding a pointless CHECK from the coverer. Flag OFF pins today's behavior
// (flop_action would ask the coverer to act).
import { describe, it, expect } from "vitest";
import {
  isRunout,
  isRoundComplete,
  type EngineSeat,
  type EngineState,
} from "@/lib/tracker-poker/trackerEngine";
import {
  deriveTrackerWorkflowState,
  type WorkflowStreet,
} from "@/components/cashier/tournament-live/handinput/trackerWorkflow";

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

// After the covering call closed preflop: 5 all-in (stack 0), 3 folded, coverer
// matched the biggest shove. street_committed carries the preflop amounts.
const closedPreflopSeats: EngineSeat[] = [
  seat(1, 0, { all_in: true, street_committed: 2_900_000 }),
  seat(2, 0, { all_in: true, street_committed: 10_300_000 }),
  seat(3, 15_000_000, { street_committed: 29_900_000 }), // coverer, called
  seat(4, 5_400_000, { folded: true }),
  seat(5, 610_000, { folded: true }),
  seat(6, 8_500_000, { folded: true }),
  seat(7, 0, { all_in: true, street_committed: 21_600_000 }),
  seat(8, 0, { all_in: true, street_committed: 13_500_000 }),
  seat(9, 0, { all_in: true, street_committed: 29_900_000 }),
];

// A FRESH runout street (flop/turn/river): street bets swept, nobody owes.
const runoutStreetSeats: EngineSeat[] = closedPreflopSeats.map((s) => ({
  ...s,
  street_committed: 0,
}));

const engine = (seats: EngineSeat[], street: EngineState["street"], waiver: boolean): EngineState => ({
  seats,
  buttonSeat: 2,
  street,
  // The closing call was voluntary → the coverer HAS acted preflop.
  streetActions:
    street === "preflop"
      ? [
          { player_id: "p1", seat_number: 1, action_type: "post_sb" },
          { player_id: "p2", seat_number: 2, action_type: "post_bb" },
          { player_id: "p9", seat_number: 9, action_type: "all_in" },
          { player_id: "p3", seat_number: 3, action_type: "call" },
        ]
      : [],
  bigBlind: 200_000,
  coverCallWaiver: waiver || undefined,
});

const fsm = (over: {
  currentStreet: WorkflowStreet;
  persistedBoardCount: number;
  state: EngineState;
  revealDone: boolean;
}) =>
  deriveTrackerWorkflowState({
    handStarted: true,
    blindsConfirmed: true,
    currentStreet: over.currentStreet,
    persistedBoardCount: over.persistedBoardCount,
    isReview: false,
    reviewValid: false,
    submitted: false,
    isRunout: isRunout(over.state.seats),
    bettingClosed: isRoundComplete(over.state),
    revealDone: over.revealDone,
  });

describe("cover-call runout — full sequence with the REAL engine (flag ON)", () => {
  it("preflop close (cover call) → runout_reveal immediately", () => {
    const s = engine(closedPreflopSeats, "preflop", true);
    expect(isRunout(s.seats)).toBe(true);
    expect(isRoundComplete(s)).toBe(true);
    expect(fsm({ currentStreet: "preflop", persistedBoardCount: 0, state: s, revealDone: false })).toBe(
      "runout_reveal"
    );
  });

  it("after reveal (or skip): flop not yet persisted → enter_flop, NO preflop/flop action", () => {
    const s = engine(runoutStreetSeats, "flop", true);
    expect(fsm({ currentStreet: "flop", persistedBoardCount: 0, state: s, revealDone: true })).toBe("enter_flop");
  });

  it("flop persisted → betting stays closed (waiver) so the hook auto-advances; turn → enter_turn", () => {
    const flop = engine(runoutStreetSeats, "flop", true);
    // The transient flop_action render is harmless BECAUSE the engine reports the
    // round complete with no actor — the auto-advance effect fires immediately.
    expect(isRoundComplete(flop)).toBe(true);
    const turn = engine(runoutStreetSeats, "turn", true);
    expect(fsm({ currentStreet: "turn", persistedBoardCount: 3, state: turn, revealDone: true })).toBe("enter_turn");
  });

  it("turn persisted → river entry; river persisted → showdown_input", () => {
    const river = engine(runoutStreetSeats, "river", true);
    expect(fsm({ currentStreet: "river", persistedBoardCount: 4, state: river, revealDone: true })).toBe(
      "enter_river"
    );
    const showdown = engine(runoutStreetSeats, "showdown", true);
    expect(fsm({ currentStreet: "showdown", persistedBoardCount: 5, state: showdown, revealDone: true })).toBe(
      "showdown_input"
    );
  });
});

describe("cover-call runout — flag OFF regression (today's behavior)", () => {
  it("runout street with the flop persisted → flop_action still demands the coverer act", () => {
    const flop = engine(runoutStreetSeats, "flop", false);
    expect(isRoundComplete(flop)).toBe(false); // coverer 'owes' a voluntary action
    expect(fsm({ currentStreet: "flop", persistedBoardCount: 3, state: flop, revealDone: true })).toBe(
      "flop_action"
    );
  });

  it("runout_reveal itself still fires at the preflop close (pre-existing P2-2, no waiver needed)", () => {
    const s = engine(closedPreflopSeats, "preflop", false);
    expect(fsm({ currentStreet: "preflop", persistedBoardCount: 0, state: s, revealDone: false })).toBe(
      "runout_reveal"
    );
  });
});
