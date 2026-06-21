import { describe, it, expect } from "vitest";
import type { SeriesEvent } from "./nativeData";
import type { Series } from "./seriesLibrary";
import { groupEvents, type EventGroup } from "./referenceDistribution";
import {
  referenceGroupToLogNormal,
  computeCostFromDrivers,
  simulateFestival,
  type EventLogNormal,
} from "./monteCarloEngine";

// --- helpers (mirror referenceDistribution.test.ts) -------------------------
function evt(name: string, over: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: "csv-1",
    event_name: name,
    event_date: "2026-06-15",
    buy_in: 1_000_000,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: 100,
    unique_entries: null,
    reentries: null,
    source: "csv",
    clubId: "csv-test",
    missingFields: [],
    ...over,
  };
}
function series(id: string, name: string, events: SeriesEvent[]): Series {
  return { id, name, seriesDate: null, sourceFilename: `${id}.csv`, events, loadedAt: 1 };
}
/** Build a single reference group named "main" from a list of total_entries. */
function groupFromEntries(entries: number[]): EventGroup {
  const lib = entries.map((te, i) => series(`s${i}`, `S${i}`, [evt("Main", { total_entries: te })]));
  return groupEvents(lib).find((g) => g.normalizedName === "main")!;
}
/** Build a sim event directly. */
function simEvt(over: Partial<EventLogNormal> = {}): EventLogNormal {
  return { name: "E", mu: Math.log(200), sigma: 0.4, fee: 100_000, buyin: 1_000_000, lowEntries: 150, tier: "observed-p20p80", ...over };
}

describe("referenceGroupToLogNormal", () => {
  it("N=1 → hypothesis tier, wide σ=0.6, μ=ln(base)", () => {
    const r = referenceGroupToLogNormal(groupFromEntries([200]))!;
    expect(r.tier).toBe("hypothesis");
    expect(r.sigma).toBe(0.6);
    expect(r.mu).toBeCloseTo(Math.log(200), 9);
  });

  it("N=2–4 → observed-minmax, σ=(ln high−ln low)/2", () => {
    const r = referenceGroupToLogNormal(groupFromEntries([100, 200, 400]))!;
    expect(r.tier).toBe("observed-minmax");
    expect(r.mu).toBeCloseTo(Math.log(200), 9); // median of 100/200/400
    expect(r.sigma).toBeCloseTo((Math.log(400) - Math.log(100)) / 2, 6);
  });

  it("N=2–4 σ floor (0.35) bites when the range is tiny", () => {
    const r = referenceGroupToLogNormal(groupFromEntries([100, 110]))!;
    expect(r.tier).toBe("observed-minmax");
    expect(r.sigma).toBe(0.35); // (ln1.1)/2 ≈ 0.048 → floored
  });

  it("N≥5 → observed-p20p80, σ=(ln p80−ln p20)/(2·0.84)", () => {
    const r = referenceGroupToLogNormal(groupFromEntries([100, 200, 300, 400, 500]))!;
    expect(r.tier).toBe("observed-p20p80");
    expect(r.mu).toBeCloseTo(Math.log(300), 9); // median
    expect(r.sigma).toBeCloseTo((Math.log(420) - Math.log(180)) / (2 * 0.84), 4); // p20=180, p80=420
  });

  it("returns null when base entries are missing", () => {
    const noData = groupEvents([series("a", "S", [evt("X", { total_entries: null })])]).find((g) => g.normalizedName === "x")!;
    expect(referenceGroupToLogNormal(noData)).toBeNull();
  });
});

describe("computeCostFromDrivers", () => {
  it("computes variable/fixed/marketing/total per the formula", () => {
    const c = computeCostFromDrivers({
      festival_days: 3,
      dealers_per_day: 4,
      dealer_wage_per_day: 1_000_000,
      staff_cost_per_day: 2_000_000,
      venue_cost: 10_000_000,
      equipment_setup_cost: 5_000_000,
      other_fixed_cost: 1_000_000,
      marketing_budget: 8_000_000,
    });
    expect(c.variable).toBe(18_000_000); // 3×(4×1m + 2m)
    expect(c.fixed).toBe(16_000_000); // 10m+5m+1m
    expect(c.marketing).toBe(8_000_000);
    expect(c.total).toBe(42_000_000);
  });

  it("missing driver → 0 contribution", () => {
    const c = computeCostFromDrivers({ festival_days: 3, dealers_per_day: 4, dealer_wage_per_day: 1_000_000 });
    expect(c.variable).toBe(12_000_000); // staff_cost_per_day missing → 0
    expect(c.fixed).toBe(0);
    expect(c.total).toBe(12_000_000);
  });

  it("all empty → total 0 (the no-cost signal)", () => {
    expect(computeCostFromDrivers({}).total).toBe(0);
  });
});

describe("simulateFestival", () => {
  const SEED = 12345;
  const threeEvents = [simEvt({ name: "A" }), simEvt({ name: "B" }), simEvt({ name: "C" })];

  it("is deterministic for a fixed seed", () => {
    const a = simulateFestival(threeEvents, { rho: 0.3, alpha: 1, seed: SEED });
    const b = simulateFestival(threeEvents, { rho: 0.3, alpha: 1, seed: SEED });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("ρ 0→0.85: mean ~unchanged but the festival spread fattens (deterministic correlation signature)", () => {
    // Higher ρ correlates the events → the festival TOTAL has higher variance while each event's
    // marginal mean is ρ-independent. The robust, deterministic signature is wider spread + lower P5.
    // (Risk-of-Ruin at an arbitrary fixed threshold is NOT monotonic in ρ — the heavy left skew from
    //  overlay makes the lo/hi distributions cross — so we assert the variance signature, not ruin.)
    const base = { alpha: 1.1, cost: 30_000_000, bankroll: 20_000_000, nSims: 20000, seed: SEED };
    const lo = simulateFestival(threeEvents, { ...base, rho: 0 });
    const hi = simulateFestival(threeEvents, { ...base, rho: 0.85 });
    expect(Math.abs(hi.eGross - lo.eGross) / Math.abs(lo.eGross)).toBeLessThan(0.05); // mean preserved
    expect(hi.p95 - hi.p5).toBeGreaterThan(lo.p95 - lo.p5); // spread widens with correlation
    expect(hi.p5).toBeLessThan(lo.p5); // fatter left tail
  });

  it("no cost → gross mode: eEV & ruin null, gross present", () => {
    const r = simulateFestival(threeEvents, { rho: 0.3, alpha: 1, seed: SEED });
    expect(r.mode).toBe("gross");
    expect(r.eEV).toBeNull();
    expect(r.ruin).toBeNull();
    expect(Number.isFinite(r.eGross)).toBe(true);
    expect(typeof r.pLoss).toBe("number");
  });

  it("cost>0 + bankroll → profit mode: eEV=eGross−cost, ruin in [0,1]", () => {
    const cost = 30_000_000;
    const r = simulateFestival(threeEvents, { rho: 0.3, alpha: 1, cost, bankroll: 20_000_000, seed: SEED });
    expect(r.mode).toBe("profit");
    expect(r.eEV!).toBeCloseTo(r.eGross - cost, 6);
    expect(r.ruin!).toBeGreaterThanOrEqual(0);
    expect(r.ruin!).toBeLessThanOrEqual(1);
  });

  it("cost>0 but bankroll absent → ruin null, eEV present", () => {
    const r = simulateFestival(threeEvents, { rho: 0.3, alpha: 1, cost: 30_000_000, seed: SEED });
    expect(r.mode).toBe("profit");
    expect(r.ruin).toBeNull();
    expect(r.eEV).not.toBeNull();
  });

  it("aggregateTier = weakest tier across events", () => {
    const mixed = [simEvt({ tier: "observed-p20p80" }), simEvt({ tier: "hypothesis" })];
    expect(simulateFestival(mixed, { rho: 0.3, alpha: 1, seed: SEED }).aggregateTier).toBe("hypothesis");
    const mm = [simEvt({ tier: "observed-p20p80" }), simEvt({ tier: "observed-minmax" })];
    expect(simulateFestival(mm, { rho: 0.3, alpha: 1, seed: SEED }).aggregateTier).toBe("observed-minmax");
  });

  it("overlay scales with α: high α → overlay>0; α=0 → no overlay", () => {
    const high = simulateFestival(threeEvents, { rho: 0.3, alpha: 3, seed: SEED });
    expect(high.eOverlay).toBeGreaterThan(0);
    expect(high.pOverlayAny).toBeGreaterThan(0);
    const none = simulateFestival(threeEvents, { rho: 0.3, alpha: 0, seed: SEED });
    expect(none.eOverlay).toBe(0);
    expect(none.pOverlayAny).toBe(0);
  });

  it("entries clamp ≥ 5 → mean rake ≥ 5×fee×#events, finite", () => {
    const tiny = [simEvt({ mu: Math.log(1), sigma: 0.6, fee: 100_000 })]; // base ~1, would dip below 5 unclamped
    const r = simulateFestival(tiny, { rho: 0, alpha: 0, seed: SEED });
    expect(Number.isFinite(r.eRake)).toBe(true);
    expect(r.eRake).toBeGreaterThanOrEqual(5 * 100_000);
  });

  it("empty selection → usable:false sentinel", () => {
    const r = simulateFestival([], { rho: 0.3, alpha: 1, seed: SEED });
    expect(r.usable).toBe(false);
  });

  it("bins cover all sims and are contiguous", () => {
    const r = simulateFestival(threeEvents, { rho: 0.3, alpha: 1, nSims: 5000, seed: SEED });
    expect(r.bins.length).toBe(24);
    expect(r.bins.reduce((s, b) => s + b.count, 0)).toBe(5000);
    for (let i = 0; i < r.bins.length - 1; i++) expect(r.bins[i].hi).toBeCloseTo(r.bins[i + 1].lo, 6);
  });
});
