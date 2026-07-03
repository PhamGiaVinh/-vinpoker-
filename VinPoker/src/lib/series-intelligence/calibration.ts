// Series Intelligence — G7 forecast calibration (PURE, client-side, reads the ⑥ CAPTURE loop only).
//
// Closes the learning loop: compares each PAST forecast snapshot against the event's real actuals
// (via captureScoring.scoreOutcome) and measures whether the forecasts were honest — did actuals land
// inside the stated band as often as the band claims (P5–P95 ≈ 90%)? is there a systematic bias?
//
// HONESTY (locked):
//  - Measured facts only (Observed Pattern) — no model, no "Model Estimate".
//  - Leakage-safe: actuals are the TARGET being scored, never fed back as a forecast input.
//  - Under-powered until enough pairs exist: below MIN_CALIBRATION_PAIRS the verdict is
//    "not-enough" and NO calibration claim is made (the whole point of gating G7 on real data).

import type { OutcomeScore } from "./captureScoring";

/** The learning loop needs at least this many scored forecast↔actual pairs before we judge calibration. */
export const MIN_CALIBRATION_PAIRS = 10;
/** The forecast band is P5–P95 ⇒ a well-calibrated band should contain the actual ~90% of the time. */
export const TARGET_BAND_RATE = 0.9;
/** Tolerance around the target before we call the band mis-sized (wide with only ~10 samples). */
const BAND_LOW = 0.75; // below → band too NARROW (overconfident)
const BAND_HIGH = 0.98; // above → band too WIDE (underconfident)

export type CalibrationVerdict =
  | "not-enough" // < MIN pairs, or no banded pairs → make no claim
  | "band-too-narrow" // actuals fall outside the band more than expected → overconfident
  | "band-too-wide" // actuals almost always inside → underconfident, band too loose
  | "well-calibrated"; // in-band rate near the 90% target

export type BiasDirection = "under" | "over" | "none";

export interface CalibrationResult {
  /** forecast↔actual pairs with a base AND an actual entry count (the denominator for bias/MAE). */
  scoredPairs: number;
  minPairs: number;
  enough: boolean;
  /** pairs that also had a full band (for the in-band rate). */
  bandedPairs: number;
  /** fraction of banded pairs whose actual fell inside [low, high]; null when no banded pairs. */
  inBandRate: number | null;
  targetBandRate: number;
  /** mean(actual − base): >0 = forecasts ran LOW (under-predicted); <0 = ran HIGH. null when none. */
  meanBias: number | null;
  /** mean(|actual − base|) — typical miss magnitude, entries. */
  mae: number | null;
  /** mean(|actual − base| / base) as % — relative typical miss; null when no base>0. */
  mapePct: number | null;
  biasDirection: BiasDirection;
  verdict: CalibrationVerdict;
  notes: string[];
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Aggregate per-event OutcomeScores into a calibration verdict. Pass every scored decision (use
 * captureScoring.scoreOutcome on each decision + its forecast snapshot). Pure + deterministic.
 */
export function computeCalibration(scores: OutcomeScore[]): CalibrationResult {
  const scored = scores.filter((s) => s.entriesDelta !== null); // has base AND actual
  const deltas = scored.map((s) => s.entriesDelta as number);
  const banded = scores.filter((s) => s.inBand !== null);
  const withBase = scored.filter((s) => s.base !== null && (s.base as number) > 0);

  const scoredPairs = scored.length;
  const bandedPairs = banded.length;
  const enough = scoredPairs >= MIN_CALIBRATION_PAIRS;
  const inBandRate = bandedPairs > 0 ? banded.filter((s) => s.inBand === true).length / bandedPairs : null;
  const meanBias = deltas.length > 0 ? mean(deltas) : null;
  const mae = deltas.length > 0 ? mean(deltas.map(Math.abs)) : null;
  const mapePct =
    withBase.length > 0
      ? mean(withBase.map((s) => Math.abs((s.entriesDelta as number) / (s.base as number)))) * 100
      : null;

  // Bias direction only asserted when it's a non-trivial share of the typical miss.
  let biasDirection: BiasDirection = "none";
  if (meanBias !== null && mae !== null && mae > 0 && Math.abs(meanBias) >= 0.25 * mae) {
    biasDirection = meanBias > 0 ? "under" : "over";
  }

  let verdict: CalibrationVerdict;
  if (!enough || inBandRate === null) {
    verdict = "not-enough";
  } else if (inBandRate < BAND_LOW) {
    verdict = "band-too-narrow";
  } else if (inBandRate > BAND_HIGH) {
    verdict = "band-too-wide";
  } else {
    verdict = "well-calibrated";
  }

  const notes: string[] = [];
  if (!enough) {
    notes.push(`Chưa đủ dữ liệu để chấm hiệu chỉnh: ${scoredPairs}/${MIN_CALIBRATION_PAIRS} cặp dự báo↔thực tế.`);
  } else {
    if (bandedPairs < scoredPairs) {
      notes.push(`${scoredPairs - bandedPairs} cặp thiếu dải dự báo → không tính vào tỷ lệ trong dải.`);
    }
    if (verdict === "band-too-narrow") {
      notes.push("Thực tế rơi ngoài dải nhiều hơn kỳ vọng → dải dự báo đang HẸP quá (tự tin thái quá), nên nới rộng.");
    } else if (verdict === "band-too-wide") {
      notes.push("Thực tế gần như luôn nằm trong dải → dải đang RỘNG quá (thiếu tự tin), có thể thu hẹp.");
    } else {
      notes.push("Tỷ lệ trong dải gần mức kỳ vọng ~90% → dải dự báo đang hợp lý.");
    }
    if (biasDirection === "under") {
      notes.push(`Xu hướng dự báo THẤP hơn thực tế trung bình ~${Math.round(meanBias as number)} lượt entry.`);
    } else if (biasDirection === "over") {
      notes.push(`Xu hướng dự báo CAO hơn thực tế trung bình ~${Math.round(Math.abs(meanBias as number))} lượt entry.`);
    }
    notes.push("Mẫu còn nhỏ — đọc như tín hiệu, không phải kết luận chắc chắn.");
  }

  return {
    scoredPairs,
    minPairs: MIN_CALIBRATION_PAIRS,
    enough,
    bandedPairs,
    inBandRate,
    targetBandRate: TARGET_BAND_RATE,
    meanBias,
    mae,
    mapePct,
    biasDirection,
    verdict,
    notes,
  };
}
