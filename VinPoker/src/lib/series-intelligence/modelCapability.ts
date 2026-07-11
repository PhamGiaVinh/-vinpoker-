// Series Intelligence — Model capability gate (A4a).
//
// ONE typed home for every sample-size / data-capability threshold the turnout forecast and the overlay
// engines use. Before A4a these were expressed inline in several places (n<=1, n<MIN_FULL, n>=MIN_FULL,
// n>=HIGH_N, the walk-forward fold minimum, and the overlay input-completeness guards). This module
// centralises the CONSTANTS and the sample-size → capability mapping so no caller re-derives them.
//
// A4a is a PURE STRUCTURAL REFACTOR: it changes no number, quantile, warning, fallback, UI state, or error.
// Every caller reads the same boolean it used to compute inline. Insufficient-data BEHAVIOUR — new statuses
// (unavailable / baseline_only), maximum-uncertainty, EmptyExplainer, new copy — is A4b and is NOT here.

/** Canonical thresholds — the single source of truth (were local consts in turnoutForecast). */
export const FULL_FEATURE_THRESHOLD = 8; // MIN_FULL: ≥ this ⇒ full ridge with one-hot; below ⇒ intercept + log(buy-in)
export const HIGH_N_THRESHOLD = 12; // HIGH_N: ≥ this ⇒ "high" tier (also the Phase-5 data gate)
export const MIN_TRAIN_LENGTH = 4; // CV_MIN_TRAIN: a walk-forward fold needs ≥ this many past events to fit

export type CapabilityLevel = "no_data" | "minimal" | "reduced" | "full";

export type CapabilityReason =
  | "NO_HISTORY"
  | "INSUFFICIENT_TRAINING_ROWS"
  | "FULL_FEATURE_THRESHOLD_NOT_MET"
  | "OVERLAY_INPUT_INCOMPLETE";

export interface ModelCapability {
  level: CapabilityLevel;
  sampleSize: number;
  minTrainLength: number;
  highNThreshold: number;
  /** turnout: n > 1 (NOT n<=1 ⇒ unavailable). overlay: inputs complete. */
  supportsForecast: boolean;
  /** turnout: n >= FULL_FEATURE_THRESHOLD (the one-hot / full-ridge tier). */
  supportsFullFeatures: boolean;
  reasons: readonly CapabilityReason[];
}

/**
 * Evaluator input.
 *   • `sample_size`   — the turnout forecast's past-events ladder (the primary capability gate).
 *   • `overlay_inputs`— the overlay engines' usability guard. Overlay has NO sample-size ladder (it runs with
 *     ≥1 usable observation), so it is expressed purely as an input-completeness boolean.
 */
export type EvaluateCapabilityInput =
  | {
      kind: "sample_size";
      sampleSize: number;
      minTrainLength?: number;
      fullFeatureThreshold?: number;
      highNThreshold?: number;
    }
  | { kind: "overlay_inputs"; inputsComplete: boolean };

/**
 * The single canonical capability evaluator. Pure and deterministic: it does not mutate its input and returns
 * a fresh, frozen-reasons ModelCapability. Preserves the exact pre-A4a thresholds — supportsForecast === n>1,
 * supportsFullFeatures === n>=FULL_FEATURE_THRESHOLD — so callers behave byte-identically.
 */
export function evaluateModelCapability(input: EvaluateCapabilityInput): ModelCapability {
  if (input.kind === "overlay_inputs") {
    // Overlay usability is a pure input-completeness gate — no sample-size ladder. Complete ⇒ the sim runs;
    // incomplete ⇒ the engines' existing `usable:false` early-return, now named OVERLAY_INPUT_INCOMPLETE.
    const reasons: CapabilityReason[] = input.inputsComplete ? [] : ["OVERLAY_INPUT_INCOMPLETE"];
    return {
      level: input.inputsComplete ? "full" : "no_data",
      sampleSize: 0,
      minTrainLength: MIN_TRAIN_LENGTH,
      highNThreshold: HIGH_N_THRESHOLD,
      supportsForecast: input.inputsComplete,
      supportsFullFeatures: false,
      reasons: Object.freeze(reasons),
    };
  }

  const n = input.sampleSize;
  const minTrainLength = input.minTrainLength ?? MIN_TRAIN_LENGTH;
  const fullFeatureThreshold = input.fullFeatureThreshold ?? FULL_FEATURE_THRESHOLD;
  const highNThreshold = input.highNThreshold ?? HIGH_N_THRESHOLD;

  const supportsForecast = n > 1; // preserves forecastTurnout's `n <= 1 ⇒ unavailable`
  const supportsFullFeatures = n >= fullFeatureThreshold; // preserves `n >= MIN_FULL ⇒ one-hot`

  let level: CapabilityLevel;
  const reasons: CapabilityReason[] = [];
  if (n <= 1) {
    level = "no_data";
    reasons.push("NO_HISTORY");
  } else if (n < minTrainLength) {
    level = "minimal"; // can forecast (degraded), but below the walk-forward fold minimum ⇒ no CV folds
    reasons.push("INSUFFICIENT_TRAINING_ROWS");
  } else if (n < fullFeatureThreshold) {
    level = "reduced"; // CV folds run, but below the full-feature (one-hot) tier
    reasons.push("FULL_FEATURE_THRESHOLD_NOT_MET");
  } else {
    level = "full";
  }

  return {
    level,
    sampleSize: n,
    minTrainLength,
    highNThreshold,
    supportsForecast,
    supportsFullFeatures,
    reasons: Object.freeze(reasons),
  };
}
