import type { DecisionPacketHorizon, DecisionTargetMetric } from "./decisionPacketV1";
import {
  FORECAST_EVALUATION_CONTRACT_VERSION,
  type ForecastBandSemantics,
  type ForecastEvaluationAggregateV1,
  type ForecastEvaluationSampleGate,
  type SeriesForecastEvaluationV1,
} from "./forecastEvaluationTypes";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function sampleGate(n: number): ForecastEvaluationSampleGate {
  if (n < 5) return "descriptive_only_small_sample";
  if (n < 20) return "descriptive_only";
  return "evaluation_summary_available";
}

function groupKey(evaluation: SeriesForecastEvaluationV1): string {
  return JSON.stringify([
    evaluation.targetMetric,
    evaluation.horizon,
    evaluation.engineId,
    evaluation.engineVersion,
    evaluation.band.semantics,
  ]);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function aggregateForecastEvaluationsV1(
  evaluations: readonly SeriesForecastEvaluationV1[],
): readonly ForecastEvaluationAggregateV1[] {
  const groups = new Map<string, SeriesForecastEvaluationV1[]>();
  for (const evaluation of evaluations) {
    if (evaluation.lifecycle !== "current") continue;
    const key = groupKey(evaluation);
    const group = groups.get(key) ?? [];
    group.push(evaluation);
    groups.set(key, group);
  }

  return deepFreeze([...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, group]) => {
    const first = group[0];
    const signed = group.reduce((sum, item) => sum + BigInt(item.signedError), 0n);
    const absolute = group.reduce((sum, item) => sum + BigInt(item.absoluteError), 0n);
    const banded = group.filter((item) => item.band.available);
    const inside = banded.filter((item) => item.band.actualInsideBand === true).length;
    return {
      contractVersion: FORECAST_EVALUATION_CONTRACT_VERSION,
      targetMetric: first.targetMetric,
      horizon: first.horizon,
      engineId: first.engineId,
      engineVersion: first.engineVersion,
      bandSemantics: first.band.semantics as ForecastBandSemantics | null,
      n: group.length,
      sumSignedError: signed.toString(),
      sumAbsoluteError: absolute.toString(),
      meanSignedError: { numerator: signed.toString(), denominator: group.length },
      mae: { numerator: absolute.toString(), denominator: group.length },
      exactCount: group.filter((item) => item.direction === "exact").length,
      overCount: group.filter((item) => item.direction === "over").length,
      underCount: group.filter((item) => item.direction === "under").length,
      bandEligibleN: banded.length,
      insideBandCount: inside,
      insideForecastBandRate: banded.length === 0 ? null : { numerator: String(inside), denominator: banded.length },
      sampleGate: sampleGate(group.length),
    };
  }));
}

export type { DecisionPacketHorizon, DecisionTargetMetric };
