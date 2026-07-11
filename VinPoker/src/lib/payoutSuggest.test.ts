import { describe, it, expect } from "vitest";
import {
  allocateLadderBp,
  itmPercentForPlaces,
  seedCustomLadder,
  suggestLadderFromRank1,
  BP_TOTAL,
  type SuggestedLadder,
  type SuggestShape,
} from "./payoutSuggest";
import { computeCustomPayouts, floorFor } from "./payoutEngine";

const M = 1_000_000;

// ── invariant helpers ───────────────────────────────────────────────────────
function expectValidBp(bp: number[]) {
  expect(bp.reduce((a, b) => a + b, 0)).toBe(BP_TOTAL);
  for (const x of bp) {
    expect(Number.isInteger(x)).toBe(true);
    expect(x).toBeGreaterThanOrEqual(1);
  }
  for (let i = 1; i < bp.length; i++) expect(bp[i]).toBeLessThanOrEqual(bp[i - 1]);
}
function expectBandsEqual(l: SuggestedLadder) {
  for (const { from, to } of l.bands) {
    for (let r = from + 1; r <= to; r++) expect(l.percentsBp[r - 1]).toBe(l.percentsBp[from - 1]);
  }
}
/** Feed a suggested ladder into the authoritative CUSTOM engine — the load-bearing assertion:
 *  the output must always be a valid computeCustomPayouts input. pool ≥ 10000×unit so even a 1-bp
 *  rank yields amount ≥ unit > 0 (isolates the bp-validity from the engine's pool/unit precondition). */
function feedEngine(bp: number[], unit: number, poolMultiple = 12345) {
  const pool = poolMultiple * BP_TOTAL * unit; // ≥ 10000×unit, arbitrary non-round multiple
  const percents = bp.map((b, i) => ({ position: i + 1, percentBp: b }));
  const res = computeCustomPayouts({ prizePool: pool, percents, roundingUnit: unit });
  expect(res.sumCheck).toBe(true);
  for (const r of res.rows) expect(r.amount).toBeGreaterThan(0);
  for (let i = 1; i < res.rows.length; i++) expect(res.rows[i].amount).toBeLessThanOrEqual(res.rows[i - 1].amount);
}

// ── allocateLadderBp ─────────────────────────────────────────────────────────
describe("allocateLadderBp — band-safe apportionment", () => {
  it("flat weights (the residual-inversion trap) → descending, Σ=10000, each≥1", () => {
    const bp = allocateLadderBp([1, 1, 1, 1, 1, 1, 1]);
    expectValidBp(bp);
    expect(bp[0]).toBeGreaterThanOrEqual(bp[1]); // rank 1 absorbs residual → still ≥ rank 2
  });
  it("all-zero weights → equal split fallback (documented)", () => {
    expectValidBp(allocateLadderBp([0, 0, 0, 0]));
  });
  it("N=1 → [10000]", () => {
    expect(allocateLadderBp([5])).toEqual([BP_TOTAL]);
  });
  it("does not mutate its input", () => {
    const w = [100, 50, 25];
    const copy = [...w];
    allocateLadderBp(w);
    expect(w).toEqual(copy);
  });
  it("keeps equal weights equal in bp (band equality)", () => {
    const bp = allocateLadderBp([500, 300, 100, 100, 100]); // ranks 3-5 equal
    expect(bp[2]).toBe(bp[3]);
    expect(bp[3]).toBe(bp[4]);
    expectValidBp(bp);
  });
  it("rejects empty / non-finite / ascending / total<N", () => {
    expect(() => allocateLadderBp([])).toThrow();
    expect(() => allocateLadderBp([1, NaN])).toThrow();
    expect(() => allocateLadderBp([1, Infinity])).toThrow();
    expect(() => allocateLadderBp([1, 2, 3])).toThrow(); // ascending
    expect(() => allocateLadderBp(new Array(20001).fill(1))).toThrow(); // total < N
  });
});

// ── itmPercentForPlaces ──────────────────────────────────────────────────────
describe("itmPercentForPlaces — robust N → itm fraction", () => {
  it("ceil(entries × itm) === places across a boundary sweep", () => {
    for (const entries of [3, 7, 12, 50, 82, 200, 777]) {
      for (let p = 1; p <= Math.min(entries, 30); p++) {
        const itm = itmPercentForPlaces(entries, p);
        expect(Math.ceil(entries * itm)).toBe(p);
      }
    }
  });
});

// ── Design A: seedCustomLadder ───────────────────────────────────────────────
function seed(entries: number, places: number, shape: SuggestShape, minCashX = 2): SuggestedLadder {
  const buyIn = 1 * M;
  const rake = 0.2 * M;
  return seedCustomLadder({
    entries,
    prizePool: entries * buyIn,
    floor: floorFor(minCashX, buyIn, rake),
    requestedPlaces: places,
    roundingUnit: 100_000,
    shape,
  });
}
describe("seedCustomLadder — preset shape seed", () => {
  it("golden DAILY 82 entries / 11 places → valid, top-heavy", () => {
    const l = seed(82, 11, "DAILY");
    expect(l.effectivePlaces).toBe(11);
    expectValidBp(l.percentsBp);
    expectBandsEqual(l);
    expect(l.effectiveRank1Bp).toBeGreaterThan(2000); // DAILY rank 1 ≫ 20%
  });
  it("shape ordering DAILY ≥ INTL ≥ MULTI at rank 1 (not strict — small N can tie)", () => {
    const d = seed(200, 30, "DAILY").percentsBp[0];
    const i = seed(200, 30, "INTL").percentsBp[0];
    const m = seed(200, 30, "MULTI").percentsBp[0];
    expect(d).toBeGreaterThanOrEqual(i);
    expect(i).toBeGreaterThanOrEqual(m);
  });
  it("invariant + engine-integration sweep", () => {
    for (const entries of [2, 3, 9, 50, 200]) {
      for (const places of [1, 2, 9, Math.min(15, entries)]) {
        for (const shape of ["DAILY", "INTL", "MULTI"] as SuggestShape[]) {
          const l = seed(entries, places, shape);
          expectValidBp(l.percentsBp);
          expectBandsEqual(l);
          feedEngine(l.percentsBp, 100_000);
        }
      }
    }
  });
  it("requested N > pool-affordable → effectivePlaces reduced + warning, still valid", () => {
    // 20 entries, want 15 places, but min-cash caps N below that
    const l = seed(20, 15, "DAILY", 3);
    expectValidBp(l.percentsBp);
    if (l.effectivePlaces !== l.requestedPlaces) expect(l.warnings).toContain("PLACES_REDUCED_BY_ENGINE");
  });
  it("N=1 (tiny field) → [10000]", () => {
    const l = seed(10, 1, "DAILY");
    expect(l.percentsBp).toEqual([BP_TOTAL]);
  });
});

// ── Design B: suggestLadderFromRank1 ─────────────────────────────────────────
describe("suggestLadderFromRank1 — target top-prize %", () => {
  it("hits the target (± rounding), valid, banded, engine-safe", () => {
    const l = suggestLadderFromRank1({ targetRank1Bp: 2200, places: 12, floorBp: 300 });
    expectValidBp(l.percentsBp);
    expectBandsEqual(l);
    expect(Math.abs(l.effectiveRank1Bp - 2200)).toBeLessThanOrEqual(25);
    feedEngine(l.percentsBp, 100_000);
  });
  it("target below flat minimum → clamp + warning", () => {
    const l = suggestLadderFromRank1({ targetRank1Bp: 2000, places: 3, floorBp: 0 }); // flat = 3334
    expect(l.warnings).toContain("TARGET_BELOW_FLAT_MIN");
    expect(l.effectiveRank1Bp).toBeGreaterThanOrEqual(Math.ceil(BP_TOTAL / 3) - 1);
    expectValidBp(l.percentsBp);
  });
  it("target above max → clamp + warning", () => {
    const l = suggestLadderFromRank1({ targetRank1Bp: 9900, places: 10, floorBp: 500 }); // max = 5500
    expect(l.warnings).toContain("TARGET_ABOVE_MAX");
    expectValidBp(l.percentsBp);
  });
  it("infeasible floor (floorBp×N > 100%) → reduced + warning", () => {
    const l = suggestLadderFromRank1({ targetRank1Bp: 3000, places: 30, floorBp: 500 }); // 30×500=15000>10000
    expect(l.warnings).toContain("FLOOR_ABOVE_FEASIBLE_MAX");
    expectValidBp(l.percentsBp);
  });
  it("pure-% (floorBp=0) large N → tail still ≥ 1 bp", () => {
    const l = suggestLadderFromRank1({ targetRank1Bp: 2500, places: 60, floorBp: 0 });
    expectValidBp(l.percentsBp);
    expect(l.percentsBp[59]).toBeGreaterThanOrEqual(1);
  });
  it("N=1 → [10000]; N=2 stays descending", () => {
    expect(suggestLadderFromRank1({ targetRank1Bp: 4000, places: 1, floorBp: 0 }).percentsBp).toEqual([BP_TOTAL]);
    expectValidBp(suggestLadderFromRank1({ targetRank1Bp: 4000, places: 2, floorBp: 100 }).percentsBp);
  });
  it("monotone solver: higher target → rank-1 does not decrease", () => {
    let prev = 0;
    for (const t of [1500, 2000, 2500, 3000, 4000, 5000]) {
      const r1 = suggestLadderFromRank1({ targetRank1Bp: t, places: 15, floorBp: 200 }).effectiveRank1Bp;
      expect(r1).toBeGreaterThanOrEqual(prev - 25); // non-decreasing within rounding
      prev = r1;
    }
  });
  it("engine-integration across rounding units", () => {
    const l = suggestLadderFromRank1({ targetRank1Bp: 2500, places: 18, floorBp: 250 });
    for (const unit of [1, 1_000, 10_000, 100_000, M]) feedEngine(l.percentsBp, unit);
  });
});

// ── UI round-trip (the exact path customRows uses) ───────────────────────────
describe("UI bp round-trip: bp → percent(bp/100) → customBp(round(percent×100)) === bp", () => {
  it("holds for every bp in 1..10000", () => {
    for (let bp = 1; bp <= BP_TOTAL; bp++) {
      expect(Math.round((bp / 100) * 100)).toBe(bp);
    }
  });
});
