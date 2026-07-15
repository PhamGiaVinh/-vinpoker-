import { canonicalHash } from "../series-intelligence/provenanceHash";
import type { MoneyClaimValue } from "./contracts";
import {
  canonicalStringSet,
  compareCanonicalStrings,
  normalizeInstant,
  normalizeIntegerString,
  SeriesMarketValidationError,
} from "./normalization";
import type {
  VerifiedEventRow,
  VerifiedField,
  VerifiedFestivalRow,
  VerifiedMarketReadModel,
} from "./verifiedMarketReadModel";

/** Research convention only: this is not a causal taxonomy or a production forecast protocol. */
export const COMPARABLE_SELECTION_PROTOCOL_ID = "jeju-comparable-v0" as const;
export const COMPARABLE_TAXONOMY_VERSION = "jeju-event-family-v0" as const;
export const COMPARABLE_DISTRIBUTION_METHOD_ID = "nearest-rank-count-quantiles-v1" as const;
export const COMPARABLE_ANALYSIS_NAMESPACE = "series-market:v1:comparable-analysis" as const;
export const DEFAULT_REQUESTED_COMPARABLES = 12;
export const DEFAULT_MINIMUM_DISTRIBUTION_N = 5;
export const COMPARISON_MINIMUM_FOLDS = 5;

export type EventFamily =
  | "main"
  | "high_roller"
  | "bounty"
  | "fast"
  | "deepstack"
  | "omaha"
  | "mixed_or_variant"
  | "other_nlh"
  | "unknown";

/** Every event type in the locked Jeju V1 release is mapped once by exact value. */
export const JEJU_EVENT_FAMILY_TAXONOMY_V0: Readonly<Record<string, Exclude<EventFamily, "unknown">>> = Object.freeze({
  Deepstack: "deepstack",
  HighRoller: "high_roller",
  HyperTurbo: "fast",
  Main: "main",
  MicroMain: "main",
  MiniMain: "main",
  Mixed: "mixed_or_variant",
  MysteryBounty: "bounty",
  NationalCup: "main",
  "NLH-Other": "other_nlh",
  PLO: "omaha",
  ShortDeck: "mixed_or_variant",
  SuperHighRoller: "high_roller",
  Turbo: "fast",
  Womens: "other_nlh",
});

export type ComparableExclusionCode =
  | "SELF"
  | "CURRENCY_MISMATCH"
  | "GAME_MISMATCH"
  | "MISSING_BUY_IN"
  | "MISSING_REQUIRED_INPUT"
  | "CONFLICTING_INPUT"
  | "MISSING_ENTRIES_OUTCOME"
  | "NOT_BEFORE_ORIGIN"
  | "EXCLUDED_EVENT"
  | "EXCLUDED_FESTIVAL"
  | "UNKNOWN_EVENT_FAMILY"
  | "TARGET_INPUT_UNAVAILABLE";

export type EventTypeMatch = "exact" | "family" | "different";
export type RatioBand = "within_1_25x" | "within_1_5x" | "within_2x" | "within_4x" | "beyond_4x";
export type GtdSimilarity = RatioBand | "missing_gtd";
export type ComparableQuality = "insufficient" | "low" | "medium" | "high";

export interface ComparableMoney {
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
}

/** This type intentionally has no turnout outcome or entries field. */
export interface ComparableSelectionInput {
  readonly eventId: string;
  readonly festivalId: string;
  readonly festivalKey: string;
  readonly tour: string;
  readonly eventDate: string;
  readonly eventType: string;
  readonly eventFamily: EventFamily;
  readonly game: string;
  readonly currency: string;
  readonly buyIn: ComparableMoney;
  readonly gtd: ComparableMoney | null;
  readonly flagship: boolean;
  readonly inputClaimIds: readonly string[];
}

/** Outcomes are deliberately separate from selection inputs and join only after IDs are frozen. */
export interface ComparableOutcome {
  readonly eventId: string;
  readonly entries: string;
  readonly claimIds: readonly string[];
}

export interface ComparableCandidate {
  readonly eventId: string;
  readonly selection: ComparableSelectionInput | null;
  readonly selectionIssues: readonly ComparableExclusionCode[];
}

export interface ComparableCorpus {
  readonly releaseId: string;
  readonly sourceCutoff: string;
  readonly selectionProtocolId: typeof COMPARABLE_SELECTION_PROTOCOL_ID;
  readonly taxonomyVersion: typeof COMPARABLE_TAXONOMY_VERSION;
  readonly distributionMethodId: typeof COMPARABLE_DISTRIBUTION_METHOD_ID;
  readonly candidates: readonly ComparableCandidate[];
  readonly outcomeEventIds: readonly string[];
  readonly outcomes: readonly ComparableOutcome[];
}

export interface ComparableSelectionOptions {
  readonly requestedComparables?: number;
  readonly chronologyOriginDate?: string | null;
  readonly excludedEventIds?: readonly string[];
  readonly excludedFestivalIds?: readonly string[];
}

export interface ComparableRankBreakdown {
  readonly eventTypeMatch: EventTypeMatch;
  readonly buyInRatioBand: RatioBand;
  readonly gtdSimilarity: GtdSimilarity;
  readonly flagshipMatch: boolean;
  readonly tourMatch: boolean;
  readonly eventDateDistanceDays: number;
  readonly reasonCodes: readonly string[];
}

export interface ComparableCandidateAssessment {
  readonly eventId: string;
  readonly eligible: boolean;
  readonly exclusionReasons: readonly ComparableExclusionCode[];
  readonly rank: ComparableRankBreakdown | null;
}

export interface FrozenComparableSelection {
  readonly targetId: string;
  readonly requestedComparables: number;
  readonly targetIssues: readonly ComparableExclusionCode[];
  readonly selectedComparableIds: readonly string[];
  readonly selectedComparables: readonly ComparableSelectionInput[];
  readonly assessments: readonly ComparableCandidateAssessment[];
  readonly exclusionCounts: Readonly<Record<string, number>>;
  readonly exactMatchCount: number;
  readonly familyMatchCount: number;
  readonly buyInBandCounts: Readonly<Record<RatioBand, number>>;
  readonly missingGtdCount: number;
}

export interface ComparableDistribution {
  readonly label: "Historical Benchmark";
  readonly methodId: typeof COMPARABLE_DISTRIBUTION_METHOD_ID;
  readonly state: "available" | "insufficient";
  readonly quality: ComparableQuality;
  readonly n: number;
  readonly minimumN: number;
  readonly observedEntries: readonly string[];
  readonly minimum: string | null;
  readonly p10: string | null;
  readonly p25: string | null;
  readonly p50: string | null;
  readonly p75: string | null;
  readonly p90: string | null;
  readonly maximum: string | null;
  readonly iqr: string | null;
  readonly limitations: readonly string[];
}

export interface ComparableAnalysisProvenance {
  readonly releaseId: string;
  readonly sourceCutoff: string;
  readonly selectionProtocolId: typeof COMPARABLE_SELECTION_PROTOCOL_ID;
  readonly taxonomyVersion: typeof COMPARABLE_TAXONOMY_VERSION;
  readonly distributionMethodId: typeof COMPARABLE_DISTRIBUTION_METHOD_ID;
  readonly targetInputHash: string;
  readonly selectedComparableIds: readonly string[];
  readonly analysisTimestamp: string | null;
}

export interface ComparableAnalysis {
  readonly id: string;
  readonly state: "available" | "insufficient";
  readonly target: ComparableSelectionInput | null;
  readonly targetIssues: readonly ComparableExclusionCode[];
  readonly selection: FrozenComparableSelection;
  readonly distribution: ComparableDistribution;
  readonly provenance: ComparableAnalysisProvenance;
  readonly limitations: readonly string[];
}

export interface ComparableEvaluationOptions {
  readonly requestedComparables?: number;
  readonly minimumDistributionN?: number;
}

export interface ComparableEvaluationFold {
  readonly targetId: string;
  readonly targetEntries: string;
  readonly targetDate: string;
  readonly currency: string;
  readonly game: string;
  readonly tour: string;
  readonly eventFamily: EventFamily;
  readonly selectedComparableIds: readonly string[];
  readonly baselineCandidateIds: readonly string[];
  readonly comparable: ComparableDistribution;
  readonly baseline: ComparableDistribution;
}

export interface ComparableErrorMetrics {
  readonly folds: number;
  readonly totalAbsoluteError: string;
  readonly meanAbsoluteError: string;
  readonly medianAbsoluteError: string;
  readonly signedBias: string;
  readonly intervalAvailableFolds: number;
  readonly intervalCoveredFolds: number;
  readonly intervalCoverage: string;
  readonly averageIntervalWidth: string;
}

export interface ComparableEvaluationSummary {
  readonly eligibleTargets: number;
  readonly comparableAvailableFolds: number;
  readonly comparableInsufficientFolds: number;
  readonly baselineAvailableFolds: number;
  readonly pairedAvailableFolds: number;
  readonly comparableMetrics: ComparableErrorMetrics | null;
  readonly comparableMetricsOnPairedFolds: ComparableErrorMetrics | null;
  readonly baselineMetricsOnPairedFolds: ComparableErrorMetrics | null;
  readonly comparisonState: "insufficient_pairs" | "comparable_lower_mae" | "baseline_lower_mae" | "mae_tied";
  readonly countsByCurrency: Readonly<Record<string, number>>;
  readonly countsByGame: Readonly<Record<string, number>>;
  readonly countsByTour: Readonly<Record<string, number>>;
  readonly countsByEventFamily: Readonly<Record<string, number>>;
  readonly folds: readonly ComparableEvaluationFold[];
}

export interface ComparableEvaluation {
  readonly releaseId: string;
  readonly sourceCutoff: string;
  readonly selectionProtocolId: typeof COMPARABLE_SELECTION_PROTOCOL_ID;
  readonly taxonomyVersion: typeof COMPARABLE_TAXONOMY_VERSION;
  readonly distributionMethodId: typeof COMPARABLE_DISTRIBUTION_METHOD_ID;
  readonly requestedComparables: number;
  readonly minimumDistributionN: number;
  readonly chronological: ComparableEvaluationSummary;
  readonly leaveOneFestivalOut: ComparableEvaluationSummary;
  readonly limitations: readonly string[];
}

function fail(message: string, code: string): never {
  throw new SeriesMarketValidationError(message, code);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return canonicalStringSet(values);
}

function cloneMoney(value: MoneyClaimValue): ComparableMoney {
  return {
    minorUnits: normalizeIntegerString(value.minorUnits),
    currency: value.currency,
    scale: value.scale,
  };
}

function fieldIssue(field: VerifiedField, isBuyIn = false): ComparableExclusionCode | null {
  if (field.state === "conflict") return "CONFLICTING_INPUT";
  if (field.state === "missing" || field.value === null) return isBuyIn ? "MISSING_BUY_IN" : "MISSING_REQUIRED_INPUT";
  return null;
}

function resolvedClaimIds(field: VerifiedField): readonly string[] {
  return sortedUnique(field.activeClaimIds);
}

function resolveFamily(eventType: string): EventFamily {
  return JEJU_EVENT_FAMILY_TAXONOMY_V0[eventType.normalize("NFC").trim()] ?? "unknown";
}

function asText(field: VerifiedField): string | null {
  return field.state === "resolved" && field.value?.type === "text" ? field.value.value : null;
}

function asDate(field: VerifiedField): string | null {
  return field.state === "resolved" && field.value?.type === "local_date" ? field.value.value : null;
}

function asMoney(field: VerifiedField): ComparableMoney | null {
  return field.state === "resolved" && field.value?.type === "money" ? cloneMoney(field.value) : null;
}

function asBoolean(field: VerifiedField): boolean | null {
  return field.state === "resolved" && field.value?.type === "boolean" ? field.value.value : null;
}

function asOutcome(event: VerifiedEventRow): ComparableOutcome | null {
  const field = event.fields.entries;
  if (field.state !== "resolved" || field.value?.type !== "integer") return null;
  const entries = normalizeIntegerString(field.value.value);
  if (BigInt(entries) < 0n) return null;
  return { eventId: event.id, entries, claimIds: resolvedClaimIds(field) };
}

function buildCandidate(event: VerifiedEventRow, festival: VerifiedFestivalRow | undefined): ComparableCandidate {
  const issues: ComparableExclusionCode[] = [];
  const tourField = festival?.fields.tour;
  if (!festival || !tourField) issues.push("MISSING_REQUIRED_INPUT");

  const fields = [
    event.fields.event_date,
    event.fields.event_type,
    event.fields.game,
    event.fields.buy_in,
    event.fields.is_flagship,
    tourField,
  ].filter((field): field is VerifiedField => field !== undefined);
  for (const field of fields) {
    const issue = fieldIssue(field, field.key === "buy_in");
    if (issue) issues.push(issue);
  }
  if (event.fields.gtd.state === "conflict") issues.push("CONFLICTING_INPUT");

  const eventDate = asDate(event.fields.event_date);
  const eventType = asText(event.fields.event_type);
  const game = asText(event.fields.game);
  const buyIn = asMoney(event.fields.buy_in);
  const flagship = asBoolean(event.fields.is_flagship);
  const tour = tourField ? asText(tourField) : null;
  const family = eventType === null ? "unknown" : resolveFamily(eventType);
  if (family === "unknown") issues.push("UNKNOWN_EVENT_FAMILY");
  const gtd = asMoney(event.fields.gtd);
  if (buyIn !== null && gtd !== null && buyIn.currency !== gtd.currency) issues.push("CONFLICTING_INPUT");

  const selectionIssues = sortedUnique(issues) as readonly ComparableExclusionCode[];
  if (
    selectionIssues.length > 0
    || eventDate === null
    || eventType === null
    || game === null
    || buyIn === null
    || flagship === null
    || tour === null
  ) {
    return { eventId: event.id, selection: null, selectionIssues };
  }

  const inputClaimIds = sortedUnique([
    ...resolvedClaimIds(event.fields.event_date),
    ...resolvedClaimIds(event.fields.event_type),
    ...resolvedClaimIds(event.fields.game),
    ...resolvedClaimIds(event.fields.buy_in),
    ...resolvedClaimIds(event.fields.gtd),
    ...resolvedClaimIds(event.fields.is_flagship),
    ...resolvedClaimIds(tourField),
  ]);
  return {
    eventId: event.id,
    selection: {
      eventId: event.id,
      festivalId: event.festivalId,
      festivalKey: event.festivalKey,
      tour,
      eventDate,
      eventType,
      eventFamily: family,
      game,
      currency: buyIn.currency,
      buyIn,
      gtd,
      flagship,
      inputClaimIds,
    },
    selectionIssues: [],
  };
}

/** Builds a public corpus from the locked read model only; it never reads the legacy CSV. */
export function buildJejuComparableCorpus(model: VerifiedMarketReadModel): ComparableCorpus {
  const festivals = new Map(model.festivals.map((festival) => [festival.id, festival] as const));
  const candidates = model.events
    .map((event) => buildCandidate(event, festivals.get(event.festivalId)))
    .sort((a, b) => compareCanonicalStrings(a.eventId, b.eventId));
  const outcomes = model.events
    .map(asOutcome)
    .filter((outcome): outcome is ComparableOutcome => outcome !== null)
    .sort((a, b) => compareCanonicalStrings(a.eventId, b.eventId));
  return {
    releaseId: model.releaseId,
    sourceCutoff: model.sourceCutoff,
    selectionProtocolId: COMPARABLE_SELECTION_PROTOCOL_ID,
    taxonomyVersion: COMPARABLE_TAXONOMY_VERSION,
    distributionMethodId: COMPARABLE_DISTRIBUTION_METHOD_ID,
    candidates,
    outcomeEventIds: outcomes.map((outcome) => outcome.eventId),
    outcomes,
  };
}

function normalizedSelectionOptions(options: ComparableSelectionOptions = {}): Required<ComparableSelectionOptions> {
  const requestedComparables = options.requestedComparables ?? DEFAULT_REQUESTED_COMPARABLES;
  if (!Number.isInteger(requestedComparables) || requestedComparables <= 0) {
    fail("requestedComparables must be a positive integer", "INVALID_COMPARABLE_COUNT");
  }
  return {
    requestedComparables,
    chronologyOriginDate: options.chronologyOriginDate ?? null,
    excludedEventIds: sortedUnique(options.excludedEventIds ?? []),
    excludedFestivalIds: sortedUnique(options.excludedFestivalIds ?? []),
  };
}

function compareMoneyMagnitude(left: ComparableMoney, right: ComparableMoney): number {
  const leftValue = BigInt(left.minorUnits) * (10n ** BigInt(right.scale));
  const rightValue = BigInt(right.minorUnits) * (10n ** BigInt(left.scale));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function ratioBand(left: ComparableMoney, right: ComparableMoney): RatioBand {
  const comparison = compareMoneyMagnitude(left, right);
  if (comparison === 0) return "within_1_25x";
  const larger = comparison > 0 ? left : right;
  const smaller = comparison > 0 ? right : left;
  const largerValue = BigInt(larger.minorUnits) * (10n ** BigInt(smaller.scale));
  const smallerValue = BigInt(smaller.minorUnits) * (10n ** BigInt(larger.scale));
  if (smallerValue === 0n) return "beyond_4x";
  if (largerValue * 4n <= smallerValue * 5n) return "within_1_25x";
  if (largerValue * 2n <= smallerValue * 3n) return "within_1_5x";
  if (largerValue <= smallerValue * 2n) return "within_2x";
  if (largerValue <= smallerValue * 4n) return "within_4x";
  return "beyond_4x";
}

const RATIO_ORDER: Readonly<Record<RatioBand, number>> = {
  within_1_25x: 0,
  within_1_5x: 1,
  within_2x: 2,
  within_4x: 3,
  beyond_4x: 4,
};

const EVENT_TYPE_ORDER: Readonly<Record<EventTypeMatch, number>> = { exact: 0, family: 1, different: 2 };

function dateDistanceDays(left: string, right: string): number {
  const toDay = (value: string): number => {
    const [year, month, day] = value.split("-").map((part) => parseInt(part, 10));
    return Date.UTC(year!, month! - 1, day!) / 86_400_000;
  };
  return Math.abs(toDay(left) - toDay(right));
}

function rankBreakdown(target: ComparableSelectionInput, candidate: ComparableSelectionInput): ComparableRankBreakdown {
  const eventTypeMatch: EventTypeMatch = target.eventType === candidate.eventType
    ? "exact"
    : target.eventFamily === candidate.eventFamily
      ? "family"
      : "different";
  const buyInRatioBand = ratioBand(target.buyIn, candidate.buyIn);
  const gtdSimilarity: GtdSimilarity = target.gtd === null || candidate.gtd === null
    ? "missing_gtd"
    : ratioBand(target.gtd, candidate.gtd);
  const flagshipMatch = target.flagship === candidate.flagship;
  const tourMatch = target.tour === candidate.tour;
  const reasonCodes = [
    eventTypeMatch === "exact" ? "EXACT_EVENT_TYPE" : eventTypeMatch === "family" ? "SAME_EVENT_FAMILY" : "DIFFERENT_EVENT_FAMILY",
    `BUY_IN_${buyInRatioBand.toUpperCase()}`,
    gtdSimilarity === "missing_gtd" ? "MISSING_GTD_PENALTY" : `GTD_${gtdSimilarity.toUpperCase()}`,
    flagshipMatch ? "FLAGSHIP_MATCH" : "FLAGSHIP_DIFFERENT",
    tourMatch ? "TOUR_MATCH" : "TOUR_DIFFERENT",
  ];
  return {
    eventTypeMatch,
    buyInRatioBand,
    gtdSimilarity,
    flagshipMatch,
    tourMatch,
    eventDateDistanceDays: dateDistanceDays(target.eventDate, candidate.eventDate),
    reasonCodes,
  };
}

function compareAssessments(left: ComparableCandidateAssessment, right: ComparableCandidateAssessment): number {
  const a = left.rank;
  const b = right.rank;
  if (!a || !b) return compareCanonicalStrings(left.eventId, right.eventId);
  const dimensions = [
    EVENT_TYPE_ORDER[a.eventTypeMatch] - EVENT_TYPE_ORDER[b.eventTypeMatch],
    RATIO_ORDER[a.buyInRatioBand] - RATIO_ORDER[b.buyInRatioBand],
    (a.gtdSimilarity === "missing_gtd" ? 5 : RATIO_ORDER[a.gtdSimilarity]) - (b.gtdSimilarity === "missing_gtd" ? 5 : RATIO_ORDER[b.gtdSimilarity]),
    a.flagshipMatch === b.flagshipMatch ? 0 : a.flagshipMatch ? -1 : 1,
    a.tourMatch === b.tourMatch ? 0 : a.tourMatch ? -1 : 1,
    a.eventDateDistanceDays - b.eventDateDistanceDays,
  ];
  for (const difference of dimensions) if (difference !== 0) return difference;
  return compareCanonicalStrings(left.eventId, right.eventId);
}

function countReasons(assessments: readonly ComparableCandidateAssessment[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const assessment of assessments) {
    for (const reason of assessment.exclusionReasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareCanonicalStrings(a, b)));
}

function hasInconsistentCurrency(input: ComparableSelectionInput): boolean {
  return input.buyIn.currency !== input.currency || (input.gtd !== null && input.gtd.currency !== input.currency);
}

/**
 * Freeze selection using only selection-shaped candidates plus availability IDs.
 * It deliberately cannot read outcome counts, so entries values cannot affect rank order.
 */
export function freezeComparableSelection(
  targetCandidate: ComparableCandidate,
  candidates: readonly ComparableCandidate[],
  outcomeEventIds: ReadonlySet<string>,
  options: ComparableSelectionOptions = {},
): FrozenComparableSelection {
  const normalized = normalizedSelectionOptions(options);
  const target = targetCandidate.selection;
  const targetIssues: readonly ComparableExclusionCode[] = target === null
    ? sortedUnique(targetCandidate.selectionIssues.length > 0 ? targetCandidate.selectionIssues : ["TARGET_INPUT_UNAVAILABLE"]) as readonly ComparableExclusionCode[]
    : sortedUnique([
      ...(target.eventFamily === "unknown" ? ["UNKNOWN_EVENT_FAMILY"] : []),
      ...(hasInconsistentCurrency(target) ? ["CONFLICTING_INPUT"] : []),
    ]) as readonly ComparableExclusionCode[];
  const excludedEvents = new Set(normalized.excludedEventIds);
  const excludedFestivals = new Set(normalized.excludedFestivalIds);

  const assessments = [...candidates]
    .sort((a, b) => compareCanonicalStrings(a.eventId, b.eventId))
    .map((candidate): ComparableCandidateAssessment => {
      const reasons: ComparableExclusionCode[] = [];
      if (target === null || targetIssues.length > 0) {
        reasons.push("TARGET_INPUT_UNAVAILABLE");
      } else if (candidate.eventId === target.eventId) {
        reasons.push("SELF");
      } else if (candidate.selection === null) {
        reasons.push(...candidate.selectionIssues);
      } else {
        const input = candidate.selection;
        if (hasInconsistentCurrency(input)) reasons.push("CONFLICTING_INPUT");
        if (input.currency !== target.currency) reasons.push("CURRENCY_MISMATCH");
        if (input.game !== target.game) reasons.push("GAME_MISMATCH");
        if (input.eventFamily === "unknown") reasons.push("UNKNOWN_EVENT_FAMILY");
        if (!outcomeEventIds.has(input.eventId)) reasons.push("MISSING_ENTRIES_OUTCOME");
        if (normalized.chronologyOriginDate !== null && input.eventDate >= normalized.chronologyOriginDate) reasons.push("NOT_BEFORE_ORIGIN");
        if (excludedEvents.has(input.eventId)) reasons.push("EXCLUDED_EVENT");
        if (excludedFestivals.has(input.festivalId)) reasons.push("EXCLUDED_FESTIVAL");
      }
      const uniqueReasons = sortedUnique(reasons) as readonly ComparableExclusionCode[];
      const rank = uniqueReasons.length === 0 && target !== null && candidate.selection !== null
        ? rankBreakdown(target, candidate.selection)
        : null;
      return { eventId: candidate.eventId, eligible: rank !== null, exclusionReasons: uniqueReasons, rank };
    });

  const inputById = new Map(candidates.flatMap((candidate) => candidate.selection ? [[candidate.eventId, candidate.selection] as const] : []));
  const eligible = assessments.filter((assessment) => assessment.eligible).sort(compareAssessments);
  const selectedAssessments = eligible.slice(0, normalized.requestedComparables);
  const selectedComparableIds = selectedAssessments.map((assessment) => assessment.eventId);
  const selectedComparables = selectedComparableIds.map((id) => inputById.get(id)).filter((input): input is ComparableSelectionInput => input !== undefined);
  const buyInBandCounts: Record<RatioBand, number> = {
    within_1_25x: 0,
    within_1_5x: 0,
    within_2x: 0,
    within_4x: 0,
    beyond_4x: 0,
  };
  for (const assessment of selectedAssessments) if (assessment.rank) buyInBandCounts[assessment.rank.buyInRatioBand] += 1;
  const exactMatchCount = selectedAssessments.filter((assessment) => assessment.rank?.eventTypeMatch === "exact").length;
  const familyMatchCount = selectedAssessments.filter((assessment) => assessment.rank?.eventTypeMatch === "family").length;
  const missingGtdCount = selectedAssessments.filter((assessment) => assessment.rank?.gtdSimilarity === "missing_gtd").length;
  return {
    targetId: targetCandidate.eventId,
    requestedComparables: normalized.requestedComparables,
    targetIssues,
    selectedComparableIds,
    selectedComparables,
    assessments,
    exclusionCounts: countReasons(assessments),
    exactMatchCount,
    familyMatchCount,
    buyInBandCounts,
    missingGtdCount,
  };
}

function nearestRankIndex(length: number, percentile: number): number {
  if (length <= 0) fail("nearest rank requires observations", "EMPTY_DISTRIBUTION");
  return Math.floor((length * percentile + 99) / 100) - 1;
}

function distributionQuality(n: number, minimumN: number, exactMatches: number, familyMatches: number): ComparableQuality {
  if (n < minimumN) return "insufficient";
  if (n >= 12 && exactMatches * 100 >= n * 60) return "high";
  if (n >= 8 && (exactMatches + familyMatches) * 100 >= n * 75) return "medium";
  return "low";
}

/** Count-only nearest-rank quantiles. It accepts outcomes only after selection is already frozen. */
export function buildComparableDistribution(
  outcomes: readonly ComparableOutcome[],
  input: { readonly minimumN?: number; readonly exactMatches?: number; readonly familyMatches?: number } = {},
): ComparableDistribution {
  const minimumN = input.minimumN ?? DEFAULT_MINIMUM_DISTRIBUTION_N;
  if (!Number.isInteger(minimumN) || minimumN <= 0) fail("minimumN must be a positive integer", "INVALID_MINIMUM_N");
  const values = outcomes.map((outcome) => normalizeIntegerString(outcome.entries));
  if (values.some((value) => BigInt(value) < 0n)) fail("entries outcomes must be non-negative", "NEGATIVE_ENTRIES_OUTCOME");
  const observedEntries = [...values].sort((a, b) => {
    const left = BigInt(a);
    const right = BigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const n = observedEntries.length;
  const quality = n < minimumN
    ? "insufficient"
    : distributionQuality(n, minimumN, input.exactMatches ?? 0, input.familyMatches ?? 0);
  const limitations = n < minimumN
    ? [
      `Comparable Distribution is insufficient: N=${n}, minimum N=${minimumN}.`,
      "No P10/P90 is emitted for an insufficient historical sample.",
      "Exploratory Historical Benchmark only; not a calibrated forecast.",
    ]
    : [
      "Nearest-rank count quantiles over frozen comparable outcomes.",
      "Exploratory Historical Benchmark only; not a calibrated forecast.",
      "Evidence quality reflects sample size and event-family homogeneity, not causal validity.",
    ];
  if (n < minimumN) {
    return {
      label: "Historical Benchmark",
      methodId: COMPARABLE_DISTRIBUTION_METHOD_ID,
      state: "insufficient",
      quality,
      n,
      minimumN,
      observedEntries,
      minimum: null,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
      maximum: null,
      iqr: null,
      limitations,
    };
  }
  const pick = (percentile: number): string => observedEntries[nearestRankIndex(n, percentile)]!;
  const p25 = pick(25);
  const p75 = pick(75);
  return {
    label: "Historical Benchmark",
    methodId: COMPARABLE_DISTRIBUTION_METHOD_ID,
    state: "available",
    quality,
    n,
    minimumN,
    observedEntries,
    minimum: observedEntries[0]!,
    p10: pick(10),
    p25,
    p50: pick(50),
    p75,
    p90: pick(90),
    maximum: observedEntries.at(-1)!,
    iqr: (BigInt(p75) - BigInt(p25)).toString(),
    limitations,
  };
}

function candidateIdentityPayload(candidate: ComparableCandidate): Record<string, unknown> {
  return candidate.selection === null
    ? { eventId: candidate.eventId, selectionIssues: sortedUnique(candidate.selectionIssues) }
    : {
      eventId: candidate.selection.eventId,
      festivalId: candidate.selection.festivalId,
      festivalKey: candidate.selection.festivalKey,
      tour: candidate.selection.tour,
      eventDate: candidate.selection.eventDate,
      eventType: candidate.selection.eventType,
      eventFamily: candidate.selection.eventFamily,
      game: candidate.selection.game,
      currency: candidate.selection.currency,
      buyIn: candidate.selection.buyIn,
      gtd: candidate.selection.gtd,
      flagship: candidate.selection.flagship,
      inputClaimIds: sortedUnique(candidate.selection.inputClaimIds),
    };
}

function outcomeMap(corpus: ComparableCorpus): ReadonlyMap<string, ComparableOutcome> {
  return new Map(corpus.outcomes.map((outcome) => [outcome.eventId, outcome] as const));
}

function selectedOutcomes(corpus: ComparableCorpus, selectedIds: readonly string[]): readonly ComparableOutcome[] {
  const byId = outcomeMap(corpus);
  return selectedIds.map((id) => {
    const outcome = byId.get(id);
    if (!outcome) fail(`selected candidate has no outcome: ${id}`, "OUTCOME_JOIN_FAILED");
    return outcome;
  });
}

/** Builds an immutable, provenance-rich exploratory benchmark. No current timestamp is generated. */
export async function analyzeComparableEvent(
  corpus: ComparableCorpus,
  targetId: string,
  options: ComparableSelectionOptions & { readonly minimumDistributionN?: number; readonly analysisTimestamp?: string | null } = {},
): Promise<ComparableAnalysis> {
  const target = corpus.candidates.find((candidate) => candidate.eventId === targetId);
  if (!target) fail(`target event is not in the corpus: ${targetId}`, "TARGET_NOT_FOUND");
  const outcomeIds = new Set(corpus.outcomeEventIds);
  const selection = freezeComparableSelection(target, corpus.candidates, outcomeIds, options);
  const distribution = buildComparableDistribution(selectedOutcomes(corpus, selection.selectedComparableIds), {
    minimumN: options.minimumDistributionN,
    exactMatches: selection.exactMatchCount,
    familyMatches: selection.familyMatchCount,
  });
  const analysisTimestamp = options.analysisTimestamp === undefined || options.analysisTimestamp === null
    ? null
    : normalizeInstant(options.analysisTimestamp);
  const targetInputHash = await canonicalHash({
    namespace: `${COMPARABLE_ANALYSIS_NAMESPACE}:${COMPARABLE_SELECTION_PROTOCOL_ID}:target-input`,
    releaseId: corpus.releaseId,
    taxonomyVersion: corpus.taxonomyVersion,
    target: candidateIdentityPayload(target),
  });
  const selectedComparableIds = sortedUnique(selection.selectedComparableIds);
  const idDigest = await canonicalHash({
    namespace: `${COMPARABLE_ANALYSIS_NAMESPACE}:${COMPARABLE_SELECTION_PROTOCOL_ID}`,
    releaseId: corpus.releaseId,
    sourceCutoff: corpus.sourceCutoff,
    selectionProtocolId: corpus.selectionProtocolId,
    taxonomyVersion: corpus.taxonomyVersion,
    distributionMethodId: corpus.distributionMethodId,
    targetInputHash,
    selectedComparableIds,
    analysisTimestamp,
  });
  const provenance: ComparableAnalysisProvenance = {
    releaseId: corpus.releaseId,
    sourceCutoff: corpus.sourceCutoff,
    selectionProtocolId: corpus.selectionProtocolId,
    taxonomyVersion: corpus.taxonomyVersion,
    distributionMethodId: corpus.distributionMethodId,
    targetInputHash,
    selectedComparableIds,
    analysisTimestamp,
  };
  return {
    id: `${COMPARABLE_ANALYSIS_NAMESPACE}:${COMPARABLE_SELECTION_PROTOCOL_ID}:${idDigest}`,
    state: distribution.state,
    target: target.selection,
    targetIssues: selection.targetIssues,
    selection,
    distribution,
    provenance,
    limitations: [
      "Comparable selection uses only pre-outcome inputs; entries join after comparable IDs freeze.",
      "No FX conversion, GTD probability, rake economics, causal claim, or production forecast is included.",
      ...distribution.limitations,
    ],
  };
}

function baselineCandidateIds(
  target: ComparableSelectionInput,
  candidates: readonly ComparableCandidate[],
  outcomeIds: ReadonlySet<string>,
  excludedFestivalIds: ReadonlySet<string>,
): readonly string[] {
  return candidates
    .flatMap((candidate) => candidate.selection ? [candidate.selection] : [])
    .filter((candidate) =>
      candidate.eventId !== target.eventId
      && candidate.currency === target.currency
      && candidate.game === target.game
      && candidate.eventDate < target.eventDate
      && outcomeIds.has(candidate.eventId)
      && !excludedFestivalIds.has(candidate.festivalId),
    )
    .map((candidate) => candidate.eventId)
    .sort(compareCanonicalStrings);
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareCanonicalStrings(a, b)));
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

function errorMetrics(
  folds: readonly ComparableEvaluationFold[],
  distributionFor: (fold: ComparableEvaluationFold) => ComparableDistribution,
): ComparableErrorMetrics | null {
  const usable = folds.filter((fold) => distributionFor(fold).state === "available");
  if (usable.length === 0) return null;
  let totalAbsolute = 0n;
  let totalSigned = 0n;
  let covered = 0;
  let width = 0n;
  const absoluteErrors: bigint[] = [];
  for (const fold of usable) {
    const distribution = distributionFor(fold);
    const actual = BigInt(fold.targetEntries);
    const p50 = BigInt(distribution.p50!);
    const signed = p50 - actual;
    const absolute = signed < 0n ? -signed : signed;
    totalSigned += signed;
    totalAbsolute += absolute;
    absoluteErrors.push(absolute);
    const p10 = BigInt(distribution.p10!);
    const p90 = BigInt(distribution.p90!);
    if (actual >= p10 && actual <= p90) covered += 1;
    width += p90 - p10;
  }
  absoluteErrors.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    folds: usable.length,
    totalAbsoluteError: totalAbsolute.toString(),
    meanAbsoluteError: fixedRatio(totalAbsolute, BigInt(usable.length)),
    medianAbsoluteError: absoluteErrors[nearestRankIndex(absoluteErrors.length, 50)]!.toString(),
    signedBias: fixedRatio(totalSigned, BigInt(usable.length)),
    intervalAvailableFolds: usable.length,
    intervalCoveredFolds: covered,
    intervalCoverage: fixedRatio(BigInt(covered), BigInt(usable.length)),
    averageIntervalWidth: fixedRatio(width, BigInt(usable.length)),
  };
}

function comparisonState(
  comparable: ComparableErrorMetrics | null,
  baseline: ComparableErrorMetrics | null,
): ComparableEvaluationSummary["comparisonState"] {
  if (!comparable || !baseline || comparable.folds < COMPARISON_MINIMUM_FOLDS || baseline.folds < COMPARISON_MINIMUM_FOLDS) {
    return "insufficient_pairs";
  }
  const comparableTotal = BigInt(comparable.totalAbsoluteError);
  const baselineTotal = BigInt(baseline.totalAbsoluteError);
  return comparableTotal < baselineTotal
    ? "comparable_lower_mae"
    : comparableTotal > baselineTotal
      ? "baseline_lower_mae"
      : "mae_tied";
}

function evaluateFolds(
  corpus: ComparableCorpus,
  options: Required<ComparableEvaluationOptions>,
  leaveOneFestivalOut: boolean,
): ComparableEvaluationSummary {
  const outcomeIds = new Set(corpus.outcomeEventIds);
  const outcomes = outcomeMap(corpus);
  const targets = corpus.candidates
    .filter((candidate) => candidate.selection !== null && outcomeIds.has(candidate.eventId))
    .sort((a, b) => {
      const left = a.selection!;
      const right = b.selection!;
      return left.eventDate === right.eventDate
        ? compareCanonicalStrings(left.eventId, right.eventId)
        : compareCanonicalStrings(left.eventDate, right.eventDate);
    });
  const folds: ComparableEvaluationFold[] = [];
  for (const target of targets) {
    const input = target.selection!;
    const excludedFestivalIds = leaveOneFestivalOut ? [input.festivalId] : [];
    const selection = freezeComparableSelection(target, corpus.candidates, outcomeIds, {
      requestedComparables: options.requestedComparables,
      chronologyOriginDate: input.eventDate,
      excludedFestivalIds,
    });
    const baselineIds = baselineCandidateIds(input, corpus.candidates, outcomeIds, new Set(excludedFestivalIds));
    const comparable = buildComparableDistribution(selectedOutcomes(corpus, selection.selectedComparableIds), {
      minimumN: options.minimumDistributionN,
      exactMatches: selection.exactMatchCount,
      familyMatches: selection.familyMatchCount,
    });
    const baseline = buildComparableDistribution(selectedOutcomes(corpus, baselineIds), {
      minimumN: options.minimumDistributionN,
      exactMatches: 0,
      familyMatches: 0,
    });
    const targetOutcome = outcomes.get(input.eventId);
    if (!targetOutcome) fail(`eligible evaluation target has no outcome: ${input.eventId}`, "EVALUATION_OUTCOME_MISSING");
    folds.push({
      targetId: input.eventId,
      targetEntries: targetOutcome.entries,
      targetDate: input.eventDate,
      currency: input.currency,
      game: input.game,
      tour: input.tour,
      eventFamily: input.eventFamily,
      selectedComparableIds: selection.selectedComparableIds,
      baselineCandidateIds: baselineIds,
      comparable,
      baseline,
    });
  }
  const comparableFolds = folds.filter((fold) => fold.comparable.state === "available");
  const pairedFolds = folds.filter((fold) => fold.comparable.state === "available" && fold.baseline.state === "available");
  const comparableMetrics = errorMetrics(comparableFolds, (fold) => fold.comparable);
  const baselineMetrics = errorMetrics(pairedFolds, (fold) => fold.baseline);
  const pairedComparableMetrics = errorMetrics(pairedFolds, (fold) => fold.comparable);
  return {
    eligibleTargets: targets.length,
    comparableAvailableFolds: comparableFolds.length,
    comparableInsufficientFolds: folds.length - comparableFolds.length,
    baselineAvailableFolds: folds.filter((fold) => fold.baseline.state === "available").length,
    pairedAvailableFolds: pairedFolds.length,
    comparableMetrics,
    comparableMetricsOnPairedFolds: pairedComparableMetrics,
    baselineMetricsOnPairedFolds: baselineMetrics,
    comparisonState: comparisonState(pairedComparableMetrics, baselineMetrics),
    countsByCurrency: countBy(targets.map((target) => target.selection!.currency)),
    countsByGame: countBy(targets.map((target) => target.selection!.game)),
    countsByTour: countBy(targets.map((target) => target.selection!.tour)),
    countsByEventFamily: countBy(targets.map((target) => target.selection!.eventFamily)),
    folds,
  };
}

/** Deterministic chronological and leave-one-festival-out evaluation; no random split is used. */
export function evaluateComparableV0(
  corpus: ComparableCorpus,
  options: ComparableEvaluationOptions = {},
): ComparableEvaluation {
  const requestedComparables = options.requestedComparables ?? DEFAULT_REQUESTED_COMPARABLES;
  const minimumDistributionN = options.minimumDistributionN ?? DEFAULT_MINIMUM_DISTRIBUTION_N;
  if (!Number.isInteger(requestedComparables) || requestedComparables <= 0) {
    fail("requestedComparables must be a positive integer", "INVALID_COMPARABLE_COUNT");
  }
  if (!Number.isInteger(minimumDistributionN) || minimumDistributionN <= 0) {
    fail("minimumDistributionN must be a positive integer", "INVALID_MINIMUM_N");
  }
  const normalized = { requestedComparables, minimumDistributionN };
  return {
    releaseId: corpus.releaseId,
    sourceCutoff: corpus.sourceCutoff,
    selectionProtocolId: corpus.selectionProtocolId,
    taxonomyVersion: corpus.taxonomyVersion,
    distributionMethodId: corpus.distributionMethodId,
    requestedComparables,
    minimumDistributionN,
    chronological: evaluateFolds(corpus, normalized, false),
    leaveOneFestivalOut: evaluateFolds(corpus, normalized, true),
    limitations: [
      "Chronological folds use only strictly earlier candidate dates.",
      "Leave-one-festival-out excludes the target festival but does not prove out-of-market generalization.",
      "Metrics are exploratory historical benchmarks, not calibrated production forecasts.",
      "No random split, FX conversion, GTD probability, or causal claim is used.",
    ],
  };
}
