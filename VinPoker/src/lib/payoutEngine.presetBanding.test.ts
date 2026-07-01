// Engine v1.1: group payout (banding) is now the DEFAULT for EVERY preset archetype
// (DAILY/INTL/MULTI/TRITON), not just the separate `LIVE_STANDARD` choice. The key differentiator
// vs the old LIVE_STANDARD-only banding: each archetype bands using ITS OWN curve for ranks 1-9,
// not a hardcoded INTL base (computeBandedPayouts previously always used "INTL" internally).
import { describe, it, expect } from "vitest";
import { computePayouts, bandBoundaries, type PayoutArchetype } from "./payoutEngine";

const M = 1_000_000;
const base = { floor: 2.4 * M, roundingUnit: 100_000 };

describe("computePayouts — group payout (banding) is the default for every preset, N=19", () => {
  const archetypes: PayoutArchetype[] = ["DAILY", "MULTI", "INTL", "TRITON"];

  it.each(archetypes)("%s: ranks 1-9 individual, 10-12/13-15/16-19 banded, Σ=pool, descending, all>0", (arch) => {
    const r = computePayouts({ entries: 190, prizePool: 190 * M, itmPercent: 0.1, archetype: arch, ...base });
    expect(r.itmPlaces).toBe(19);
    const a = r.rows.map((x) => x.amount);
    // ranks 1-9 individual: no two adjacent ranks forced equal by the engine (a real curve, not a flat band)
    expect(new Set(a.slice(0, 9)).size).toBe(9);
    // bands: 10-12, 13-15, 16-19 each internally equal
    expect(a[9]).toBe(a[10]); expect(a[10]).toBe(a[11]);
    expect(a[12]).toBe(a[13]); expect(a[13]).toBe(a[14]);
    expect(a[15]).toBe(a[16]); expect(a[16]).toBe(a[17]); expect(a[17]).toBe(a[18]);
    // Σ = pool exactly, descending, every amount > 0
    expect(a.reduce((s, x) => s + x, 0)).toBe(190 * M);
    for (let i = 0; i < a.length - 1; i++) expect(a[i]).toBeGreaterThanOrEqual(a[i + 1]);
    for (const x of a) expect(x).toBeGreaterThan(0);
    // bands sit at/above the floor (never below, even when floor isn't rounding-unit-aligned)
    expect(a[18]).toBeGreaterThanOrEqual(r.effectiveFloor);
  });

  it("DAILY and MULTI use their OWN curve for ranks 1-9 (NOT a hardcoded INTL base) — the actual fix", () => {
    const input = { entries: 190, prizePool: 190 * M, itmPercent: 0.1, ...base };
    const daily = computePayouts({ ...input, archetype: "DAILY" });
    const multi = computePayouts({ ...input, archetype: "MULTI" });
    const intl = computePayouts({ ...input, archetype: "INTL" });
    // DAILY is top-heavy (steeper α), MULTI is flatter — their rank-1 amounts must differ from
    // each other AND from INTL's; if banding had silently fallen back to a hardcoded INTL base
    // (the old LIVE_STANDARD bug this PR fixes), all three would collapse to the same numbers.
    expect(daily.rows[0].amount).not.toBe(multi.rows[0].amount);
    expect(daily.rows[0].amount).not.toBe(intl.rows[0].amount);
    expect(multi.rows[0].amount).not.toBe(intl.rows[0].amount);
    // DAILY (top-heavy 2x) pays rank 1 more than MULTI (flatter 1.5x) on the identical field
    expect(daily.rows[0].amount).toBeGreaterThan(multi.rows[0].amount);
  });

  it("N <= 9 stays fully individual (no banding kicks in) for every archetype", () => {
    for (const arch of archetypes) {
      const r = computePayouts({ entries: 50, prizePool: 50 * M, itmPercent: 0.1, archetype: arch, ...base }); // N=5
      const a = r.rows.map((x) => x.amount);
      expect(new Set(a).size).toBe(a.length); // every rank distinct — no band formed
      expect(bandBoundaries(r.itmPlaces).every(([f, t]) => f === t)).toBe(true);
    }
  });

  it("floor-clamp regression: a band never sits below the true min-cash floor even when floor isn't rounding-unit-aligned", () => {
    // floor=2.4M with a 1M rounding unit is NOT unit-aligned (2.4M / 1M = 2.4) — this exact
    // combination surfaced a real undershoot bug (band floored past the true floor) during
    // implementation; this test locks the fix in.
    const r = computePayouts({ entries: 4000, prizePool: 4000 * M, floor: 2.4 * M, itmPercent: 0.15, archetype: "DAILY", roundingUnit: 1_000_000 });
    const a = r.rows.map((x) => x.amount);
    for (const x of a) expect(x).toBeGreaterThanOrEqual(2.4 * M);
    expect(a.reduce((s, x) => s + x, 0)).toBe(4000 * M);
  });
});
