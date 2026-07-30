import { canonicalHash, canonicalize } from "../series-intelligence/provenanceHash";
import {
  compareCanonicalStrings,
  normalizeCurrency,
  normalizeInstant,
  normalizeIntegerString,
  normalizeLocalDate,
  normalizeMoneyValue,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";

/**
 * D1B records public results independently of D1A's announced schedule supply.
 * It deliberately cannot create an empty release: evidence must exist first.
 */
export const VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION = "v1" as const;
export const VIETNAM_OUTCOME_EVIDENCE_NAMESPACE =
  `series-market:v1:vietnam-outcome-evidence:${VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION}` as const;

export type VietnamOutcomeEvidenceQuality =
  | "official_result_verified"
  | "official_result_unverified"
  | "established_reporting_unverified"
  | "owner_provided_public_image_unverified"
  | "secondary_public_announcement_unverified"
  | "conflicting_public_sources"
  | "insufficient_identity"
  | "rejected";

export type OutcomeSourceCategory =
  | "official_result_poster"
  | "official_tournament_report"
  | "official_result_page"
  | "established_public_reporting"
  | "final_result_pdf"
  | "public_outcome_post"
  | "public_satellite_result"
  | "rejected";

export type OutcomeReviewerStatus = "intake" | "reviewed" | "rejected";
export type OutcomeExtractionMethod = "manual_visual" | "manual_text" | "ocr_assisted";
export type OutcomeExtractionStatus = "verified" | "uncertain" | "conflicting" | "missing" | "rejected";
export type OutcomeFieldState =
  | "present"
  | "missing"
  | "explicit_zero"
  | "uncertain"
  | "conflicting"
  | "not_applicable"
  | "superseded";

export type OutcomeFieldKey =
  | "organizer"
  | "series_name"
  | "event_name"
  | "event_number"
  | "event_date"
  | "flight_identity"
  | "currency"
  | "entries"
  | "unique_players"
  | "total_bullets"
  | "reentry_count"
  | "entries_basis"
  | "published_gtd"
  | "actual_prize_pool"
  | "prize_contribution_per_entry"
  | "organizer_fee"
  | "paid_places"
  | "min_cash"
  | "first_prize"
  | "satellite_seats_awarded"
  | "satellite_seats_redeemed"
  | "satellite_seats_converted"
  | "satellite_target_competition_key"
  | "linkage_confidence"
  | "completion_status";

export type OutcomeEntriesBasis =
  | "event_total"
  | "flight_only"
  | "day_total"
  | "series_total"
  | "unknown";
export type OutcomeCompletionStatus =
  | "scheduled"
  | "registration_open"
  | "completed"
  | "cancelled"
  | "postponed"
  | "result_partial"
  | "result_final";
export type ScheduleOutcomeLinkState =
  | "exact"
  | "explicit_source_link"
  | "candidate"
  | "ambiguous"
  | "unlinked"
  | "conflicting";
export type OutcomeReadinessState =
  | "outcome_ready"
  | "partial_outcome"
  | "missing_outcome"
  | "ambiguous_linkage"
  | "conflicting_outcome"
  | "entries_only"
  | "prize_pool_only"
  | "turnout_economics_ready"
  | "unique_player_analysis_blocked"
  | "reentry_analysis_blocked"
  | "satellite_conversion_blocked";

export type OutcomeClaimValue =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "integer"; readonly value: string }
  | { readonly type: "money"; readonly minorUnits: string; readonly currency: string; readonly scale: number }
  | { readonly type: "local_date"; readonly value: string };

export interface VietnamOutcomeEvidenceSourceInput {
  readonly sourceId: string;
  readonly sourceCategory: OutcomeSourceCategory;
  readonly sourceIdentity:
    | { readonly kind: "repository_file"; readonly path: string; readonly sha256: string }
    | { readonly kind: "public_url"; readonly url: string; readonly sha256: string | null };
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string | null;
  readonly publicationAt: string;
  readonly capturedAt: string;
  readonly expectedCompetitionKey: string | null;
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly evidenceQuality: VietnamOutcomeEvidenceQuality;
  readonly limitationNotes: readonly string[];
}

export interface VietnamOutcomeEvidenceSource {
  readonly sourceId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly sourceCategory: OutcomeSourceCategory;
  readonly sourceIdentity:
    | { readonly kind: "repository_file"; readonly path: string; readonly sha256: string }
    | { readonly kind: "public_url"; readonly url: string; readonly sha256: string | null };
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string | null;
  readonly publicationAt: string;
  readonly capturedAt: string;
  readonly expectedCompetitionKey: string | null;
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly evidenceQuality: VietnamOutcomeEvidenceQuality;
  readonly limitationNotes: readonly string[];
}

export interface VietnamOutcomeEvidenceClaimInput {
  readonly outcomeEventKey: string;
  readonly source: VietnamOutcomeEvidenceSource;
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeFieldState;
  readonly value: OutcomeClaimValue | null;
  readonly visualOrTextRegion: string;
  readonly extractionMethod: OutcomeExtractionMethod;
  readonly extractionStatus: OutcomeExtractionStatus;
  readonly correctionOfClaimId: string | null;
}

export interface VietnamOutcomeEvidenceClaim {
  readonly claimId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly outcomeEventKey: string;
  readonly sourceId: string;
  readonly sourceIdentity: VietnamOutcomeEvidenceSource["sourceIdentity"];
  readonly publicationAt: string;
  readonly capturedAt: string;
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeFieldState;
  readonly value: OutcomeClaimValue | null;
  readonly visualOrTextRegion: string;
  readonly extractionMethod: OutcomeExtractionMethod;
  readonly extractionStatus: OutcomeExtractionStatus;
  readonly evidenceQuality: VietnamOutcomeEvidenceQuality;
  readonly correctionOfClaimId: string | null;
}

export interface OutcomeFieldObservation {
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeFieldState;
  readonly value: OutcomeClaimValue | null;
  readonly claimIds: readonly string[];
}

export interface VietnamEventOutcomeInput {
  readonly outcomeEventKey: string;
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string;
  readonly eventDate: string;
  readonly flightIdentity: string | null;
  readonly currency: string | null;
  readonly claimIds: readonly string[];
}

export interface VietnamEventOutcome {
  readonly outcomeId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly outcomeEventKey: string;
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string;
  readonly eventDate: string;
  readonly flightIdentity: string | null;
  readonly currency: string | null;
  readonly sourceClaimIds: readonly string[];
  readonly fields: readonly OutcomeFieldObservation[];
}

export interface ScheduleCompetitionReference {
  readonly competitionKey: string;
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string;
  readonly eventDate: string;
  readonly flightIdentity: string | null;
}

export interface ScheduleOutcomeLinkInput {
  readonly outcome: VietnamEventOutcome;
  readonly sourceDeclaredCompetitionKey: string | null;
  readonly expectedCompetitionKey: string | null;
  readonly scheduleCompetitions: readonly ScheduleCompetitionReference[];
}

export interface ScheduleOutcomeLink {
  readonly linkId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly outcomeId: string;
  readonly outcomeEventKey: string;
  readonly competitionKey: string | null;
  readonly state: ScheduleOutcomeLinkState;
  readonly candidateCompetitionKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface VietnamOutcomeInclusionManifest {
  readonly inclusionManifestId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly sourceCutoff: string;
  readonly sourceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly outcomeIds: readonly string[];
  readonly linkIds: readonly string[];
  readonly sourceContentHashes: readonly string[];
}

export interface VietnamOutcomeRelease {
  readonly releaseId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly releaseKind: "observed_public_outcome_evidence";
  readonly releaseKey: "vietnam-outcome-evidence-v1";
  readonly market: "vietnam";
  readonly country: "Vietnam";
  readonly scopeKind: "country";
  readonly sourceCutoff: string;
  readonly inclusionManifestId: string;
  readonly sourceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly outcomeIds: readonly string[];
  readonly linkIds: readonly string[];
  readonly evidenceQuality: readonly VietnamOutcomeEvidenceQuality[];
}

export interface OutcomeDerivedMoney {
  readonly kind: "overlay" | "surplus";
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
  readonly inputClaimIds: readonly string[];
  readonly methodVersion: "explicit-compatible-money-v1";
}

export interface OutcomeReadinessReport {
  readonly readinessId: string;
  readonly outcomeId: string;
  readonly competitionKey: string | null;
  readonly states: readonly OutcomeReadinessState[];
  readonly reasonCodes: readonly string[];
  readonly overlay: OutcomeDerivedMoney | null;
  readonly surplus: OutcomeDerivedMoney | null;
}

export interface VietnamOutcomeArtifact {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly artifactType: "vietnam_outcome_evidence";
  readonly releaseId: string;
  readonly sourceCutoff: string;
  readonly sources: readonly VietnamOutcomeEvidenceSource[];
  readonly claims: readonly VietnamOutcomeEvidenceClaim[];
  readonly outcomes: readonly VietnamEventOutcome[];
  readonly links: readonly ScheduleOutcomeLink[];
  readonly readinessReports: readonly OutcomeReadinessReport[];
  readonly limitations: readonly string[];
}

export interface VietnamOutcomeReceipt {
  readonly receiptId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly releaseId: string;
  readonly artifactId: string;
  readonly artifactContentHash: string;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
  readonly sourceReceipts: readonly {
    readonly sourceId: string;
    readonly sourceIdentity: VietnamOutcomeEvidenceSource["sourceIdentity"];
  }[];
}

export interface VietnamOutcomeCorrectionInput {
  readonly correctionKey: string;
  readonly correctedAt: string;
  readonly supersededClaimId: string;
  readonly supersedingClaimId: string;
  readonly reason: string;
}

export interface VietnamOutcomeCorrection {
  readonly correctionId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly correctionKey: string;
  readonly correctedAt: string;
  readonly supersededClaimId: string;
  readonly supersedingClaimId: string;
  readonly reason: string;
  readonly status: "superseded_by_corrected_claim";
}

export interface OutcomeIntakeRecordInput {
  readonly intakeKey: string;
  readonly source: VietnamOutcomeEvidenceSourceInput;
  readonly claimedFields: readonly OutcomeFieldKey[];
  readonly expectedCompetitionKey: string | null;
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly limitationNotes: readonly string[];
}

export interface OutcomeIntakeRecord {
  readonly intakeId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly intakeKey: string;
  readonly source: VietnamOutcomeEvidenceSource;
  readonly claimedFields: readonly OutcomeFieldKey[];
  readonly expectedCompetitionKey: string | null;
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly limitationNotes: readonly string[];
  readonly fixtureOnly: boolean;
}

export interface VietnamOutcomeEvidenceBundleInput {
  readonly sourceCutoff: string;
  readonly sources: readonly VietnamOutcomeEvidenceSource[];
  readonly claims: readonly VietnamOutcomeEvidenceClaim[];
  readonly outcomeInputs: readonly VietnamEventOutcomeInput[];
  readonly links: readonly ScheduleOutcomeLink[];
}

export interface VietnamOutcomeEvidenceBundle {
  readonly inclusionManifest: VietnamOutcomeInclusionManifest;
  readonly release: VietnamOutcomeRelease;
  readonly artifact: VietnamOutcomeArtifact;
}

const FIELD_ORDER: readonly OutcomeFieldKey[] = [
  "organizer", "series_name", "event_name", "event_number", "event_date", "flight_identity", "currency",
  "entries", "unique_players", "total_bullets", "reentry_count", "entries_basis",
  "published_gtd", "actual_prize_pool", "prize_contribution_per_entry", "organizer_fee", "paid_places", "min_cash", "first_prize",
  "satellite_seats_awarded", "satellite_seats_redeemed", "satellite_seats_converted", "satellite_target_competition_key", "linkage_confidence",
  "completion_status",
];
const MONEY_FIELDS = new Set<OutcomeFieldKey>([
  "published_gtd", "actual_prize_pool", "prize_contribution_per_entry", "organizer_fee", "min_cash", "first_prize",
]);
const COUNT_FIELDS = new Set<OutcomeFieldKey>([
  "entries", "unique_players", "total_bullets", "reentry_count", "paid_places",
  "satellite_seats_awarded", "satellite_seats_redeemed", "satellite_seats_converted",
]);
const DATE_FIELDS = new Set<OutcomeFieldKey>(["event_date"]);
const ACTIVE_VALUE_STATES = new Set<OutcomeFieldState>(["present", "explicit_zero"]);

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

function normalizeText(raw: string, label: string, max = 4096): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > max) {
    fail(`${label} must be non-blank printable text`, "INVALID_OUTCOME_TEXT");
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) fail(`${label} must be non-blank printable text`, "INVALID_OUTCOME_TEXT");
  }
  return value;
}

function normalizeNullableText(raw: string | null, label: string, max = 4096): string | null {
  return raw === null ? null : normalizeText(raw, label, max);
}

function normalizeSha256(raw: string, label: string): string {
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) fail(`${label} must be SHA-256`, "INVALID_OUTCOME_SHA256");
  return value;
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  const normalized = values.map((value) => normalizeText(value, label, 512));
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains duplicates`, "DUPLICATE_OUTCOME_REFERENCE");
  return Object.freeze([...normalized].sort(compareCanonicalStrings));
}

function normalizeOptionalStableKey(raw: string | null, label: string): string | null {
  return raw === null ? null : normalizeStableKey(raw, label);
}

function normalizeSourceIdentity(
  sourceIdentity: VietnamOutcomeEvidenceSourceInput["sourceIdentity"],
): VietnamOutcomeEvidenceSource["sourceIdentity"] {
  if (sourceIdentity.kind === "repository_file") {
    const path = sourceIdentity.path.replace(/\\/g, "/").trim();
    if (!path.startsWith("docs/series/evidence/vietnam/outcomes/") || path.includes("..") || /^[A-Za-z]:/.test(path)) {
      fail("repository outcome evidence must remain inside the Vietnam outcomes evidence directory", "INVALID_OUTCOME_SOURCE_PATH");
    }
    return deepFreeze({ kind: "repository_file", path, sha256: normalizeSha256(sourceIdentity.sha256, "source sha256") });
  }
  let url: URL;
  try { url = new URL(sourceIdentity.url); } catch { fail("public source URL is invalid", "INVALID_OUTCOME_PUBLIC_URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("public source URL must be canonical HTTPS without credentials or fragment", "INVALID_OUTCOME_PUBLIC_URL");
  }
  return deepFreeze({
    kind: "public_url",
    url: url.toString(),
    sha256: sourceIdentity.sha256 === null ? null : normalizeSha256(sourceIdentity.sha256, "source sha256"),
  });
}

function normalizeClaimValue(field: OutcomeFieldKey, value: OutcomeClaimValue): OutcomeClaimValue {
  if (MONEY_FIELDS.has(field)) {
    if (value.type !== "money") fail(`${field} requires a money value`, "OUTCOME_VALUE_TYPE_MISMATCH");
    return normalizeMoneyValue(value);
  }
  if (COUNT_FIELDS.has(field)) {
    if (value.type !== "integer") fail(`${field} requires an integer value`, "OUTCOME_VALUE_TYPE_MISMATCH");
    const integer = normalizeIntegerString(value.value);
    if (integer.startsWith("-")) fail(`${field} cannot be negative`, "NEGATIVE_OUTCOME_COUNT");
    return { type: "integer", value: integer };
  }
  if (DATE_FIELDS.has(field)) {
    if (value.type !== "local_date") fail(`${field} requires a local date`, "OUTCOME_VALUE_TYPE_MISMATCH");
    return normalizeLocalDate(value.value);
  }
  if (value.type !== "text") fail(`${field} requires text`, "OUTCOME_VALUE_TYPE_MISMATCH");
  const text = normalizeText(value.value, `${field} value`);
  if (field === "entries_basis" && !(["event_total", "flight_only", "day_total", "series_total", "unknown"] as const).includes(text as OutcomeEntriesBasis)) {
    fail("entries_basis is not recognized", "INVALID_ENTRIES_BASIS");
  }
  if (field === "completion_status" && !(["scheduled", "registration_open", "completed", "cancelled", "postponed", "result_partial", "result_final"] as const).includes(text as OutcomeCompletionStatus)) {
    fail("completion_status is not recognized", "INVALID_OUTCOME_COMPLETION_STATUS");
  }
  return { type: "text", value: text };
}

function isZeroValue(value: OutcomeClaimValue): boolean {
  return (value.type === "integer" || value.type === "money") && BigInt(value.type === "integer" ? value.value : value.minorUnits) === 0n;
}

function valueEquals(left: OutcomeClaimValue, right: OutcomeClaimValue): boolean {
  return canonicalize(left) === canonicalize(right);
}

function normalizeFieldState(state: OutcomeFieldState, value: OutcomeClaimValue | null): OutcomeFieldState {
  if (ACTIVE_VALUE_STATES.has(state) && value === null) fail(`${state} outcome field requires a value`, "OUTCOME_VALUE_REQUIRED");
  if (["missing", "not_applicable"].includes(state) && value !== null) {
    fail(`${state} outcome field must not carry a value`, "OUTCOME_VALUE_FORBIDDEN");
  }
  if (state === "explicit_zero" && (value === null || !isZeroValue(value))) {
    fail("explicit_zero requires an explicit numeric zero", "OUTCOME_EXPLICIT_ZERO_REQUIRED");
  }
  return state;
}

function idPayload(kind: string, payload: Record<string, unknown>) {
  return { namespace: `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:${kind}`, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...payload };
}

export async function createVietnamOutcomeEvidenceSource(
  input: VietnamOutcomeEvidenceSourceInput,
): Promise<VietnamOutcomeEvidenceSource> {
  const sourceCategory = input.sourceCategory;
  const reviewerStatus = input.reviewerStatus;
  const evidenceQuality = input.evidenceQuality;
  if (sourceCategory === "rejected" && reviewerStatus !== "rejected") fail("rejected source category requires rejected review", "OUTCOME_REJECTED_SOURCE_STATE");
  if (evidenceQuality === "rejected" && reviewerStatus !== "rejected") fail("rejected evidence requires rejected review", "OUTCOME_REJECTED_EVIDENCE_STATE");
  if (reviewerStatus === "rejected" && evidenceQuality !== "rejected") fail("rejected review requires rejected evidence quality", "OUTCOME_REJECTED_EVIDENCE_STATE");
  const sourceIdentity = normalizeSourceIdentity(input.sourceIdentity);
  const content = {
    sourceCategory,
    sourceIdentity,
    organizer: normalizeText(input.organizer, "organizer"),
    seriesName: normalizeText(input.seriesName, "seriesName"),
    eventName: normalizeNullableText(input.eventName, "eventName"),
    publicationAt: normalizeInstant(input.publicationAt),
    capturedAt: normalizeInstant(input.capturedAt),
    expectedCompetitionKey: normalizeOptionalStableKey(input.expectedCompetitionKey, "expectedCompetitionKey"),
    reviewerStatus,
    evidenceQuality,
    limitationNotes: sortedUnique(input.limitationNotes, "limitationNotes"),
  };
  const sourceId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:source:${await canonicalHash(idPayload("source", content))}`;
  return deepFreeze({ sourceId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content });
}

export async function createVietnamOutcomeEvidenceClaim(
  input: VietnamOutcomeEvidenceClaimInput,
): Promise<VietnamOutcomeEvidenceClaim> {
  const field = input.field;
  const rawValue = input.value === null ? null : normalizeClaimValue(field, input.value);
  const state = normalizeFieldState(input.state, rawValue);
  if (input.source.reviewerStatus === "rejected" || input.source.evidenceQuality === "rejected") {
    fail("rejected evidence cannot create a usable outcome claim", "REJECTED_OUTCOME_EVIDENCE");
  }
  const content = {
    outcomeEventKey: normalizeStableKey(input.outcomeEventKey, "outcomeEventKey"),
    sourceId: input.source.sourceId,
    sourceIdentity: input.source.sourceIdentity,
    publicationAt: input.source.publicationAt,
    capturedAt: input.source.capturedAt,
    field,
    state,
    value: rawValue,
    visualOrTextRegion: normalizeText(input.visualOrTextRegion, "visualOrTextRegion"),
    extractionMethod: input.extractionMethod,
    extractionStatus: input.extractionStatus,
    evidenceQuality: input.source.evidenceQuality,
    correctionOfClaimId: input.correctionOfClaimId === null ? null : normalizeText(input.correctionOfClaimId, "correctionOfClaimId", 1024),
  };
  if (state === "conflicting" && content.extractionStatus !== "conflicting") fail("conflicting state requires conflicting extraction status", "OUTCOME_CONFLICT_STATUS_MISMATCH");
  if (state === "uncertain" && content.extractionStatus !== "uncertain") fail("uncertain state requires uncertain extraction status", "OUTCOME_UNCERTAIN_STATUS_MISMATCH");
  if (state === "missing" && content.extractionStatus !== "missing") fail("missing state requires missing extraction status", "OUTCOME_MISSING_STATUS_MISMATCH");
  const claimId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:claim:${await canonicalHash(idPayload("claim", content))}`;
  return deepFreeze({ claimId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content });
}

function claimMap(claims: readonly VietnamOutcomeEvidenceClaim[]): ReadonlyMap<string, VietnamOutcomeEvidenceClaim> {
  const map = new Map<string, VietnamOutcomeEvidenceClaim>();
  for (const claim of claims) {
    if (map.has(claim.claimId)) fail("duplicate outcome claim ID", "DUPLICATE_OUTCOME_CLAIM");
    map.set(claim.claimId, claim);
  }
  return map;
}

function resolveField(field: OutcomeFieldKey, claims: readonly VietnamOutcomeEvidenceClaim[]): OutcomeFieldObservation {
  const ids = sortedUnique(claims.map((claim) => claim.claimId), "claimIds");
  const active = claims.filter((claim) => claim.state !== "superseded");
  if (active.length === 0) return deepFreeze({ field, state: "superseded", value: null, claimIds: ids });
  if (active.some((claim) => claim.state === "conflicting")) return deepFreeze({ field, state: "conflicting", value: null, claimIds: ids });
  const usable = active.filter((claim) => ACTIVE_VALUE_STATES.has(claim.state) && claim.value !== null);
  if (usable.length > 0) {
    const value = usable[0].value!;
    if (usable.some((claim) => !valueEquals(value, claim.value!))) {
      return deepFreeze({ field, state: "conflicting", value: null, claimIds: ids });
    }
    if (active.some((claim) => claim.state === "uncertain")) {
      return deepFreeze({ field, state: "uncertain", value, claimIds: ids });
    }
    return deepFreeze({ field, state: value && isZeroValue(value) ? "explicit_zero" : "present", value, claimIds: ids });
  }
  if (active.some((claim) => claim.state === "uncertain")) return deepFreeze({ field, state: "uncertain", value: null, claimIds: ids });
  if (active.some((claim) => claim.state === "missing")) return deepFreeze({ field, state: "missing", value: null, claimIds: ids });
  return deepFreeze({ field, state: "not_applicable", value: null, claimIds: ids });
}

export async function createVietnamEventOutcome(
  input: VietnamEventOutcomeInput,
  claims: readonly VietnamOutcomeEvidenceClaim[],
): Promise<VietnamEventOutcome> {
  const map = claimMap(claims);
  const claimIds = sortedUnique(input.claimIds, "claimIds");
  if (claimIds.length === 0) fail("outcome requires at least one claim", "OUTCOME_CLAIMS_REQUIRED");
  const selected = claimIds.map((claimId) => {
    const claim = map.get(claimId);
    if (!claim) fail("outcome references an unknown claim", "UNKNOWN_OUTCOME_CLAIM");
    return claim;
  });
  const outcomeEventKey = normalizeStableKey(input.outcomeEventKey, "outcomeEventKey");
  if (selected.some((claim) => claim.outcomeEventKey !== outcomeEventKey)) fail("outcome claim event key mismatch", "OUTCOME_CLAIM_EVENT_MISMATCH");
  const fields = FIELD_ORDER
    .filter((field) => selected.some((claim) => claim.field === field))
    .map((field) => resolveField(field, selected.filter((claim) => claim.field === field)));
  const content = {
    outcomeEventKey,
    organizer: normalizeText(input.organizer, "organizer"),
    seriesName: normalizeText(input.seriesName, "seriesName"),
    eventName: normalizeText(input.eventName, "eventName"),
    eventDate: normalizeLocalDate(input.eventDate).value,
    flightIdentity: normalizeNullableText(input.flightIdentity, "flightIdentity", 512),
    currency: input.currency === null ? null : normalizeCurrency(input.currency),
    sourceClaimIds: claimIds,
    fields: Object.freeze(fields),
  };
  const outcomeId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:outcome:${await canonicalHash(idPayload("outcome", content))}`;
  return deepFreeze({ outcomeId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content });
}

function normalizeScheduleReference(input: ScheduleCompetitionReference): ScheduleCompetitionReference {
  return deepFreeze({
    competitionKey: normalizeStableKey(input.competitionKey, "competitionKey"),
    organizer: normalizeText(input.organizer, "organizer"),
    seriesName: normalizeText(input.seriesName, "seriesName"),
    eventName: normalizeText(input.eventName, "eventName"),
    eventDate: normalizeLocalDate(input.eventDate).value,
    flightIdentity: normalizeNullableText(input.flightIdentity, "flightIdentity", 512),
  });
}

export async function createScheduleOutcomeLink(input: ScheduleOutcomeLinkInput): Promise<ScheduleOutcomeLink> {
  const scheduleCompetitions = input.scheduleCompetitions.map(normalizeScheduleReference);
  if (new Set(scheduleCompetitions.map((item) => item.competitionKey)).size !== scheduleCompetitions.length) {
    fail("schedule competition references contain duplicates", "DUPLICATE_SCHEDULE_COMPETITION");
  }
  const expected = normalizeOptionalStableKey(input.expectedCompetitionKey, "expectedCompetitionKey");
  const sourceDeclared = normalizeOptionalStableKey(input.sourceDeclaredCompetitionKey, "sourceDeclaredCompetitionKey");
  const exactCandidates = [expected, sourceDeclared].filter((value): value is string => value !== null);
  const matching = scheduleCompetitions.filter((candidate) => exactCandidates.includes(candidate.competitionKey));
  let candidateMatches = matching;
  let state: ScheduleOutcomeLinkState;
  let competitionKey: string | null = null;
  let reasonCodes: string[];
  if (expected !== null && sourceDeclared !== null && expected !== sourceDeclared) {
    state = "conflicting"; reasonCodes = ["expected_and_source_declared_competition_conflict"];
  } else if (expected !== null && matching.length === 1 && matching[0].competitionKey === expected) {
    state = "exact"; competitionKey = expected; reasonCodes = ["expected_competition_key_exact_match"];
  } else if (sourceDeclared !== null && matching.length === 1 && matching[0].competitionKey === sourceDeclared) {
    state = "explicit_source_link"; competitionKey = sourceDeclared; reasonCodes = ["source_declared_competition_key_match"];
  } else if (matching.length > 1) {
    state = "ambiguous"; reasonCodes = ["multiple_schedule_competitions_match_explicit_key"];
  } else if (expected !== null || sourceDeclared !== null) {
    state = "unlinked"; reasonCodes = ["explicit_schedule_competition_key_not_found"];
  } else {
    const structural = scheduleCompetitions.filter((candidate) =>
      candidate.organizer === input.outcome.organizer
      && candidate.seriesName === input.outcome.seriesName
      && candidate.eventName === input.outcome.eventName
      && candidate.eventDate === input.outcome.eventDate
      && candidate.flightIdentity === input.outcome.flightIdentity,
    );
    candidateMatches = structural;
    if (structural.length === 0) { state = "unlinked"; reasonCodes = ["no_explicit_or_structural_schedule_match"]; }
    else if (structural.length === 1) { state = "candidate"; competitionKey = structural[0].competitionKey; reasonCodes = ["structural_candidate_requires_review"]; }
    else { state = "ambiguous"; reasonCodes = ["multiple_structural_schedule_candidates"]; }
  }
  const candidateCompetitionKeys = Object.freeze(candidateMatches
    .map((candidate) => candidate.competitionKey)
    .sort(compareCanonicalStrings));
  const content = { outcomeId: input.outcome.outcomeId, outcomeEventKey: input.outcome.outcomeEventKey, competitionKey, state, candidateCompetitionKeys, reasonCodes };
  const linkId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:schedule-outcome-link:${await canonicalHash(idPayload("schedule-outcome-link", content))}`;
  return deepFreeze({ linkId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content, reasonCodes: Object.freeze(reasonCodes) });
}

function getField(outcome: VietnamEventOutcome, key: OutcomeFieldKey): OutcomeFieldObservation | null {
  return outcome.fields.find((field) => field.field === key) ?? null;
}

function isExplicitMoney(field: OutcomeFieldObservation | null): field is OutcomeFieldObservation & { readonly value: Extract<OutcomeClaimValue, { readonly type: "money" }> } {
  return field !== null && ACTIVE_VALUE_STATES.has(field.state) && field.value?.type === "money";
}

function isExplicitInteger(field: OutcomeFieldObservation | null): field is OutcomeFieldObservation & { readonly value: Extract<OutcomeClaimValue, { readonly type: "integer" }> } {
  return field !== null && ACTIVE_VALUE_STATES.has(field.state) && field.value?.type === "integer";
}

export function deriveOutcomeOverlaySurplus(outcome: VietnamEventOutcome): { readonly overlay: OutcomeDerivedMoney | null; readonly surplus: OutcomeDerivedMoney | null } {
  const gtd = getField(outcome, "published_gtd");
  const prizePool = getField(outcome, "actual_prize_pool");
  if (!isExplicitMoney(gtd) || !isExplicitMoney(prizePool)) return deepFreeze({ overlay: null, surplus: null });
  if (gtd.value.currency !== prizePool.value.currency || gtd.value.scale !== prizePool.value.scale) return deepFreeze({ overlay: null, surplus: null });
  const delta = BigInt(gtd.value.minorUnits) - BigInt(prizePool.value.minorUnits);
  const inputClaimIds = sortedUnique([...gtd.claimIds, ...prizePool.claimIds], "overlay input claim IDs");
  const make = (kind: "overlay" | "surplus", minorUnits: bigint): OutcomeDerivedMoney => deepFreeze({
    kind,
    minorUnits: minorUnits.toString(),
    currency: gtd.value.currency,
    scale: gtd.value.scale,
    inputClaimIds,
    methodVersion: "explicit-compatible-money-v1",
  });
  return deepFreeze({ overlay: make("overlay", delta > 0n ? delta : 0n), surplus: make("surplus", delta < 0n ? -delta : 0n) });
}

export async function createOutcomeReadinessReport(
  outcome: VietnamEventOutcome,
  link: ScheduleOutcomeLink,
): Promise<OutcomeReadinessReport> {
  if (link.outcomeId !== outcome.outcomeId) fail("readiness link does not match outcome", "OUTCOME_LINK_MISMATCH");
  const states = new Set<OutcomeReadinessState>();
  const reasonCodes: string[] = [...link.reasonCodes];
  const entries = getField(outcome, "entries");
  const entriesBasis = getField(outcome, "entries_basis");
  const uniquePlayers = getField(outcome, "unique_players");
  const bullets = getField(outcome, "total_bullets");
  const prizePool = getField(outcome, "actual_prize_pool");
  const completion = getField(outcome, "completion_status");
  const satelliteAwarded = getField(outcome, "satellite_seats_awarded");
  const satelliteRedeemed = getField(outcome, "satellite_seats_redeemed");
  const satelliteConverted = getField(outcome, "satellite_seats_converted");
  const anyConflicting = outcome.fields.some((field) => field.state === "conflicting");
  const anyObserved = outcome.fields.some((field) => ACTIVE_VALUE_STATES.has(field.state));
  if (!anyObserved) { states.add("missing_outcome"); reasonCodes.push("no_explicit_observed_outcome_fields"); }
  if (anyObserved && !(isExplicitInteger(entries) || isExplicitMoney(prizePool))) { states.add("partial_outcome"); reasonCodes.push("entries_and_actual_prize_pool_not_explicit"); }
  if (anyConflicting) { states.add("conflicting_outcome"); reasonCodes.push("one_or_more_outcome_fields_conflicting"); }
  if (link.state === "ambiguous") states.add("ambiguous_linkage");
  const entriesAreEventTotal = isExplicitInteger(entries)
    && entriesBasis?.value?.type === "text"
    && entriesBasis.value.value === "event_total";
  if (isExplicitInteger(entries) && !entriesAreEventTotal) {
    states.add("partial_outcome");
    reasonCodes.push("entries_basis_is_not_explicit_event_total");
  }
  if (entriesAreEventTotal && isExplicitMoney(prizePool)) states.add("turnout_economics_ready");
  else if (entriesAreEventTotal) states.add("entries_only");
  else if (isExplicitMoney(prizePool)) states.add("prize_pool_only");
  if (!isExplicitInteger(uniquePlayers)) { states.add("unique_player_analysis_blocked"); reasonCodes.push("missing_or_nonexplicit_unique_players"); }
  if (!isExplicitInteger(uniquePlayers) || !isExplicitInteger(bullets)) { states.add("reentry_analysis_blocked"); reasonCodes.push("missing_or_nonexplicit_unique_players_or_total_bullets"); }
  if (!isExplicitInteger(satelliteAwarded) || !isExplicitInteger(satelliteRedeemed) || !isExplicitInteger(satelliteConverted)) {
    states.add("satellite_conversion_blocked"); reasonCodes.push("missing_or_nonexplicit_satellite_conversion_fields");
  }
  if (
    !anyConflicting
    && completion?.value?.type === "text"
    && completion.value.value === "result_final"
    && entriesAreEventTotal
    && ["exact", "explicit_source_link"].includes(link.state)
  ) {
    states.add("outcome_ready");
  }
  const derived = deriveOutcomeOverlaySurplus(outcome);
  const normalizedStates = Object.freeze([...states].sort(compareCanonicalStrings));
  const normalizedReasons = sortedUnique(reasonCodes, "readiness reasons");
  const content = { outcomeId: outcome.outcomeId, competitionKey: link.competitionKey, states: normalizedStates, reasonCodes: normalizedReasons, overlay: derived.overlay, surplus: derived.surplus };
  const readinessId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:readiness:${await canonicalHash(idPayload("readiness", content))}`;
  return deepFreeze({ readinessId, ...content });
}

export async function createVietnamOutcomeEvidenceBundle(
  input: VietnamOutcomeEvidenceBundleInput,
): Promise<VietnamOutcomeEvidenceBundle> {
  if (input.sources.length === 0 || input.claims.length === 0 || input.outcomeInputs.length === 0) {
    fail("Vietnam Outcome Evidence V1 cannot emit an empty research release", "OUTCOME_RELEASE_EMPTY");
  }
  const sourceCutoff = normalizeInstant(input.sourceCutoff);
  const sources = [...input.sources].sort((a, b) => compareCanonicalStrings(a.sourceId, b.sourceId));
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) fail("duplicate outcome source ID", "DUPLICATE_OUTCOME_SOURCE");
  if (sources.some((source) => source.publicationAt > sourceCutoff)) {
    fail("an outcome source publication time cannot be after the release source cutoff", "OUTCOME_SOURCE_AFTER_CUTOFF");
  }
  if (sources.some((source) => source.reviewerStatus !== "reviewed" || source.evidenceQuality === "rejected")) {
    fail("only reviewed non-rejected sources may enter an outcome release", "OUTCOME_SOURCE_NOT_RELEASE_ELIGIBLE");
  }
  const claims = [...input.claims].sort((a, b) => compareCanonicalStrings(a.claimId, b.claimId));
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  for (const claim of claims) {
    const source = sourcesById.get(claim.sourceId);
    if (!source) fail("release claim source is not included", "OUTCOME_RELEASE_SOURCE_MISMATCH");
    const claimSourceProvenance = {
      sourceIdentity: claim.sourceIdentity,
      publicationAt: claim.publicationAt,
      capturedAt: claim.capturedAt,
      evidenceQuality: claim.evidenceQuality,
    };
    const sourceProvenance = {
      sourceIdentity: source.sourceIdentity,
      publicationAt: source.publicationAt,
      capturedAt: source.capturedAt,
      evidenceQuality: source.evidenceQuality,
    };
    if (canonicalize(claimSourceProvenance) !== canonicalize(sourceProvenance)) {
      fail("release claim provenance does not match its included source", "OUTCOME_CLAIM_SOURCE_PROVENANCE_MISMATCH");
    }
  }
  const outcomes = await Promise.all(input.outcomeInputs.map((outcome) => createVietnamEventOutcome(outcome, claims)));
  const orderedOutcomes = [...outcomes].sort((a, b) => compareCanonicalStrings(a.outcomeId, b.outcomeId));
  if (new Set(orderedOutcomes.map((outcome) => outcome.outcomeId)).size !== orderedOutcomes.length) fail("duplicate outcome ID", "DUPLICATE_OUTCOME_ID");
  const links = [...input.links].sort((a, b) => compareCanonicalStrings(a.linkId, b.linkId));
  if (links.some((link) => !orderedOutcomes.some((outcome) => outcome.outcomeId === link.outcomeId))) fail("release link outcome is not included", "OUTCOME_RELEASE_LINK_MISMATCH");
  const readinessReports = await Promise.all(orderedOutcomes.map(async (outcome) => {
    const link = links.find((candidate) => candidate.outcomeId === outcome.outcomeId);
    if (!link) fail("release outcome requires a schedule-outcome link", "OUTCOME_LINK_REQUIRED");
    return createOutcomeReadinessReport(outcome, link);
  }));
  const sourceIds = Object.freeze(sources.map((source) => source.sourceId));
  const claimIds = Object.freeze(claims.map((claim) => claim.claimId));
  const outcomeIds = Object.freeze(orderedOutcomes.map((outcome) => outcome.outcomeId));
  const linkIds = Object.freeze(links.map((link) => link.linkId));
  const sourceContentHashes = Object.freeze(sources.map((source) => source.sourceIdentity.sha256).filter((value): value is string => value !== null).sort(compareCanonicalStrings));
  const inclusionContent = { sourceCutoff, sourceIds, claimIds, outcomeIds, linkIds, sourceContentHashes };
  const inclusionManifestId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:inclusion:${await canonicalHash(idPayload("inclusion", inclusionContent))}`;
  const inclusionManifest = deepFreeze({ inclusionManifestId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...inclusionContent });
  const evidenceQuality = Object.freeze([...new Set(sources.map((source) => source.evidenceQuality))].sort(compareCanonicalStrings));
  const releaseContent = { releaseKind: "observed_public_outcome_evidence" as const, releaseKey: "vietnam-outcome-evidence-v1" as const, market: "vietnam" as const, country: "Vietnam" as const, scopeKind: "country" as const, sourceCutoff, inclusionManifestId, sourceIds, claimIds, outcomeIds, linkIds, evidenceQuality };
  const releaseId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:release:${await canonicalHash(idPayload("release", releaseContent))}`;
  const release = deepFreeze({ releaseId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...releaseContent });
  const limitations = Object.freeze([
    "Observed public outcome evidence is separate from planned schedule supply.",
    "Absent evidence remains missing and is never interpreted as zero.",
    "No public release contains private player, registration, or operator records.",
    "Only exact or explicit source schedule links are eligible for automatic aggregate research.",
  ]);
  const artifactContent = { artifactType: "vietnam_outcome_evidence" as const, releaseId, sourceCutoff, sources, claims, outcomes: orderedOutcomes, links, readinessReports: readinessReports.sort((a, b) => compareCanonicalStrings(a.readinessId, b.readinessId)), limitations };
  const contentHash = await canonicalHash(idPayload("artifact-content", artifactContent));
  const artifactId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:artifact:${await canonicalHash(idPayload("artifact", { releaseId, contentHash }))}`;
  const artifact = deepFreeze({ artifactId, contentHash, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...artifactContent });
  return deepFreeze({ inclusionManifest, release, artifact });
}

export async function createVietnamOutcomeReceipt(input: {
  readonly bundle: VietnamOutcomeEvidenceBundle;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
}): Promise<VietnamOutcomeReceipt> {
  const artifactPath = input.artifactPath.replace(/\\/g, "/").trim();
  if (!artifactPath.startsWith("src/lib/series-market/datasets/vietnam/outcomes/") || artifactPath.includes("..")) {
    fail("outcome artifact path must be repository-relative under Vietnam outcomes", "INVALID_OUTCOME_ARTIFACT_PATH");
  }
  const sourceReceipts = Object.freeze(input.bundle.artifact.sources.map((source) => ({ sourceId: source.sourceId, sourceIdentity: source.sourceIdentity })));
  const content = { releaseId: input.bundle.release.releaseId, artifactId: input.bundle.artifact.artifactId, artifactContentHash: input.bundle.artifact.contentHash, artifactPath, artifactFileSha256: normalizeSha256(input.artifactFileSha256, "artifactFileSha256"), sourceReceipts };
  const receiptId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:receipt:${await canonicalHash(idPayload("receipt", content))}`;
  return deepFreeze({ receiptId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content });
}

export async function createVietnamOutcomeCorrection(
  input: VietnamOutcomeCorrectionInput,
  claims: readonly VietnamOutcomeEvidenceClaim[],
): Promise<VietnamOutcomeCorrection> {
  const map = claimMap(claims);
  const superseded = map.get(input.supersededClaimId);
  const superseding = map.get(input.supersedingClaimId);
  if (!superseded || !superseding) fail("correction references an unknown claim", "UNKNOWN_OUTCOME_CORRECTION_CLAIM");
  if (superseded.claimId === superseding.claimId) fail("a correction cannot supersede itself", "OUTCOME_CORRECTION_SELF_REFERENCE");
  if (superseded.outcomeEventKey !== superseding.outcomeEventKey || superseded.field !== superseding.field) {
    fail("a correction must stay within one outcome event and field", "OUTCOME_CORRECTION_FIELD_MISMATCH");
  }
  const content = { correctionKey: normalizeStableKey(input.correctionKey, "correctionKey"), correctedAt: normalizeInstant(input.correctedAt), supersededClaimId: superseded.claimId, supersedingClaimId: superseding.claimId, reason: normalizeText(input.reason, "correction reason") };
  const correctionId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:correction:${await canonicalHash(idPayload("correction", content))}`;
  return deepFreeze({ correctionId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content, status: "superseded_by_corrected_claim" as const });
}

export async function createOutcomeIntakeRecord(input: OutcomeIntakeRecordInput): Promise<OutcomeIntakeRecord> {
  const source = await createVietnamOutcomeEvidenceSource(input.source);
  const claimedFields = Object.freeze([...new Set(input.claimedFields)].sort(compareCanonicalStrings));
  if (claimedFields.length !== input.claimedFields.length) fail("claimed outcome fields contain duplicates", "DUPLICATE_OUTCOME_INTAKE_FIELD");
  const content = { intakeKey: normalizeStableKey(input.intakeKey, "intakeKey"), sourceId: source.sourceId, claimedFields, expectedCompetitionKey: normalizeOptionalStableKey(input.expectedCompetitionKey, "expectedCompetitionKey"), reviewerStatus: input.reviewerStatus, limitationNotes: sortedUnique(input.limitationNotes, "limitationNotes"), fixtureOnly: true as const };
  if (content.reviewerStatus !== source.reviewerStatus) fail("intake review status must match source review status", "OUTCOME_INTAKE_REVIEW_MISMATCH");
  const intakeId = `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:intake:${await canonicalHash(idPayload("intake", content))}`;
  return deepFreeze({ intakeId, contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION, ...content, source });
}

export function validateOutcomeCorrectionGraph(corrections: readonly VietnamOutcomeCorrection[]): void {
  const edges = new Map<string, string>();
  for (const correction of corrections) {
    if (edges.has(correction.supersededClaimId)) fail("a claim may have one superseding correction", "OUTCOME_CORRECTION_DUPLICATE_SUPERSESSION");
    edges.set(correction.supersededClaimId, correction.supersedingClaimId);
  }
  for (const start of edges.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined) {
      if (visited.has(current)) fail("outcome correction graph contains a cycle", "OUTCOME_CORRECTION_CYCLE");
      visited.add(current);
      current = edges.get(current);
    }
  }
}

export function isAutomaticAggregateResearchEligible(link: ScheduleOutcomeLink): boolean {
  return link.state === "exact" || link.state === "explicit_source_link";
}
