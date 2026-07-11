// Series Intelligence — Baseline Battery (A3). Every model forecast is compared against a family of simple,
// honest baselines evaluated on EXACTLY the same canonical walk-forward folds as the model (A2). There is NO
// second CV loop, date split, scoring path, or actual join: the folds come from turnoutForecast.canonicalCvFolds
// (the ONE machinery), each predictor reads only a fold's strictly-earlier `train` rows, and the fold's own
// outcome is joined ONLY here in the separate scoring layer. Behind the seriesBaselineBattery flag (default OFF).
//
// Boundaries respected:
//  • A1 point-in-time: predictors read only StaticKnown prior outcomes; never the fold target or a future row.
//    (The canonical folds already run A1's admitStaticPreFeatures per fold — feature-boundary stays active.)
//  • A4a capability: min-fold requirement + full-tier gate come from evaluateModelCapability / MIN_TRAIN_LENGTH —
//    the sample-size ladder is never re-derived here.
//  • A4b is NOT implemented: no unavailable/baseline_only status, maximum-uncertainty, EmptyExplainer, or new
//    copy — unavailable baselines just carry an explicit machine reason (never a fake 0).

import type { SeriesEvent } from "./nativeData";
import {
  canonicalCvFolds,
  pastLeanRows,
  targetWeekdayCode,
  medianOf,
  type CvFold,
  type LeanFoldRow,
  type UpcomingEvent,
  type ForecastOptions,
} from "./turnoutForecast";
import { naiveBaseline } from "./naiveBaseline";
import { evaluateModelCapability, MIN_TRAIN_LENGTH } from "./modelCapability";

export type BaselineId = "historical_median" | "trailing_mean" | "same_weekday" | "existing_naive";

/** The trailing-window baseline's window — a NAMED, tested constant (never chosen by a fold's outcome). */
export const TRAILING_WINDOW = 4;
/** The existing-naive baseline's last-N window (matches naiveBaseline's default — reuse, not re-implement). */
const NAIVE_WINDOW = 3;

// Machine-stable unavailable reasons; the UI renders Vietnamese. A baseline is NEVER a fake 0 when unavailable.
export const REASON_NO_HISTORY = "NO_HISTORY";
export const REASON_NO_SAME_WEEKDAY = "NO_SAME_WEEKDAY";

export interface BaselineForecast {
  baselineId: BaselineId;
  eventId: string;
  originTs: string;
  horizon: number; // single-step ahead (the event itself)
  forecast: number | null;
  unavailableReason: string | null; // set ⟺ forecast === null
}
export interface BaselineScore {
  baselineId: BaselineId;
  foldCount: number; // folds where the baseline produced a forecast (and had a valid actual)
  mape: number | null; // % — null when foldCount === 0
  mae: number | null; // entries — null when foldCount === 0
}
/** The baseline's point prediction for the UPCOMING event (for the card's "… : X khách"). */
export interface BaselineTargetPrediction {
  baselineId: BaselineId;
  forecast: number | null;
  unavailableReason: string | null;
}
/** Model-vs-baseline verdict on IDENTICAL folds (both non-null) — the only basis for a "tốt hơn baseline" claim. */
export interface BaselineComparison {
  baselineId: BaselineId;
  conclusive: boolean; // same folds, both non-null metrics, capability min-fold requirement met
  foldCount: number; // matched folds (model AND baseline both predicted) — never one-sided
  modelMape: number | null;
  baselineMape: number | null;
  modelBeatsBaseline: boolean; // meaningful only when conclusive
}
export interface BaselineBatteryResult {
  forecasts: readonly BaselineForecast[];
  scores: readonly BaselineScore[];
  bestBaselineId: BaselineId | null;
  // A3 card additions (still no actual/outcome in any BaselineForecast):
  targets: readonly BaselineTargetPrediction[];
  comparisons: readonly BaselineComparison[];
}

const BASELINE_IDS: readonly BaselineId[] = ["historical_median", "trailing_mean", "same_weekday", "existing_naive"];

const rawMean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const relErr = (pred: number, actual: number): number => Math.abs(pred - actual) / actual;

// --- predictors: read ONLY strictly-earlier rows; NEVER the fold target's outcome ---
/** Predict a from-rows baseline (median / trailing / same-weekday) over strictly-earlier rows. The naive
 *  baseline is handled by its own reused implementation (see predictBaseline). */
function predictFromRows(
  id: Exclude<BaselineId, "existing_naive">,
  rows: readonly LeanFoldRow[],
  weekday: string | null,
): { value: number | null; reason: string | null } {
  if (id === "historical_median") {
    const v = medianOf(rows.map((r) => r.entries)); // the ONE median impl (deterministic even-count handling)
    return v === null ? { value: null, reason: REASON_NO_HISTORY } : { value: v, reason: null };
  }
  if (id === "trailing_mean") {
    if (rows.length === 0) return { value: null, reason: REASON_NO_HISTORY };
    const window = rows.slice(-TRAILING_WINDOW); // latest eligible prior rows only (rows are date-ascending)
    return { value: rawMean(window.map((r) => r.entries)), reason: null };
  }
  // same_weekday — documented policy: NO fallback, NO silent model substitution. Unavailable when none.
  if (weekday === null) return { value: null, reason: REASON_NO_SAME_WEEKDAY };
  const sw = rows.filter((r) => r.weekday === weekday);
  return sw.length === 0
    ? { value: null, reason: REASON_NO_SAME_WEEKDAY }
    : { value: rawMean(sw.map((r) => r.entries)), reason: null };
}

/** Unified predictor for a fold OR the target. `rows` = strictly-earlier lean rows; `beforeDate` = the origin
 *  (fold origin or target date) used by the reused naive baseline's own strictly-earlier cutoff. */
function predictBaseline(
  id: BaselineId,
  rows: readonly LeanFoldRow[],
  weekday: string | null,
  events: SeriesEvent[],
  typeKeyword: string | null,
  beforeDate: string,
): { value: number | null; reason: string | null } {
  if (id === "existing_naive") {
    // Reuse the existing naiveBaseline (last-N same-type mean) at this origin — do NOT re-implement it.
    const nb = naiveBaseline(events, typeKeyword, beforeDate, NAIVE_WINDOW);
    return nb.value === null ? { value: null, reason: REASON_NO_HISTORY } : { value: nb.value, reason: null };
  }
  return predictFromRows(id, rows, weekday);
}

// --- separate scoring layer: join each fold's OWN outcome (targetEntries) positionally, A2's leak-safe way ---
function scoreBaseline(id: BaselineId, forecasts: readonly BaselineForecast[], folds: readonly CvFold[]): BaselineScore {
  const rel: number[] = [];
  const abs: number[] = [];
  for (let i = 0; i < folds.length; i++) {
    const pred = forecasts[i].forecast;
    const actual = folds[i].targetEntries; // actual enters ONLY here, never in the forecast artifact
    if (pred === null || !(actual > 0)) continue;
    rel.push(relErr(pred, actual));
    abs.push(Math.abs(pred - actual));
  }
  return {
    baselineId: id,
    foldCount: rel.length,
    mape: rel.length ? rawMean(rel) * 100 : null,
    mae: abs.length ? rawMean(abs) : null,
  };
}

/** Model vs baseline on the folds where BOTH predicted — the errors are pushed in lockstep, so a fold missing
 *  on EITHER side is dropped from BOTH (never one-sided). Conclusive only when the capability min-fold gate is met. */
function compareModelVsBaseline(
  id: BaselineId,
  folds: readonly CvFold[],
  forecasts: readonly BaselineForecast[],
  fullTier: boolean,
): BaselineComparison {
  const mRel: number[] = [];
  const bRel: number[] = [];
  for (let i = 0; i < folds.length; i++) {
    const m = folds[i].modelForecast;
    const b = forecasts[i].forecast;
    const actual = folds[i].targetEntries;
    if (m === null || b === null || !(actual > 0)) continue; // MATCHED folds only — symmetric drop
    mRel.push(relErr(m, actual));
    bRel.push(relErr(b, actual));
  }
  const foldCount = mRel.length; // === bRel.length by construction
  const modelMape = foldCount ? rawMean(mRel) * 100 : null;
  const baselineMape = foldCount ? rawMean(bRel) * 100 : null;
  // A4a: enough matched folds (MIN_TRAIN_LENGTH) AND the model is at its full-feature tier — no over-claim.
  const conclusive = fullTier && foldCount >= MIN_TRAIN_LENGTH && modelMape !== null && baselineMape !== null;
  const modelBeatsBaseline = conclusive && (modelMape as number) < (baselineMape as number);
  return { baselineId: id, conclusive, foldCount, modelMape, baselineMape, modelBeatsBaseline };
}

function pickBest(scores: readonly BaselineScore[]): BaselineId | null {
  let best: BaselineScore | null = null;
  for (const s of scores) {
    if (s.mape === null || s.foldCount === 0) continue;
    if (best === null || s.mape < (best.mape as number)) best = s; // BASELINE_IDS order ⇒ stable tie-break (first wins)
  }
  return best?.baselineId ?? null;
}

/**
 * Run the baseline battery for `target` over the club's `events`. Pure + deterministic; does not mutate inputs.
 * All baselines reduce over the SAME canonical folds the model CV uses, so scores compare on identical folds.
 */
export function runBaselineBattery(
  events: SeriesEvent[],
  target: UpcomingEvent,
  opts: ForecastOptions = {},
): BaselineBatteryResult {
  const folds = canonicalCvFolds(events, target, opts); // the ONE canonical fold set (model + median + train + actual)
  const past = pastLeanRows(events, target, opts); // all strictly-earlier rows — the target-point training basis
  const targetWeekday = targetWeekdayCode(target);
  const typeKeyword = target.typeKeyword ?? null;
  // A4a: full-feature tier gate for a superiority claim, from the SAME evaluator the model uses (no duplicate ladder).
  const fullTier = evaluateModelCapability({ kind: "sample_size", sampleSize: past.length }).supportsFullFeatures;

  const forecasts: BaselineForecast[] = [];
  const scores: BaselineScore[] = [];
  const targets: BaselineTargetPrediction[] = [];
  const comparisons: BaselineComparison[] = [];

  for (const id of BASELINE_IDS) {
    const foldForecasts: BaselineForecast[] = folds.map((fold) => {
      const p = predictBaseline(id, fold.train, fold.targetWeekday, events, typeKeyword, fold.originTs);
      return { baselineId: id, eventId: fold.eventId, originTs: fold.originTs, horizon: 1, forecast: p.value, unavailableReason: p.reason };
    });
    forecasts.push(...foldForecasts);
    scores.push(scoreBaseline(id, foldForecasts, folds));

    const tp = predictBaseline(id, past, targetWeekday, events, typeKeyword, target.event_date);
    targets.push({ baselineId: id, forecast: tp.value, unavailableReason: tp.reason });

    comparisons.push(compareModelVsBaseline(id, folds, foldForecasts, fullTier));
  }

  return { forecasts, scores, bestBaselineId: pickBest(scores), targets, comparisons };
}

export type BaselineVerdictKind = "inconclusive" | "model_better" | "model_not_ahead";
export interface BaselineVerdict {
  kind: BaselineVerdictKind;
  baselineId: BaselineId | null; // the best baseline the verdict is measured against
  foldCount: number; // matched folds behind the verdict
}
/**
 * The single honest model-vs-baseline verdict: compare the model to the BEST (lowest-MAPE) baseline on their
 * MATCHED folds. "model_better" ONLY when that comparison is conclusive AND the model wins; else
 * "model_not_ahead" (conclusive, model not ahead) or "inconclusive" (not enough matched folds / no scoreable
 * baseline). Never claims a win on insufficient data.
 */
export function baselineVerdict(result: BaselineBatteryResult): BaselineVerdict {
  const best = result.bestBaselineId;
  const cmp = best ? result.comparisons.find((c) => c.baselineId === best) ?? null : null;
  if (best === null || cmp === null || !cmp.conclusive) {
    return { kind: "inconclusive", baselineId: best, foldCount: cmp?.foldCount ?? 0 };
  }
  return { kind: cmp.modelBeatsBaseline ? "model_better" : "model_not_ahead", baselineId: best, foldCount: cmp.foldCount };
}
