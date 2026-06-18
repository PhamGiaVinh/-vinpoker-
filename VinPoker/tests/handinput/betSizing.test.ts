// Pure quick-sizing math for the console's +BB / 2.5BB / 3BB / Pot / All-in chips.
// Every value is an ABSOLUTE "bet to" street-total (engine semantics), clamped to
// [0, current_bet + stack] and integer-rounded. 2.5BB/3BB are null when BB unknown.

import { describe, it, expect } from "vitest";
import {
  maxBetTo,
  clampBetTo,
  computeSizingChips,
  incrementByBB,
  type SizingContext,
} from "@/components/cashier/tournament-live/handinput/betSizing";

function ctx(over: Partial<SizingContext>): SizingContext {
  return {
    bigBlind: over.bigBlind ?? 100,
    pot: over.pot ?? 300,
    toCall: over.toCall ?? 0,
    actorCurrentBet: over.actorCurrentBet ?? 0,
    actorCurrentStack: over.actorCurrentStack ?? 10000,
  };
}

describe("betSizing", () => {
  it("maxBetTo = current_bet + stack", () => {
    expect(maxBetTo(ctx({ actorCurrentBet: 200, actorCurrentStack: 800 }))).toBe(1000);
  });

  it("clampBetTo rounds and clamps into [0, max]", () => {
    const c = ctx({ actorCurrentBet: 0, actorCurrentStack: 500 });
    expect(clampBetTo(249.6, c)).toBe(250);
    expect(clampBetTo(-50, c)).toBe(0);
    expect(clampBetTo(9999, c)).toBe(500); // clamped to max
  });

  it("2.5BB / 3BB / Pot / All-in for a deep stack, no bet to call", () => {
    const chips = computeSizingChips(ctx({ bigBlind: 100, pot: 300, toCall: 0, actorCurrentBet: 0, actorCurrentStack: 10000 }));
    expect(chips.bb2_5).toBe(250);
    expect(chips.bb3).toBe(300);
    expect(chips.pot).toBe(300); // current_bet(0) + pot(300) + 2*toCall(0)
    expect(chips.allIn).toBe(10000);
  });

  it("Pot-sized raise-to includes the call: current_bet + pot + 2*toCall", () => {
    const chips = computeSizingChips(ctx({ bigBlind: 100, pot: 300, toCall: 100, actorCurrentBet: 100, actorCurrentStack: 10000 }));
    expect(chips.pot).toBe(600); // 100 + 300 + 200
  });

  it("BB chips are null when the big blind is unknown (0)", () => {
    const chips = computeSizingChips(ctx({ bigBlind: 0 }));
    expect(chips.bb2_5).toBeNull();
    expect(chips.bb3).toBeNull();
    // Pot + All-in still resolve.
    expect(chips.allIn).toBe(10000);
  });

  it("chips clamp to the all-in ceiling for a short stack", () => {
    const chips = computeSizingChips(ctx({ bigBlind: 100, pot: 50, toCall: 0, actorCurrentBet: 0, actorCurrentStack: 200 }));
    expect(chips.bb3).toBe(200); // round(300) clamped to 200
    expect(chips.allIn).toBe(200);
  });

  it("incrementByBB nudges from the box, or from current_bet when empty/invalid", () => {
    const c = ctx({ bigBlind: 100, actorCurrentBet: 0, actorCurrentStack: 10000 });
    expect(incrementByBB(null, c)).toBe(100); // empty → current_bet(0) + BB
    expect(incrementByBB(250, c)).toBe(350);
    expect(incrementByBB(NaN, c)).toBe(100); // invalid → current_bet + BB
  });

  it("incrementByBB just clamps the box value when BB unknown", () => {
    const c = ctx({ bigBlind: 0, actorCurrentBet: 40, actorCurrentStack: 1000 });
    expect(incrementByBB(null, c)).toBe(40); // falls back to current_bet
    expect(incrementByBB(120, c)).toBe(120);
  });
});
