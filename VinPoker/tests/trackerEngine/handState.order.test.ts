// Rules-pin (PR-T): action ORDER — heads-up + 3-handed, preflop + postflop.
// Regression guard: locks the correct No-Limit Hold'em first-to-act so a later
// fix can't silently break it. Pure functions, no DB, no source change.
//
// Two authorities are pinned:
//  • server `nextToAct` (handState) — confirms the reconstructed preflop order;
//  • client `firstPreflopActor` / `firstPostflopActor` (trackerEngine) — the
//    canonical "who acts first" the operator UI highlights (mirrors the server).
import { describe, it, expect } from "vitest";
import { nextToAct } from "@tracker-engine/handState.ts";
import { firstPreflopActor, firstPostflopActor } from "@/lib/tracker-poker/trackerEngine";
import type { ActionRow, PlayerSeed } from "@tracker-engine/types.ts";

const HU: PlayerSeed[] = [
  { player_id: "P1", seat_number: 1, starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, starting_stack: 10000 },
];
const THREE: PlayerSeed[] = [
  { player_id: "P1", seat_number: 1, starting_stack: 10000 },
  { player_id: "P2", seat_number: 2, starting_stack: 10000 },
  { player_id: "P3", seat_number: 3, starting_stack: 10000 },
];
const BUTTON = 1;

function build(rows: [string, ActionRow["action_type"], number, ActionRow["street"]?][]): ActionRow[] {
  return rows.map(([player_id, action_type, action_amount, street], i) => ({
    player_id,
    action_type,
    action_amount,
    street: street ?? "preflop",
    action_order: i + 1,
  }));
}

describe("action order — canonical first-to-act (client trackerEngine = UI authority)", () => {
  // Heads-up: button = SB. 3-handed (button=1): SB=2, BB=3.
  it("heads-up preflop: the button/SB acts first", () => {
    expect(firstPreflopActor([1, 2], 1)).toBe(1);
  });
  it("heads-up postflop: the BB / non-button acts first", () => {
    expect(firstPostflopActor([1, 2], 1)).toBe(2);
  });
  it("3-handed preflop: UTG (first seat left of the BB) acts first", () => {
    expect(firstPreflopActor([1, 2, 3], 1)).toBe(1); // BB=3 → left of BB wraps to seat 1
  });
  it("3-handed postflop: SB (first seat left of the button) acts first", () => {
    expect(firstPostflopActor([1, 2, 3], 1)).toBe(2);
  });
});

describe("action order — server nextToAct after the blinds (preflop)", () => {
  it("heads-up: after SB+BB posts, the SB/button (P1) is next", () => {
    const rows = build([["P1", "post_sb", 50], ["P2", "post_bb", 100]]);
    expect(nextToAct(HU, rows, BUTTON)).toBe("P1");
  });
  it("3-handed: after SB+BB posts, UTG (P1, the button) is next", () => {
    const rows = build([["P2", "post_sb", 50], ["P3", "post_bb", 100]]);
    expect(nextToAct(THREE, rows, BUTTON)).toBe("P1");
  });
  it("3-handed: after a flop street opens, the SB (P2) is the next live actor", () => {
    // Close preflop, then SB checks the flop → the engine continues clockwise to BB.
    const rows = build([
      ["P2", "post_sb", 50], ["P3", "post_bb", 100],
      ["P1", "call", 100], ["P2", "call", 50], ["P3", "check", 0],
      ["P2", "check", 0, "flop"], // SB acts first on the flop…
    ]);
    expect(nextToAct(THREE, rows, BUTTON)).toBe("P3"); // …then the BB is next
  });
});
