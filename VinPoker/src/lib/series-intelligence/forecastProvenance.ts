// Series Intelligence — structured forecast provenance (B2, part 2). PURE adapter; no DB, no flag, no wiring.
//
// Gives every forecast a content-addressed identity, split into TWO tiers (review fix P0-2):
//   • PredictorIdentity  → predictorId — STABLE across many forecasts; B1 pools residuals by THIS.
//   • ForecastInputIdentity → per-forecast hashes (target features, training data, the full canonical input).
// The TARGET's own outcome is never hashed (it is the thing predicted, A2 P0-2); a HISTORICAL training row's
// `entries` IS hashed into trainingDataHash, so a corrected historical outcome changes the identity (P0-3).
// Only model-consumed data is hashed — never raw UI labels (P0-4). Timing is a triple, not the event time
// (P0-1): forecast scoring later gates on `actual.publishedAt > asOfTs`, not targetEventTs.
//
// This module does NOT extend ForecastPoint or touch forecastTurnout's output (A2/A5 byte-identity preserved);
// it reuses the same preFeatures + pastTrainRows via turnoutForecast.featureIdentityInputs.

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

/** Three distinct instants (P0-1). The event time is NOT the forecast time. */
export interface ForecastTiming {
  forecastIssuedAt: string; // when the snapshot was created
  asOfTs: string; // information cutoff — data observable up to this instant (features frozen)
  targetEventTs: string; // the target event's scheduled start
}

/** Stable predictor identity — B1 pools residuals by predictorId. */
export interface PredictorIdentity {
  engineVersion: string;
  featureSchemaVersion: string;
  codeSha: string; // "unknown"/"" ⇒ completeness = missing_code_sha (not poolable by B1)
  modelConfigHash: string;
  trialCount: number; // multiple-testing record; a VALIDITY annotation, NOT part of predictorId
}

/** Per-forecast input identity. */
export interface ForecastInputIdentity {
  predictorId: string; // sha256 of {engineVersion, featureSchemaVersion, codeSha, modelConfigHash}
  targetInputHash: string;
  trainingDataHash: string;
  canonicalInputHash: string; // sha256 of {predictorId, targetInputHash, trainingDataHash, timing}
}

export type ProvenanceCompleteness = "complete" | "missing_code_sha" | "legacy" | "manual";
export type ForecastProvenanceKind = "engine" | "manual_override" | "manual";

export interface ForecastProvenance {
  predictor: PredictorIdentity;
  input: ForecastInputIdentity;
  timing: ForecastTiming; // normalized to UTC ISO
  completeness: ProvenanceCompleteness;
  kind: ForecastProvenanceKind;
  derivedFromInputHash: string | null; // manual-override lineage (P1): the engine forecast this edited from
}

export interface BuildProvenanceMeta {
  /** Build-time git sha. Default "unknown" (the snapshot-capture wiring PR resolves it from the build env). */
  codeSha?: string;
  /** Candidate configs evaluated to produce this forecast (multiple-testing record). Default 1. */
  trialCount?: number;
  /** "engine" (default) | "manual_override" (owner edited an engine prefill) | "manual" (hand-typed). */
  kind?: ForecastProvenanceKind;
  /** For manual_override: the canonicalInputHash of the engine forecast it was derived from. */
  derivedFromInputHash?: string | null;
}

/** Normalize an ISO timestamp to canonical UTC ISO so equal instants in different offsets hash identically. */
function canonIso(x: string): string {
  const ms = new Date(x).getTime();
  if (!Number.isFinite(ms)) throw new ProvenanceError(`invalid timing timestamp "${x}"`);
  return new Date(ms).toISOString();
}

/** predictorId = sha256 over the stable predictor fields (NOT trialCount — that annotates validity). */
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

/** Hash the config the model consumes. Floats (lambda/z) stay canonical finite numbers; the booleans/ints are
 *  exact — so calendar/censoring on-vs-off (or a threshold change) yields a different predictorId. */
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
  const codeSha = meta.codeSha ?? "unknown";
  const trialCount = meta.trialCount ?? 1;
  const kind = meta.kind ?? "engine";

  const fii = featureIdentityInputs(events, target, opts);

  const modelConfigHash = await computeModelConfigHash(fii.modelConfig);
  const predictorId = await computePredictorId({
    engineVersion: ENGINE_VERSION,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    codeSha,
    modelConfigHash,
  });

  const targetInputHash = await canonicalHash(fii.targetFeatures ?? null);
  // entries (a count → DB integer) hashed as a DECIMAL STRING (P0-5): a bigint value and its JS-number twin
  // must never diverge. features are log-numerics/codes (no raw money) → left as finite numbers.
  const trainingDataHash = await canonicalHash(
    fii.trainingRows.map((r) => ({
      eventId: r.eventId,
      date: canonIso(r.dateIso),
      entries: String(r.entries),
      features: r.features,
    })),
  );

  const normTiming: ForecastTiming = {
    forecastIssuedAt: canonIso(timing.forecastIssuedAt),
    asOfTs: canonIso(timing.asOfTs),
    targetEventTs: canonIso(timing.targetEventTs),
  };
  const canonicalInputHash = await canonicalHash({
    predictorId,
    targetInputHash,
    trainingDataHash,
    timing: normTiming,
  });

  const completeness: ProvenanceCompleteness =
    kind === "manual" ? "manual" : codeSha === "" || codeSha === "unknown" ? "missing_code_sha" : "complete";

  return {
    predictor: { engineVersion: ENGINE_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION, codeSha, modelConfigHash, trialCount },
    input: { predictorId, targetInputHash, trainingDataHash, canonicalInputHash },
    timing: normTiming,
    completeness,
    kind,
    derivedFromInputHash: meta.derivedFromInputHash ?? null,
  };
}
