import { describe, it, expect } from "vitest";
import type { SeriesEvent } from "./nativeData";
import {
  filterComparableEvents,
  netAssumptionFactor,
  simulateScenarioWhatIf,
  type WhatIfAssumptions,
} from "./scenarioSimulator";

function evt(over: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: Math.random().toString(36).slice(2),
    event_name: "Event",
    event_date: "2026-06-15T19:00:00+07:00",
    buy_in: 1_000_000,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: 100,
    unique_entries: 90,
    reentries: 10,
    source: "csv",
    clubId: "club-1",
    missingFields: [],
    ...over,
  };
}

// 8 events with controlled entries → bands: pMin=100,p25=120,p75=200,pMax=240
const eightEvents = [100, 120, 140, 160, 180, 200, 220, 240].map((n, i) => evt({ event_id: `e${i}`, total_entries: n, buy_in: 1_000_000 }));

const NEUTRAL: WhatIfAssumptions = { marketingPushPct: 0, slotFactorPct: 0, candidateGtd: null };

describe("netAssumptionFactor", () => {
  it("neutral = 1", () => expect(netAssumptionFactor(NEUTRAL)).toBe(1));
  it("multiplicative + transparent", () => {
    expect(netAssumptionFactor({ marketingPushPct: 20, slotFactorPct: 0, candidateGtd: null })).toBeCloseTo(1.2, 9);
    expect(netAssumptionFactor({ marketingPushPct: 10, slotFactorPct: -10, candidateGtd: null })).toBeCloseTo(1.1 * 0.9, 9);
  });
});

describe("simulateScenarioWhatIf — bands", () => {
  it("three bands from quantiles, monotonic non-decreasing", () => {
    const r = simulateScenarioWhatIf(eightEvents, { assumptions: NEUTRAL });
    expect(r.available).toBe(true);
    expect(r.bands.map((b) => b.kind)).toEqual(["conservative", "base", "upside"]);
    const [c, b, u] = r.bands;
    expect(c.entryRange).toEqual({ low: 100, high: 120 });
    expect(b.entryRange).toEqual({ low: 120, high: 200 });
    expect(u.entryRange).toEqual({ low: 200, high: 240 });
    expect(c.entryRange.low).toBeLessThanOrEqual(b.entryRange.low);
    expect(b.entryRange.low).toBeLessThanOrEqual(u.entryRange.low);
  });

  it("assumption factor shifts the band transparently", () => {
    const r = simulateScenarioWhatIf(eightEvents, { assumptions: { marketingPushPct: 20, slotFactorPct: 0, candidateGtd: null } });
    expect(r.assumptionFactor).toBeCloseTo(1.2, 9);
    const base = r.bands.find((x) => x.kind === "base")!;
    expect(base.entryRange).toEqual({ low: 144, high: 240 }); // {120,200} × 1.2
    expect(r.missingDataNotes.some((n) => n.includes("+20%"))).toBe(true);
  });

  it("confidence by sample size: 8 → high", () => {
    expect(simulateScenarioWhatIf(eightEvents, { assumptions: NEUTRAL }).confidence).toBe("high");
  });
});

describe("simulateScenarioWhatIf — prize + overlay (4c)", () => {
  it("prizeBand = entryRange × median buy-in; overlay = max(0, GTD − prizeBand) per band", () => {
    const r = simulateScenarioWhatIf(eightEvents, { assumptions: { marketingPushPct: 0, slotFactorPct: 0, candidateGtd: 5_000_000_000 } });
    const base = r.bands.find((x) => x.kind === "base")!;
    expect(base.prizeBand).toEqual({ low: 120_000_000, high: 200_000_000 }); // {120,200} × 1M
    // overlay larger when prize smaller: low edge uses prizeBand.high
    expect(base.overlay).toEqual({ low: 4_800_000_000, high: 4_880_000_000 });
  });

  it("no candidate GTD → overlay null", () => {
    const r = simulateScenarioWhatIf(eightEvents, { assumptions: NEUTRAL });
    expect(r.bands.every((b) => b.overlay === null)).toBe(true);
  });

  it("missing buy-in → prizeBand & overlay null + note", () => {
    const noBuyIn = [100, 120, 140, 160].map((n, i) => evt({ event_id: `n${i}`, total_entries: n, buy_in: null }));
    const r = simulateScenarioWhatIf(noBuyIn, { assumptions: { marketingPushPct: 0, slotFactorPct: 0, candidateGtd: 1_000_000_000 } });
    expect(r.bands.every((b) => b.prizeBand === null && b.overlay === null)).toBe(true);
    expect(r.missingDataNotes.some((n) => n.toLowerCase().includes("buy-in"))).toBe(true);
  });
});

describe("simulateScenarioWhatIf — noisy + empty", () => {
  it("sampleSize < 4 → noisy, widened, low confidence", () => {
    const three = [100, 200, 300].map((n, i) => evt({ event_id: `t${i}`, total_entries: n, buy_in: 1_000_000 }));
    const r = simulateScenarioWhatIf(three, { assumptions: NEUTRAL });
    expect(r.noisy).toBe(true);
    expect(r.confidence).toBe("low");
    // base band {p25..p75} widened by ±15%
    const base = r.bands.find((x) => x.kind === "base")!;
    // entries [100,200,300]: p25=idx floor(0.25*2)=0 →100, p75=idx floor(0.75*2)=1 →200
    expect(base.entryRange.low).toBe(Math.round(100 * 0.85));
    expect(base.entryRange.high).toBe(Math.round(200 * 1.15));
    expect(r.missingDataNotes.some((n) => n.includes("Noisy"))).toBe(true);
  });

  it("no comparable with entries → available false", () => {
    const r = simulateScenarioWhatIf([evt({ total_entries: null })], { assumptions: NEUTRAL });
    expect(r.available).toBe(false);
    expect(r.bands).toEqual([]);
  });

  it("deterministic for the same input", () => {
    const a = JSON.stringify(simulateScenarioWhatIf(eightEvents, { assumptions: NEUTRAL }));
    const b = JSON.stringify(simulateScenarioWhatIf(eightEvents, { assumptions: NEUTRAL }));
    expect(a).toBe(b);
  });
});

describe("filterComparableEvents + selection precedence", () => {
  it("filters by day-of-week (TZ-agnostic via same Date method)", () => {
    const target = evt({ event_id: "dow", event_date: "2026-06-13T20:00:00+07:00", total_entries: 111 });
    const dow = new Date(target.event_date as string).getDay();
    const pool = [target, ...eightEvents];
    const kept = filterComparableEvents(pool, { dayOfWeek: dow });
    expect(kept.some((e) => e.event_id === "dow")).toBe(true);
    const other = filterComparableEvents(pool, { dayOfWeek: (dow + 1) % 7 });
    expect(other.some((e) => e.event_id === "dow")).toBe(false);
  });

  it("filters by name keyword (case-insensitive)", () => {
    const pool = [evt({ event_id: "turbo", event_name: "Turbo Madness" }), evt({ event_id: "main", event_name: "Main Event" })];
    const kept = filterComparableEvents(pool, { typeKeyword: "turbo" });
    expect(kept.map((e) => e.event_id)).toEqual(["turbo"]);
  });

  it("explicit selectedIds overrides the filter", () => {
    const r = simulateScenarioWhatIf(eightEvents, { selectedIds: ["e0", "e1", "e2", "e3"], filter: { typeKeyword: "nope" }, assumptions: NEUTRAL });
    expect(r.sampleSize).toBe(4); // selection wins; filter ignored
    expect(r.confidence).toBe("medium");
  });
});
