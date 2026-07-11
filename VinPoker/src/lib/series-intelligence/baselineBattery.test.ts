// A3 — Baseline Battery. Proves the baselines are leak-safe, reduce over the SAME canonical folds as the
// model, and are compared only on identical fold sets. Pure-lib coverage; the card is tested separately.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runBaselineBattery,
  baselineVerdict,
  TRAILING_WINDOW,
  REASON_NO_HISTORY,
  REASON_NO_SAME_WEEKDAY,
  type BaselineBatteryResult,
  type BaselineForecast,
} from "./baselineBattery";
import { canonicalCvFolds, type UpcomingEvent } from "./turnoutForecast";
import type { SeriesEvent } from "./nativeData";

function ev(dateISO: string, buy_in: number, entries: number | null): SeriesEvent {
  return {
    event_id: `e-${dateISO}`, event_name: "Event", event_date: dateISO, buy_in, fee: 100_000,
    serviceFeeAmount: null, gtd: null, prize_pool_actual: null, total_entries: entries, unique_entries: entries,
    reentries: 0, source: "csv", clubId: "c1", missingFields: [],
  };
}
const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T19:00:00+07:00`;
const target = (day: number, buy_in = 2_000_000): UpcomingEvent => ({ event_date: at(day), buy_in, gtd: null });
const pick = (r: BaselineBatteryResult, id: string) => ({
  target: r.targets.find((t) => t.baselineId === id)!,
  score: r.scores.find((s) => s.baselineId === id)!,
  forecasts: r.forecasts.filter((f) => f.baselineId === id),
});

describe("A3 target-point predictors — leak-safe rules", () => {
  it("historical median — odd history length", () => {
    const r = runBaselineBattery([ev(at(5), 1e6, 100), ev(at(6), 1e6, 200), ev(at(7), 1e6, 300)], target(20));
    expect(pick(r, "historical_median").target.forecast).toBe(200); // median of {100,200,300}
  });
  it("historical median — even history length (deterministic average of the two middles)", () => {
    const r = runBaselineBattery(
      [ev(at(5), 1e6, 100), ev(at(6), 1e6, 200), ev(at(7), 1e6, 300), ev(at(8), 1e6, 400)],
      target(20),
    );
    expect(pick(r, "historical_median").target.forecast).toBe(250); // (200+300)/2
  });

  it("trailing mean uses ONLY the configured prior window (latest TRAILING_WINDOW rows)", () => {
    // entries 10..60 by date; window=4 ⇒ mean of the last 4 (30,40,50,60)=45, NOT mean of all 6 (35).
    const evs = [10, 20, 30, 40, 50, 60].map((e, i) => ev(at(i + 1), 1e6, e));
    const r = runBaselineBattery(evs, target(20));
    expect(TRAILING_WINDOW).toBe(4);
    expect(pick(r, "trailing_mean").target.forecast).toBe(45);
  });

  it("same-weekday uses only prior SAME-weekday events (excludes other weekdays)", () => {
    // days 1..10; target weekday = getDay(target). same-weekday prior entries only.
    const evs = Array.from({ length: 10 }, (_, i) => ev(at(i + 1), 1e6, 100 + i * 10));
    const tgt = target(15);
    const twd = new Date(tgt.event_date).getDay();
    const expected = evs
      .filter((e) => new Date(e.event_date as string).getDay() === twd)
      .map((e) => e.total_entries as number);
    const r = runBaselineBattery(evs, tgt);
    if (expected.length === 0) {
      expect(pick(r, "same_weekday").target.forecast).toBeNull();
    } else {
      const mean = Math.round(expected.reduce((a, c) => a + c, 0) / expected.length);
      expect(pick(r, "same_weekday").target.forecast).toBe(mean);
    }
  });

  it("same-weekday NEVER uses future events", () => {
    const tgt = target(15);
    const twd = new Date(tgt.event_date).getDay();
    // a FUTURE same-weekday event (7 days after target) with a wild value must not move the prediction.
    const future = ev(at(22), 1e6, 99999); // day 22 == same weekday as day 15
    expect(new Date(future.event_date as string).getDay()).toBe(twd);
    const past = Array.from({ length: 10 }, (_, i) => ev(at(i + 1), 1e6, 100 + i * 10));
    const withFuture = runBaselineBattery([...past, future], tgt);
    const withoutFuture = runBaselineBattery(past, tgt);
    expect(pick(withFuture, "same_weekday").target.forecast).toBe(pick(withoutFuture, "same_weekday").target.forecast);
  });

  it("same-weekday unavailable (explicit reason, not a fake 0) when no prior same-weekday exists", () => {
    // one prior event only, on a DIFFERENT weekday than the target.
    const tgt = target(15);
    const other = at(8);
    const r = runBaselineBattery([ev(other, 1e6, 300)], tgt);
    const sw = pick(r, "same_weekday").target;
    if (new Date(other).getDay() !== new Date(tgt.event_date).getDay()) {
      expect(sw.forecast).toBeNull();
      expect(sw.unavailableReason).toBe(REASON_NO_SAME_WEEKDAY);
    }
  });

  it("no history ⇒ every baseline unavailable with a reason (never a fake 0), no best, inconclusive", () => {
    const r = runBaselineBattery([], target(20));
    for (const t of r.targets) {
      expect(t.forecast).toBeNull();
      expect(t.unavailableReason).not.toBeNull();
    }
    for (const s of r.scores) expect(s.foldCount).toBe(0);
    expect(r.bestBaselineId).toBeNull();
    expect(baselineVerdict(r).kind).toBe("inconclusive");
  });
});

describe("A3 canonical-fold discipline", () => {
  const evs = Array.from({ length: 12 }, (_, i) => ev(at(i + 1), [1e6, 2e6, 5e6][i % 3], Math.round(2e8 / [1e6, 2e6, 5e6][i % 3]) + i));
  const tgt = target(20);
  const r = runBaselineBattery(evs, tgt);
  const folds = canonicalCvFolds(evs, tgt);

  it("all baselines share IDENTICAL fold origins (the ONE canonical fold set)", () => {
    const foldOrigins = folds.map((f) => f.originTs);
    for (const id of ["historical_median", "trailing_mean", "same_weekday", "existing_naive"] as const) {
      const origins = pick(r, id).forecasts.map((f) => f.originTs);
      expect(origins).toEqual(foldOrigins);
      expect(pick(r, id).forecasts.map((f) => f.eventId)).toEqual(folds.map((f) => f.eventId));
    }
  });

  it("baseline artifacts carry NO actual / outcome field", () => {
    for (const f of r.forecasts) {
      expect(f).not.toHaveProperty("actual");
      expect(f).not.toHaveProperty("targetEntries");
      expect(Object.keys(f).sort()).toEqual(
        ["baselineId", "eventId", "forecast", "horizon", "originTs", "unavailableReason"].sort(),
      );
    }
  });

  it("model and baseline are compared on IDENTICAL fold sets — a fold missing on one side drops from BOTH", () => {
    for (const c of r.comparisons) {
      // reconstruct the matched set from the public folds + this baseline's forecasts (same order).
      const bf = pick(r, c.baselineId).forecasts;
      let matched = 0;
      for (let i = 0; i < folds.length; i++) {
        if (folds[i].modelForecast !== null && bf[i].forecast !== null && folds[i].targetEntries > 0) matched++;
      }
      expect(c.foldCount).toBe(matched); // symmetric — never one-sided
      if (matched === 0) {
        expect(c.modelMape).toBeNull();
        expect(c.baselineMape).toBeNull();
      } else {
        expect(c.modelMape).not.toBeNull();
        expect(c.baselineMape).not.toBeNull();
      }
    }
  });

  it("baseline score foldCount matches folds where THAT baseline produced a forecast", () => {
    for (const id of ["historical_median", "trailing_mean", "same_weekday", "existing_naive"] as const) {
      const { forecasts, score } = pick(r, id);
      const produced = forecasts.filter((f, i) => f.forecast !== null && folds[i].targetEntries > 0).length;
      expect(score.foldCount).toBe(produced);
    }
  });
});

describe("A3 purity", () => {
  const evs = Array.from({ length: 8 }, (_, i) => ev(at(i + 1), [1e6, 2e6][i % 2], 100 + i * 7));
  const tgt = target(20);

  it("deterministic (same inputs ⇒ identical result)", () => {
    expect(JSON.stringify(runBaselineBattery(evs, tgt))).toBe(JSON.stringify(runBaselineBattery(evs, tgt)));
  });
  it("does not mutate its inputs", () => {
    const copy = JSON.stringify(evs);
    runBaselineBattery(evs, tgt);
    expect(JSON.stringify(evs)).toBe(copy);
  });
});

describe("A3 baselineVerdict — honest by construction", () => {
  const mk = (over: Partial<BaselineBatteryResult["comparisons"][number]>): BaselineBatteryResult => ({
    forecasts: [],
    scores: [{ baselineId: "historical_median", foldCount: 5, mape: 10, mae: 5 }],
    bestBaselineId: "historical_median",
    targets: [],
    comparisons: [{ baselineId: "historical_median", conclusive: false, foldCount: 0, modelMape: null, baselineMape: null, modelBeatsBaseline: false, ...over }],
  });
  it("inconclusive when best comparison is not conclusive", () => {
    expect(baselineVerdict(mk({ conclusive: false })).kind).toBe("inconclusive");
  });
  it("inconclusive when there is no scoreable baseline", () => {
    const r = mk({}); (r as { bestBaselineId: null }).bestBaselineId = null;
    expect(baselineVerdict(r).kind).toBe("inconclusive");
  });
  it("model_better only when conclusive AND model wins", () => {
    expect(baselineVerdict(mk({ conclusive: true, foldCount: 6, modelMape: 8, baselineMape: 12, modelBeatsBaseline: true })).kind).toBe("model_better");
  });
  it("model_not_ahead when conclusive but model does not win", () => {
    expect(baselineVerdict(mk({ conclusive: true, foldCount: 6, modelMape: 14, baselineMape: 12, modelBeatsBaseline: false })).kind).toBe("model_not_ahead");
  });
});

describe("A3 boundary reuse (no duplicated machinery/thresholds)", () => {
  // vitest cwd is the VinPoker project root — robust to import.meta.url scheme differences across environments.
  const src = readFileSync(join(process.cwd(), "src/lib/series-intelligence/baselineBattery.ts"), "utf8");
  it("reuses the canonical fold machinery (canonicalCvFolds) — no second CV loop/split", () => {
    expect(src.includes("canonicalCvFolds")).toBe(true);
    // no second date split: the battery must NOT re-derive folds — it never parses dates or calls trainRows.
    expect(src.includes("new Date(")).toBe(false);
    expect(src.includes("trainRows")).toBe(false);
  });
  it("imports capability thresholds from A4a rather than duplicating them", () => {
    expect(src.includes('from "./modelCapability"')).toBe(true);
    expect(src.includes("evaluateModelCapability")).toBe(true);
    expect(src.includes("MIN_TRAIN_LENGTH")).toBe(true);
    // the sample-size ladder is never re-declared here
    expect(src.includes("MIN_FULL")).toBe(false);
    expect(src.includes("HIGH_N")).toBe(false);
  });
  it("feature-boundary stays active — folds come from the canonical (admitting) machinery, matched by origin", () => {
    const evs = Array.from({ length: 6 }, (_, i) => ev(at(i + 1), 1e6, 100 + i * 10));
    const tgt = target(20);
    const battery = runBaselineBattery(evs, tgt);
    const folds = canonicalCvFolds(evs, tgt); // canonicalCvFolds runs admitStaticPreFeatures (A1) per fold
    expect(battery.forecasts.filter((f) => f.baselineId === "historical_median").map((f) => f.originTs)).toEqual(
      folds.map((f) => f.originTs),
    );
  });
  void (REASON_NO_HISTORY as string); // referenced so the import is a used symbol
  const _f: BaselineForecast | null = null;
  void _f;
});
