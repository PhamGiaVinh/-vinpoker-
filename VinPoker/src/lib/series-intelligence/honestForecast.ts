// Series Intelligence — Honest insufficient-data adapter (A4b, final item of Quant Apply Wave 1).
//
// A view-model AROUND forecastTurnout — it does NOT change forecastTurnout's public output. It maps the
// EXISTING forecast + the A4a capability gate + the A3 baseline battery into one honest, discriminated result
// so the UI never renders a fabricated "0 khách" and never invents "maximum uncertainty". When the
// seriesInsufficientDataUx flag is OFF this adapter is simply not called, so output + UI stay byte-identical.
//
// Reuses A4a (evaluateModelCapability — no duplicated n<=1 / n<8 / n>=12 ladder) and A3 (the baseline battery —
// no second median / naive implementation). The status is driven by the model's OWN availability (fc.available,
// itself capability-gated inside forecastTurnout) plus whether any honest baseline exists.

import { type TurnoutForecast } from "./turnoutForecast";
import { evaluateModelCapability, type CapabilityReason } from "./modelCapability";
import { type BaselineBatteryResult, type BaselineId } from "./baselineBattery";

export type ExistingForecastOutput = TurnoutForecast;

/** A single simple baseline surfaced as an honest reference (never dressed up as the model). */
export interface BaselineSummary {
  baselineId: BaselineId;
  forecast: number; // the baseline's point prediction for the upcoming event ("X khách")
  foldCount: number; // walk-forward folds it was scored on (0 = not yet validated, shown honestly)
}

export type HonestForecastStatus = "unavailable" | "baseline_only" | "full_model";

export type HonestForecastResult =
  | { status: "unavailable"; reasons: readonly CapabilityReason[]; forecast: null; baseline: null }
  | { status: "baseline_only"; reasons: readonly CapabilityReason[]; forecast: null; baseline: BaselineSummary }
  | {
      status: "full_model";
      reasons: readonly CapabilityReason[];
      forecast: ExistingForecastOutput;
      baseline: BaselineSummary | null;
    };

/**
 * Pick the most-defensible AVAILABLE baseline from the A3 battery: the battery's best (lowest walk-forward
 * MAPE, folds > 0) when there is one; otherwise the first baseline (registry order) that has a non-null
 * point prediction (folds may be 0 — e.g. only 1 prior event). Returns null when no baseline is available.
 * Pure; reuses A3 outputs only (no new median/naive).
 */
export function bestAvailableBaseline(battery: BaselineBatteryResult | null): BaselineSummary | null {
  if (!battery) return null;
  const summarise = (id: BaselineId): BaselineSummary | null => {
    const t = battery.targets.find((x) => x.baselineId === id);
    if (!t || t.forecast === null) return null;
    const s = battery.scores.find((x) => x.baselineId === id);
    return { baselineId: id, forecast: t.forecast, foldCount: s?.foldCount ?? 0 };
  };
  if (battery.bestBaselineId) {
    const best = summarise(battery.bestBaselineId);
    if (best) return best;
  }
  for (const t of battery.targets) {
    const s = summarise(t.baselineId);
    if (s) return s;
  }
  return null;
}

/**
 * Adapt the existing forecast into an honest, discriminated result. Pure + deterministic; mutates nothing.
 *   • model produced a forecast (fc.available)          → full_model (+ optional baseline reference)
 *   • model unavailable but a baseline exists            → baseline_only (never a fabricated 0)
 *   • no usable history / no baseline                    → unavailable
 * `reasons` come from the A4a capability gate (machine-readable, mapped to plain Vietnamese in the UI).
 */
export function toHonestForecastResult(
  fc: ExistingForecastOutput,
  battery: BaselineBatteryResult | null,
): HonestForecastResult {
  // sampleSize is forecastTurnout's own past-event count — feed it to the SAME gate the model uses.
  const reasons = evaluateModelCapability({ kind: "sample_size", sampleSize: fc.sampleSize }).reasons;

  if (fc.available) {
    return { status: "full_model", reasons, forecast: fc, baseline: bestAvailableBaseline(battery) };
  }
  const baseline = bestAvailableBaseline(battery);
  if (baseline) {
    return { status: "baseline_only", reasons, forecast: null, baseline };
  }
  return { status: "unavailable", reasons, forecast: null, baseline: null };
}
