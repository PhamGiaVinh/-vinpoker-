// P2-4 — post-hand felt refresh: busted players leave the felt, survivors show
// their new stacks. Pure transform `survivorsAfterHand` (no DB), so directly
// testable. The DB (`record_hand` → is_active=false) is the elimination authority;
// `activeSeatNumbers` is the post-submit re-query of is_active=true seats.

import { describe, it, expect } from "vitest";
import { clearBettingState, survivorsAfterHand, type FeltSeat } from "@/components/cashier/tournament-live/handinput/postHand";

/** Build a felt seat mid-hand (dirty per-hand flags) to prove they get cleared. */
function seat(over: Partial<FeltSeat> & { player_id: string; seat_number: number }): FeltSeat {
  return {
    starting_stack: 1000,
    current_stack: 1000,
    current_bet: 200,
    total_bet: 200,
    is_folded: true,
    is_all_in: true,
    ...over,
  };
}

describe("P2-4 survivorsAfterHand", () => {
  it("drops the busted (now-inactive) player and keeps survivors", () => {
    const players = [
      seat({ player_id: "A", seat_number: 1 }),
      seat({ player_id: "B", seat_number: 2 }),
      seat({ player_id: "C", seat_number: 3 }),
    ];
    // C busted → record_hand set is_active=false → not in the active re-query.
    const out = survivorsAfterHand(players, [1, 2], { A: 1300, B: 700, C: 0 });
    expect(out.map((p) => p.player_id)).toEqual(["A", "B"]);
    expect(out.find((p) => p.player_id === "C")).toBeUndefined();
  });

  it("sets each survivor's stack to its ending stack (winner's chips visible immediately)", () => {
    const players = [seat({ player_id: "A", seat_number: 1 }), seat({ player_id: "B", seat_number: 2 })];
    const out = survivorsAfterHand(players, [1, 2], { A: 1300, B: 700 });
    const a = out.find((p) => p.player_id === "A")!;
    const b = out.find((p) => p.player_id === "B")!;
    expect([a.starting_stack, a.current_stack]).toEqual([1300, 1300]);
    expect([b.starting_stack, b.current_stack]).toEqual([700, 700]);
  });

  it("clears per-hand flags (bet/folded/all-in) for the next hand", () => {
    const out = survivorsAfterHand([seat({ player_id: "A", seat_number: 1 })], [1], { A: 1300 });
    const a = out[0];
    expect(a.current_bet).toBe(0);
    expect(a.total_bet).toBe(0);
    expect(a.is_folded).toBe(false);
    expect(a.is_all_in).toBe(false);
  });

  it("falls back to current_stack when a survivor has no ending entry", () => {
    const out = survivorsAfterHand([seat({ player_id: "A", seat_number: 1, current_stack: 950 })], [1], {});
    expect(out[0].current_stack).toBe(950);
    expect(out[0].starting_stack).toBe(950);
  });

  it("elimination authority is the active set, not endingStacks: a 0-stack seat still active is kept", () => {
    // Defensive: if the DB still reports the seat active, trust it (don't drop on ending===0).
    const out = survivorsAfterHand([seat({ player_id: "A", seat_number: 1 })], [1], { A: 0 });
    expect(out).toHaveLength(1);
    expect(out[0].current_stack).toBe(0);
  });

  it("preserves seat order", () => {
    const players = [
      seat({ player_id: "A", seat_number: 1 }),
      seat({ player_id: "B", seat_number: 2 }),
      seat({ player_id: "C", seat_number: 3 }),
    ];
    const out = survivorsAfterHand(players, [3, 1], { A: 100, C: 300 });
    expect(out.map((p) => p.seat_number)).toEqual([1, 3]);
  });
});

// C1 BUGFIX — clearBettingState: a voided/abandoned hand must never leak betting
// state into the next hand (the "side_pots không khớp" root cause), and stacks are
// restored ONLY on the explicit void path.
describe("C1 clearBettingState", () => {
  it("clears current_bet/total_bet/is_folded/is_all_in on every reset", () => {
    const out = clearBettingState(
      [seat({ player_id: "A", seat_number: 1, current_stack: 400, starting_stack: 1000 })],
      false
    );
    const a = out[0];
    expect(a.current_bet).toBe(0);
    expect(a.total_bet).toBe(0);
    expect(a.is_folded).toBe(false);
    expect(a.is_all_in).toBe(false);
  });

  it("restoreStacks=false (settled hand / new hand): stacks are NOT touched — no false refund", () => {
    const out = clearBettingState(
      [seat({ player_id: "A", seat_number: 1, current_stack: 400, starting_stack: 1000 })],
      false
    );
    expect(out[0].current_stack).toBe(400); // the chips a settled hand moved stay moved
    expect(out[0].starting_stack).toBe(1000);
  });

  it("restoreStacks=true (VOID only): current_stack returns to starting_stack, mirroring the server", () => {
    const out = clearBettingState(
      [
        seat({ player_id: "A", seat_number: 1, current_stack: 0, starting_stack: 1000 }), // was all-in
        seat({ player_id: "B", seat_number: 2, current_stack: 1800, starting_stack: 800 }),
      ],
      true
    );
    expect(out[0].current_stack).toBe(1000);
    expect(out[1].current_stack).toBe(800);
  });
});
