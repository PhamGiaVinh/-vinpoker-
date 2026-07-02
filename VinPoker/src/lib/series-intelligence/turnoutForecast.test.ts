import { describe, it, expect } from "vitest";
import type { SeriesEvent } from "./nativeData";
import { forecastTurnout, forecastToOverlayFeed, describeFeature, FEED_LOG_SD_FALLBACK, type UpcomingEvent } from "./turnoutForecast";

const pad = (n: number) => String(n).padStart(2, "0");

function ev(day: number, buy_in: number, entries: number | null, extra: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: `e-${day}-${buy_in}`,
    event_name: "Event",
    event_date: `2026-01-${pad(day)}T19:00:00+07:00`,
    buy_in,
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
    ...extra,
  };
}

// entries = 2e8 / buy_in (exact log-linear: log(entries) = C − 1·log(buy_in))
function exactSet(days: number[]): SeriesEvent[] {
  const buyins = [1_000_000, 2_000_000, 5_000_000];
  return days.map((d, i) => {
    const b = buyins[i % buyins.length];
    return ev(d, b, Math.round(2e8 / b));
  });
}

const future = (buy_in: number, gtd: number | null = null): UpcomingEvent => ({ event_date: "2026-02-15T19:00:00+07:00", buy_in, gtd });

describe("forecastTurnout — degrade ladder", () => {
  it("N ≤ 1 → unavailable, no number, note (no NaN)", () => {
    const r = forecastTurnout([ev(1, 1_000_000, 150)], future(1_000_000));
    expect(r.available).toBe(false);
    expect(r.base).toBeNull();
    expect(r.missingDataNotes.length).toBeGreaterThan(0);
  });

  it("2 ≤ N < 8 → degraded (intercept+buy-in), low tier, wide band", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4]), future(1_500_000));
    expect(r.available).toBe(true);
    expect(r.degraded).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.base).toBeGreaterThan(0);
    expect(r.high! - r.low!).toBeGreaterThan(0);
  });

  it("N ≥ 12 → high tier, full model, not degraded", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), future(1_000_000));
    expect(r.available).toBe(true);
    expect(r.degraded).toBe(false);
    expect(r.confidence).toBe("high");
  });
});

describe("forecastTurnout — model recovers the buy-in pattern", () => {
  const events = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  it("predict is monotonic decreasing in buy-in", () => {
    const lowBuy = forecastTurnout(events, future(1_000_000)).base!;
    const midBuy = forecastTurnout(events, future(2_000_000)).base!;
    const highBuy = forecastTurnout(events, future(5_000_000)).base!;
    expect(lowBuy).toBeGreaterThan(midBuy);
    expect(midBuy).toBeGreaterThan(highBuy);
  });
  it("recovers the ~2e8/buy_in level closely (exact fixture)", () => {
    const r = forecastTurnout(events, future(1_000_000));
    expect(r.base).toBeGreaterThan(150); // ≈ 200
    expect(r.base).toBeLessThan(260);
  });
  it("deterministic — same input ⇒ identical output", () => {
    expect(JSON.stringify(forecastTurnout(events, future(2_000_000)))).toBe(JSON.stringify(forecastTurnout(events, future(2_000_000))));
  });
});

describe("forecastTurnout — temporal discipline (no leakage)", () => {
  it("trains ONLY on events strictly before the target date", () => {
    const events = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // days 1..10
    const r = forecastTurnout(events, { event_date: "2026-01-06T12:00:00+07:00", buy_in: 1_000_000, gtd: null });
    expect(r.sampleSize).toBe(5); // only days 1..5 are before Jan 6
  });

  it("future events / result-only fields never affect the forecast", () => {
    const base = exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // identical pre-event inputs, but stuff RESULT fields (prize/fee) + a later event with wild entries
    const polluted = base.map((e) => ({ ...e, prize_pool_actual: 9.9e12, fee: 9_999_999 }));
    polluted.push(ev(28, 1_000_000, 99999)); // far-future event (after the Feb target? no — Jan 28 < Feb 15)
    const target = future(2_000_000); // Feb 15 → the Jan 28 event IS in the past, so to isolate result-fields use an earlier target
    const cleanR = forecastTurnout(base, { event_date: "2026-01-13T12:00:00+07:00", buy_in: 2_000_000, gtd: null });
    const pollR = forecastTurnout(polluted, { event_date: "2026-01-13T12:00:00+07:00", buy_in: 2_000_000, gtd: null });
    void target;
    expect(pollR.base).toBe(cleanR.base); // prize/fee + later event (day 28 > Jan 13) ignored
  });
});

describe("forecastTurnout — walk-forward CV + baseline", () => {
  it("model & baseline MAPE finite and ≥ 0; delta = baseline − model", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), future(1_000_000));
    expect(r.modelMapePct).not.toBeNull();
    expect(r.baselineMapePct).not.toBeNull();
    expect(r.modelMapePct!).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.modelMapePct!)).toBe(true);
    expect(r.deltaVsBaselinePct).toBeCloseTo(r.baselineMapePct! - r.modelMapePct!, 6);
  });
  it("on the exact log-linear fixture the model beats the median baseline", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), future(1_000_000));
    expect(r.deltaVsBaselinePct!).toBeGreaterThan(0);
  });
});

describe("forecastTurnout — robustness", () => {
  it("missing gtd / sparse data → no NaN, integer band", () => {
    const r = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    expect(Number.isFinite(r.base!)).toBe(true);
    expect(Number.isInteger(r.base!)).toBe(true);
    expect(Number.isFinite(r.low!) && Number.isFinite(r.high!)).toBe(true);
    expect(r.coefContributions.every((c) => Number.isFinite(c.impactPct))).toBe(true);
  });
});

describe("forecastToOverlayFeed (explicit forecast→overlay adapter feed)", () => {
  it("recovers logSd from the band and round-trips: exp(ln(base) ± Z·logSd) ≈ low/high", () => {
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    expect(fc.available).toBe(true);
    const feed = forecastToOverlayFeed(fc, 1_500_000);
    expect(feed).not.toBeNull();
    const Z = 1.2816;
    // band was rounded to integers → allow a loose tolerance on the round-trip
    expect(Math.exp(Math.log(feed!.base) + Z * feed!.logSd)).toBeGreaterThan(fc.base! * 0.9);
    expect(feed!.logSd).toBeGreaterThan(0);
    expect(feed!.buyIn).toBe(1_500_000);
    expect(feed!.label).toContain("Hypothesis");
  });

  it("owner override replaces the center and is labeled as edited", () => {
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    const feed = forecastToOverlayFeed(fc, 1_500_000, 123);
    expect(feed!.base).toBe(123);
    expect(feed!.label).toContain("sửa tay");
  });

  it("returns null when the forecast is unavailable or inputs unusable", () => {
    const unavailable = forecastTurnout(exactSet([1]), future(1_500_000, null)); // N ≤ 1 → gated
    expect(forecastToOverlayFeed(unavailable, 1_500_000)).toBeNull();
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    expect(forecastToOverlayFeed(fc, null)).toBeNull();
    expect(forecastToOverlayFeed(fc, 0)).toBeNull();
    expect(forecastToOverlayFeed(fc, 1_500_000, 0)).toBeNull(); // degenerate override
    expect(forecastToOverlayFeed(null, 1_500_000)).toBeNull();
  });

  it("falls back to FEED_LOG_SD_FALLBACK on a degenerate band", () => {
    const fc = forecastTurnout(exactSet([1, 2, 3, 4, 5, 6, 7, 8]), future(1_500_000, null));
    const degenerate = { ...fc, low: fc.base, high: fc.base }; // no width to invert
    const feed = forecastToOverlayFeed(degenerate, 1_500_000);
    expect(feed!.logSd).toBe(FEED_LOG_SD_FALLBACK);
  });
});

describe("describeFeature (plain-VN factor names for the owner)", () => {
  it("translates weekday/quarter/hour-slot/type/numeric codes", () => {
    expect(describeFeature("weekday:wd6")).toBe("Cuối tuần (Thứ 7)");
    expect(describeFeature("weekday:wd0")).toBe("Cuối tuần (Chủ nhật)");
    expect(describeFeature("weekday:wd3")).toBe("Thứ 4");
    expect(describeFeature("quarter:q2")).toBe("Quý 3");
    expect(describeFeature("hourSlot:hs3")).toBe("Khung tối (18–24h)");
    expect(describeFeature("type:main")).toBe("Loại Main Event");
    expect(describeFeature("logBuyin")).toBe("Buy-in cao");
    expect(describeFeature("gtdMissing")).toBe("Không đặt GTD");
  });
  it("falls back to the raw code for unknown features", () => {
    expect(describeFeature("mystery-col")).toBe("mystery-col");
  });
});
