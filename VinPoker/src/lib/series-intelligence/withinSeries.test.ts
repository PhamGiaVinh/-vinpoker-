import { describe, it, expect } from "vitest";
import type { SeriesEvent } from "./nativeData";
import {
  computeWithinSeriesElasticity,
  ELASTICITY_DISCLAIMER,
  MIN_EDITIONS,
  MIN_BUYIN_LEVELS,
  STABLE_EDITIONS,
} from "./withinSeries";

const pad = (n: number) => String(n).padStart(2, "0");

function mkEvent(name: string, month: number, buyIn: number, entries: number | null, id: string): SeriesEvent {
  return {
    event_id: id,
    event_name: name,
    event_date: `2026-${pad(month)}-05T19:00:00+07:00`,
    buy_in: buyIn,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: entries,
    unique_entries: entries,
    reentries: 0,
    source: "csv",
    clubId: "c1",
    missingFields: [],
  };
}

// Build a brand whose entries lie EXACTLY on the plane ln(entries) = c − γ·ln(buy_in) + δ·edition, so OLS must
// recover γ and δ. One event per month (strictly increasing dates ⇒ editionOf yields 1..k). Pass buy-ins that
// are NOT monotone in edition so price is not collinear with the trend (otherwise γ is not identified).
function planarBrand(name: string, gamma: number, delta: number, c: number, buyins: number[]): SeriesEvent[] {
  return buyins.map((b, i) => {
    const edition = i + 1;
    const entries = Math.exp(c - gamma * Math.log(b) + delta * edition);
    return mkEvent(name, i + 1, b, entries, `${name}-${i}`);
  });
}

describe("computeWithinSeriesElasticity — OLS recovers the plane", () => {
  it("recovers γ (and δ) on exact log-linear data with enough editions", () => {
    const events = planarBrand("APT Main", 0.8, 0.15, Math.log(300), [
      1_000_000, 2_000_000, 3_000_000, 1_000_000, 2_000_000, 3_000_000,
    ]);
    const r = computeWithinSeriesElasticity(events);
    expect(r.enough).toBe(true);
    expect(r.perBrand).toHaveLength(1);
    expect(r.perBrand[0].gamma).toBeCloseTo(0.8, 4);
    expect(r.perBrand[0].delta).toBeCloseTo(0.15, 4);
    expect(r.perBrand[0].editions).toBe(6);
    expect(r.perBrand[0].buyinLevels).toBe(3);
    expect(r.perBrand[0].thin).toBe(false); // 6 >= STABLE_EDITIONS
    expect(r.pooledGamma).toBeCloseTo(0.8, 4);
  });

  it("is deterministic — same input ⇒ identical output", () => {
    const events = planarBrand("APT Main", 0.8, 0.15, Math.log(300), [1_000_000, 2_000_000, 3_000_000, 1_000_000]);
    expect(JSON.stringify(computeWithinSeriesElasticity(events))).toBe(JSON.stringify(computeWithinSeriesElasticity(events)));
  });
});

describe("computeWithinSeriesElasticity — pooled γ = median across brands", () => {
  it("returns the median of the qualifying brands' γ", () => {
    const buyins = [1_000_000, 2_000_000, 3_000_000, 1_000_000]; // 4 editions, non-monotone price
    const events = [
      ...planarBrand("Brand A", 0.5, 0.1, Math.log(200), buyins),
      ...planarBrand("Brand B", 1.0, 0.1, Math.log(200), buyins),
      ...planarBrand("Brand C", 1.5, 0.1, Math.log(200), buyins),
    ];
    const r = computeWithinSeriesElasticity(events);
    expect(r.perBrand).toHaveLength(3);
    expect(r.perBrand.every((b) => b.thin)).toBe(true); // 4 < STABLE_EDITIONS → flagged coarse
    const gammas = r.perBrand.map((b) => b.gamma).sort((a, b) => a - b);
    expect(gammas[0]).toBeCloseTo(0.5, 3);
    expect(gammas[1]).toBeCloseTo(1.0, 3);
    expect(gammas[2]).toBeCloseTo(1.5, 3);
    expect(r.pooledGamma).toBeCloseTo(1.0, 3); // median of {0.5, 1.0, 1.5}
  });
});

describe("computeWithinSeriesElasticity — qualification gates", () => {
  it("drops a brand with fewer than MIN_EDITIONS editions", () => {
    const events = planarBrand("Small Brand", 0.8, 0.1, Math.log(200), [1_000_000, 2_000_000]); // 2 editions
    const r = computeWithinSeriesElasticity(events);
    expect(r.enough).toBe(false);
    expect(r.pooledGamma).toBeNull();
    const drop = r.dropped.find((d) => d.displayName === "Small Brand");
    expect(drop).toBeDefined();
    expect(drop!.reason).toContain(`≥${MIN_EDITIONS}`);
  });

  it("drops a 3-edition brand: n == params is a saturated fit (γ would be noise, not estimated)", () => {
    expect(MIN_EDITIONS).toBe(4); // > 3 OLS parameters
    const events = planarBrand("Exactly Three", 0.8, 0.1, Math.log(200), [1_000_000, 2_000_000, 3_000_000]);
    const r = computeWithinSeriesElasticity(events);
    expect(r.enough).toBe(false);
    expect(r.dropped.find((d) => d.displayName === "Exactly Three")!.reason).toContain(`≥${MIN_EDITIONS}`);
  });

  it("drops a brand whose buy-in never varies (needs ≥ MIN_BUYIN_LEVELS levels)", () => {
    // 4 editions (passes the edition gate) but a single constant buy-in ⇒ price cannot be estimated.
    const events = [
      mkEvent("Flat Brand", 1, 1_000_000, 100, "f-0"),
      mkEvent("Flat Brand", 2, 1_000_000, 120, "f-1"),
      mkEvent("Flat Brand", 3, 1_000_000, 140, "f-2"),
      mkEvent("Flat Brand", 4, 1_000_000, 130, "f-3"),
    ];
    const r = computeWithinSeriesElasticity(events);
    expect(r.enough).toBe(false);
    const drop = r.dropped.find((d) => d.displayName === "Flat Brand");
    expect(drop).toBeDefined();
    expect(drop!.reason).toMatch(/mức giá|không đổi/);
    expect(MIN_BUYIN_LEVELS).toBe(2);
  });

  it("drops a brand whose price rose in lockstep with the edition (γ not identified)", () => {
    // Geometric buy-ins (1M,2M,4M,8M) ⇒ ln(buy_in) is exactly linear in edition ⇒ |corr| = 1 ⇒ price is
    // confounded with the time trend. Passes edition + buy-in-level gates, must be dropped by the ID gate.
    const events = planarBrand("Escalator", 0.8, 0.1, Math.log(200), [1_000_000, 2_000_000, 4_000_000, 8_000_000]);
    const r = computeWithinSeriesElasticity(events);
    expect(r.enough).toBe(false);
    const drop = r.dropped.find((d) => d.displayName === "Escalator");
    expect(drop).toBeDefined();
    expect(drop!.reason).toMatch(/xu hướng thời gian/);
  });

  it("keeps qualifying brands and lists non-qualifying ones separately", () => {
    const events = [
      ...planarBrand("Good Brand", 0.9, 0.1, Math.log(250), [1_000_000, 2_000_000, 3_000_000, 1_000_000]),
      ...planarBrand("Too Small", 0.9, 0.1, Math.log(250), [1_000_000, 2_000_000]),
    ];
    const r = computeWithinSeriesElasticity(events);
    expect(r.perBrand.map((b) => b.displayName)).toContain("Good Brand");
    expect(r.dropped.map((d) => d.displayName)).toContain("Too Small");
  });
});

describe("ELASTICITY_DISCLAIMER — endogeneity honesty (always present)", () => {
  it("states observation-not-causation and names endogeneity", () => {
    expect(ELASTICITY_DISCLAIMER).toContain("KHÔNG phải nhân quả");
    expect(ELASTICITY_DISCLAIMER.toLowerCase()).toContain("endogeneity");
    expect(ELASTICITY_DISCLAIMER).toContain("thí nghiệm giá");
  });
  it("STABLE_EDITIONS is above the parameter count so 'thin' is a meaningful caveat", () => {
    expect(STABLE_EDITIONS).toBeGreaterThan(MIN_EDITIONS);
  });
});

describe("computeWithinSeriesElasticity — TP6 censoring", () => {
  it("GOLDEN — censoring off (default) is byte-identical to explicit false", () => {
    const events = planarBrand("Brand X", 0.8, 0.15, Math.log(200), [1_000_000, 2_000_000, 3_000_000, 1_000_000, 2_000_000, 3_000_000]);
    expect(JSON.stringify(computeWithinSeriesElasticity(events))).toBe(JSON.stringify(computeWithinSeriesElasticity(events, { censoring: false })));
  });

  it("drops a sold-out edition when censoring is on (4→3 editions ⇒ brand falls below MIN_EDITIONS)", () => {
    // Realistic integer entries (not the planar helper, whose entries are tiny fractions); edition 2 is sold
    // out (entries === capacity). 4 editions qualify OFF; censoring removes the sold-out one → 3 < MIN_EDITIONS.
    const events = [
      mkEvent("Censor Brand", 1, 1_000_000, 100, "cb-1"),
      { ...mkEvent("Censor Brand", 2, 2_000_000, 90, "cb-2"), capacity: 90 }, // sold out (90 >= 90)
      mkEvent("Censor Brand", 3, 1_000_000, 110, "cb-3"),
      mkEvent("Censor Brand", 4, 3_000_000, 80, "cb-4"),
    ];
    const off = computeWithinSeriesElasticity(events);
    const on = computeWithinSeriesElasticity(events, { censoring: true });
    expect(off.perBrand.map((b) => b.displayName)).toContain("Censor Brand"); // 4 editions qualify
    expect(on.enough).toBe(false); // 3 editions after dropping the sold-out one → below MIN_EDITIONS(4)
  });
});
