// P2-5 DB-2 — carry-forward regression guard.
//
// In a dead-button hand the SUGGESTION's SB seat can differ from
// `blindSeats(occupied, button)`'s pick. The operator-facing BlindSetupPanel must
// read SB/BB from the suggestion (correct), NOT from blindSeats (wrong) — otherwise
// the operator is told to post the SB on the wrong seat. This pins the divergence so
// a future refactor can't silently re-point the panel at blindSeats.

import { describe, it, expect } from "vitest";
import { blindSeats } from "@/lib/tracker-poker/trackerEngine";
import { nextButtonTournament } from "@/lib/tournament/deadButton";

describe("P2-5 carry-forward: panel SB must come from the suggestion, not blindSeats", () => {
  it("the hard case diverges — suggestion SB=2, blindSeats SB=3", () => {
    const occupied = [2, 3, 5, 8];
    const sug = nextButtonTournament({ maxSeats: 9, occupiedSeats: occupied, prevBbSeat: 2 })!;
    const bs = blindSeats(occupied, sug.buttonSeat); // button=1 (dead)

    // The dead-button truth (what the operator must see):
    expect(sug.sbSeat).toBe(2);
    expect(sug.bbSeat).toBe(3);
    // What blindSeats would (wrongly) show for a dead button on seat 1:
    expect(bs.sbSeat).toBe(3);
    expect(bs.bbSeat).toBe(5);
    // ⇒ they diverge → the panel sourcing matters.
    expect(sug.sbSeat).not.toBe(bs.sbSeat);
    expect(sug.bbSeat).not.toBe(bs.bbSeat);
  });

  it("normal (no empty seats interleaved) — suggestion and blindSeats agree", () => {
    const occupied = [1, 2, 3, 4, 5, 6];
    const sug = nextButtonTournament({ maxSeats: 6, occupiedSeats: occupied, prevBbSeat: 3 })!; // button=2, sb=3, bb=4
    const bs = blindSeats(occupied, sug.buttonSeat);
    expect(sug.sbSeat).toBe(bs.sbSeat);
    expect(sug.bbSeat).toBe(bs.bbSeat);
  });
});
