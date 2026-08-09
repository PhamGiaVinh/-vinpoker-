import {
  DECISION_PACKET_HASH_CONTRACT_VERSION,
  hashDecisionPacketV1,
  normalizeDecisionPacketCanonicalValue,
  normalizeDecisionPacketText,
  normalizeDecisionPacketTextSet,
  compareDecisionPacketUtf8,
  type D2ACanonicalValue,
  DecisionPacketCanonicalError,
} from "./decisionPacketCanonicalV1";

export const DECISION_PACKET_SCHEMA_VERSION = "series-decision-packet-v1" as const;
export const EVENT_ACTUAL_REVISION_SCHEMA_VERSION = "series-event-actual-revision-v1" as const;
export { DECISION_PACKET_HASH_CONTRACT_VERSION } from "./decisionPacketCanonicalV1";

export type DecisionPacketHorizon = "T-21" | "T-7" | "T-1" | "T-0";
export type DecisionTargetMetric = "entries" | "unique_players" | "total_bullets";
export type DecisionForecastState =
  | "no_forecast_available"
  | "manual_expectation"
  | "forecast_provenance_incomplete"
  | "forecast_not_identity_eligible"
  | "forecast_identity_eligible";
export type DecisionEvidenceKind =
  | "forecast_snapshot"
  | "public_research_artifact"
  | "registration_slice"
  | "campaign_slice";
export type RecommendationSourceKind =
  | "forecast_snapshot"
  | "research_artifact";

export type EventOutcomeScope =
  | "event_total"
  | "flight_only"
  | "day_total"
  | "series_total"
  | "partial_result"
  | "unknown";
export type EventActualFinality =
  | "partial"
  | "provisional"
  | "final"
  | "corrected"
  | "conflicting"
  | "void";
export type EventActualSourceKind =
  | "native_tournament_system"
  | "auto_capture"
  | "owner_manual"
  | "reconciled"
  | "legacy_decision_log"
  | "import_verified";
export type EventActualReconciliationStatus =
  | "auto_only"
  | "manual_only"
  | "matching"
  | "mismatch"
  | "manually_reconciled"
  | "blocked_conflict";
export type MetricAvailability =
  | "present"
  | "missing"
  | "explicit_zero"
  | "uncertain"
  | "conflicting"
  | "not_applicable";
export type SourceTimestampState = "exact" | "not_reported";

export type CanonicalValue = D2ACanonicalValue;

export interface DecisionEvidenceReferenceInput {
  readonly kind: DecisionEvidenceKind;
  readonly referenceId: string;
  readonly contentHash: string;
  readonly sourceCutoff: string;
}

export interface DecisionEvidenceReference {
  readonly kind: DecisionEvidenceKind;
  readonly referenceId: string;
  readonly contentHash: string;
  readonly sourceCutoff: string;
}

export interface DecisionInputSliceInput {
  readonly manifestId: string;
  readonly contentHash: string;
  readonly observationCount: number;
  readonly sourceCutoff: string;
}

export interface DecisionInputSlice {
  readonly manifestId: string;
  readonly contentHash: string;
  readonly observationCount: number;
  readonly sourceCutoff: string;
}

export interface SourcedRecommendationInput {
  readonly text: string;
  readonly sourceKind: RecommendationSourceKind;
  readonly sourceReferenceId: string;
}

export interface SourcedRecommendation {
  readonly text: string;
  readonly sourceKind: RecommendationSourceKind;
  readonly sourceReferenceId: string;
}

export interface DecisionPacketContentInput {
  readonly clubId: string;
  readonly eventId: string;
  readonly horizon: DecisionPacketHorizon;
  readonly targetMetric: DecisionTargetMetric;
  readonly asOfTs: string;
  readonly sourceCutoff: string;
  readonly targetEventTs: string;
  readonly forecastSnapshotId: string | null;
  readonly forecastState: DecisionForecastState;
  readonly manualExpectation: number | null;
  readonly publicEvidence: readonly DecisionEvidenceReferenceInput[];
  readonly registrationSlice: DecisionInputSliceInput | null;
  readonly campaignSlice: DecisionInputSliceInput | null;
  readonly knownInformation: CanonicalValue;
  readonly recommendedAction: SourcedRecommendationInput | null;
  readonly ownerDecision: string | null;
  readonly publicAction: string | null;
  readonly decisionReason: string | null;
  readonly alternatives: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertaintyNotes: string | null;
  readonly supersedesPacketId: string | null;
  readonly correctionReason: string | null;
}

export interface DecisionPacketContent {
  readonly hashContractVersion: typeof DECISION_PACKET_HASH_CONTRACT_VERSION;
  readonly schemaVersion: typeof DECISION_PACKET_SCHEMA_VERSION;
  readonly clubId: string;
  readonly eventId: string;
  readonly horizon: DecisionPacketHorizon;
  readonly targetMetric: DecisionTargetMetric;
  readonly asOfTs: string;
  readonly sourceCutoff: string;
  readonly targetEventTs: string;
  readonly forecastSnapshotId: string | null;
  readonly forecastState: DecisionForecastState;
  readonly manualExpectation: number | null;
  readonly publicEvidence: readonly DecisionEvidenceReference[];
  readonly registrationSlice: DecisionInputSlice | null;
  readonly campaignSlice: DecisionInputSlice | null;
  readonly knownInformation: CanonicalValue;
  readonly recommendedAction: SourcedRecommendation | null;
  readonly ownerDecision: string | null;
  readonly publicAction: string | null;
  readonly decisionReason: string | null;
  readonly alternatives: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertaintyNotes: string | null;
  readonly supersedesPacketId: string | null;
  readonly correctionReason: string | null;
  readonly contentHash: string;
}

export interface CountMetricInput {
  readonly availability: MetricAvailability;
  readonly value: number | null;
}

export interface CountMetric {
  readonly availability: MetricAvailability;
  readonly value: number | null;
}

export interface MoneyMetricInput {
  readonly availability: MetricAvailability;
  readonly amountMinor: string | null;
  readonly currency: string | null;
  readonly scale: number | null;
}

export interface MoneyMetric {
  readonly availability: MetricAvailability;
  readonly amountMinor: string | null;
  readonly currency: string | null;
  readonly scale: number | null;
}

export interface EventActualMetricsInput {
  readonly entries: CountMetricInput;
  readonly uniquePlayers: CountMetricInput;
  readonly totalBullets: CountMetricInput;
  readonly reentries: CountMetricInput;
  readonly registrationRecords: CountMetricInput;
  readonly paidPlaces: CountMetricInput;
  readonly prizePool: MoneyMetricInput;
  readonly overlay: MoneyMetricInput;
}

export interface EventActualMetrics {
  readonly entries: CountMetric;
  readonly uniquePlayers: CountMetric;
  readonly totalBullets: CountMetric;
  readonly reentries: CountMetric;
  readonly registrationRecords: CountMetric;
  readonly paidPlaces: CountMetric;
  readonly prizePool: MoneyMetric;
  readonly overlay: MoneyMetric;
}

export interface EventActualRevisionContentInput {
  readonly clubId: string;
  readonly eventId: string;
  readonly scope: EventOutcomeScope;
  readonly finality: EventActualFinality;
  readonly sourceKind: EventActualSourceKind;
  readonly sourceTimestampState: SourceTimestampState;
  readonly sourceTimestamp: string | null;
  readonly capturedAt: string;
  readonly reconciliationStatus: EventActualReconciliationStatus;
  readonly metrics: EventActualMetricsInput;
  readonly supersedesRevisionId: string | null;
  readonly reconcilesAutoRevisionId: string | null;
  readonly reconcilesManualRevisionId: string | null;
  readonly idempotencyKey: string;
  readonly correctionReason: string | null;
}

export interface EventActualRevisionContent {
  readonly hashContractVersion: typeof DECISION_PACKET_HASH_CONTRACT_VERSION;
  readonly schemaVersion: typeof EVENT_ACTUAL_REVISION_SCHEMA_VERSION;
  readonly clubId: string;
  readonly eventId: string;
  readonly scope: EventOutcomeScope;
  readonly finality: EventActualFinality;
  readonly sourceKind: EventActualSourceKind;
  readonly sourceTimestampState: SourceTimestampState;
  readonly sourceTimestamp: string | null;
  readonly capturedAt: string;
  readonly reconciliationStatus: EventActualReconciliationStatus;
  readonly metrics: EventActualMetrics;
  readonly supersedesRevisionId: string | null;
  readonly reconcilesAutoRevisionId: string | null;
  readonly reconcilesManualRevisionId: string | null;
  readonly idempotencyKey: string;
  readonly correctionReason: string | null;
  readonly contentHash: string;
}

export interface EventActualRevision extends EventActualRevisionContent {
  readonly revisionId: string;
}

export interface EventActualRevisionInput extends EventActualRevisionContentInput {
  readonly revisionId: string;
}

export interface DecisionPacketCreateRequestInput extends Omit<DecisionPacketContentInput, "clubId"> {
  readonly idempotencyKey: string;
}

export interface DecisionPacketCreateRequestIdentity {
  readonly canonical: string;
  readonly requestHash: string;
}

export interface EventActualCreateRequestInput {
  readonly eventId: string;
  readonly scope: EventOutcomeScope;
  readonly finality: EventActualFinality;
  readonly sourceTimestampState: SourceTimestampState;
  readonly sourceTimestamp: string | null;
  readonly metrics: EventActualMetricsInput;
  readonly supersedesRevisionId: string | null;
  readonly idempotencyKey: string;
  readonly correctionReason: string | null;
}

export interface EventActualCreateRequestIdentity {
  readonly canonical: string;
  readonly requestHash: string;
}

export type EventActualResolution =
  | { readonly state: "unavailable"; readonly reason: "no_revision" | "all_void" }
  | {
    readonly state: "current";
    readonly revision: EventActualRevision;
    readonly sourceState: "auto_only" | "manual_only" | "reconciled";
  }
  | {
    readonly state: "needs_reconciliation";
    readonly autoRevisionIds: readonly string[];
    readonly manualRevisionIds: readonly string[];
  }
  | {
    readonly state: "conflict";
    readonly reason: "divergent_lineage" | "stale_reconciliation" | "conflicting_revision";
    readonly revisionIds: readonly string[];
  };

export class DecisionPacketValidationError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "DecisionPacketValidationError";
    this.code = code;
  }
}

const FORBIDDEN_INFORMATION_KEYS = new Set([
  "actual",
  "actual_entries",
  "actual_unique_players",
  "actual_reentries",
  "actual_prize_pool",
  "actual_overlay_amount",
  "outcome",
  "outcomes",
  "final_entries",
  "final_unique_players",
  "final_prize_pool",
  "final_overlay",
  "paid_places",
  "finished_place",
  "finishers",
  "payout",
  "payouts",
  "bust_order",
  "post_event_reason",
  "source_entry_id",
  "player_id",
  "user_id",
  "phone",
  "phone_number",
  "email",
  "telegram",
  "id_card",
  "full_name",
]);
const FORBIDDEN_INFORMATION_KEY_COMPACTS = new Set(
  [...FORBIDDEN_INFORMATION_KEYS].map((key) => key.split("_").join("")),
);

const FORECAST_STATES = new Set<DecisionForecastState>([
  "no_forecast_available",
  "manual_expectation",
  "forecast_provenance_incomplete",
  "forecast_not_identity_eligible",
  "forecast_identity_eligible",
]);
const HORIZONS = new Set<DecisionPacketHorizon>(["T-21", "T-7", "T-1", "T-0"]);
const TARGET_METRICS = new Set<DecisionTargetMetric>(["entries", "unique_players", "total_bullets"]);
const EVIDENCE_KINDS = new Set<DecisionEvidenceKind>([
  "forecast_snapshot",
  "public_research_artifact",
  "registration_slice",
  "campaign_slice",
]);
const RECOMMENDATION_SOURCE_KINDS = new Set<RecommendationSourceKind>([
  "forecast_snapshot",
  "research_artifact",
]);
const OUTCOME_SCOPES = new Set<EventOutcomeScope>([
  "event_total",
  "flight_only",
  "day_total",
  "series_total",
  "partial_result",
  "unknown",
]);
const ACTUAL_FINALITIES = new Set<EventActualFinality>([
  "partial",
  "provisional",
  "final",
  "corrected",
  "conflicting",
  "void",
]);
const ACTUAL_SOURCE_KINDS = new Set<EventActualSourceKind>([
  "native_tournament_system",
  "auto_capture",
  "owner_manual",
  "reconciled",
  "legacy_decision_log",
  "import_verified",
]);
const RECONCILIATION_STATUSES = new Set<EventActualReconciliationStatus>([
  "auto_only",
  "manual_only",
  "matching",
  "mismatch",
  "manually_reconciled",
  "blocked_conflict",
]);
const AVAILABILITY_STATES = new Set<MetricAvailability>([
  "present",
  "missing",
  "explicit_zero",
  "uncertain",
  "conflicting",
  "not_applicable",
]);

function fail(message: string, code: string): never {
  throw new DecisionPacketValidationError(message, code);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function hasDisallowedAsciiControl(value: string, allowTextWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127) return true;
    if (code <= 31 && (!allowTextWhitespace || (code !== 9 && code !== 10 && code !== 13))) {
      return true;
    }
  }
  return false;
}

function normalizeReference(raw: string, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be a string`, "INVALID_REFERENCE");
  const value = raw.normalize("NFC").trim();
  if (value.length === 0 || value.length > 512 || hasDisallowedAsciiControl(value, false)) {
    fail(`${label} must be a non-blank canonical reference`, "INVALID_REFERENCE");
  }
  return value;
}

function normalizeUuid(raw: string, label: string): string {
  const value = normalizeReference(raw, label).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    fail(`${label} must be a UUID`, "INVALID_UUID");
  }
  return value;
}

function normalizeIdempotencyKey(raw: string, label: string): string {
  const value = normalizeReference(raw, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/.test(value)) {
    fail(`${label} must be a valid idempotency key`, "INVALID_IDEMPOTENCY_KEY");
  }
  return value;
}

function normalizeText(raw: string | null, label: string, maxLength = 4096): string | null {
  if (raw === null) return null;
  try {
    return normalizeDecisionPacketText(raw, label, maxLength);
  } catch (error) {
    if (error instanceof DecisionPacketCanonicalError) {
      fail(`${label} must be non-blank bounded text`, "INVALID_TEXT");
    }
    throw error;
  }
}

function normalizeHash(raw: string, label: string): string {
  const value = raw.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) fail(`${label} must be a lowercase SHA-256`, "INVALID_HASH");
  return value;
}

function normalizeInstant(raw: string, label: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  const match = value.match(
    /^([1-9]\d{3})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(z|[+-](\d{2}):(\d{2}))$/i,
  );
  if (!match) {
    fail(`${label} must include an explicit UTC offset`, "INVALID_INSTANT");
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText, offset, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number((millisecondText ?? "").padEnd(3, "0"));
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour
    || calendar.getUTCMinutes() !== minute
    || calendar.getUTCSeconds() !== second
    || calendar.getUTCMilliseconds() !== millisecond
    || (offset.toLowerCase() !== "z" && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))
  ) {
    fail(`${label} must be a valid instant`, "INVALID_INSTANT");
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) fail(`${label} must be a valid instant`, "INVALID_INSTANT");
  return new Date(epoch).toISOString();
}

function normalizeCount(raw: number, label: string): number {
  if (!Number.isSafeInteger(raw) || raw < 0) {
    fail(`${label} must be a non-negative safe integer`, "INVALID_COUNT");
  }
  return raw;
}

function normalizeDecimalInteger(raw: string, label: string): string {
  if (typeof raw !== "string" || !/^(0|[1-9]\d*)$/.test(raw)) {
    fail(`${label} must be a canonical non-negative integer string`, "INVALID_MONEY");
  }
  return raw;
}

function normalizeStringList(raw: readonly string[], label: string): readonly string[] {
  try {
    return normalizeDecisionPacketTextSet(raw, label, 2048);
  } catch (error) {
    if (error instanceof DecisionPacketCanonicalError) {
      if (error.code === "DUPLICATE_LIST_MEMBER") fail(`${label} contains a duplicate`, "DUPLICATE_LIST_MEMBER");
      fail(`${label} must be an array of bounded text`, "INVALID_LIST");
    }
    throw error;
  }
}

function normalizeInformationKey(rawKey: string): string {
  return rawKey
    .normalize("NFC")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s._-]+/g, "_")
    .toLowerCase();
}

function assertNoForbiddenInformation(value: CanonicalValue, path = "knownInformation"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenInformation(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [rawKey, nested] of Object.entries(value)) {
      const key = normalizeInformationKey(rawKey);
      if (FORBIDDEN_INFORMATION_KEYS.has(key) || FORBIDDEN_INFORMATION_KEY_COMPACTS.has(key.split("_").join(""))) {
        fail(`${path}.${rawKey} is post-event, identity, or PII data`, "OUTCOME_OR_PII_LEAKAGE");
      }
      assertNoForbiddenInformation(nested, `${path}.${rawKey}`);
    }
  }
}

function normalizeKnownInformation(value: CanonicalValue): CanonicalValue {
  assertNoForbiddenInformation(value);
  let normalized: CanonicalValue;
  try {
    normalized = normalizeDecisionPacketCanonicalValue(value, "knownInformation");
  } catch (error) {
    if (error instanceof DecisionPacketCanonicalError) {
      fail("known information is outside the D2A canonical payload domain", "INVALID_KNOWN_INFORMATION");
    }
    throw error;
  }
  return normalized;
}

function normalizeEvidence(input: DecisionEvidenceReferenceInput): DecisionEvidenceReference {
  if (!EVIDENCE_KINDS.has(input.kind)) fail("unsupported evidence kind", "INVALID_EVIDENCE");
  return {
    kind: input.kind,
    referenceId: normalizeReference(input.referenceId, "evidence reference"),
    contentHash: normalizeHash(input.contentHash, "evidence content hash"),
    sourceCutoff: normalizeInstant(input.sourceCutoff, "evidence source cutoff"),
  };
}

function normalizeEvidenceList(
  input: readonly DecisionEvidenceReferenceInput[],
  packetCutoff: string,
): readonly DecisionEvidenceReference[] {
  if (!Array.isArray(input)) fail("public evidence must be an array", "INVALID_EVIDENCE");
  const evidence = input
    .map(normalizeEvidence)
    .sort((left, right) =>
      compareDecisionPacketUtf8(`${left.kind}:${left.referenceId}`, `${right.kind}:${right.referenceId}`));
  for (let index = 0; index < evidence.length; index += 1) {
    const current = evidence[index];
    if (current.sourceCutoff > packetCutoff) {
      fail("evidence cannot be newer than the packet source cutoff", "EVIDENCE_AFTER_CUTOFF");
    }
    if (
      index > 0
      && current.kind === evidence[index - 1].kind
      && current.referenceId === evidence[index - 1].referenceId
    ) {
      fail("duplicate evidence reference", "DUPLICATE_EVIDENCE");
    }
  }
  return evidence;
}

function normalizeSlice(
  input: DecisionInputSliceInput | null,
  label: string,
  packetCutoff: string,
): DecisionInputSlice | null {
  if (input === null) return null;
  const sourceCutoff = normalizeInstant(input.sourceCutoff, `${label} source cutoff`);
  if (sourceCutoff > packetCutoff) fail(`${label} cannot be newer than the packet cutoff`, "SLICE_AFTER_CUTOFF");
  return {
    manifestId: normalizeReference(input.manifestId, `${label} manifest id`),
    contentHash: normalizeHash(input.contentHash, `${label} content hash`),
    observationCount: normalizeCount(input.observationCount, `${label} observation count`),
    sourceCutoff,
  };
}

function normalizeRecommendation(
  input: SourcedRecommendationInput | null,
  forecastSnapshotId: string | null,
  publicEvidence: readonly DecisionEvidenceReference[],
): SourcedRecommendation | null {
  if (input === null) return null;
  if (!RECOMMENDATION_SOURCE_KINDS.has(input.sourceKind)) {
    fail("unsupported recommendation source", "INVALID_RECOMMENDATION");
  }
  const sourceReferenceId = normalizeReference(input.sourceReferenceId, "recommendation source reference");
  if (input.sourceKind === "forecast_snapshot" && sourceReferenceId !== forecastSnapshotId) {
    fail("forecast recommendation must reference the attached snapshot", "RECOMMENDATION_SOURCE_MISMATCH");
  }
  if (
    input.sourceKind === "research_artifact"
    && !publicEvidence.some((evidence) => (
      evidence.kind === "public_research_artifact"
      && evidence.referenceId === sourceReferenceId
    ))
  ) {
    fail("research recommendation must reference attached research evidence", "RECOMMENDATION_SOURCE_MISMATCH");
  }
  return {
    text: normalizeText(input.text, "recommended action", 4096) as string,
    sourceKind: input.sourceKind,
    sourceReferenceId,
  };
}

function assertForecastShape(
  state: DecisionForecastState,
  targetMetric: DecisionTargetMetric,
  snapshotId: string | null,
  manualExpectation: number | null,
): void {
  if (!FORECAST_STATES.has(state)) fail("unsupported forecast state", "INVALID_FORECAST_STATE");
  if (state === "no_forecast_available") {
    if (snapshotId !== null || manualExpectation !== null) {
      fail("no-forecast state cannot carry a snapshot or expectation", "INVALID_FORECAST_SHAPE");
    }
    return;
  }
  if (state === "manual_expectation") {
    if (snapshotId !== null || manualExpectation === null) {
      fail("manual expectation requires only a manual value", "INVALID_FORECAST_SHAPE");
    }
    return;
  }
  if (snapshotId === null || manualExpectation !== null) {
    fail("forecast provenance states require only a snapshot", "INVALID_FORECAST_SHAPE");
  }
  if (targetMetric !== "entries") {
    fail("current forecast snapshots can only support the entries target", "FORECAST_TARGET_MISMATCH");
  }
}

/**
 * The content payload is deliberately separate from the create-request payload.
 * Content binds the saved packet; the request hash binds caller-controlled inputs
 * while excluding club scope and idempotency transport details.
 */
export function decisionPacketContentHashPayload(
  content: Omit<DecisionPacketContent, "contentHash">,
): unknown {
  return {
    hashContractVersion: content.hashContractVersion,
    schemaVersion: content.schemaVersion,
    clubId: content.clubId,
    eventId: content.eventId,
    horizon: content.horizon,
    targetMetric: content.targetMetric,
    asOfTs: content.asOfTs,
    sourceCutoff: content.sourceCutoff,
    targetEventTs: content.targetEventTs,
    forecastSnapshotId: content.forecastSnapshotId,
    forecastState: content.forecastState,
    manualExpectation: content.manualExpectation,
    publicEvidence: content.publicEvidence,
    registrationSlice: content.registrationSlice,
    campaignSlice: content.campaignSlice,
    knownInformation: content.knownInformation,
    recommendedAction: content.recommendedAction,
    ownerDecision: content.ownerDecision,
    publicAction: content.publicAction,
    decisionReason: content.decisionReason,
    alternatives: content.alternatives,
    assumptions: content.assumptions,
    uncertaintyNotes: content.uncertaintyNotes,
    supersedesPacketId: content.supersedesPacketId,
    correctionReason: content.correctionReason,
  };
}

export function decisionPacketCreateRequestHashPayload(
  content: Omit<DecisionPacketContent, "contentHash" | "clubId">,
): unknown {
  return {
    hashContractVersion: content.hashContractVersion,
    requestKind: "decisionPacketCreateRequest",
    schemaVersion: content.schemaVersion,
    eventId: content.eventId,
    horizon: content.horizon,
    targetMetric: content.targetMetric,
    asOfTs: content.asOfTs,
    sourceCutoff: content.sourceCutoff,
    targetEventTs: content.targetEventTs,
    forecastSnapshotId: content.forecastSnapshotId,
    forecastState: content.forecastState,
    manualExpectation: content.manualExpectation,
    publicEvidence: content.publicEvidence,
    registrationSlice: content.registrationSlice,
    campaignSlice: content.campaignSlice,
    knownInformation: content.knownInformation,
    recommendedAction: content.recommendedAction,
    ownerDecision: content.ownerDecision,
    publicAction: content.publicAction,
    decisionReason: content.decisionReason,
    alternatives: content.alternatives,
    assumptions: content.assumptions,
    uncertaintyNotes: content.uncertaintyNotes,
    supersedesPacketId: content.supersedesPacketId,
    correctionReason: content.correctionReason,
  };
}

export async function buildDecisionPacketContent(
  input: DecisionPacketContentInput,
): Promise<DecisionPacketContent> {
  const clubId = normalizeUuid(input.clubId, "club id");
  const eventId = normalizeUuid(input.eventId, "event id");
  if (!HORIZONS.has(input.horizon)) fail("unsupported decision horizon", "INVALID_HORIZON");
  if (!TARGET_METRICS.has(input.targetMetric)) fail("unsupported target metric", "INVALID_TARGET_METRIC");

  const asOfTs = normalizeInstant(input.asOfTs, "as-of timestamp");
  const sourceCutoff = normalizeInstant(input.sourceCutoff, "source cutoff");
  const targetEventTs = normalizeInstant(input.targetEventTs, "target event timestamp");
  if (sourceCutoff > asOfTs) fail("source cutoff cannot be after as-of", "INVALID_PACKET_TIMING");

  const forecastSnapshotId = input.forecastSnapshotId === null
    ? null
    : normalizeUuid(input.forecastSnapshotId, "forecast snapshot id");
  const manualExpectation = input.manualExpectation === null
    ? null
    : normalizeCount(input.manualExpectation, "manual expectation");
  assertForecastShape(input.forecastState, input.targetMetric, forecastSnapshotId, manualExpectation);

  const knownInformation = normalizeKnownInformation(input.knownInformation);
  const publicEvidence = normalizeEvidenceList(input.publicEvidence, sourceCutoff);
  const registrationSlice = normalizeSlice(input.registrationSlice, "registration slice", sourceCutoff);
  const campaignSlice = normalizeSlice(input.campaignSlice, "campaign slice", sourceCutoff);
  const recommendedAction = normalizeRecommendation(input.recommendedAction, forecastSnapshotId, publicEvidence);
  const supersedesPacketId = input.supersedesPacketId === null
    ? null
    : normalizeUuid(input.supersedesPacketId, "superseded packet id");
  const correctionReason = normalizeText(input.correctionReason, "correction reason", 4096);
  if ((supersedesPacketId === null) !== (correctionReason === null)) {
    fail("packet correction parent and reason must be supplied together", "INVALID_PACKET_CORRECTION");
  }

  const contentWithoutHash = {
    hashContractVersion: DECISION_PACKET_HASH_CONTRACT_VERSION,
    schemaVersion: DECISION_PACKET_SCHEMA_VERSION,
    clubId,
    eventId,
    horizon: input.horizon,
    targetMetric: input.targetMetric,
    asOfTs,
    sourceCutoff,
    targetEventTs,
    forecastSnapshotId,
    forecastState: input.forecastState,
    manualExpectation,
    publicEvidence,
    registrationSlice,
    campaignSlice,
    knownInformation,
    recommendedAction,
    ownerDecision: normalizeText(input.ownerDecision, "owner decision", 4096),
    publicAction: normalizeText(input.publicAction, "public action", 4096),
    decisionReason: normalizeText(input.decisionReason, "decision reason", 8192),
    alternatives: normalizeStringList(input.alternatives, "alternatives"),
    assumptions: normalizeStringList(input.assumptions, "assumptions"),
    uncertaintyNotes: normalizeText(input.uncertaintyNotes, "uncertainty notes", 8192),
    supersedesPacketId,
    correctionReason,
  } as const;

  const contentHash = (await hashDecisionPacketV1(decisionPacketContentHashPayload(contentWithoutHash))).sha256;
  return deepFreeze({ ...contentWithoutHash, contentHash });
}

const REQUEST_SCOPE_SENTINEL = "00000000-0000-4000-8000-000000000000";

/**
 * Idempotency keys are intentionally excluded from this request identity. The
 * database binds them separately to this hash so replay and conflict semantics
 * remain explicit without changing the semantic caller input fingerprint.
 */
export async function buildDecisionPacketCreateRequestIdentity(
  input: DecisionPacketCreateRequestInput,
): Promise<DecisionPacketCreateRequestIdentity> {
  const { idempotencyKey, ...contentInput } = input;
  normalizeIdempotencyKey(idempotencyKey, "idempotency key");
  const content = await buildDecisionPacketContent({ ...contentInput, clubId: REQUEST_SCOPE_SENTINEL });
  const { clubId: _clubId, contentHash: _contentHash, ...requestContent } = content;
  const hash = await hashDecisionPacketV1(decisionPacketCreateRequestHashPayload(requestContent));
  return deepFreeze({ canonical: hash.canonicalText, requestHash: hash.sha256 });
}

function normalizeCountMetric(input: CountMetricInput, label: string): CountMetric {
  if (!AVAILABILITY_STATES.has(input.availability)) {
    fail(`${label} has unsupported availability`, "INVALID_AVAILABILITY");
  }
  if (input.availability === "present") {
    if (input.value === null || normalizeCount(input.value, label) === 0) {
      fail(`${label} present requires a positive value`, "INVALID_COUNT_AVAILABILITY");
    }
    return { availability: input.availability, value: input.value };
  }
  if (input.availability === "explicit_zero") {
    if (input.value !== 0) fail(`${label} explicit zero requires value 0`, "INVALID_COUNT_AVAILABILITY");
    return { availability: input.availability, value: 0 };
  }
  if (input.value !== null) fail(`${label} unavailable state requires null`, "INVALID_COUNT_AVAILABILITY");
  return { availability: input.availability, value: null };
}

function normalizeCurrency(raw: string, label: string): string {
  const value = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) fail(`${label} must be a three-letter currency`, "INVALID_CURRENCY");
  return value;
}

function normalizeMoneyMetric(input: MoneyMetricInput, label: string): MoneyMetric {
  if (!AVAILABILITY_STATES.has(input.availability)) {
    fail(`${label} has unsupported availability`, "INVALID_AVAILABILITY");
  }
  if (input.availability === "present" || input.availability === "explicit_zero") {
    if (input.amountMinor === null || input.currency === null || input.scale === null) {
      fail(`${label} available money requires amount, currency, and scale`, "INVALID_MONEY_AVAILABILITY");
    }
    const amountMinor = normalizeDecimalInteger(input.amountMinor, `${label} amount`);
    if (input.availability === "present" && amountMinor === "0") {
      fail(`${label} present requires a positive amount`, "INVALID_MONEY_AVAILABILITY");
    }
    if (input.availability === "explicit_zero" && amountMinor !== "0") {
      fail(`${label} explicit zero requires amount 0`, "INVALID_MONEY_AVAILABILITY");
    }
    if (!Number.isInteger(input.scale) || input.scale < 0 || input.scale > 6) {
      fail(`${label} scale must be an integer from 0 to 6`, "INVALID_MONEY_SCALE");
    }
    return {
      availability: input.availability,
      amountMinor,
      currency: normalizeCurrency(input.currency, `${label} currency`),
      scale: input.scale,
    };
  }
  if (input.amountMinor !== null || input.currency !== null || input.scale !== null) {
    fail(`${label} unavailable state cannot carry money`, "INVALID_MONEY_AVAILABILITY");
  }
  return { availability: input.availability, amountMinor: null, currency: null, scale: null };
}

function normalizeActualMetrics(input: EventActualMetricsInput): EventActualMetrics {
  const metrics = {
    entries: normalizeCountMetric(input.entries, "entries"),
    uniquePlayers: normalizeCountMetric(input.uniquePlayers, "unique players"),
    totalBullets: normalizeCountMetric(input.totalBullets, "total bullets"),
    reentries: normalizeCountMetric(input.reentries, "reentries"),
    registrationRecords: normalizeCountMetric(input.registrationRecords, "registration records"),
    paidPlaces: normalizeCountMetric(input.paidPlaces, "paid places"),
    prizePool: normalizeMoneyMetric(input.prizePool, "prize pool"),
    overlay: normalizeMoneyMetric(input.overlay, "overlay"),
  };

  const presentCount = (metric: CountMetric): number | null =>
    metric.availability === "present" || metric.availability === "explicit_zero" ? metric.value : null;
  const entries = presentCount(metrics.entries);
  const uniquePlayers = presentCount(metrics.uniquePlayers);
  const totalBullets = presentCount(metrics.totalBullets);
  const reentries = presentCount(metrics.reentries);
  const paidPlaces = presentCount(metrics.paidPlaces);
  if (entries !== null && uniquePlayers !== null && uniquePlayers > entries) {
    fail("unique players cannot exceed entries in the same scope", "ACTUAL_COUNT_INVARIANT");
  }
  if (totalBullets !== null && uniquePlayers !== null && uniquePlayers > totalBullets) {
    fail("unique players cannot exceed bullets in the same scope", "ACTUAL_COUNT_INVARIANT");
  }
  if (totalBullets !== null && reentries !== null && reentries > totalBullets) {
    fail("reentries cannot exceed bullets in the same scope", "ACTUAL_COUNT_INVARIANT");
  }
  if (entries !== null && paidPlaces !== null && paidPlaces > entries) {
    fail("paid places cannot exceed entries in the same scope", "ACTUAL_COUNT_INVARIANT");
  }

  const money = [metrics.prizePool, metrics.overlay].filter(
    (metric) => metric.availability === "present" || metric.availability === "explicit_zero",
  );
  if (
    money.length === 2
    && (money[0].currency !== money[1].currency || money[0].scale !== money[1].scale)
  ) {
    fail("prize pool and overlay must use the same currency and scale", "MONEY_SCOPE_MISMATCH");
  }
  return metrics;
}

function assertActualSourceShape(
  sourceKind: EventActualSourceKind,
  reconciliationStatus: EventActualReconciliationStatus,
  autoId: string | null,
  manualId: string | null,
): void {
  if (sourceKind === "reconciled") {
    if (autoId === null || manualId === null) {
      fail("reconciled actual requires both source revisions", "INVALID_RECONCILIATION");
    }
    if (!["matching", "mismatch", "manually_reconciled", "blocked_conflict"].includes(reconciliationStatus)) {
      fail("reconciled actual has incompatible status", "INVALID_RECONCILIATION");
    }
    return;
  }
  if (autoId !== null || manualId !== null) {
    fail("only reconciled actuals can reference both source revisions", "INVALID_RECONCILIATION");
  }
  if (
    (sourceKind === "native_tournament_system" || sourceKind === "auto_capture")
    && reconciliationStatus !== "auto_only"
  ) {
    fail("automatic actual requires auto_only status", "INVALID_RECONCILIATION");
  }
  if (
    ["owner_manual", "legacy_decision_log", "import_verified"].includes(sourceKind)
    && reconciliationStatus !== "manual_only"
  ) {
    fail("manual/imported actual requires manual_only status", "INVALID_RECONCILIATION");
  }
}

export function eventActualRevisionContentHashPayload(
  content: Omit<EventActualRevisionContent, "contentHash">,
): unknown {
  return {
    hashContractVersion: content.hashContractVersion,
    schemaVersion: content.schemaVersion,
    clubId: content.clubId,
    eventId: content.eventId,
    scope: content.scope,
    finality: content.finality,
    sourceKind: content.sourceKind,
    sourceTimestampState: content.sourceTimestampState,
    sourceTimestamp: content.sourceTimestamp,
    capturedAt: content.capturedAt,
    reconciliationStatus: content.reconciliationStatus,
    metrics: content.metrics,
    supersedesRevisionId: content.supersedesRevisionId,
    reconcilesAutoRevisionId: content.reconcilesAutoRevisionId,
    reconcilesManualRevisionId: content.reconcilesManualRevisionId,
    idempotencyKey: content.idempotencyKey,
    correctionReason: content.correctionReason,
  };
}

export function eventActualCreateRequestHashPayload(
  content: Omit<EventActualRevisionContent, "contentHash" | "clubId" | "sourceKind" | "capturedAt" | "reconciliationStatus" | "idempotencyKey" | "reconcilesAutoRevisionId" | "reconcilesManualRevisionId">,
): unknown {
  return {
    hashContractVersion: content.hashContractVersion,
    requestKind: "eventActualCreateRequest",
    schemaVersion: content.schemaVersion,
    eventId: content.eventId,
    scope: content.scope,
    finality: content.finality,
    sourceTimestampState: content.sourceTimestampState,
    sourceTimestamp: content.sourceTimestamp,
    metrics: content.metrics,
    supersedesRevisionId: content.supersedesRevisionId,
    correctionReason: content.correctionReason,
  };
}

export async function buildEventActualRevisionContent(
  input: EventActualRevisionContentInput,
): Promise<EventActualRevisionContent> {
  if (!OUTCOME_SCOPES.has(input.scope)) fail("unsupported outcome scope", "INVALID_OUTCOME_SCOPE");
  if (!ACTUAL_FINALITIES.has(input.finality)) fail("unsupported actual finality", "INVALID_FINALITY");
  if (!ACTUAL_SOURCE_KINDS.has(input.sourceKind)) fail("unsupported actual source", "INVALID_ACTUAL_SOURCE");
  if (!RECONCILIATION_STATUSES.has(input.reconciliationStatus)) {
    fail("unsupported reconciliation status", "INVALID_RECONCILIATION");
  }
  if (input.sourceTimestampState !== "exact" && input.sourceTimestampState !== "not_reported") {
    fail("unsupported source timestamp state", "INVALID_SOURCE_TIME");
  }

  const sourceTimestamp = input.sourceTimestamp === null
    ? null
    : normalizeInstant(input.sourceTimestamp, "source timestamp");
  const capturedAt = normalizeInstant(input.capturedAt, "captured at");
  if (input.sourceTimestampState === "exact") {
    if (sourceTimestamp === null || sourceTimestamp > capturedAt) {
      fail("exact source timestamp must exist and not exceed capture time", "INVALID_SOURCE_TIME");
    }
  } else if (sourceTimestamp !== null) {
    fail("not-reported source timestamp must be null", "INVALID_SOURCE_TIME");
  }

  const supersedesRevisionId = input.supersedesRevisionId === null
    ? null
    : normalizeUuid(input.supersedesRevisionId, "superseded revision id");
  const reconcilesAutoRevisionId = input.reconcilesAutoRevisionId === null
    ? null
    : normalizeUuid(input.reconcilesAutoRevisionId, "auto revision id");
  const reconcilesManualRevisionId = input.reconcilesManualRevisionId === null
    ? null
    : normalizeUuid(input.reconcilesManualRevisionId, "manual revision id");
  const correctionReason = normalizeText(input.correctionReason, "correction reason", 4096);
  if ((supersedesRevisionId === null) !== (correctionReason === null)) {
    fail("actual correction parent and reason must be supplied together", "INVALID_ACTUAL_CORRECTION");
  }
  if ((input.finality === "corrected" || input.finality === "void") && supersedesRevisionId === null) {
    fail("corrected or void actual requires a predecessor", "INVALID_ACTUAL_CORRECTION");
  }
  assertActualSourceShape(
    input.sourceKind,
    input.reconciliationStatus,
    reconcilesAutoRevisionId,
    reconcilesManualRevisionId,
  );

  const metrics = normalizeActualMetrics(input.metrics);
  if (input.finality === "void") {
    const hasValue = Object.values(metrics).some((metric) => {
      if ("value" in metric) return metric.value !== null;
      return metric.amountMinor !== null;
    });
    if (hasValue) fail("void actual cannot carry metric values", "VOID_ACTUAL_HAS_VALUES");
  }

  const contentWithoutHash = {
    hashContractVersion: DECISION_PACKET_HASH_CONTRACT_VERSION,
    schemaVersion: EVENT_ACTUAL_REVISION_SCHEMA_VERSION,
    clubId: normalizeUuid(input.clubId, "club id"),
    eventId: normalizeUuid(input.eventId, "event id"),
    scope: input.scope,
    finality: input.finality,
    sourceKind: input.sourceKind,
    sourceTimestampState: input.sourceTimestampState,
    sourceTimestamp,
    capturedAt,
    reconciliationStatus: input.reconciliationStatus,
    metrics,
    supersedesRevisionId,
    reconcilesAutoRevisionId,
    reconcilesManualRevisionId,
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey, "idempotency key"),
    correctionReason,
  } as const;

  const contentHash = (await hashDecisionPacketV1(eventActualRevisionContentHashPayload(contentWithoutHash))).sha256;
  return deepFreeze({ ...contentWithoutHash, contentHash });
}

export async function buildEventActualCreateRequestIdentity(
  input: EventActualCreateRequestInput,
): Promise<EventActualCreateRequestIdentity> {
  const capturedAt = input.sourceTimestampState === "exact"
    ? input.sourceTimestamp
    : "1970-01-01T00:00:00.000Z";
  const content = await buildEventActualRevisionContent({
    clubId: REQUEST_SCOPE_SENTINEL,
    eventId: input.eventId,
    scope: input.scope,
    finality: input.finality,
    sourceKind: "owner_manual",
    sourceTimestampState: input.sourceTimestampState,
    sourceTimestamp: input.sourceTimestamp,
    capturedAt: capturedAt ?? "1970-01-01T00:00:00.000Z",
    reconciliationStatus: "manual_only",
    metrics: input.metrics,
    supersedesRevisionId: input.supersedesRevisionId,
    reconcilesAutoRevisionId: null,
    reconcilesManualRevisionId: null,
    idempotencyKey: input.idempotencyKey,
    correctionReason: input.correctionReason,
  });
  const {
    clubId: _clubId,
    sourceKind: _sourceKind,
    capturedAt: _capturedAt,
    reconciliationStatus: _reconciliationStatus,
    idempotencyKey: _idempotencyKey,
    reconcilesAutoRevisionId: _reconcilesAutoRevisionId,
    reconcilesManualRevisionId: _reconcilesManualRevisionId,
    contentHash: _contentHash,
    ...requestContent
  } = content;
  const hash = await hashDecisionPacketV1(eventActualCreateRequestHashPayload(requestContent));
  return deepFreeze({ canonical: hash.canonicalText, requestHash: hash.sha256 });
}

export async function buildEventActualRevision(
  input: EventActualRevisionInput,
): Promise<EventActualRevision> {
  const revisionId = normalizeUuid(input.revisionId, "revision id");
  const content = await buildEventActualRevisionContent(input);
  if (
    revisionId === content.supersedesRevisionId
    || revisionId === content.reconcilesAutoRevisionId
    || revisionId === content.reconcilesManualRevisionId
  ) {
    fail("actual revision cannot reference itself", "SELF_REFERENTIAL_REVISION");
  }
  return deepFreeze({ revisionId, ...content });
}

function sourceFamily(revision: EventActualRevision): "auto" | "manual" | "reconciled" {
  if (revision.sourceKind === "reconciled") return "reconciled";
  if (revision.sourceKind === "native_tournament_system" || revision.sourceKind === "auto_capture") return "auto";
  return "manual";
}

export async function validateEventActualRevisionGraph(
  revisions: readonly EventActualRevision[],
): Promise<void> {
  const byId = new Map<string, EventActualRevision>();
  const childByParent = new Map<string, string>();
  const rootBySourceFamily = new Map<string, string>();
  for (const revision of revisions) {
    if (byId.has(revision.revisionId)) fail("duplicate revision id", "DUPLICATE_REVISION");
    const rebuilt = await buildEventActualRevision({
      revisionId: revision.revisionId,
      clubId: revision.clubId,
      eventId: revision.eventId,
      scope: revision.scope,
      finality: revision.finality,
      sourceKind: revision.sourceKind,
      sourceTimestampState: revision.sourceTimestampState,
      sourceTimestamp: revision.sourceTimestamp,
      capturedAt: revision.capturedAt,
      reconciliationStatus: revision.reconciliationStatus,
      metrics: revision.metrics,
      supersedesRevisionId: revision.supersedesRevisionId,
      reconcilesAutoRevisionId: revision.reconcilesAutoRevisionId,
      reconcilesManualRevisionId: revision.reconcilesManualRevisionId,
      idempotencyKey: revision.idempotencyKey,
      correctionReason: revision.correctionReason,
    });
    if (
      rebuilt.hashContractVersion !== revision.hashContractVersion
      || rebuilt.contentHash !== revision.contentHash
    ) {
      fail("actual revision content hash does not match its fields", "FORGED_REVISION");
    }
    byId.set(revision.revisionId, revision);
  }

  for (const revision of revisions) {
    if (revision.supersedesRevisionId === null) {
      const rootKey = [revision.clubId, revision.eventId, revision.scope, sourceFamily(revision)].join(":");
      if (rootBySourceFamily.has(rootKey)) {
        fail("actual source-family root cannot diverge", "DIVERGENT_REVISION");
      }
      rootBySourceFamily.set(rootKey, revision.revisionId);
    }
    if (revision.supersedesRevisionId !== null) {
      const parent = byId.get(revision.supersedesRevisionId);
      if (!parent) fail("actual predecessor is unknown", "UNKNOWN_PREDECESSOR");
      if (
        parent.clubId !== revision.clubId
        || parent.eventId !== revision.eventId
        || parent.scope !== revision.scope
        || sourceFamily(parent) !== sourceFamily(revision)
      ) {
        fail("actual predecessor has incompatible identity or source lineage", "INCOMPATIBLE_PREDECESSOR");
      }
      if (parent.capturedAt >= revision.capturedAt) {
        fail("actual correction must be chronologically later", "INVALID_REVISION_CHRONOLOGY");
      }
      if (childByParent.has(parent.revisionId)) {
        fail("actual correction lineage cannot diverge", "DIVERGENT_REVISION");
      }
      childByParent.set(parent.revisionId, revision.revisionId);
    }

    if (revision.sourceKind === "reconciled") {
      const auto = byId.get(revision.reconcilesAutoRevisionId as string);
      const manual = byId.get(revision.reconcilesManualRevisionId as string);
      if (!auto || !manual) fail("reconciliation references an unknown source revision", "UNKNOWN_RECONCILIATION_SOURCE");
      if (
        sourceFamily(auto) !== "auto"
        || sourceFamily(manual) !== "manual"
        || auto.clubId !== revision.clubId
        || manual.clubId !== revision.clubId
        || auto.eventId !== revision.eventId
        || manual.eventId !== revision.eventId
        || auto.scope !== revision.scope
        || manual.scope !== revision.scope
      ) {
        fail("reconciliation source identity is incompatible", "INCOMPATIBLE_RECONCILIATION");
      }
    }
  }

  for (const revision of revisions) {
    const visited = new Set<string>();
    let cursor: EventActualRevision | undefined = revision;
    while (cursor?.supersedesRevisionId) {
      if (visited.has(cursor.revisionId)) fail("actual correction lineage contains a cycle", "REVISION_CYCLE");
      visited.add(cursor.revisionId);
      cursor = byId.get(cursor.supersedesRevisionId);
    }
  }
}

export async function resolveEventActualTruth(
  revisions: readonly EventActualRevision[],
  eventId: string,
  scope: EventOutcomeScope,
): Promise<EventActualResolution> {
  await validateEventActualRevisionGraph(revisions);
  const relevant = revisions.filter((revision) => revision.eventId === eventId && revision.scope === scope);
  if (relevant.length === 0) return deepFreeze({ state: "unavailable", reason: "no_revision" });

  const superseded = new Set(
    relevant
      .map((revision) => revision.supersedesRevisionId)
      .filter((id): id is string => id !== null),
  );
  const heads = relevant.filter((revision) => !superseded.has(revision.revisionId));
  const liveHeads = heads.filter((revision) => revision.finality !== "void");
  if (liveHeads.length === 0) return deepFreeze({ state: "unavailable", reason: "all_void" });
  if (liveHeads.some((revision) => revision.finality === "conflicting")) {
    return deepFreeze({
      state: "conflict",
      reason: "conflicting_revision",
      revisionIds: liveHeads.map((revision) => revision.revisionId).sort(),
    });
  }

  const reconciled = liveHeads.filter((revision) => sourceFamily(revision) === "reconciled");
  if (reconciled.length > 1) {
    return deepFreeze({
      state: "conflict",
      reason: "divergent_lineage",
      revisionIds: reconciled.map((revision) => revision.revisionId).sort(),
    });
  }
  if (reconciled.length === 1) {
    const current = reconciled[0];
    const autoHeads = liveHeads.filter((revision) => sourceFamily(revision) === "auto");
    const manualHeads = liveHeads.filter((revision) => sourceFamily(revision) === "manual");
    if (
      !autoHeads.some((revision) => revision.revisionId === current.reconcilesAutoRevisionId)
      || !manualHeads.some((revision) => revision.revisionId === current.reconcilesManualRevisionId)
    ) {
      return deepFreeze({
        state: "conflict",
        reason: "stale_reconciliation",
        revisionIds: liveHeads.map((revision) => revision.revisionId).sort(),
      });
    }
    return deepFreeze({ state: "current", revision: current, sourceState: "reconciled" });
  }

  const autoHeads = liveHeads.filter((revision) => sourceFamily(revision) === "auto");
  const manualHeads = liveHeads.filter((revision) => sourceFamily(revision) === "manual");
  if (autoHeads.length > 1 || manualHeads.length > 1) {
    return deepFreeze({
      state: "conflict",
      reason: "divergent_lineage",
      revisionIds: liveHeads.map((revision) => revision.revisionId).sort(),
    });
  }
  if (autoHeads.length === 1 && manualHeads.length === 1) {
    return deepFreeze({
      state: "needs_reconciliation",
      autoRevisionIds: [autoHeads[0].revisionId],
      manualRevisionIds: [manualHeads[0].revisionId],
    });
  }
  const current = autoHeads[0] ?? manualHeads[0];
  if (!current) {
    return deepFreeze({
      state: "conflict",
      reason: "divergent_lineage",
      revisionIds: liveHeads.map((revision) => revision.revisionId).sort(),
    });
  }
  return deepFreeze({
    state: "current",
    revision: current,
    sourceState: sourceFamily(current) === "auto" ? "auto_only" : "manual_only",
  });
}

export function isEventActualEligibleForScoring(
  revision: EventActualRevision,
  targetMetric: DecisionTargetMetric,
  decisionAsOfTs: string,
): boolean {
  const asOf = normalizeInstant(decisionAsOfTs, "decision as-of");
  if (
    revision.scope !== "event_total"
    || (revision.finality !== "final" && revision.finality !== "corrected")
    || revision.sourceTimestampState !== "exact"
    || revision.sourceTimestamp === null
    || revision.sourceTimestamp <= asOf
    || revision.reconciliationStatus === "mismatch"
    || revision.reconciliationStatus === "blocked_conflict"
  ) {
    return false;
  }
  const metric = targetMetric === "entries"
    ? revision.metrics.entries
    : targetMetric === "unique_players"
      ? revision.metrics.uniquePlayers
      : revision.metrics.totalBullets;
  return metric.availability === "present" || metric.availability === "explicit_zero";
}
