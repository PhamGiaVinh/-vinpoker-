import type { DecisionTargetMetric, EventActualRevision } from "./decisionPacketV1";
import {
  resolveForecastActualScoringPairV1,
  type ForecastActualScoringBlockReason,
} from "./decisionPacketReadModel";
import { canonicalHash } from "./provenanceHash";
import {
  FORECAST_EVALUATION_CONTRACT_VERSION,
  POINT_ESTIMATE_SEMANTICS,
  SCORING_ELIGIBILITY_CONTRACT_VERSION,
  type ExactCountInput,
  type ForecastEvaluationBlockReason,
  type ForecastEvaluationForecastInput,
  type SeriesForecastEvaluationBlockedV1,
  type SeriesForecastEvaluationResult,
  type SeriesForecastEvaluationV1,
} from "./forecastEvaluationTypes";
import type { ForecastEvaluationInput } from "./forecastEvaluationTypes";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function normalizeExactCount(value: ExactCountInput, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} must be non-negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a safe non-negative integer`);
    return BigInt(value);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be a decimal integer`);
  return BigInt(value);
}

function countMetricValue(actual: EventActualRevision, targetMetric: DecisionTargetMetric): number | null {
  if (targetMetric === "entries") return actual.metrics.entries.value;
  if (targetMetric === "unique_players") return actual.metrics.uniquePlayers.value;
  return actual.metrics.totalBullets.value;
}

function pushUnique(reasons: ForecastEvaluationBlockReason[], reason: ForecastEvaluationBlockReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function blocked(
  input: ForecastEvaluationInput,
  reasons: readonly ForecastEvaluationBlockReason[],
  sourceState: "d2b" | "kernel" = "d2b",
): SeriesForecastEvaluationBlockedV1 {
  return deepFreeze({
    kind: "blocked",
    lifecycle: "blocked",
    evaluationId: null,
    contractVersion: FORECAST_EVALUATION_CONTRACT_VERSION,
    scoringEligibilityContractVersion: input.scoringEligibilityContractVersion ?? SCORING_ELIGIBILITY_CONTRACT_VERSION,
    clubId: input.packet?.packet.clubId ?? input.forecast?.clubId ?? null,
    eventId: input.packet?.packet.eventId ?? input.forecast?.eventId ?? null,
    packetId: input.packet?.packetId ?? null,
    targetMetric: input.packet?.packet.targetMetric ?? input.forecast?.targetMetric ?? null,
    horizon: input.packet?.packet.horizon ?? null,
    blockReasons: [...reasons],
    sourceState,
  });
}

function blockFromD2b(input: ForecastEvaluationInput, reasons: readonly ForecastActualScoringBlockReason[]): SeriesForecastEvaluationBlockedV1 {
  return blocked(input, reasons as readonly ForecastEvaluationBlockReason[]);
}

function bandFor(
  forecast: ForecastEvaluationForecastInput,
  pointEstimate: bigint,
  actual: bigint,
): { band: SeriesForecastEvaluationV1["band"] } | { reason: "invalid_forecast_band" } {
  const lowProvided = forecast.low !== null;
  const highProvided = forecast.high !== null;
  if (!lowProvided || !highProvided) {
    return {
      band: {
        available: false,
        semantics: forecast.bandSemantics,
        low: lowProvided ? normalizeExactCount(forecast.low as ExactCountInput, "forecast low").toString() : null,
        high: highProvided ? normalizeExactCount(forecast.high as ExactCountInput, "forecast high").toString() : null,
        width: null,
        actualInsideBand: null,
        belowBandBy: null,
        aboveBandBy: null,
        unavailableReason: "missing_bound",
      },
    };
  }
  const low = normalizeExactCount(forecast.low as ExactCountInput, "forecast low");
  const high = normalizeExactCount(forecast.high as ExactCountInput, "forecast high");
  if (low > high || low > pointEstimate || pointEstimate > high) return { reason: "invalid_forecast_band" };
  if (forecast.bandSemantics === null || forecast.bandSemantics === "unknown") {
    return {
      band: {
        available: false,
        semantics: forecast.bandSemantics,
        low: low.toString(),
        high: high.toString(),
        width: null,
        actualInsideBand: null,
        belowBandBy: null,
        aboveBandBy: null,
        unavailableReason: "semantics_unknown",
      },
    };
  }
  const below = actual < low ? low - actual : 0n;
  const above = actual > high ? actual - high : 0n;
  return {
    band: {
      available: true,
      semantics: forecast.bandSemantics,
      low: low.toString(),
      high: high.toString(),
      width: (high - low).toString(),
      actualInsideBand: actual >= low && actual <= high,
      belowBandBy: below.toString(),
      aboveBandBy: above.toString(),
      unavailableReason: null,
    },
  };
}

export async function evaluateForecastActualV1(input: ForecastEvaluationInput): Promise<SeriesForecastEvaluationResult> {
  const pair = await resolveForecastActualScoringPairV1({
    packet: input.packet,
    forecast: input.forecast,
    revisions: input.revisions,
  });
  if (pair.eligibility === "blocked") return blockFromD2b(input, pair.blockReasons);

  const packet = pair.packet;
  const forecast = input.forecast;
  const actualRevision = pair.actual;
  if (!packet || !forecast || !actualRevision) return blocked(input, ["no_actual_revision"]);
  if (actualRevision.clubId !== packet.packet.clubId || actualRevision.eventId !== packet.packet.eventId) {
    return blocked(input, ["actual_identity_mismatch"], "kernel");
  }
  if (!forecast.engineId || !forecast.engineVersion || !forecast.predictorId) {
    return blocked(input, ["forecast_engine_identity_missing"]);
  }
  if (forecast.pointEstimate === null) return blocked(input, ["forecast_point_missing"]);

  let pointEstimate: bigint;
  let actual: bigint;
  try {
    pointEstimate = normalizeExactCount(forecast.pointEstimate, "forecast point estimate");
    const actualValue = countMetricValue(actualRevision, packet.packet.targetMetric);
    if (actualValue === null) return blocked(input, ["actual_metric_missing"]);
    actual = normalizeExactCount(actualValue, "actual");
  } catch {
    return blocked(input, ["invalid_forecast_value"], "kernel");
  }

  let bandResult: ReturnType<typeof bandFor>;
  try {
    bandResult = bandFor(forecast, pointEstimate, actual);
  } catch {
    return blocked(input, ["invalid_forecast_band"], "kernel");
  }
  if ("reason" in bandResult) return blocked(input, [bandResult.reason], "kernel");

  const signedError = pointEstimate - actual;
  const identity = await canonicalHash({
    contractVersion: FORECAST_EVALUATION_CONTRACT_VERSION,
    scoringEligibilityContractVersion: input.scoringEligibilityContractVersion ?? SCORING_ELIGIBILITY_CONTRACT_VERSION,
    clubId: packet.packet.clubId,
    eventId: packet.packet.eventId,
    packetId: packet.packetId,
    packetContentHash: packet.packet.contentHash,
    horizon: packet.packet.horizon,
    forecastSnapshotId: forecast.snapshotId,
    forecastIdentity: {
      engineId: forecast.engineId,
      engineVersion: forecast.engineVersion,
      predictorId: forecast.predictorId,
    },
    forecastOutput: {
      pointEstimate: pointEstimate.toString(),
      low: bandResult.band.low,
      high: bandResult.band.high,
      bandSemantics: bandResult.band.semantics,
    },
    targetMetric: packet.packet.targetMetric,
    actualRevisionId: actualRevision.revisionId,
    actualContentHash: actualRevision.contentHash,
    actualFinality: actualRevision.finality,
    actualSourceKind: actualRevision.sourceKind,
    actualReconciliationStatus: actualRevision.reconciliationStatus,
    actualSourceTimestamp: actualRevision.sourceTimestamp,
    scope: actualRevision.scope,
    pointEstimateSemantics: POINT_ESTIMATE_SEMANTICS,
  });

  return deepFreeze({
    kind: "evaluation",
    lifecycle: "current",
    evaluationId: identity,
    contractVersion: FORECAST_EVALUATION_CONTRACT_VERSION,
    scoringEligibilityContractVersion: input.scoringEligibilityContractVersion ?? SCORING_ELIGIBILITY_CONTRACT_VERSION,
    clubId: packet.packet.clubId,
    eventId: packet.packet.eventId,
    scope: actualRevision.scope,
    targetMetric: packet.packet.targetMetric,
    horizon: packet.packet.horizon,
    packetId: packet.packetId,
    packetContentHash: packet.packet.contentHash,
    forecastSnapshotId: forecast.snapshotId,
    actualRevisionId: actualRevision.revisionId,
    actualContentHash: actualRevision.contentHash,
    actualFinality: actualRevision.finality,
    actualSourceKind: actualRevision.sourceKind,
    actualReconciliationStatus: actualRevision.reconciliationStatus,
    actualSourceTimestamp: actualRevision.sourceTimestamp as string,
    actual: actual.toString(),
    pointEstimateSemantics: POINT_ESTIMATE_SEMANTICS,
    pointEstimate: pointEstimate.toString(),
    engineId: forecast.engineId,
    engineVersion: forecast.engineVersion,
    predictorId: forecast.predictorId,
    forecastIssuedAt: forecast.forecastIssuedAt as string,
    asOfTs: forecast.asOfTs as string,
    signedError: signedError.toString(),
    absoluteError: (signedError < 0n ? -signedError : signedError).toString(),
    squaredError: (signedError * signedError).toString(),
    direction: signedError > 0n ? "over" : signedError < 0n ? "under" : "exact",
    band: bandResult.band,
  });
}

export function classifyForecastEvaluationLifecycleV1(
  evaluation: SeriesForecastEvaluationResult,
  current: {
    readonly packetId: string | null;
    readonly forecastSnapshotId: string | null;
    readonly actualRevisionId: string | null;
    readonly actualResolution: "current" | "needs_reconciliation" | "conflict" | "unavailable";
  },
): "current" | "superseded" | "stale" | "blocked" {
  if (evaluation.kind === "blocked") return "blocked";
  if (current.actualResolution !== "current") return "stale";
  if (
    current.packetId !== evaluation.packetId
    || current.forecastSnapshotId !== evaluation.forecastSnapshotId
    || current.actualRevisionId !== evaluation.actualRevisionId
  ) return "superseded";
  return "current";
}
