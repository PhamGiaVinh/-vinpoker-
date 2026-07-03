import { describe, it, expect } from "vitest";
import { computeCalibration, MIN_CALIBRATION_PAIRS } from "./calibration";
import type { OutcomeScore } from "./captureScoring";

/** Minimal OutcomeScore for calibration (only base/actual/inBand are read here). */
function sc(base: number | null, actual: number | null, inBand: boolean | null): OutcomeScore {
  const entriesDelta = actual !== null && base !== null ? actual - base : null;
  return {
    hasActuals: actual !== null,
    actualEntries: actual,
    base,
    bandLow: null,
    bandHigh: null,
    inBand,
    entriesDelta,
    candidateGtd: null,
    actualPrizePool: null,
    gtdCovered: null,
    overlayAmount: null,
    hadOverlay: null,
    label: "Observed Pattern",
  };
}

/** N pairs, each actual = base + delta, inBand as given. */
const many = (n: number, base: number, delta: number, inBand: boolean): OutcomeScore[] =>
  Array.from({ length: n }, () => sc(base, base + delta, inBand));

describe("computeCalibration — gating", () => {
  it("empty → not-enough, zero pairs, null rates", () => {
    const r = computeCalibration([]);
    expect(r.scoredPairs).toBe(0);
    expect(r.enough).toBe(false);
    expect(r.verdict).toBe("not-enough");
    expect(r.inBandRate).toBeNull();
    expect(r.minPairs).toBe(MIN_CALIBRATION_PAIRS);
  });

  it("fewer than MIN pairs → not-enough even if all in band", () => {
    const r = computeCalibration(many(MIN_CALIBRATION_PAIRS - 1, 100, 0, true));
    expect(r.enough).toBe(false);
    expect(r.verdict).toBe("not-enough");
    expect(r.notes.some((n) => n.includes(`/${MIN_CALIBRATION_PAIRS}`))).toBe(true);
  });

  it("pairs with no actual/base are not counted as scored", () => {
    const r = computeCalibration([sc(100, null, null), sc(null, 100, null), ...many(3, 100, 0, true)]);
    expect(r.scoredPairs).toBe(3);
  });
});

describe("computeCalibration — band verdict (≥10 pairs)", () => {
  it("~90% in-band → well-calibrated", () => {
    // 9 in-band + 1 out = 90%
    const r = computeCalibration([...many(9, 100, 5, true), sc(100, 200, false)]);
    expect(r.enough).toBe(true);
    expect(r.inBandRate).toBeCloseTo(0.9, 5);
    expect(r.verdict).toBe("well-calibrated");
  });

  it("low in-band rate → band-too-narrow (overconfident)", () => {
    // 5/10 in band = 0.5 < 0.75
    const r = computeCalibration([...many(5, 100, 5, true), ...many(5, 100, 80, false)]);
    expect(r.inBandRate).toBeCloseTo(0.5, 5);
    expect(r.verdict).toBe("band-too-narrow");
    expect(r.notes.some((n) => n.includes("HẸP"))).toBe(true);
  });

  it("everything in band → band-too-wide (underconfident)", () => {
    const r = computeCalibration(many(12, 100, 2, true));
    expect(r.inBandRate).toBe(1);
    expect(r.verdict).toBe("band-too-wide");
    expect(r.notes.some((n) => n.includes("RỘNG"))).toBe(true);
  });

  it("banded pairs exclude those with null inBand, but they still count as scored", () => {
    const r = computeCalibration([...many(10, 100, 5, true), sc(100, 130, null)]);
    expect(r.scoredPairs).toBe(11);
    expect(r.bandedPairs).toBe(10);
    expect(r.inBandRate).toBe(1);
  });
});

describe("computeCalibration — bias + error magnitude", () => {
  it("consistent positive delta → biasDirection under (forecast ran low)", () => {
    const r = computeCalibration(many(10, 100, 30, true)); // actual always 30 above base
    expect(r.meanBias).toBe(30);
    expect(r.biasDirection).toBe("under");
    expect(r.notes.some((n) => n.includes("THẤP hơn thực tế"))).toBe(true);
  });

  it("consistent negative delta → biasDirection over (forecast ran high)", () => {
    const r = computeCalibration(many(10, 100, -25, true));
    expect(r.meanBias).toBe(-25);
    expect(r.biasDirection).toBe("over");
  });

  it("symmetric misses cancel → no net bias, but MAE reflects the spread", () => {
    const r = computeCalibration([...many(5, 100, 20, true), ...many(5, 100, -20, true)]);
    expect(r.meanBias).toBe(0);
    expect(r.biasDirection).toBe("none");
    expect(r.mae).toBe(20);
  });

  it("MAPE is |delta|/base as % over base>0", () => {
    const r = computeCalibration(many(10, 200, 20, true)); // 20/200 = 10%
    expect(r.mapePct).toBeCloseTo(10, 5);
  });

  it("is deterministic for identical input", () => {
    const input = many(10, 100, 5, true);
    expect(computeCalibration(input)).toEqual(computeCalibration(input));
  });
});
