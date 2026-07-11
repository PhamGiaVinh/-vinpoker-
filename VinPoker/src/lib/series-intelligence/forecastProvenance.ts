// Series Intelligence — structured forecast provenance (B2). PURE adapter; no DB, no flag, no wiring.
//
// Identity is layered (owner review):
//   • PredictorIdentity → predictorId  — engine/config identity (stable across many forecasts).
//   • calibrationPoolId = hash(predictorId, trialCount, selectionProtocolId) — B1 pools residuals by THIS
//     (NOT predictorId alone), and only when the forecast is forecastIdentityEligible.
//   • inputContentHash — the semantic input identity, EXCLUDING forecastIssuedAt.
//   • forecastInstanceId = hash(inputContentHash, forecastIssuedAt) — same input issued twice ⇒ same
//     inputContentHash, different forecastInstanceId.
//
// A kind=manual forecast is a hand-typed number: it has NO engine/training identity (no predictorId, no pool
// id, no target/training hashes) and is never forecast-identity-eligible. kind=engine and kind=manual_override
// both carry the engine input hashes (manual_override additionally keeps its engine lineage via
// derivedFromInputHash), but only a pure engine forecast is forecast-identity-eligible.
//
// forecastIdentityEligible is a B2-SIDE gate only. Final B1 calibration eligibility ADDITIONALLY requires a
// current final/revised B3 actual revision published after asOfTs — no B2 boolean alone implies a residual is
// calibration-ready.
//
// Truthfulness + fail-closed (all throw ProvenanceError with a stable `code`): asOfTs truthful (no
// training/calendar/edition input later than asOfTs ⇒ AS_OF_INPUT_MISMATCH — REJECT, never silently filter);
// timing.targetEventTs must match target.event_date (TARGET_TIME_MISMATCH); asOfTs<=forecastIssuedAt; trialCount
// a positive integer; codeSha normalized+validated; selectionProtocolId trimmed+LOWERCASED+validated (casing can
// never mint a second pool); target.capacity enters targetInputHash when (and only when) censoring caps the band
// (non-finite capacity ⇒ INVALID_CAPACITY); manual_override requires a 64-hex derivedFromInputHash, engine/manual
// forbid it.
//
// Does NOT extend ForecastPoint or touch forecastTurnout's output (A2/A5 byte-identity preserved).

import type { SeriesEvent } from "./nativeData";
import {
  ENGINE_VERSION,
  featureIdentityInputs,
  type UpcomingEvent,
  type ForecastOptions,
  type ProvenanceModelConfig,
} from "./turnoutForecast";
import { FEATURE_SCHEMA_VERSION } from "./featureBoundary";
import { canonicalHash, ProvenanceError } from "./provenanceHash";

export const HASH_ALGORITHM = "sha256";
/** The model-selection protocol for a plain, single-config forecast (no tuning / no peeking). */
export const SELECTION_PROTOCOL_DIRECT = "direct-1";

/** Three distinct instants (review P0-1). The event time is NOT the forecast time. */
export interface ForecastTiming {
  forecastIssuedAt: string; // when the snapshot was created
  asOfTs: string; // information cutoff — data observable up to this instant (features frozen)
  targetEventTs: string; // the target event's scheduled start (must equal target.event_date)
}

/** Stable predictor identity. predictorId hashes only engine/config; the pool key adds trialCount + protocol. */
export interface PredictorIdentity {
  engineVersion: string;
  featureSchemaVersion: string;
  codeSha: string; // normalized; "unknown" ⇒ completeness missing_code_sha (not eligible)
  modelConfigHash: string;
  trialCount: number; // multiple-testing record (positive integer)
  selectionProtocolId: string; // how the predictor was selected (direct vs a tuning protocol)
}

export interface ForecastIdentity {
  predictorId: string; // sha256({engineVersion, featureSchemaVersion, codeSha, modelConfigHash})
  calibrationPoolId: string; // sha256({predictorId, trialCount, selectionProtocolId}) — B1 pools by THIS
  targetInputHash: string;
  trainingDataHash: string;
  inputContentHash: string; // sha256({predictorId, targetInputHash, trainingDataHash, asOfTs, targetEventTs}) — NO issuedAt
  forecastInstanceId: string; // sha256({inputContentHash, forecastIssuedAt})
}

export type ProvenanceCompleteness = "complete" | "missing_code_sha" | "legacy" | "manual";
export type ForecastProvenanceKind = "engine" | "manual_override" | "manual";

/** Engine-derived (kind=engine) or engine-lineage-carrying (kind=manual_override) provenance — has hashes. */
export interface EngineForecastProvenance {
  kind: "engine" | "manual_override";
  predictor: PredictorIdentity;
  input: ForecastIdentity;
  timing: ForecastTiming; // normalized to UTC ISO
  completeness: "complete" | "missing_code_sha";
  /** B2-side gate: kind=engine + complete codeSha + valid trialCount. NOT sufficient for B1 (needs a B3 actual). */
  forecastIdentityEligible: boolean;
  derivedFromInputHash: string | null; // 64-hex for manual_override; null for engine
}
/** A hand-typed forecast — NO engine/training identity, never forecast-identity-eligible. */
export interface ManualForecastProvenance {
  kind: "manual";
  predictor: null;
  input: null;
  timing: ForecastTiming;
  completeness: "manual";
  forecastIdentityEligible: false;
  derivedFromInputHash: null;
}
export type ForecastProvenance = EngineForecastProvenance | ManualForecastProvenance;

export interface BuildProvenanceMeta {
  codeSha?: string; // build-time git sha; default "unknown" (resolved by the wiring PR)
  trialCount?: number; // positive integer; default 1
  selectionProtocolId?: string; // default SELECTION_PROTOCOL_DIRECT
  kind?: ForecastProvenanceKind; // default "engine"
  derivedFromInputHash?: string | null; // REQUIRED (64-hex) for manual_override; FORBIDDEN otherwise
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Type guard: engine or manual_override provenance (carries engine identity hashes). */
export function isEngineProvenance(p: ForecastProvenance): p is EngineForecastProvenance {
  return p.kind !== "manual";
}

/** B2-side eligibility: only a pure engine forecast with a complete codeSha + valid trialCount. NOT the final
 *  B1 gate (B1 additionally needs a current final/revised B3 actual published after asOfTs). */
export function isForecastIdentityEligible(p: ForecastProvenance): boolean {
  return (
    p.kind === "engine" &&
    p.completeness === "complete" &&
    p.predictor !== null &&
    Number.isInteger(p.predictor.trialCount) &&
    p.predictor.trialCount >= 1
  );
}

/** Normalize + validate a git sha. "" / "unknown" ⇒ "unknown"; else must be 7–64 lowercase hex. */
function normalizeCodeSha(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "unknown") return "unknown";
  if (!/^[0-9a-f]{7,64}$/.test(s)) throw new ProvenanceError(`invalid codeSha ${JSON.stringify(raw)}`, "INVALID_CODE_SHA");
  return s;
}

/** Canonicalize + validate a selection-protocol id as a stable machine identifier. Trim + LOWERCASE so
 *  casing can never accidentally mint a second calibration pool (e.g. "Direct-1" and "direct-1" collapse to
 *  the same id). Enforce a strict, length-capped shape. */
function normalizeSelectionProtocol(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(s)) {
    throw new ProvenanceError(`invalid selectionProtocolId ${JSON.stringify(raw)}`, "INVALID_SELECTION_PROTOCOL");
  }
  return s;
}

/** Normalize an ISO timestamp to canonical UTC ISO; return {iso, ms}. Fails closed on an unparseable date. */
function canonTime(x: string, label: string): { iso: string; ms: number } {
  const ms = new Date(x).getTime();
  if (!Number.isFinite(ms)) throw new ProvenanceError(`invalid ${label} timestamp ${JSON.stringify(x)}`, "INVALID_TIMESTAMP");
  return { iso: new Date(ms).toISOString(), ms };
}

/** The target's capacity as it can ACTUALLY affect the forecast output, mirroring the engine contract
 *  (turnoutForecast: the band is capped only when `censoring` is on AND `capacity != null && capacity > 0`).
 *  ⇒ censoring off, or a null / non-positive capacity, cannot move the output ⇒ hashes as null (identity must
 *  not change when the output cannot). A non-finite capacity (NaN/Infinity) can never be a valid seat count and
 *  is a data bug ⇒ fail closed (INVALID_CAPACITY) rather than silently hashing it. */
function effectiveTargetCapacity(opts: ForecastOptions, target: UpcomingEvent): number | null {
  if (opts.censoring !== true) return null;
  const cap = target.capacity;
  if (cap == null) return null;
  if (typeof cap !== "number" || !Number.isFinite(cap)) {
    throw new ProvenanceError(`invalid target.capacity ${JSON.stringify(cap)}`, "INVALID_CAPACITY");
  }
  return cap > 0 ? cap : null; // engine caps only on a positive capacity
}

const eventMs = (e: SeriesEvent): number | null => {
  if (!e.event_date) return null;
  const ms = new Date(e.event_date).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** predictorId = sha256 over the stable predictor fields (NOT trialCount / protocol — those key the pool). */
export async function computePredictorId(p: {
  engineVersion: string;
  featureSchemaVersion: string;
  codeSha: string;
  modelConfigHash: string;
}): Promise<string> {
  return canonicalHash({
    engineVersion: p.engineVersion,
    featureSchemaVersion: p.featureSchemaVersion,
    codeSha: p.codeSha,
    modelConfigHash: p.modelConfigHash,
  });
}

/** Hash the config the model consumes (floats stay canonical finite numbers; booleans/ints exact). */
export async function computeModelConfigHash(cfg: ProvenanceModelConfig): Promise<string> {
  return canonicalHash({
    calendarFeatures: cfg.calendarFeatures,
    censoring: cfg.censoring,
    lambda: cfg.lambda,
    z: cfg.z,
    fullFeatureThreshold: cfg.fullFeatureThreshold,
    highNThreshold: cfg.highNThreshold,
    minTrainLength: cfg.minTrainLength,
  });
}

/**
 * Build the structured provenance for the forecast of `target` from `events` under `opts`. Pure + async.
 * (Deviation from the plan's `(events, target, opts, forecastPoint, timing)`: `forecastPoint` is dropped —
 * its only identity-relevant field is engineVersion, a constant, and the forecast OUTPUT must never enter
 * identity; timing is passed explicitly instead.)
 */
export async function buildForecastProvenance(
  events: SeriesEvent[],
  target: UpcomingEvent,
  opts: ForecastOptions,
  timing: ForecastTiming,
  meta: BuildProvenanceMeta = {},
): Promise<ForecastProvenance> {
  const kind = meta.kind ?? "engine";
  const derivedFromInputHash = meta.derivedFromInputHash ?? null;

  // --- timing normalization + consistency (ALL kinds) ---
  const issued = canonTime(timing.forecastIssuedAt, "forecastIssuedAt");
  const asOf = canonTime(timing.asOfTs, "asOfTs");
  const targetTs = canonTime(timing.targetEventTs, "targetEventTs");
  if (asOf.ms > issued.ms) throw new ProvenanceError("asOfTs must be <= forecastIssuedAt", "AS_OF_AFTER_ISSUED");
  const targetDateMs = new Date(target.event_date).getTime();
  if (!Number.isFinite(targetDateMs)) {
    throw new ProvenanceError(`invalid target.event_date ${JSON.stringify(target.event_date)}`, "INVALID_TIMESTAMP");
  }
  if (targetDateMs !== targetTs.ms) {
    throw new ProvenanceError(
      `timing.targetEventTs (${targetTs.iso}) does not match target.event_date`,
      "TARGET_TIME_MISMATCH",
    );
  }
  const normTiming: ForecastTiming = { forecastIssuedAt: issued.iso, asOfTs: asOf.iso, targetEventTs: targetTs.iso };

  // --- derivedFromInputHash pairing (ALL kinds) ---
  if (kind === "manual_override") {
    if (derivedFromInputHash === null || !HEX64.test(derivedFromInputHash)) {
      throw new ProvenanceError("manual_override requires a valid 64-hex derivedFromInputHash", "INVALID_DERIVED_FROM");
    }
  } else if (derivedFromInputHash !== null) {
    throw new ProvenanceError(`${kind} must not carry derivedFromInputHash`, "UNEXPECTED_DERIVED_FROM");
  }

  // --- MANUAL: no engine/training identity is built (fix 1) ---
  if (kind === "manual") {
    return {
      kind: "manual",
      predictor: null,
      input: null,
      timing: normTiming,
      completeness: "manual",
      forecastIdentityEligible: false,
      derivedFromInputHash: null,
    };
  }

  // --- ENGINE | MANUAL_OVERRIDE: build the engine identity ---
  const codeSha = normalizeCodeSha(meta.codeSha ?? "unknown");
  const trialCount = meta.trialCount ?? 1;
  if (!Number.isInteger(trialCount) || trialCount < 1) {
    throw new ProvenanceError(`trialCount must be a positive integer, got ${trialCount}`, "INVALID_TRIAL_COUNT");
  }
  const selectionProtocolId = normalizeSelectionProtocol(meta.selectionProtocolId ?? SELECTION_PROTOCOL_DIRECT);

  const fii = featureIdentityInputs(events, target, opts);

  // asOfTs truthfulness — the model actually ran here. (a) the fit: every training row observable by asOfTs;
  // (b) the target's calendar/edition feature recomputed with only events observable by asOfTs must match.
  for (const r of fii.trainingRows) {
    if (new Date(r.dateIso).getTime() > asOf.ms) {
      throw new ProvenanceError(
        `training input ${r.eventId} (${r.dateIso}) is later than asOfTs ${asOf.iso}`,
        "AS_OF_INPUT_MISMATCH",
      );
    }
  }
  const eventsAsOf = events.filter((e) => {
    const ms = eventMs(e);
    return ms !== null && ms <= asOf.ms;
  });
  const fiiAsOf = featureIdentityInputs(eventsAsOf, target, opts);
  if (JSON.stringify(fii.targetFeatures) !== JSON.stringify(fiiAsOf.targetFeatures)) {
    throw new ProvenanceError("target calendar/edition feature used an input later than asOfTs", "AS_OF_INPUT_MISMATCH");
  }

  const modelConfigHash = await computeModelConfigHash(fii.modelConfig);
  const predictorId = await computePredictorId({
    engineVersion: ENGINE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    codeSha,
    modelConfigHash,
  });
  const calibrationPoolId = await canonicalHash({ predictorId, trialCount, selectionProtocolId });

  // targetInputHash covers EVERY target input that can change the output: the admitted feature vector AND the
  // target capacity when censoring caps the band (else null — see effectiveTargetCapacity).
  const targetInputHash = await canonicalHash({
    features: fii.targetFeatures ?? null,
    capacity: effectiveTargetCapacity(opts, target),
  });
  const trainingDataHash = await canonicalHash(
    fii.trainingRows.map((r) => ({
      eventId: r.eventId,
      date: canonTime(r.dateIso, "trainingRow.date").iso,
      entries: String(r.entries), // count as a decimal string (P0-5)
      features: r.features,
    })),
  );
  const inputContentHash = await canonicalHash({
    predictorId,
    targetInputHash,
    trainingDataHash,
    asOfTs: normTiming.asOfTs,
    targetEventTs: normTiming.targetEventTs,
  });
  const forecastInstanceId = await canonicalHash({ inputContentHash, forecastIssuedAt: normTiming.forecastIssuedAt });

  const completeness: "complete" | "missing_code_sha" = codeSha === "unknown" ? "missing_code_sha" : "complete";

  return {
    kind, // "engine" | "manual_override"
    predictor: { engineVersion: ENGINE_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION, codeSha, modelConfigHash, trialCount, selectionProtocolId },
    input: { predictorId, calibrationPoolId, targetInputHash, trainingDataHash, inputContentHash, forecastInstanceId },
    timing: normTiming,
    completeness,
    forecastIdentityEligible: kind === "engine" && completeness === "complete", // manual_override never eligible
    derivedFromInputHash,
  };
}
