// PR-C: native CUSTOM payout (computeCustomPayouts) — basis-points validation + deterministic
// rounding repair. Mirrors the server-side checks in prepare/apply (Σ=pool, descending, >0).
import { describe, it, expect } from "vitest";
import { computeCustomPayouts } from "./payoutEngine";

const bp = (arr: number[]) => arr.map((percentBp, i) => ({ position: i + 1, percentBp }));

describe("computeCustomPayouts", () => {
  it("1) accepts basis points that sum to exactly 10000", () => {
    const r = computeCustomPayouts({ prizePool: 10_000_000, percents: bp([5000, 3000, 2000]), roundingUnit: 100_000 });
    expect(r.itmPlaces).toBe(3);
    expect(r.archetype).toBe("CUSTOM");
    expect(r.effectiveFloor).toBe(0);
    expect(r.rows.map((x) => x.position)).toEqual([1, 2, 3]);
    expect(r.engineVersion).toBe("custom3neo-v1");
  });

  it("2) rejects gaps / duplicates / bp<=0 / non-descending / sum!=10000", () => {
    expect(() => computeCustomPayouts({ prizePool: 10_000_000, percents: [{ position: 1, percentBp: 6000 }, { position: 3, percentBp: 4000 }], roundingUnit: 100_000 })).toThrow(/CUSTOM_RANK_GAP/);
    expect(() => computeCustomPayouts({ prizePool: 10_000_000, percents: [{ position: 1, percentBp: 6000 }, { position: 1, percentBp: 4000 }], roundingUnit: 100_000 })).toThrow(/CUSTOM_RANK_GAP/);
    expect(() => computeCustomPayouts({ prizePool: 10_000_000, percents: bp([10000, 0]), roundingUnit: 100_000 })).toThrow(/CUSTOM_BP_NONPOS/);
    expect(() => computeCustomPayouts({ prizePool: 10_000_000, percents: bp([3000, 7000]), roundingUnit: 100_000 })).toThrow(/CUSTOM_BP_NOT_DESC/);
    expect(() => computeCustomPayouts({ prizePool: 10_000_000, percents: bp([5000, 4000]), roundingUnit: 100_000 })).toThrow(/CUSTOM_BP_SUM/);
  });

  it("3) Σ amounts equals the prize pool EXACTLY across pools/splits (rounding repair)", () => {
    for (const pool of [10_000_000, 12_345_678, 82_000_000, 7_000_000, 33_300_000]) {
      for (const pcts of [[5000, 3000, 2000], [4000, 3000, 2000, 1000], [7600, 2400], [3334, 3333, 3333], [10000]]) {
        const r = computeCustomPayouts({ prizePool: pool, percents: bp(pcts), roundingUnit: 100_000 });
        const sum = r.rows.reduce((s, x) => s + x.amount, 0);
        expect(sum).toBe(pool);
        expect(r.sumCheck).toBe(true);
      }
    }
  });

  it("4) every amount > 0 and non-increasing (descending)", () => {
    const r = computeCustomPayouts({ prizePool: 50_000_000, percents: bp([4000, 2500, 1800, 1000, 700]), roundingUnit: 100_000 });
    for (const row of r.rows) expect(row.amount).toBeGreaterThan(0);
    for (let i = 0; i < r.rows.length - 1; i++) expect(r.rows[i].amount).toBeGreaterThanOrEqual(r.rows[i + 1].amount);
  });

  it("throws when a rank rounds to 0 (too small for the unit)", () => {
    expect(() => computeCustomPayouts({ prizePool: 2_000_000, percents: bp([9999, 1]), roundingUnit: 1_000_000 })).toThrow(/CUSTOM_ZERO_AMOUNT|CUSTOM_INVARIANT/);
  });
});
