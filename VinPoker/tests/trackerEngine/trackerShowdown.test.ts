// Phase-2 P2-1: exact showdown settlement (auto-rank + per-side-pot payout).
// The headline test is the all-in-call-for-less (uncalled-at-showdown) case asserting
// EACH player's stack — the only thing that catches the P1-1 trap, which Σ-conservation
// alone does NOT (using potOf double-counts the uncalled yet Σ still matches).
import { describe, it, expect } from "vitest";
import { settleShowdown, toEvalCard, showdownConserves } from "@/lib/tracker-poker/trackerShowdown";
import type { EngineSeat } from "@/lib/tracker-poker/trackerEngine";

function seat(
  player_id: string,
  seat_number: number,
  starting_stack: number,
  stack: number,
  total_committed: number,
  opts: { folded?: boolean; all_in?: boolean } = {},
): EngineSeat {
  return {
    player_id,
    seat_number,
    starting_stack,
    stack,
    street_committed: 0,
    total_committed,
    folded: !!opts.folded,
    all_in: !!opts.all_in,
  };
}
const stacks = (s: ReturnType<typeof settleShowdown>) =>
  Object.fromEntries((s!.results).map((r) => [r.player_id, r.ending_stack]));

describe("settleShowdown — 🔴 P1-1: uncalled-at-showdown pays the RIGHT per-player stacks", () => {
  it("HU river all-in-call-for-less: B (short all-in 300) wins vs A (committed 500)", () => {
    // A committed 500 of a 1000 stack (→ stack behind 500); B is all-in for 300 (start 300).
    const seats = [
      seat("A", 1, 1000, 500, 500),
      seat("B", 2, 300, 0, 300, { all_in: true }),
    ];
    const board = ["2c", "7d", "9s", "Jh", "Ad"];
    const holes = { A: ["3c", "4h"], B: ["Ks", "Kd"] }; // B = pair of kings beats A = ace-high
    const s = settleShowdown(seats, holes, board);
    expect(s).not.toBeNull();
    const end = stacks(s);

    // Layer = {600,[A,B]} (A capped at B's 300); uncalled = {A,200}. B wins the layer.
    expect(end.B).toBe(600); // stack 0 + 600 layer
    expect(end.A).toBe(700); // stack 500 + 200 uncalled refund  (= start 1000 − net 300)
    expect(s!.uncalled).toEqual({ player_id: "A", amount: 200 });
    // Conservation holds either way — it is NOT what catches the bug:
    expect(showdownConserves(seats, s!.results)).toBe(true);
    // The BUGGY potOf path would give B=800 / A=500 (still Σ=1300) — the asserts above forbid it.
  });
});

describe("settleShowdown — multiway side pots with different winners per layer", () => {
  it("A wins the main pot, C wins the side pot", () => {
    const seats = [
      seat("A", 1, 100, 0, 100, { all_in: true }), // short all-in → main pot only
      seat("B", 2, 1000, 700, 300),
      seat("C", 3, 1000, 700, 300),
    ];
    const board = ["2c", "7d", "9s", "Jh", "4s"];
    const holes = { A: ["Ac", "As"], B: ["3d", "5c"], C: ["Kc", "Kd"] };
    // A = pair aces (best overall, wins main); among B,C the side pot goes to C = pair kings.
    const s = settleShowdown(seats, holes, board);
    const end = stacks(s);
    expect(end.A).toBe(300); // stack 0 + main pot 300 (100×3)
    expect(end.C).toBe(1100); // stack 700 + side pot 400 (200×2)
    expect(end.B).toBe(700); // stack 700 + nothing
    expect(showdownConserves(seats, s!.results)).toBe(true);
    // Layer breakdown surfaces who won which pot (for the Review per-layer view):
    expect(s!.layers[0].winner_player_ids).toEqual(["A"]);
    expect(s!.layers[1].winner_player_ids).toEqual(["C"]);
  });
});

describe("settleShowdown — tie split with odd chip to the earliest seat", () => {
  it("A and B chop a 11-chip pot (D folded 1 = dead money) → A gets the odd chip", () => {
    const seats = [
      seat("A", 1, 100, 95, 5),
      seat("B", 2, 100, 95, 5),
      seat("D", 3, 100, 99, 1, { folded: true }), // dead money
    ];
    const board = ["Ah", "Kd", "Qc", "Js", "Ts"]; // broadway on board
    const holes = { A: ["2c", "3d"], B: ["4h", "5c"] }; // both play the board → tie
    const s = settleShowdown(seats, holes, board);
    const end = stacks(s);
    expect(end.A).toBe(101); // stack 95 + 6 (5 + odd chip)
    expect(end.B).toBe(100); // stack 95 + 5
    expect(end.D).toBe(99); // folded, wins nothing
    expect(showdownConserves(seats, s!.results)).toBe(true);
  });
});

describe("settleShowdown — muck", () => {
  it("a mucked (non-revealing) player is excluded from the rank and wins nothing", () => {
    const seats = [seat("A", 1, 1000, 900, 100), seat("B", 2, 1000, 900, 100)];
    const board = ["2c", "7d", "9s", "Jh", "Ad"];
    // B mucks; even with no cards entered for B, A takes the pot.
    const s = settleShowdown(seats, { A: ["Ks", "Kd"] }, board, new Set(["B"]));
    const end = stacks(s);
    expect(end.A).toBe(1100); // stack 900 + 200 pot
    expect(end.B).toBe(900);
  });
});

describe("settleShowdown — guards", () => {
  it("returns null when the board is not complete (→ manual)", () => {
    const seats = [seat("A", 1, 1000, 900, 100), seat("B", 2, 1000, 900, 100)];
    expect(settleShowdown(seats, { A: ["Ks", "Kd"], B: ["Qs", "Qd"] }, ["2c", "7d", "9s"])).toBeNull();
  });
  it("returns null when a non-mucked eligible player has not revealed (→ manual)", () => {
    const seats = [seat("A", 1, 1000, 900, 100), seat("B", 2, 1000, 900, 100)];
    const board = ["2c", "7d", "9s", "Jh", "Ad"];
    expect(settleShowdown(seats, { A: ["Ks", "Kd"] }, board)).toBeNull(); // B not revealed, not mucked
  });
});

describe("toEvalCard — 52-card round-trip + display forms", () => {
  const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  const SUITS = ["s", "h", "d", "c"];
  const SYMBOL: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
  it("stored 'Rs' form is identity for all 52 cards", () => {
    for (const r of RANKS) for (const su of SUITS) expect(toEvalCard(`${r}${su}`)).toBe(`${r}${su}`);
  });
  it("display forms map correctly (symbols + '10' → 'T')", () => {
    for (const r of RANKS) for (const su of SUITS) {
      const disp = `${r === "T" ? "10" : r}${SYMBOL[su]}`;
      expect(toEvalCard(disp)).toBe(`${r}${su}`);
    }
  });
});
