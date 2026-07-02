// Series Intelligence — Turnout forecast (transparent ridge log-linear, PURE, client-only).
//
// Predicts entries for an UPCOMING event from the club's OWN past events, with a confidence band + tier +
// an honest walk-forward CV error. This is a TRANSPARENT model (ridge regression on log(entries) with one-hot
// categoricals), NOT black-box ML. It is the ROADMAP's gated Phase-5 PREDICTIVE tier shipped as RESEARCH:
// output is labeled only with the existing tiers (Hypothesis + confidence) — NEVER `Model Estimate` — and
// stays behind a default-OFF flag until a backtest beats the rules baseline (owner-gated).
//
// LEAKAGE DISCIPLINE (locked): inputs are ONLY known-before-the-event features (date → weekday/quarter/
// hour-slot, log buy-in, log GTD + a missing flag, event-type keyword). total_entries is the TARGET only;
// prize_pool_actual / fee-actual / overlay / rake are RESULTS and are NEVER predictors. Serving + every CV
// fold train ONLY on events strictly before the target date. Deterministic (closed-form ridge, no random).

import type { SeriesEvent } from "./nativeData";
import { typeOf } from "./seriesEventType";

export type ForecastConfidence = "low" | "medium" | "high"; // reuses the ScenarioConfidence vocabulary

/** n passed to the existing overlay engine so its epistemic √n shrink → ~0; the band comes from the
 *  forecast's own σ_pred, not from the engine. Keeps the overlay a pure forecast-centered simulation. */
export const OVERLAY_FEED_N = 10000;

const MIN_FULL = 8; // ≥ this → full ridge with one-hot; below → intercept + log(buy-in) fallback
const HIGH_N = 12; // ≥ this → "high" tier (also the Phase-5 data gate)
const CV_MIN_TRAIN = 4; // a walk-forward fold needs at least this many past events to fit
const LAMBDA = 1.0; // ridge strength (intercept unpenalised); mainly shrinks sparse one-hot levels
const Z = 1.2816; // ~p10–p90 band

// Event-type vocabulary lives in the shared seriesEventType helper (also used by contribution-margin
// grouping) so all consumers classify identically. Its specific-first ordering fixes two misclassifications
// this file's original inline list had ("Super High Roller" → high roller; "Satellite to Main" → main).

export interface UpcomingEvent {
  event_date: string; // ISO
  buy_in: number;
  gtd: number | null;
  typeKeyword?: string | null;
}

export interface CoefContribution {
  feature: string;
  beta: number; // log-space coefficient
  impactPct: number; // (exp(beta) − 1) × 100 — a model adjustment / correlation, NOT a causal claim
}

export interface TurnoutForecast {
  available: boolean;
  base: number | null;
  low: number | null;
  high: number | null;
  confidence: ForecastConfidence;
  sampleSize: number; // past events (with entries) used to train
  degraded: boolean; // used the intercept + log(buy-in) fallback
  modelMapePct: number | null; // walk-forward CV error of the model
  baselineMapePct: number | null; // walk-forward CV error of the median-of-past baseline
  deltaVsBaselinePct: number | null; // baseline − model (positive ⇒ model beats baseline)
  coefContributions: CoefContribution[];
  missingDataNotes: string[];
  disclaimer: string;
}

const DISCLAIMER =
  "Khung dự báo tham khảo · chưa qua backtest chính thức · cần ≥12 giải + thắng baseline để gọi là Model Estimate. KHÔNG phải cam kết — chủ club sửa đè được.";

// ---------- pre-event feature extraction ----------
function localParts(iso: string | null): { weekday: number; quarter: number; hourSlot: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { weekday: d.getDay(), quarter: Math.floor(d.getMonth() / 3), hourSlot: Math.floor(d.getHours() / 6) };
}

interface PreFeatures {
  logBuyin: number;
  logGtd: number | null;
  weekday: string;
  quarter: string;
  hourSlot: string;
  type: string;
}
function preFeatures(buyIn: number, gtd: number | null, iso: string, name: string | null, explicitType?: string | null): PreFeatures | null {
  const parts = localParts(iso);
  if (!parts || !(buyIn > 0)) return null;
  return {
    logBuyin: Math.log(buyIn),
    logGtd: gtd != null && gtd > 0 ? Math.log(gtd) : null,
    weekday: `wd${parts.weekday}`,
    quarter: `q${parts.quarter}`,
    hourSlot: `hs${parts.hourSlot}`,
    type: typeOf(name, explicitType),
  };
}

// ---------- ridge pipeline (built fresh per training set — no leakage) ----------
interface Model {
  cols: string[]; // feature names in β order; cols[0] = "intercept"
  oneHot: string[]; // the categorical "group:level" columns that survived pruning
  numMean: Record<string, number>;
  numStd: Record<string, number>;
  meanLogGtd: number; // imputation for missing GTD
  useGtd: boolean;
  useOneHot: boolean;
  beta: number[];
  rmse: number;
  n: number;
}

const NUM_COLS_FULL = ["logBuyin", "logGtd", "gtdMissing"];
const ONE_HOT_GROUPS: Array<keyof Pick<PreFeatures, "weekday" | "quarter" | "hourSlot" | "type">> = ["weekday", "quarter", "hourSlot", "type"];

function buildModel(rows: Array<{ f: PreFeatures; y: number }>): Model | null {
  const n = rows.length;
  if (n < 2) return null;
  const useOneHot = n >= MIN_FULL;
  const useGtd = useOneHot && rows.some((r) => r.f.logGtd !== null);

  // numeric columns
  const numCols = useGtd ? NUM_COLS_FULL : ["logBuyin"];
  const meanLogGtd = useGtd ? mean(rows.map((r) => r.f.logGtd).filter((v): v is number => v !== null)) : 0;
  const numValue = (f: PreFeatures, c: string): number => {
    if (c === "logBuyin") return f.logBuyin;
    if (c === "logGtd") return f.logGtd ?? meanLogGtd;
    if (c === "gtdMissing") return f.logGtd === null ? 1 : 0;
    return 0;
  };
  const numMean: Record<string, number> = {};
  const numStd: Record<string, number> = {};
  for (const c of numCols) {
    const vals = rows.map((r) => numValue(r.f, c));
    numMean[c] = mean(vals);
    const sd = std(vals, numMean[c]);
    numStd[c] = sd > 1e-9 ? sd : 1; // constant column → no scaling (β absorbs)
  }

  // one-hot levels with ≥2 observations (pruned)
  const oneHot: string[] = [];
  if (useOneHot) {
    for (const g of ONE_HOT_GROUPS) {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.f[g], (counts.get(r.f[g]) ?? 0) + 1);
      for (const [level, c] of counts) if (c >= 2) oneHot.push(`${g}:${level}`);
    }
  }

  const cols = ["intercept", ...numCols, ...oneHot];
  const rowVec = (f: PreFeatures): number[] => {
    const v = [1];
    for (const c of numCols) v.push((numValue(f, c) - numMean[c]) / numStd[c]);
    for (const oh of oneHot) {
      const [g, level] = oh.split(":");
      v.push(f[g as keyof PreFeatures] === level ? 1 : 0);
    }
    return v;
  };

  const X = rows.map((r) => rowVec(r.f));
  const y = rows.map((r) => r.y);
  const p = cols.length;
  // A = XᵀX + λI (skip intercept), b = Xᵀy
  const A = zeros(p, p);
  const b = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = j; k < p; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) A[k][j] = A[j][k];
  for (let j = 1; j < p; j++) A[j][j] += LAMBDA;

  let beta = choleskySolve(A, b);
  if (!beta) beta = [mean(y), ...new Array(p - 1).fill(0)]; // never crash → intercept-only fallback

  let sse = 0;
  for (let i = 0; i < n; i++) {
    let yh = 0;
    for (let j = 0; j < p; j++) yh += X[i][j] * beta[j];
    sse += (y[i] - yh) * (y[i] - yh);
  }
  const rmse = Math.sqrt(sse / n);
  return { cols, oneHot, numMean, numStd, meanLogGtd, useGtd, useOneHot, beta, rmse, n };
}

function predictLog(model: Model, f: PreFeatures): number {
  const numCols = model.useGtd ? NUM_COLS_FULL : ["logBuyin"];
  const numValue = (c: string): number => {
    if (c === "logBuyin") return f.logBuyin;
    if (c === "logGtd") return f.logGtd ?? model.meanLogGtd;
    if (c === "gtdMissing") return f.logGtd === null ? 1 : 0;
    return 0;
  };
  let yh = model.beta[0];
  let idx = 1;
  for (const c of numCols) yh += ((numValue(c) - model.numMean[c]) / model.numStd[c]) * model.beta[idx++];
  for (const oh of model.oneHot) {
    const [g, level] = oh.split(":"); // unknown category at predict ⇒ no level matches ⇒ contributes 0 ("other")
    yh += (f[g as keyof PreFeatures] === level ? 1 : 0) * model.beta[idx++];
  }
  return yh;
}

// ---------- public API ----------
interface TrainRow {
  f: PreFeatures;
  y: number; // log entries
  date: number; // ms for sorting
  entries: number;
}

function trainRows(events: SeriesEvent[]): TrainRow[] {
  const rows: TrainRow[] = [];
  for (const e of events) {
    if (e.total_entries === null || !(e.total_entries > 0)) continue;
    if (e.buy_in === null || !(e.buy_in > 0) || e.event_date === null) continue;
    const t = new Date(e.event_date).getTime();
    if (Number.isNaN(t)) continue;
    const f = preFeatures(e.buy_in, e.gtd, e.event_date, e.event_name);
    if (!f) continue;
    rows.push({ f, y: Math.log(e.total_entries), date: t, entries: e.total_entries });
  }
  return rows.sort((a, b) => a.date - b.date);
}

/** Walk-forward CV: for each event predict it from ONLY earlier events (pipeline rebuilt per fold). Honest
 *  out-of-sample. Returns null mapes when too few folds. Baseline = median of past entries (same protocol). */
function walkForwardCv(rows: TrainRow[]): { modelMape: number | null; baselineMape: number | null } {
  const mApe: number[] = [];
  const bApe: number[] = [];
  for (let i = CV_MIN_TRAIN; i < rows.length; i++) {
    const train = rows.slice(0, i);
    const actual = rows[i].entries;
    const model = buildModel(train.map((r) => ({ f: r.f, y: r.y })));
    if (model) {
      const pred = Math.exp(predictLog(model, rows[i].f));
      if (Number.isFinite(pred) && pred > 0) mApe.push(Math.abs(pred - actual) / actual);
    }
    const med = median(train.map((r) => r.entries));
    if (med !== null) bApe.push(Math.abs(med - actual) / actual);
  }
  return {
    modelMape: mApe.length ? mean(mApe) * 100 : null,
    baselineMape: bApe.length ? mean(bApe) * 100 : null,
  };
}

function tierFor(n: number): ForecastConfidence {
  return n >= HIGH_N ? "high" : n >= MIN_FULL ? "medium" : "low";
}
function widenFor(tier: ForecastConfidence): number {
  return tier === "high" ? 1.0 : tier === "medium" ? 1.2 : 1.5;
}

/**
 * Forecast turnout for `target`, training ONLY on events strictly before `target.event_date`.
 * Degrade ladder: N≤1 → unavailable ("cần thêm dữ liệu"); 2≤N<8 → intercept + log(buy-in) only (low);
 * N≥8 → full ridge. Always returns a band + tier + disclaimer; never a bare number, never NaN.
 */
export function forecastTurnout(events: SeriesEvent[], target: UpcomingEvent): TurnoutForecast {
  const targetTime = new Date(target.event_date).getTime();
  const all = trainRows(events);
  const past = Number.isNaN(targetTime) ? all : all.filter((r) => r.date < targetTime);
  const n = past.length;
  const notes: string[] = [];

  const empty = (note: string): TurnoutForecast => ({
    available: false, base: null, low: null, high: null, confidence: "low", sampleSize: n, degraded: n < MIN_FULL,
    modelMapePct: null, baselineMapePct: null, deltaVsBaselinePct: null, coefContributions: [], missingDataNotes: [note], disclaimer: DISCLAIMER,
  });

  if (n <= 1) return empty(`Chỉ có ${n} giải trước ngày này — cần thêm dữ liệu để dự báo.`);

  const tf = preFeatures(target.buy_in, target.gtd, target.event_date, null, target.typeKeyword);
  if (!tf) return empty("Thông số giải sắp tới chưa hợp lệ (cần buy-in > 0 và ngày hợp lệ).");

  const model = buildModel(past.map((r) => ({ f: r.f, y: r.y })));
  if (!model) return empty("Không dựng được mô hình từ dữ liệu hiện có.");

  const tier = tierFor(n);
  const degraded = !model.useOneHot;
  const yh = predictLog(model, tf);
  const sigma = model.rmse * Math.sqrt(1 + 1 / n) * widenFor(tier);
  const base = Math.round(Math.exp(yh));
  const low = Math.round(Math.exp(yh - Z * sigma));
  const high = Math.round(Math.exp(yh + Z * sigma));

  const { modelMape, baselineMape } = walkForwardCv(past);
  const delta = modelMape !== null && baselineMape !== null ? baselineMape - modelMape : null;

  const coefContributions: CoefContribution[] = model.cols.slice(1).map((feature, i) => {
    const beta = model.beta[i + 1];
    return { feature, beta, impactPct: Math.round((Math.exp(beta) - 1) * 1000) / 10 };
  });

  if (degraded) notes.push(`Ít dữ liệu (${n} giải) — chỉ dùng buy-in, dải nới rộng, chỉ tham khảo.`);
  if (n < HIGH_N) notes.push(`Cần ≥${HIGH_N} giải để đạt độ tin cậy cao (hiện ${n}).`);
  if (tf.logGtd === null) notes.push("Giải sắp tới chưa đặt GTD — overlay sẽ không tính được.");

  return {
    available: true,
    base,
    low: Math.max(0, low),
    high,
    confidence: tier,
    sampleSize: n,
    degraded,
    modelMapePct: modelMape === null ? null : Math.round(modelMape * 10) / 10,
    baselineMapePct: baselineMape === null ? null : Math.round(baselineMape * 10) / 10,
    deltaVsBaselinePct: delta === null ? null : Math.round(delta * 10) / 10,
    coefContributions,
    missingDataNotes: notes,
    disclaimer: DISCLAIMER,
  };
}

// ---------- tiny pure linear algebra ----------
function mean(v: number[]): number {
  return v.length ? v.reduce((a, c) => a + c, 0) / v.length : 0;
}
function std(v: number[], m: number): number {
  if (v.length < 2) return 0;
  return Math.sqrt(v.reduce((a, c) => a + (c - m) * (c - m), 0) / v.length);
}
function median(v: number[]): number | null {
  const s = v.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}
function zeros(r: number, c: number): number[][] {
  return Array.from({ length: r }, () => new Array(c).fill(0));
}
/** Solve SPD A x = b via Cholesky. Returns null if A is not positive-definite. */
function choleskySolve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 1e-12) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  const yv = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * yv[k];
    yv[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = yv[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}
