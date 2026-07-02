import { describe, it, expect } from "vitest";
import { forecastSuggest } from "./forecastSuggest";
import type { SeriesEvent } from "./nativeData";

/** Minimal SeriesEvent factory — only the fields forecastSuggest reads matter. */
function ev(id: string, buy_in: number | null, total_entries: number | null): SeriesEvent {
  return {
    event_id: id,
    event_name: id,
    event_date: null,
    buy_in,
    fee: null,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries,
    unique_entries: null,
    reentries: null,
    source: "native",
    clubId: "club",
    missingFields: [],
  };
}

describe("forecastSuggest", () => {
  it("returns insufficient when too few comparable banded events", () => {
    const history = [ev("a", 1_000_000, 100), ev("b", 1_000_000, 110)]; // only 2 in-band, min 3
    const r = forecastSuggest("target", 1_000_000, history);
    expect(r.status).toBe("insufficient");
    expect(r.base).toBeNull();
    expect(r.sampleSize).toBe(2);
  });

  it("only compares SAME buy-in band (does not blend a bimodal field)", () => {
    // Small-stakes cluster (~100 entries @ 1M) + a high-roller cluster (~18 entries @ 20M).
    const history = [
      ev("s1", 1_000_000, 95),
      ev("s2", 1_000_000, 105),
      ev("s3", 1_200_000, 100),
      ev("h1", 20_000_000, 16),
      ev("h2", 20_000_000, 20),
      ev("h3", 22_000_000, 18),
    ];
    const r = forecastSuggest("target", 1_000_000, history);
    expect(r.status).toBe("ok");
    // base must reflect the SMALL cluster (~100), never a blend pulled down by the high-rollers.
    expect(r.base).toBeGreaterThanOrEqual(90);
    expect(r.base).toBeLessThanOrEqual(110);
    // only the 3 same-band events were used
    expect(r.sampleSize).toBe(3);
    expect(r.comparableEventIds.sort()).toEqual(["s1", "s2", "s3"]);
    expect(r.bandLow).toBe(500_000);
    expect(r.bandHigh).toBe(2_000_000);
  });

  it("excludes the target event from its own history", () => {
    const history = [
      ev("target", 1_000_000, 999), // must be ignored even though same band
      ev("a", 1_000_000, 100),
      ev("b", 1_000_000, 100),
      ev("c", 1_000_000, 100),
    ];
    const r = forecastSuggest("target", 1_000_000, history);
    expect(r.status).toBe("ok");
    expect(r.sampleSize).toBe(3);
    expect(r.comparableEventIds).not.toContain("target");
    expect(r.base).toBe(100);
  });

  it("ignores events without a real, positive entry count", () => {
    const history = [
      ev("a", 1_000_000, 100),
      ev("b", 1_000_000, null), // not finished / no count
      ev("c", 1_000_000, 0), // zero → excluded
    ];
    const r = forecastSuggest("target", 1_000_000, history);
    expect(r.status).toBe("insufficient"); // only 1 usable → below min 3
    expect(r.sampleSize).toBe(1);
  });

  it("produces an ordered low ≤ base ≤ high band with expected percentiles", () => {
    const history = [50, 60, 70, 80, 90].map((n, i) => ev(`e${i}`, 1_000_000, n));
    const r = forecastSuggest("target", 1_000_000, history);
    expect(r.status).toBe("ok");
    expect(r.base).toBe(70); // p50 of 50..90
    expect(r.low).toBeLessThanOrEqual(r.base!);
    expect(r.high).toBeGreaterThanOrEqual(r.base!);
    expect(r.low).toBe(58); // p20 = 50 + (90-50 spread)… linear: 50 + (60-50)*0.8 = 58
    expect(r.high).toBe(82); // p80: 80 + (90-80)*0.2 = 82
  });

  it("falls back to an unbanded (all buy-ins) sample when the target buy-in is unknown, with a stricter minimum", () => {
    const four = [ev("a", 1_000_000, 100), ev("b", 5_000_000, 40), ev("c", 500_000, 200), ev("d", 2_000_000, 80)];
    // 4 events, unbanded min is 5 → insufficient
    expect(forecastSuggest("t", null, four).status).toBe("insufficient");
    // add a 5th → now enough; band is null (unfiltered)
    const five = [...four, ev("e", 3_000_000, 60)];
    const r = forecastSuggest("t", null, five);
    expect(r.status).toBe("ok");
    expect(r.sampleSize).toBe(5);
    expect(r.bandLow).toBeNull();
    expect(r.bandHigh).toBeNull();
  });
});
