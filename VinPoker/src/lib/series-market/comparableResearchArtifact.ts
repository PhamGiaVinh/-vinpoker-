import { canonicalHash } from "../series-intelligence/provenanceHash";
import {
  COMPARABLE_DISTRIBUTION_METHOD_ID,
  COMPARABLE_SELECTION_PROTOCOL_ID,
  COMPARABLE_TAXONOMY_VERSION,
  DEFAULT_MINIMUM_DISTRIBUTION_N,
  DEFAULT_REQUESTED_COMPARABLES,
  buildJejuComparableCorpus,
  evaluateComparableV0,
  freezeComparableSelection,
  type ComparableCorpus,
  type ComparableEvaluation,
  type ComparableEvaluationFold,
  type ComparableEvaluationSummary,
  type EventFamily,
  type FrozenComparableSelection,
  type RatioBand,
} from "./comparableEvent";
import {
  compareCanonicalStrings,
  SeriesMarketValidationError,
} from "./normalization";
import {
  createForecastOriginInformationSet,
  createInputSliceManifest,
  createOutcomeExclusionManifest,
  createResearchDefinition,
  createResearchExecution,
  type ForecastOriginInformationSet,
  type InputSliceManifest,
  type OutcomeExclusionManifest,
  type ResearchDefinition,
  type ResearchEnvironmentFingerprintInput,
  type ResearchExecution,
  type ResearchRecordGraph,
} from "./researchRun";
import {
  createResearchArtifact,
  type ResearchArtifact,
  validateResearchArtifactGraph,
} from "./researchArtifact";
import type { VerifiedMarketReadModel } from "./verifiedMarketReadModel";

export const COMPARABLE_V0_RESEARCH_METHOD_ID = "comparable-event-engine" as const;
export const COMPARABLE_V0_RESEARCH_METHOD_VERSION = "v0" as const;
export const COMPARABLE_V0_FEATURE_SCHEMA_ID = "jeju-comparable-selection-features-v0" as const;
export const COMPARABLE_V0_FOLD_PROTOCOL_ID = "chronological-and-lofo-v1" as const;
export const COMPARABLE_V0_OUTCOME_DEFINITION_ID = "event-entries-count-v1" as const;
export const COMPARABLE_V0_ARTIFACT_TYPE = "comparable-v0-evaluation" as const;
export const COMPARABLE_V0_ARTIFACT_SCHEMA_VERSION = "v1" as const;
export const COMPARABLE_V0_FOLD_NAMESPACE = "series-market:research:v1:comparable-v0-fold" as const;

export type ComparableEvaluationProtocolId = "chronological-v1" | "leave-one-festival-out-v1";
export type FoldAvailabilityState = "available" | "unavailable";
export type FoldFailureState = "insufficient_historical_sample" | null;

export interface ComparableV0Parameters {
  readonly requestedComparables: number;
  readonly minimumDistributionN: number;
}

export interface HistoricalComparableQuantiles {
  readonly label: "Historical Benchmark";
  readonly interpretation: "historical comparable field quantiles";
  readonly p10: string;
  readonly p25: string;
  readonly p50: string;
  readonly p75: string;
  readonly p90: string;
}

export interface FoldPrediction {
  readonly targetEventId: string;
  readonly evaluationProtocolId: ComparableEvaluationProtocolId;
  readonly foldId: string;
  readonly forecastOrigin: string;
  readonly excludedFestivalIds: readonly string[];
  readonly selectedComparableIds: readonly string[];
  readonly selectedComparableCount: number;
  readonly exactMatchCount: number;
  readonly availabilityState: FoldAvailabilityState;
  readonly historicalQuantiles: HistoricalComparableQuantiles | null;
  readonly pointBenchmark: string | null;
  readonly actualEntries: string;
  readonly absoluteError: string | null;
  readonly signedError: string | null;
  readonly inputClaimIds: readonly string[];
  readonly historicalOutcomeClaimIds: readonly string[];
  readonly targetOutcomeClaimIds: readonly string[];
  readonly failureState: FoldFailureState;
}

export interface PairedErrorDelta {
  readonly targetEventId: string;
  readonly comparableAbsoluteError: string;
  readonly baselineAbsoluteError: string;
  readonly comparableMinusBaselineAbsoluteError: string;
  readonly winner: "comparable" | "baseline" | "tie";
}

export interface EvaluationReport {
  readonly label: "Historical Benchmark";
  readonly evaluationProtocolId: ComparableEvaluationProtocolId;
  readonly totalTargets: number;
  readonly pairedTargets: number;
  readonly unavailableTargets: number;
  readonly availabilityRate: string;
  readonly comparableMeanAbsoluteError: string | null;
  readonly baselineMeanAbsoluteError: string | null;
  readonly comparableMedianAbsoluteError: string | null;
  readonly baselineMedianAbsoluteError: string | null;
  readonly comparableWape: string | null;
  readonly baselineWape: string | null;
  readonly wapeDenominatorPolicy: "sum of actual entries over paired available folds";
  readonly comparableMeanSignedError: string | null;
  readonly baselineMeanSignedError: string | null;
  readonly comparableAbsoluteBias: string | null;
  readonly baselineAbsoluteBias: string | null;
  readonly comparableWinCount: number;
  readonly baselineWinCount: number;
  readonly tieCount: number;
  readonly pairedErrorDeltas: readonly PairedErrorDelta[];
  readonly limitations: readonly string[];
}

export type BiasDimension =
  | "event_family"
  | "tour"
  | "currency"
  | "flagship_status"
  | "buy_in_ratio_band"
  | "gtd_state"
  | "chronology_quarter"
  | "festival"
  | "field_size_bucket";

export interface BiasDiagnosticGroup {
  readonly dimension: BiasDimension;
  readonly bucket: string;
  readonly totalFolds: number;
  readonly availableFolds: number;
  readonly unavailableFolds: number;
  readonly meanSignedError: string | null;
  readonly meanAbsoluteError: string | null;
}

export interface BiasDecompositionReport {
  readonly label: "Exploratory Diagnostic";
  readonly evaluationProtocolId: ComparableEvaluationProtocolId;
  readonly groups: readonly BiasDiagnosticGroup[];
  readonly dimensionNotes: Readonly<Record<BiasDimension, string>>;
  readonly postHocBiasCorrectionApplied: false;
  readonly causalInterpretationAllowed: false;
  readonly hypotheses: readonly string[];
  readonly limitations: readonly string[];
}

export interface ModelCard {
  readonly modelName: "Comparable Event Engine V0";
  readonly status: "exploratory";
  readonly methodId: typeof COMPARABLE_V0_RESEARCH_METHOD_ID;
  readonly methodVersion: typeof COMPARABLE_V0_RESEARCH_METHOD_VERSION;
  readonly selectionProtocolId: typeof COMPARABLE_SELECTION_PROTOCOL_ID;
  readonly taxonomyVersion: typeof COMPARABLE_TAXONOMY_VERSION;
  readonly distributionMethodId: typeof COMPARABLE_DISTRIBUTION_METHOD_ID;
  readonly datasetReleaseId: string;
  readonly sourceCutoff: string;
  readonly intendedUse: readonly string[];
  readonly prohibitedUse: readonly string[];
  readonly evaluationProtocols: readonly ComparableEvaluationProtocolId[];
  readonly knownNegativeBias: Readonly<Record<ComparableEvaluationProtocolId, string | null>>;
  readonly missingDataLimitations: readonly string[];
  readonly boundaries: readonly string[];
  readonly calibrated: false;
  readonly productionForecast: false;
  readonly causalInterpretation: false;
}

export interface ComparableV0ResearchPayload {
  readonly label: "Historical Benchmark";
  readonly datasetReleaseId: string;
  readonly sourceCutoff: string;
  readonly methodId: typeof COMPARABLE_V0_RESEARCH_METHOD_ID;
  readonly methodVersion: typeof COMPARABLE_V0_RESEARCH_METHOD_VERSION;
  readonly parameters: ComparableV0Parameters;
  readonly evaluatorOutput: ComparableEvaluation;
  readonly foldPredictions: readonly FoldPrediction[];
  readonly evaluationReports: readonly EvaluationReport[];
  readonly biasDecompositionReports: readonly BiasDecompositionReport[];
  readonly modelCard: ModelCard;
}

export interface ComparableV0ResearchBundle {
  readonly inputSliceManifest: InputSliceManifest;
  readonly outcomeExclusionManifest: OutcomeExclusionManifest;
  readonly informationSet: ForecastOriginInformationSet;
  readonly researchDefinition: ResearchDefinition;
  readonly researchExecution: ResearchExecution;
  readonly artifact: ResearchArtifact<ComparableV0ResearchPayload>;
}

export interface ComparableV0ResearchExecutionInput {
  readonly model: VerifiedMarketReadModel;
  readonly parameters?: unknown;
  readonly codeSha: string;
  readonly dependencyLockHash: string | null;
  readonly environment: ResearchEnvironmentFingerprintInput;
  readonly executedAt: string;
  readonly createdAt: string;
}

interface FoldDiagnosticContext {
  readonly eventFamily: EventFamily;
  readonly tour: string;
  readonly currency: string;
  readonly flagship: boolean;
  readonly dominantBuyInRatioBand: RatioBand | "unavailable";
  readonly gtdState: "present" | "missing" | "zero";
  readonly chronologyQuarter: string;
  readonly festival: string;
}

function fail(message: string, code: string): never {
  throw new SeriesMarketValidationError(message, code);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  const normalized = values.map((value) => value.normalize("NFC"));
  return [...new Set(normalized)].sort(compareCanonicalStrings);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const ALLOWED_PARAMETER_KEYS = new Set(["requestedComparables", "minimumDistributionN"]);
const OUTCOME_PARAMETER_ALIASES = new Set([
  "actual",
  "actualentries",
  "actualvalue",
  "entries",
  "finalentries",
  "observedentries",
  "observedoutcome",
  "outcome",
  "outcomevalue",
  "targetentries",
  "targetlabel",
  "targetvalue",
]);
const MUTABLE_PARAMETER_ALIASES = new Set([
  "createdat",
  "executedat",
  "futureclaims",
  "generatedat",
  "timestamp",
  "updatedat",
]);

function normalizedParameterKey(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(`${label} must be a positive safe integer`, "INVALID_COMPARABLE_V0_PARAMETER");
  }
  return value as number;
}

/** Allows only the two configuration fields consumed by Comparable Event Engine V0. */
export function validateComparableV0Parameters(input: unknown): ComparableV0Parameters {
  if (input === undefined) {
    return deepFreeze({
      requestedComparables: DEFAULT_REQUESTED_COMPARABLES,
      minimumDistributionN: DEFAULT_MINIMUM_DISTRIBUTION_N,
    });
  }
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    fail("Comparable V0 parameters must be a plain object", "INVALID_COMPARABLE_V0_PARAMETERS");
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const normalized = normalizedParameterKey(key);
    if (OUTCOME_PARAMETER_ALIASES.has(normalized)) {
      fail("outcome values are forbidden in Comparable V0 parameters", "COMPARABLE_V0_PARAMETER_OUTCOME_LEAKAGE");
    }
    if (MUTABLE_PARAMETER_ALIASES.has(normalized)) {
      fail("future claims and mutable timestamps are forbidden in Comparable V0 parameters", "COMPARABLE_V0_PARAMETER_MUTABLE_INPUT");
    }
    if (!ALLOWED_PARAMETER_KEYS.has(key)) {
      fail(`unknown Comparable V0 parameter: ${key}`, "UNKNOWN_COMPARABLE_V0_PARAMETER");
    }
  }
  return deepFreeze({
    requestedComparables: positiveSafeInteger(
      record.requestedComparables ?? DEFAULT_REQUESTED_COMPARABLES,
      "requestedComparables",
    ),
    minimumDistributionN: positiveSafeInteger(
      record.minimumDistributionN ?? DEFAULT_MINIMUM_DISTRIBUTION_N,
      "minimumDistributionN",
    ),
  });
}

function fixedRatio(numerator: bigint, denominator: bigint, places = 3): string {
  if (denominator <= 0n) return "0.000";
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const scale = 10n ** BigInt(places);
  const rounded = (absolute * scale + denominator / 2n) / denominator;
  const whole = rounded / scale;
  const fraction = (rounded % scale).toString().padStart(places, "0");
  return `${negative && rounded !== 0n ? "-" : ""}${whole}.${fraction}`;
}

function absoluteDecimal(value: string | null): string | null {
  if (value === null) return null;
  return value.startsWith("-") ? value.slice(1) : value;
}

function absoluteDifference(left: string, right: string): bigint {
  const delta = BigInt(left) - BigInt(right);
  return delta < 0n ? -delta : delta;
}

function dominantBuyInRatioBand(selection: FrozenComparableSelection): RatioBand | "unavailable" {
  const ranked = (Object.entries(selection.buyInBandCounts) as [RatioBand, number][])
    .filter(([, count]) => count > 0)
    .sort(([leftBand, leftCount], [rightBand, rightCount]) =>
      rightCount - leftCount || compareCanonicalStrings(leftBand, rightBand),
    );
  return ranked[0]?.[0] ?? "unavailable";
}

function quarterFor(localDate: string): string {
  const year = localDate.slice(0, 4);
  const month = Number(localDate.slice(5, 7));
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function fieldSizeBucket(entries: string): string {
  const value = BigInt(entries);
  if (value < 50n) return "under_50";
  if (value < 100n) return "50_to_99";
  if (value < 250n) return "100_to_249";
  if (value < 500n) return "250_to_499";
  return "500_plus";
}

function eventMap(corpus: ComparableCorpus): ReadonlyMap<string, NonNullable<ComparableCorpus["candidates"][number]["selection"]>> {
  return new Map(
    corpus.candidates.flatMap((candidate) =>
      candidate.selection === null ? [] : [[candidate.eventId, candidate.selection] as const],
    ),
  );
}

function outcomeMap(corpus: ComparableCorpus): ReadonlyMap<string, ComparableCorpus["outcomes"][number]> {
  return new Map(corpus.outcomes.map((outcome) => [outcome.eventId, outcome] as const));
}

function selectionForFold(
  corpus: ComparableCorpus,
  fold: ComparableEvaluationFold,
  protocolId: ComparableEvaluationProtocolId,
  parameters: ComparableV0Parameters,
): FrozenComparableSelection {
  const target = corpus.candidates.find((candidate) => candidate.eventId === fold.targetId);
  if (!target || !target.selection) fail(`fold target is unavailable: ${fold.targetId}`, "COMPARABLE_FOLD_TARGET_MISSING");
  const excludedFestivalIds = protocolId === "leave-one-festival-out-v1"
    ? [target.selection.festivalId]
    : [];
  const selection = freezeComparableSelection(
    target,
    corpus.candidates,
    new Set(corpus.outcomeEventIds),
    {
      requestedComparables: parameters.requestedComparables,
      chronologyOriginDate: target.selection.eventDate,
      excludedFestivalIds,
    },
  );
  if (!sameStrings(selection.selectedComparableIds, fold.selectedComparableIds)) {
    fail("artifact selection drifted from Comparable V0 evaluator", "COMPARABLE_ARTIFACT_SELECTION_DRIFT");
  }
  return selection;
}

async function createFoldPrediction(
  corpus: ComparableCorpus,
  fold: ComparableEvaluationFold,
  protocolId: ComparableEvaluationProtocolId,
  parameters: ComparableV0Parameters,
): Promise<{ readonly prediction: FoldPrediction; readonly context: FoldDiagnosticContext }> {
  const inputs = eventMap(corpus);
  const outcomes = outcomeMap(corpus);
  const target = inputs.get(fold.targetId);
  const targetOutcome = outcomes.get(fold.targetId);
  if (!target || !targetOutcome) fail(`fold target has incomplete provenance: ${fold.targetId}`, "COMPARABLE_FOLD_PROVENANCE_MISSING");
  const selection = selectionForFold(corpus, fold, protocolId, parameters);
  const excludedFestivalIds = protocolId === "leave-one-festival-out-v1"
    ? [target.festivalId]
    : [];
  const inputClaimIds = sortedUnique([
    ...target.inputClaimIds,
    ...selection.selectedComparableIds.flatMap((id) => inputs.get(id)?.inputClaimIds ?? []),
  ]);
  const historicalOutcomeClaimIds = sortedUnique(
    selection.selectedComparableIds.flatMap((id) => outcomes.get(id)?.claimIds ?? []),
  );
  const targetOutcomeClaimIds = sortedUnique(targetOutcome.claimIds);
  const foldDigest = await canonicalHash({
    namespace: COMPARABLE_V0_FOLD_NAMESPACE,
    evaluationProtocolId: protocolId,
    targetEventId: target.eventId,
    forecastOrigin: target.eventDate,
    excludedFestivalIds,
    selectedComparableIds: selection.selectedComparableIds,
    inputClaimIds,
    parameters,
  });
  const foldId = `${COMPARABLE_V0_FOLD_NAMESPACE}:${protocolId}:${foldDigest}`;
  const available = fold.comparable.state === "available";
  const signedError = available
    ? (BigInt(fold.comparable.p50!) - BigInt(fold.targetEntries)).toString()
    : null;
  const absoluteError = signedError === null
    ? null
    : (BigInt(signedError) < 0n ? -BigInt(signedError) : BigInt(signedError)).toString();
  const historicalQuantiles: HistoricalComparableQuantiles | null = available
    ? {
      label: "Historical Benchmark",
      interpretation: "historical comparable field quantiles",
      p10: fold.comparable.p10!,
      p25: fold.comparable.p25!,
      p50: fold.comparable.p50!,
      p75: fold.comparable.p75!,
      p90: fold.comparable.p90!,
    }
    : null;

  return {
    prediction: {
      targetEventId: fold.targetId,
      evaluationProtocolId: protocolId,
      foldId,
      forecastOrigin: fold.targetDate,
      excludedFestivalIds,
      selectedComparableIds: [...selection.selectedComparableIds],
      selectedComparableCount: selection.selectedComparableIds.length,
      exactMatchCount: selection.exactMatchCount,
      availabilityState: available ? "available" : "unavailable",
      historicalQuantiles,
      pointBenchmark: available ? fold.comparable.p50 : null,
      actualEntries: fold.targetEntries,
      absoluteError,
      signedError,
      inputClaimIds,
      historicalOutcomeClaimIds,
      targetOutcomeClaimIds,
      failureState: available ? null : "insufficient_historical_sample",
    },
    context: {
      eventFamily: target.eventFamily,
      tour: target.tour,
      currency: target.currency,
      flagship: target.flagship,
      dominantBuyInRatioBand: dominantBuyInRatioBand(selection),
      gtdState: target.gtd === null
        ? "missing"
        : BigInt(target.gtd.minorUnits) === 0n
          ? "zero"
          : "present",
      chronologyQuarter: quarterFor(target.eventDate),
      festival: target.festivalKey,
    },
  };
}

export async function createComparableV0FoldPredictions(
  corpus: ComparableCorpus,
  evaluation: ComparableEvaluation,
  parameters: ComparableV0Parameters,
): Promise<{
  readonly predictions: readonly FoldPrediction[];
  readonly contexts: Readonly<Record<string, FoldDiagnosticContext>>;
}> {
  const predictions: FoldPrediction[] = [];
  const contexts: Record<string, FoldDiagnosticContext> = {};
  const protocols = [
    ["chronological-v1", evaluation.chronological.folds],
    ["leave-one-festival-out-v1", evaluation.leaveOneFestivalOut.folds],
  ] as const;
  for (const [protocolId, folds] of protocols) {
    for (const fold of folds) {
      const created = await createFoldPrediction(corpus, fold, protocolId, parameters);
      predictions.push(created.prediction);
      contexts[created.prediction.foldId] = created.context;
    }
  }
  return deepFreeze({ predictions, contexts });
}

function buildEvaluationReport(
  protocolId: ComparableEvaluationProtocolId,
  summary: ComparableEvaluationSummary,
): EvaluationReport {
  const paired = summary.folds.filter(
    (fold) => fold.comparable.state === "available" && fold.baseline.state === "available",
  );
  const pairedErrorDeltas = paired.map((fold): PairedErrorDelta => {
    const comparableAbsoluteError = absoluteDifference(fold.comparable.p50!, fold.targetEntries);
    const baselineAbsoluteError = absoluteDifference(fold.baseline.p50!, fold.targetEntries);
    const delta = comparableAbsoluteError - baselineAbsoluteError;
    return {
      targetEventId: fold.targetId,
      comparableAbsoluteError: comparableAbsoluteError.toString(),
      baselineAbsoluteError: baselineAbsoluteError.toString(),
      comparableMinusBaselineAbsoluteError: delta.toString(),
      winner: delta < 0n ? "comparable" : delta > 0n ? "baseline" : "tie",
    };
  });
  const denominator = paired.reduce((total, fold) => total + BigInt(fold.targetEntries), 0n);
  const comparableTotalAbsolute = pairedErrorDeltas.reduce(
    (total, delta) => total + BigInt(delta.comparableAbsoluteError),
    0n,
  );
  const baselineTotalAbsolute = pairedErrorDeltas.reduce(
    (total, delta) => total + BigInt(delta.baselineAbsoluteError),
    0n,
  );
  const comparableMetrics = summary.comparableMetricsOnPairedFolds;
  const baselineMetrics = summary.baselineMetricsOnPairedFolds;
  return {
    label: "Historical Benchmark",
    evaluationProtocolId: protocolId,
    totalTargets: summary.folds.length,
    pairedTargets: paired.length,
    unavailableTargets: summary.folds.length - paired.length,
    availabilityRate: fixedRatio(BigInt(paired.length), BigInt(summary.folds.length)),
    comparableMeanAbsoluteError: comparableMetrics?.meanAbsoluteError ?? null,
    baselineMeanAbsoluteError: baselineMetrics?.meanAbsoluteError ?? null,
    comparableMedianAbsoluteError: comparableMetrics?.medianAbsoluteError ?? null,
    baselineMedianAbsoluteError: baselineMetrics?.medianAbsoluteError ?? null,
    comparableWape: paired.length === 0 || denominator === 0n
      ? null
      : fixedRatio(comparableTotalAbsolute, denominator),
    baselineWape: paired.length === 0 || denominator === 0n
      ? null
      : fixedRatio(baselineTotalAbsolute, denominator),
    wapeDenominatorPolicy: "sum of actual entries over paired available folds",
    comparableMeanSignedError: comparableMetrics?.signedBias ?? null,
    baselineMeanSignedError: baselineMetrics?.signedBias ?? null,
    comparableAbsoluteBias: absoluteDecimal(comparableMetrics?.signedBias ?? null),
    baselineAbsoluteBias: absoluteDecimal(baselineMetrics?.signedBias ?? null),
    comparableWinCount: pairedErrorDeltas.filter((delta) => delta.winner === "comparable").length,
    baselineWinCount: pairedErrorDeltas.filter((delta) => delta.winner === "baseline").length,
    tieCount: pairedErrorDeltas.filter((delta) => delta.winner === "tie").length,
    pairedErrorDeltas,
    limitations: [
      "Paired comparisons use only folds where both Comparable V0 and the historical baseline are available.",
      "WAPE divides total absolute error by actual entries over the same paired folds.",
      "Exploratory historical evaluation only; no statistical significance or calibrated probability is claimed.",
    ],
  };
}

const BIAS_DIMENSION_NOTES: Readonly<Record<BiasDimension, string>> = {
  event_family: "Target event family known before the target outcome.",
  tour: "Target festival tour known before the target outcome.",
  currency: "Target currency; no FX conversion is performed.",
  flagship_status: "Target flagship status known before the target outcome.",
  buy_in_ratio_band: "Dominant selected-comparable buy-in ratio band; ties use canonical band order.",
  gtd_state: "Whether target GTD is present, explicitly zero, or missing; missing is not zero.",
  chronology_quarter: "Calendar quarter of the target event date.",
  festival: "Target festival identity.",
  field_size_bucket: "Post-outcome diagnostic only; never used for selection, training identity, or fold identity.",
};

function diagnosticBuckets(
  prediction: FoldPrediction,
  context: FoldDiagnosticContext,
): readonly [BiasDimension, string][] {
  return [
    ["event_family", context.eventFamily],
    ["tour", context.tour],
    ["currency", context.currency],
    ["flagship_status", context.flagship ? "flagship" : "non_flagship"],
    ["buy_in_ratio_band", context.dominantBuyInRatioBand],
    ["gtd_state", context.gtdState],
    ["chronology_quarter", context.chronologyQuarter],
    ["festival", context.festival],
    ["field_size_bucket", fieldSizeBucket(prediction.actualEntries)],
  ];
}

function buildBiasDecompositionReport(
  protocolId: ComparableEvaluationProtocolId,
  predictions: readonly FoldPrediction[],
  contexts: Readonly<Record<string, FoldDiagnosticContext>>,
): BiasDecompositionReport {
  const buckets = new Map<string, { dimension: BiasDimension; bucket: string; folds: FoldPrediction[] }>();
  for (const prediction of predictions.filter((item) => item.evaluationProtocolId === protocolId)) {
    const context = contexts[prediction.foldId];
    if (!context) fail(`missing diagnostic context for ${prediction.foldId}`, "BIAS_DIAGNOSTIC_CONTEXT_MISSING");
    for (const [dimension, bucket] of diagnosticBuckets(prediction, context)) {
      const key = `${dimension}\u0000${bucket}`;
      const group = buckets.get(key) ?? { dimension, bucket, folds: [] };
      group.folds.push(prediction);
      buckets.set(key, group);
    }
  }
  const groups = [...buckets.values()]
    .sort((left, right) =>
      compareCanonicalStrings(left.dimension, right.dimension)
      || compareCanonicalStrings(left.bucket, right.bucket),
    )
    .map(({ dimension, bucket, folds }): BiasDiagnosticGroup => {
      const available = folds.filter((fold) => fold.signedError !== null && fold.absoluteError !== null);
      const signedTotal = available.reduce((total, fold) => total + BigInt(fold.signedError!), 0n);
      const absoluteTotal = available.reduce((total, fold) => total + BigInt(fold.absoluteError!), 0n);
      return {
        dimension,
        bucket,
        totalFolds: folds.length,
        availableFolds: available.length,
        unavailableFolds: folds.length - available.length,
        meanSignedError: available.length === 0 ? null : fixedRatio(signedTotal, BigInt(available.length)),
        meanAbsoluteError: available.length === 0 ? null : fixedRatio(absoluteTotal, BigInt(available.length)),
      };
    });
  return {
    label: "Exploratory Diagnostic",
    evaluationProtocolId: protocolId,
    groups,
    dimensionNotes: BIAS_DIMENSION_NOTES,
    postHocBiasCorrectionApplied: false,
    causalInterpretationAllowed: false,
    hypotheses: [
      "Older historical comparables may understate later fields in a changing market; this is an untested hypothesis.",
    ],
    limitations: [
      "Buckets are descriptive slices of a small unverified public dataset.",
      "Subgroup diagnostics are not causal estimates and are not corrected for confounding or repeated testing.",
      "Field-size buckets are defined after the outcome and are diagnostic only.",
      "No post-hoc bias offset is applied to Comparable Event Engine V0.",
    ],
  };
}

function buildModelCard(
  model: VerifiedMarketReadModel,
  reports: readonly EvaluationReport[],
): ModelCard {
  const biasByProtocol = Object.fromEntries(
    reports.map((report) => [report.evaluationProtocolId, report.comparableMeanSignedError]),
  ) as Record<ComparableEvaluationProtocolId, string | null>;
  return {
    modelName: "Comparable Event Engine V0",
    status: "exploratory",
    methodId: COMPARABLE_V0_RESEARCH_METHOD_ID,
    methodVersion: COMPARABLE_V0_RESEARCH_METHOD_VERSION,
    selectionProtocolId: COMPARABLE_SELECTION_PROTOCOL_ID,
    taxonomyVersion: COMPARABLE_TAXONOMY_VERSION,
    distributionMethodId: COMPARABLE_DISTRIBUTION_METHOD_ID,
    datasetReleaseId: model.releaseId,
    sourceCutoff: model.sourceCutoff,
    intendedUse: [
      "Reproducible historical comparison of event fields within the locked Jeju V1 public release.",
      "Exploratory benchmark and challenger control for future Series Market research.",
      "Descriptive review of availability, error, and bias under chronological and leave-one-festival-out protocols.",
    ],
    prohibitedUse: [
      "Production turnout forecast or calibrated prediction interval.",
      "Overlay probability, optimal GTD, recommended GTD, or autonomous money decision.",
      "Causal interpretation of GTD, buy-in, tour, flagship, or schedule effects.",
      "Cross-currency comparison or FX conversion.",
    ],
    evaluationProtocols: ["chronological-v1", "leave-one-festival-out-v1"],
    knownNegativeBias: {
      "chronological-v1": biasByProtocol["chronological-v1"] ?? null,
      "leave-one-festival-out-v1": biasByProtocol["leave-one-festival-out-v1"] ?? null,
    },
    missingDataLimitations: [
      `${model.quality.missingClaims} of ${model.claimCount} Jeju V1 claims are missing.`,
      "Missing GTD is retained as missing and is not interpreted as zero.",
      "Unavailable folds remain explicit when historical comparable evidence is below the minimum sample.",
    ],
    boundaries: [
      "Selection is limited to the same currency and same game.",
      "Entries outcomes join only after comparable IDs are frozen.",
      "Historical nearest-rank quantiles are not calibrated forecast quantiles.",
      "The owner-provided Jeju V1 release is unverified public research data.",
      "Small samples and event-family heterogeneity can make benchmark ranges unstable.",
    ],
    calibrated: false,
    productionForecast: false,
    causalInterpretation: false,
  };
}

function allSelectionClaimIds(corpus: ComparableCorpus): readonly string[] {
  return sortedUnique(
    corpus.candidates.flatMap((candidate) => candidate.selection?.inputClaimIds ?? []),
  );
}

function allOutcomeClaimIds(corpus: ComparableCorpus): readonly string[] {
  return sortedUnique(corpus.outcomes.flatMap((outcome) => outcome.claimIds));
}

export async function emitComparableV0ResearchBundle(
  input: ComparableV0ResearchExecutionInput,
): Promise<ComparableV0ResearchBundle> {
  const parameters = validateComparableV0Parameters(input.parameters);
  const corpus = buildJejuComparableCorpus(input.model);
  const evaluatorOutput = evaluateComparableV0(corpus, parameters);
  const inputClaimIds = allSelectionClaimIds(corpus);
  const outcomeClaimIds = allOutcomeClaimIds(corpus);
  const leaked = new Set(outcomeClaimIds);
  if (inputClaimIds.some((claimId) => leaked.has(claimId))) {
    fail("selection input slice contains an outcome claim", "COMPARABLE_V0_INFORMATION_SET_LEAKAGE");
  }

  const inputSliceManifest = await createInputSliceManifest({
    datasetReleaseIds: [input.model.releaseId],
    sourceCutoff: input.model.sourceCutoff,
    memberKind: "claim_id",
    memberIds: inputClaimIds,
    rowCount: input.model.events.length,
  });
  const outcomeExclusionManifest = await createOutcomeExclusionManifest({
    datasetReleaseIds: [input.model.releaseId],
    sourceCutoff: input.model.sourceCutoff,
    outcomeClaimIds,
  });
  const informationSet = await createForecastOriginInformationSet({
    inputSliceManifest,
    outcomeExclusionManifest,
    featureSchemaId: COMPARABLE_V0_FEATURE_SCHEMA_ID,
  });
  const targetEntityIds = evaluatorOutput.chronological.folds.map((fold) => fold.targetId);
  const researchDefinition = await createResearchDefinition({
    questionKey: "comparable-v0-historical-benchmark",
    informationSet,
    targetEntityIds,
    methodId: COMPARABLE_V0_RESEARCH_METHOD_ID,
    methodVersion: COMPARABLE_V0_RESEARCH_METHOD_VERSION,
    foldProtocolId: COMPARABLE_V0_FOLD_PROTOCOL_ID,
    outcomeDefinitionId: COMPARABLE_V0_OUTCOME_DEFINITION_ID,
    parameters: {
      requestedComparables: parameters.requestedComparables,
      minimumDistributionN: parameters.minimumDistributionN,
    },
    displayLabel: "Comparable Event Engine V0 Historical Benchmark",
    notes: "Exploratory public-market evaluation; not a production forecast.",
  });
  const researchExecution = await createResearchExecution({
    researchDefinition,
    codeSha: input.codeSha,
    dependencyLockHash: input.dependencyLockHash,
    environment: input.environment,
    seedPolicy: { kind: "none" },
    determinismLevel: "exact",
    executedAt: input.executedAt,
  });
  const researchGraph: ResearchRecordGraph = {
    inputSliceManifests: [inputSliceManifest],
    outcomeExclusionManifests: [outcomeExclusionManifest],
    informationSets: [informationSet],
    definitions: [researchDefinition],
    executions: [researchExecution],
    challenges: [],
    supersessions: [],
  };

  const createdFolds = await createComparableV0FoldPredictions(corpus, evaluatorOutput, parameters);
  const evaluationReports = [
    buildEvaluationReport("chronological-v1", evaluatorOutput.chronological),
    buildEvaluationReport("leave-one-festival-out-v1", evaluatorOutput.leaveOneFestivalOut),
  ];
  const biasDecompositionReports = [
    buildBiasDecompositionReport("chronological-v1", createdFolds.predictions, createdFolds.contexts),
    buildBiasDecompositionReport("leave-one-festival-out-v1", createdFolds.predictions, createdFolds.contexts),
  ];
  const payload: ComparableV0ResearchPayload = {
    label: "Historical Benchmark",
    datasetReleaseId: input.model.releaseId,
    sourceCutoff: input.model.sourceCutoff,
    methodId: COMPARABLE_V0_RESEARCH_METHOD_ID,
    methodVersion: COMPARABLE_V0_RESEARCH_METHOD_VERSION,
    parameters,
    evaluatorOutput,
    foldPredictions: createdFolds.predictions,
    evaluationReports,
    biasDecompositionReports,
    modelCard: buildModelCard(input.model, evaluationReports),
  };
  const artifact = await createResearchArtifact({
    executionId: researchExecution.executionId,
    researchDefinitionId: researchDefinition.researchDefinitionId,
    artifactType: COMPARABLE_V0_ARTIFACT_TYPE,
    artifactSchemaVersion: COMPARABLE_V0_ARTIFACT_SCHEMA_VERSION,
    createdAt: input.createdAt,
    determinismLevel: "exact",
    payload,
    limitations: [
      "Jeju V1 is an unverified owner-provided public seed release.",
      "Comparable V0 is an exploratory historical benchmark, not a calibrated or production forecast.",
      "Bias decomposition is descriptive only and does not support causal claims or post-hoc correction.",
      "No FX conversion, GTD recommendation, overlay probability, or autonomous money decision is emitted.",
    ],
    allowedClaims: [
      "Comparable V0 was evaluated with chronological and leave-one-festival-out protocols.",
      "Historical benchmark metrics and unavailable folds are reproduced from the existing evaluator.",
      "Selection uses pre-outcome event inputs and joins entries only after comparable IDs freeze.",
    ],
    forbiddenClaims: [
      "Comparable V0 is calibrated.",
      "Comparable V0 is a production forecast.",
      "Comparable V0 estimates causal effects.",
      "The artifact provides an overlay probability, optimal GTD, or recommended GTD.",
    ],
  });
  await validateResearchArtifactGraph({ artifact, researchGraph });

  return deepFreeze({
    inputSliceManifest,
    outcomeExclusionManifest,
    informationSet,
    researchDefinition,
    researchExecution,
    artifact,
  });
}
