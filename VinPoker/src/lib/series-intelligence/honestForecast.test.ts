// A4b — honest insufficient-data adapter. Proves the status mapping, that insufficient data is NEVER a
// fabricated 0, reasons are preserved from the A4a gate, and the adapter is pure. Reuses A3 + A4a, never a
// new median/naive/ladder.
import { describe, it, expect } from "vitest";
import { toHonestForecastResult, bestAvailableBaseline, type HonestForecastResult } from "./honestForecast";
import { forecastTurnout, type UpcomingEvent } from "./turnoutForecast";
import { runBaselineBattery, type BaselineBatteryResult } from "./baselineBattery";
import type { SeriesEvent } from "./nativeData";

function ev(day: number, buy_in: number, entries: number | null): SeriesEvent {
  return {
    event_id: `e-${day}`, event_name: "Event", event_date: `2026-01-${String(day).padStart(2, "0")}T19:00:00+07:00`,
    buy_in, fee: 100_000, serviceFeeAmount: null, gtd: null, prize_pool_actual: null,
    total_entries: entries, unique_entries: entries, reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
const bys = [1_000_000, 2_000_000, 5_000_000];
const eventsN = (n: number): SeriesEvent[] => Array.from({ length: n }, (_, i) => ev(i + 1, bys[i % 3], Math.round(2e8 / bys[i % 3]) + i));
const target: UpcomingEvent = { event_date: "2026-02-15T19:00:00+07:00", buy_in: 2_000_000, gtd: null };
const adapt = (n: number): HonestForecastResult => {
  const events = eventsN(n);
  return toHonestForecastResult(forecastTurnout(events, target), runBaselineBattery(events, target));
};

describe("A4b status mapping across capability boundaries (n=0,1,2,7,8,11,12)", () => {
  it("n=0 — no usable history ⇒ unavailable, forecast+baseline null, NO_HISTORY", () => {
    const r = adapt(0);
    expect(r.status).toBe("unavailable");
    expect(r.forecast).toBeNull();
    expect(r.baseline).toBeNull();
    expect([...r.reasons]).toEqual(["NO_HISTORY"]);
  });
  it("n=1 — model unavailable but a baseline exists ⇒ baseline_only (never a fabricated 0)", () => {
    const r = adapt(1);
    expect(r.status).toBe("baseline_only");
    expect(r.forecast).toBeNull(); // NOT 0
    if (r.status === "baseline_only") {
      expect(r.baseline.forecast).toBeGreaterThan(0);
      expect(typeof r.baseline.baselineId).toBe("string");
      expect(r.baseline.foldCount).toBe(0); // 1 event ⇒ no walk-forward folds, shown honestly
    }
    expect([...r.reasons]).toEqual(["NO_HISTORY"]);
  });
  for (const [n, reason] of [
    [2, "INSUFFICIENT_TRAINING_ROWS"], [7, "FULL_FEATURE_THRESHOLD_NOT_MET"],
    [8, null], [11, null], [12, null],
  ] as const) {
    it(`n=${n} — model supported ⇒ full_model (reasons ${reason ?? "[]"})`, () => {
      const r = adapt(n);
      expect(r.status).toBe("full_model");
      if (r.status === "full_model") {
        expect(r.forecast.available).toBe(true);
        expect(r.forecast.sampleSize).toBe(n);
      }
      expect([...r.reasons]).toEqual(reason ? [reason] : []);
    });
  }
});

describe("A4b invariants", () => {
  it("insufficient data is NEVER a fabricated 0 (forecast stays null)", () => {
    for (const n of [0, 1]) expect(adapt(n).forecast).toBeNull();
  });
  it("reasons are preserved exactly from the A4a capability gate", () => {
    // full_model at n=7 still carries the honest FULL_FEATURE_THRESHOLD_NOT_MET reason
    expect([...adapt(7).reasons]).toEqual(["FULL_FEATURE_THRESHOLD_NOT_MET"]);
  });
  it("deterministic — same inputs ⇒ identical result", () => {
    const events = eventsN(1);
    const a = toHonestForecastResult(forecastTurnout(events, target), runBaselineBattery(events, target));
    const b = toHonestForecastResult(forecastTurnout(events, target), runBaselineBattery(events, target));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("does not mutate its inputs", () => {
    const events = eventsN(8);
    const fc = forecastTurnout(events, target);
    const battery = runBaselineBattery(events, target);
    const fcCopy = JSON.stringify(fc);
    const batteryCopy = JSON.stringify(battery);
    toHonestForecastResult(fc, battery);
    expect(JSON.stringify(fc)).toBe(fcCopy);
    expect(JSON.stringify(battery)).toBe(batteryCopy);
  });
});

describe("A4b bestAvailableBaseline", () => {
  const base: BaselineBatteryResult = {
    forecasts: [],
    scores: [
      { baselineId: "historical_median", foldCount: 6, mape: 10, mae: 5 },
      { baselineId: "trailing_mean", foldCount: 6, mape: 20, mae: 8 },
    ],
    bestBaselineId: "historical_median",
    targets: [
      { baselineId: "historical_median", forecast: 128, unavailableReason: null },
      { baselineId: "trailing_mean", forecast: 140, unavailableReason: null },
    ],
    comparisons: [],
  };
  it("null battery ⇒ null", () => {
    expect(bestAvailableBaseline(null)).toBeNull();
  });
  it("prefers the battery's best baseline (forecast + fold count)", () => {
    expect(bestAvailableBaseline(base)).toEqual({ baselineId: "historical_median", forecast: 128, foldCount: 6 });
  });
  it("falls back to the first non-null target when there is no scoreable best (folds=0)", () => {
    const noBest: BaselineBatteryResult = {
      ...base,
      bestBaselineId: null,
      scores: [{ baselineId: "historical_median", foldCount: 0, mape: null, mae: null }],
      targets: [
        { baselineId: "historical_median", forecast: null, unavailableReason: "NO_SAME_WEEKDAY" },
        { baselineId: "trailing_mean", forecast: 140, unavailableReason: null },
      ],
    };
    expect(bestAvailableBaseline(noBest)).toEqual({ baselineId: "trailing_mean", forecast: 140, foldCount: 0 });
  });
  it("returns null when no baseline has a non-null prediction", () => {
    const none: BaselineBatteryResult = {
      ...base, bestBaselineId: null, scores: [],
      targets: [{ baselineId: "historical_median", forecast: null, unavailableReason: "NO_HISTORY" }],
    };
    expect(bestAvailableBaseline(none)).toBeNull();
  });
});
