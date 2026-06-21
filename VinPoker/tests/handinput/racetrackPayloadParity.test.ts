// PR-B payload-parity gate (the linchpin — empirical proof of Q5 units).
//
// The racetrack ActionDock feeds the bet/raise TOTAL ("bet to") via the controller's
// additive `betToTotal` param; the old console (ActionStepPanel) feeds the same total
// via the `betAmount` input string. This pins that BOTH paths build the byte-identical
// `record_action` body, so the racetrack write-path is provably unchanged.
//
// Mirrors useStandaloneHandInput.handleAction's bet/raise decision:
//   const betTo = betToOverride ?? (parseInt(betAmount) || 0);
//   const { added } = betToAdded(betTo, current_bet, current_stack);
//   buildRecordActionBody({ ..., actionType, actionAmount: added });

import { describe, it, expect } from "vitest";
import { betToAdded } from "@/lib/tracker-poker/trackerEngine";
import { buildRecordActionBody } from "@/components/cashier/tournament-live/handinput/handInputEdge";

const CTX = {
  tournamentId: "t1",
  handId: "h1",
  playerId: "p1",
  entryNumber: 1,
  street: "preflop",
  actionOrder: 3,
};

// Old console path: betAmount is a string TOTAL ("bet to").
function bodyOldConsole(
  betAmount: string,
  currentBet: number,
  stack: number,
  actionType: "raise" | "bet",
) {
  const betTo = parseInt(betAmount) || 0;
  const { added } = betToAdded(betTo, currentBet, stack);
  return buildRecordActionBody({ ...CTX, actionType, actionAmount: added });
}

// Racetrack path: ForcedAmountPad returns a number TOTAL → betToTotal override.
function bodyRacetrack(
  total: number,
  currentBet: number,
  stack: number,
  actionType: "raise" | "bet",
) {
  const betTo = total ?? (parseInt("") || 0);
  const { added } = betToAdded(betTo, currentBet, stack);
  return buildRecordActionBody({ ...CTX, actionType, actionAmount: added });
}

describe("racetrack ↔ old console: record_action payload parity (PR-B Q5 gate)", () => {
  it("committed SB case: raise to 1000 (committed 200, behind 19800) → identical body, added=800", () => {
    const old = bodyOldConsole("1000", 200, 19800, "raise");
    const rt = bodyRacetrack(1000, 200, 19800, "raise");
    expect(rt).toEqual(old);
    expect(rt.action_amount).toBe(800); // added = total − committed (behind > added, no clamp)
  });

  it("no prior bet → bet to 1500 (committed 0) → identical body, added=1500", () => {
    const old = bodyOldConsole("1500", 0, 30000, "bet");
    const rt = bodyRacetrack(1500, 0, 30000, "bet");
    expect(rt).toEqual(old);
    expect(rt.action_amount).toBe(1500);
  });

  it("all-in-by-raise: total = committed + behind (200 + 19800) → identical body, added=19800", () => {
    const old = bodyOldConsole("20000", 200, 19800, "raise");
    const rt = bodyRacetrack(20000, 200, 19800, "raise");
    expect(rt).toEqual(old);
    expect(rt.action_amount).toBe(19800); // added clamps to the whole behind
  });

  it("over-typed total clamps to the stack identically in both paths", () => {
    const old = bodyOldConsole("999999", 200, 19800, "raise");
    const rt = bodyRacetrack(999999, 200, 19800, "raise");
    expect(rt).toEqual(old);
    expect(rt.action_amount).toBe(19800);
  });
});
