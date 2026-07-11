// Series Intelligence — structured forecast provenance (B2, part 2). PURE adapter; no DB, no flag, no wiring.
//
// Identity is layered (owner review):
//   • PredictorIdentity → predictorId  — engine/config identity (stable across many forecasts).
//   • calibrationPoolId = hash(predictorId, trialCount, selectionProtocolId) — B1 pools residuals by THIS
//     (NOT predictorId alone), and only when the forecast is calibrationEligible.
//   • inputContentHash — the semantic input identity, EXCLUDING forecastIssuedAt.
//   • forecastInstanceId = hash(inputContentHash, forecastIssuedAt) — same input issued twice ⇒ same
//     inputContentHash, different forecastInstanceId.
//
// Truthfulness + fail-closed rules (all throw ProvenanceError with a stable `code`):
//   • asOfTs must be truthful: any model-consumed training / calendar / edition input later than asOfTs ⇒
//     AS_OF_INPUT_MISMATCH (we REJECT, we never silently filter the provenance copy while the forecast used more).
//   • trialCount must be a positive integer; asOfTs <= forecastIssuedAt; manual_override requires a valid
//     64-hex derivedFromInputHash; engine/manual must NOT carry derivedFromInputHash; codeSha normalized+validated.
//   • The TARGET's own outcome is never hashed (A2 P0-2); a HISTORICAL training row's entries IS (P0-3);
//     only model-consumed data is hashed, never UI labels (P0-4).
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
  targetEventTs: string; // the target event's scheduled start
}

/** Stable predictor identity. predictorId hashes only engine/config; the pool key adds trialCount + protocol. */
export interface PredictorIdentity {
  engineVersion: string;
  featureSchemaVersion: string;
  codeSha: string; // normalized; "unknown" ⇒ completeness missing_code_sha (not poolable)
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

export interface ForecastProvenance {
  predictor: PredictorIdentity;
  input: ForecastIdentity;
  timing: ForecastTiming; // normalized to UTC ISO
  completeness: ProvenanceCompleteness;
  /** Only an engine forecast with a complete codeSha + valid trialCount may enter a B1 calibration pool. */
  calibrationEligible: boolean;
  kind: ForecastProvenanceKind;
  derivedFromInputHash: string | null; // manual-override lineage (P1)
}

export interface BuildProvenanceMeta {
  /** Build-time git sha. Default "unknown" (the snapshot-capture wiring PR resolves it from the build env). */
  codeSha?: string;
  /** Candidate configs evaluated to produce this forecast (positive integer; multiple-testing record). Default 1. */
  trialCount?: number;
  /** Model-selection protocol id. Default SELECTION_PROTOCOL_DIRECT. */
  selectionProtocolId?: string;
  /** "engine" (default) | "manual_override" (owner edited an engine prefill) | "manual" (hand-typed). */
  kind?: ForecastProvenanceKind;
  /** REQUIRED (64-hex) for manual_override; FORBIDDEN for engine/manual. */
  derivedFromInputHash?: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** True iff a forecast provenance may enter a B1 calibration pool: engine + complete codeSha + valid trialCount. */
export function isCalibrationEligible(p: ForecastProvenance): boolean {
  return (
    p.kind === "engine" &&
    p.completeness === "complete" &&
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

/** Normalize an ISO timestamp to canonical UTC ISO; return {iso, ms}. Fails closed on an unparseable date. */
function canonTime(x: string, label: string): { iso: string; ms: number } {
  const ms = new Date(x).getTime();
  if (!Number.isFinite(ms)) throw new ProvenanceError(`invalid ${label} timestamp ${JSON.stringify(x)}`, "INVALID_TIMESTAMP");
  return { iso: new Date(ms).toISOString(), ms };
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
 * Build the structured provenance for the forecast of `target` from `events` under `opts`. Pure + async
 * (SHA-256). Reuses the SAME feature/training inputs the forecast uses (turnoutForecast.featureIdentityInputs).
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
  const codeSha = normalizeCodeSha(meta.codeSha ?? "unknown"); // fail closed on a malformed sha
  const trialCount = meta.trialCount ?? 1;
  if (!Number.isInteger(trialCount) || trialCount < 1) {
    throw new ProvenanceError(`trialCount must be a positive integer, got ${trialCount}`, "INVALID_TRIAL_COUNT");
  }
  const selectionProtocolId = meta.selectionProtocolId ?? SELECTION_PROTOCOL_DIRECT;

  // derivedFromInputHash pairing: required (64-hex) for manual_override, forbidden otherwise.
  const derivedFromInputHash = meta.derivedFromInputHash ?? null;
  if (kind === "manual_override") {
    if (derivedFromInputHash === null || !HEX64.test(derivedFromInputHash)) {
      throw new ProvenanceError("manual_override requires a valid 64-hex derivedFromInputHash", "INVALID_DERIVED_FROM");
    }
  } else if (derivedFromInputHash !== null) {
    throw new ProvenanceError(`${kind} must not carry derivedFromInputHash`, "UNEXPECTED_DERIVED_FROM");
  }

  const issued = canonTime(timing.forecastIssuedAt, "forecastIssuedAt");
  const asOf = canonTime(timing.asOfTs, "asOfTs");
  const targetEvent = canonTime(timing.targetEventTs, "targetEventTs");
  if (asOf.ms > issued.ms) {
    throw new ProvenanceError("asOfTs must be <= forecastIssuedAt", "AS_OF_AFTER_ISSUED");
  }
  const normTiming: ForecastTiming = { forecastIssuedAt: issued.iso, asOfTs: asOf.iso, targetEventTs: targetEvent.iso };

  const fii = featureIdentityInputs(events, target, opts);

  // asOfTs truthfulness — only meaningful when the model actually ran (engine / manual_override). A pure
  // hand-typed manual forecast consumed no training input, so there is nothing to be later than asOfTs.
  if (kind !== "manual") {
    // (a) the fit: every training row must be observable by asOfTs — reject (never silently drop) otherwise.
    for (const r of fii.trainingRows) {
      const ms = new Date(r.dateIso).getTime();
      if (ms > asOf.ms) {
        throw new ProvenanceError(
          `training input ${r.eventId} (${r.dateIso}) is later than asOfTs ${asOf.iso}`,
          "AS_OF_INPUT_MISMATCH",
        );
      }
    }
    // (b) the target's calendar/edition feature: recompute it using ONLY events observable by asOfTs; if that
    // differs from what the forecast used (all events), a post-asOfTs edition leaked into the target feature.
    const eventsAsOf = events.filter((e) => {
      const ms = eventMs(e);
      return ms !== null && ms <= asOf.ms;
    });
    const fiiAsOf = featureIdentityInputs(eventsAsOf, target, opts);
    if (JSON.stringify(fii.targetFeatures) !== JSON.stringify(fiiAsOf.targetFeatures)) {
      throw new ProvenanceError("target calendar/edition feature used an input later than asOfTs", "AS_OF_INPUT_MISMATCH");
    }
  }

  const modelConfigHash = await computeModelConfigHash(fii.modelConfig);
  const predictorId = await computePredictorId({
    engineVersion: ENGINE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    codeSha,
    modelConfigHash,
  });
  const calibrationPoolId = await canonicalHash({ predictorId, trialCount, selectionProtocolId });

  const targetInputHash = await canonicalHash(fii.targetFeatures ?? null);
  // entries (a count → DB integer) hashed as a DECIMAL STRING (P0-5). features are log-numerics/codes (no raw
  // money) → left as finite numbers.
  const trainingDataHash = await canonicalHash(
    fii.trainingRows.map((r) => ({
      eventId: r.eventId,
      date: canonTime(r.dateIso, "trainingRow.date").iso,
      entries: String(r.entries),
      features: r.features,
    })),
  );

  // inputContentHash EXCLUDES forecastIssuedAt (semantic content only); forecastInstanceId adds it.
  const inputContentHash = await canonicalHash({
    predictorId,
    targetInputHash,
    trainingDataHash,
    asOfTs: normTiming.asOfTs,
    targetEventTs: normTiming.targetEventTs,
  });
  const forecastInstanceId = await canonicalHash({ inputContentHash, forecastIssuedAt: normTiming.forecastIssuedAt });

  const completeness: ProvenanceCompleteness =
    kind === "manual" ? "manual" : codeSha === "unknown" ? "missing_code_sha" : "complete";

  const provenance: ForecastProvenance = {
    predictor: {
      engineVersion: ENGINE_VERSION,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      codeSha,
      modelConfigHash,
      trialCount,
      selectionProtocolId,
    },
    input: { predictorId, calibrationPoolId, targetInputHash, trainingDataHash, inputContentHash, forecastInstanceId },
    timing: normTiming,
    completeness,
    calibrationEligible: false, // set below via the single source of truth
    kind,
    derivedFromInputHash,
  };
  return { ...provenance, calibrationEligible: isCalibrationEligible(provenance) };
}
