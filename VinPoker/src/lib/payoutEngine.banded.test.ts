// PR-D: banded preset LIVE_STANDARD — final table (1–9) individual, places 10+ in equal bands.
// Band equality is sacred; residual repair only touches rank 1; Σ = pool exactly; descending.
import { describe, it, expect } from "vitest";
import { computeBandedPayouts, computePayouts, bandBoundaries } from "./payoutEngine";

const M = 1_000_000;
const base = { floor: 2.4 * M, roundingUnit: 100_000 };

describe("bandBoundaries", () => {
  it("2) N=19 → 1..9 individual, then 10–12, 13–15, 16–19 (short tail merged)", () => {
    const b = bandBoundaries(19);
    expect(b.slice(0, 9)).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9]]);
    expect(b.slice(9)).toEqual([[10, 12], [13, 15], [16, 19]]);
  });
  it("covers 1..N exactly with no gaps/overlap", () => {
    for (const N of [11, 14, 15, 19, 27, 40, 100]) {
      const b = bandBoundaries(N);
      expect(b[0][0]).toBe(1);
      expect(b[b.length - 1][1]).toBe(N);
      for (let i = 1; i < b.length; i++) expect(b[i][0]).toBe(b[i - 1][1] + 1);
    }
  });
});

describe("computeBandedPayouts (LIVE_STANDARD)", () => {
  it("1) ITM ≤ 10 stays individual (= the INTL base, just relabeled)", () => {
    const input = { entries: 50, prizePool: 50 * M, itmPercent: 0.1, ...base }; // N=5
    const r = computeBandedPayouts(input);
    expect(r.itmPlaces).toBe(5);
    expect(r.archetype).toBe("LIVE_STANDARD");
    const intl = computePayouts({ ...input, archetype: "INTL" });
    expect(r.rows.map((x) => x.amount)).toEqual(intl.rows.map((x) => x.amount));
  });

  it("2/3) ITM 19 → bands 10–12, 13–15, 16–19 with EXACTLY equal amounts inside each", () => {
    const r = computeBandedPayouts({ entries: 190, prizePool: 190 * M, itmPercent: 0.1, ...base });
    expect(r.itmPlaces).toBe(19);
    const a = r.rows.map((x) => x.amount);
    expect(a[9]).toBe(a[10]); expect(a[10]).toBe(a[11]);                 // 10–12
    expect(a[12]).toBe(a[13]); expect(a[13]).toBe(a[14]);               // 13–15
    expect(a[15]).toBe(a[16]); expect(a[16]).toBe(a[17]); expect(a[17]).toBe(a[18]); // 16–19
    // adjacent bands must differ-or-equal but be descending; the last band sits ABOVE the floor
    expect(a[9]).toBeGreaterThanOrEqual(a[12]);
    expect(a[18]).toBeGreaterThan(0);
  });

  it("4/5) Σ = pool exactly, amounts positive & non-increasing; band equality holds everywhere", () => {
    for (const entries of [120, 190, 300, 777]) {
      for (const itm of [0.12, 0.15, 0.18]) {
        const pool = entries * M;
        const r = computeBandedPayouts({ entries, prizePool: pool, itmPercent: itm, ...base });
        const a = r.rows.map((x) => x.amount);
        expect(a.reduce((s, x) => s + x, 0)).toBe(pool);
        for (const x of a) expect(x).toBeGreaterThan(0);
        for (let i = 0; i < a.length - 1; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i + 1]);
        for (const [from, to] of bandBoundaries(r.itmPlaces)) {
          if (from >= 10) for (let p = from; p <= to; p++) expect(a[p - 1]).toBe(a[from - 1]);
        }
      }
    }
  });

  it("6) base INTL output is UNCHANGED (banding only post-processes; INTL still pins rank N to floor)", () => {
    const intl = computePayouts({ entries: 190, prizePool: 190 * M, itmPercent: 0.1, ...base, archetype: "INTL" });
    expect(intl.archetype).toBe("INTL");
    expect(intl.rows[intl.rows.length - 1].amount).toBe(2.4 * M); // INTL min-cash invariant intact
    expect(intl.rows.reduce((s, x) => s + x.amount, 0)).toBe(190 * M);
  });
});
