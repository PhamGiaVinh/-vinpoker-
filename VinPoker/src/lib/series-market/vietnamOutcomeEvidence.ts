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
import {
  VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
  VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
  VIETNAM_SUPPLY_CURRENT_CORRECTION_ID,
  VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
  VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
  VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID,
} from "./vietnamSupplyReadModel";

/**
 * D1B is an append-only public-evidence contract. It does not fetch evidence,
 * touch private operator data, or make an operational recommendation.
 */
export const VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION = "v2" as const;
export const VIETNAM_OUTCOME_EVIDENCE_NAMESPACE =
  `series-market:v1:vietnam-outcome-evidence:${VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION}` as const;
export const VIETNAM_OUTCOME_FIXTURE_PREFIX = "fixture." as const;
export const VIETNAM_SUPPLY_CURRENT_COMPETITION_INDEX_SHA256 =
  "578f8eb86c955cb26d4b618ad9a584d557033aa7ed41d06be54373abf1420830" as const;
export const VIETNAM_SUPPLY_CURRENT_SOURCE_CUTOFF =
  "2026-07-28T14:05:00.000Z" as const;

export const OUTCOME_EVIDENCE_QUALITIES = [
  "official_result_verified",
  "official_result_unverified",
  "established_reporting_unverified",
  "owner_provided_public_image_unverified",
  "secondary_public_announcement_unverified",
  "conflicting_public_sources",
  "insufficient_identity",
  "rejected",
] as const;
export type VietnamOutcomeEvidenceQuality = (typeof OUTCOME_EVIDENCE_QUALITIES)[number];

export const OUTCOME_SOURCE_CATEGORIES = [
  "official_result_poster",
  "official_tournament_report",
  "official_result_page",
  "established_public_reporting",
  "final_result_pdf",
  "public_outcome_post",
  "public_satellite_result",
  "rejected",
] as const;
export type OutcomeSourceCategory = (typeof OUTCOME_SOURCE_CATEGORIES)[number];

export const OUTCOME_REVIEWER_STATUSES = ["intake", "reviewed", "rejected"] as const;
export type OutcomeReviewerStatus = (typeof OUTCOME_REVIEWER_STATUSES)[number];

export const OUTCOME_EXTRACTION_METHODS = ["manual_visual", "manual_text", "ocr_assisted"] as const;
export type OutcomeExtractionMethod = (typeof OUTCOME_EXTRACTION_METHODS)[number];

export const OUTCOME_EXTRACTION_STATUSES = [
  "verified",
  "uncertain",
  "conflicting",
  "missing",
  "rejected",
] as const;
export type OutcomeExtractionStatus = (typeof OUTCOME_EXTRACTION_STATUSES)[number];

export const OUTCOME_CLAIM_STATES = [
  "present",
  "missing",
  "explicit_zero",
  "uncertain",
  "conflicting",
  "not_applicable",
  "rejected",
] as const;
export type OutcomeClaimState = (typeof OUTCOME_CLAIM_STATES)[number];
export type OutcomeResolvedFieldState = OutcomeClaimState | "superseded";

export const OUTCOME_FIELD_KEYS = [
  "organizer",
  "series_name",
  "event_name",
  "event_number",
  "event_date",
  "flight_identity",
  "currency",
  "entries",
  "unique_players",
  "total_bullets",
  "reentry_count",
  "published_gtd",
  "actual_prize_pool",
  "prize_contribution_per_entry",
  "organizer_fee",
  "paid_places",
  "min_cash",
  "first_prize",
  "satellite_seats_awarded",
  "satellite_seats_redeemed",
  "satellite_seats_converted",
  "satellite_target_competition_key",
  "linkage_confidence",
  "completion_status",
] as const;
export type OutcomeFieldKey = (typeof OUTCOME_FIELD_KEYS)[number];

export const OUTCOME_VALUE_SCOPE_BASES = [
  "event_total",
  "flight_only",
  "day_total",
  "series_total",
  "partial_result",
  "unknown",
] as const;
export type OutcomeValueScopeBasis = (typeof OUTCOME_VALUE_SCOPE_BASES)[number];

export const OUTCOME_COMPLETION_STATUSES = [
  "scheduled",
  "registration_open",
  "completed",
  "cancelled",
  "postponed",
  "result_partial",
  "result_final",
] as const;
export type OutcomeCompletionStatus = (typeof OUTCOME_COMPLETION_STATUSES)[number];

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

export const OUTCOME_APPROVED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/html",
  "text/plain",
  "application/json",
] as const;
export type OutcomeApprovedMediaType = (typeof OUTCOME_APPROVED_MEDIA_TYPES)[number];

export type OutcomePublicationTime =
  | { readonly kind: "exact"; readonly value: string }
  | { readonly kind: "not_reported" };

export type OutcomeClaimValue =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "integer"; readonly value: string }
  | { readonly type: "money"; readonly minorUnits: string; readonly currency: string; readonly scale: number }
  | { readonly type: "local_date"; readonly value: string };

export interface OutcomeValueScope {
  readonly basis: OutcomeValueScopeBasis;
  readonly scopeIdentity: string;
}

export type VietnamOutcomeSourceIdentity =
  | {
    readonly kind: "repository_file";
    readonly path: string;
    readonly sha256: string;
    readonly byteLength: string;
    readonly mediaType: OutcomeApprovedMediaType;
  }
  | {
    readonly kind: "public_url";
    readonly url: string;
    readonly sha256: string | null;
    readonly byteLength: string | null;
    readonly mediaType: OutcomeApprovedMediaType | null;
  };

export interface VietnamOutcomeEvidenceSourceInput {
  readonly sourceKey: string;
  readonly sourceCategory: OutcomeSourceCategory;
  readonly sourceIdentity: VietnamOutcomeSourceIdentity;
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string | null;
  readonly publication: OutcomePublicationTime;
  readonly capturedAt: string;
  readonly expectedCompetitionKey: string | null;
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly evidenceQuality: VietnamOutcomeEvidenceQuality;
  readonly limitationNotes: readonly string[];
}

export interface VietnamOutcomeEvidenceSource extends VietnamOutcomeEvidenceSourceInput {
  readonly sourceId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly sourceIdentity: VietnamOutcomeSourceIdentity;
  readonly publication: OutcomePublicationTime;
  readonly limitationNotes: readonly string[];
}

export interface VietnamOutcomeEvidenceClaimInput {
  readonly outcomeEventKey: string;
  readonly source: VietnamOutcomeEvidenceSource;
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeClaimState;
  readonly value: OutcomeClaimValue | null;
  readonly scope: OutcomeValueScope | null;
  readonly visualOrTextRegion: string;
  readonly extractionMethod: OutcomeExtractionMethod;
  readonly extractionStatus: OutcomeExtractionStatus;
}

export interface VietnamOutcomeEvidenceClaim {
  readonly claimId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly outcomeEventKey: string;
  readonly sourceId: string;
  readonly sourceIdentity: VietnamOutcomeSourceIdentity;
  readonly publication: OutcomePublicationTime;
  readonly capturedAt: string;
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeClaimState;
  readonly value: OutcomeClaimValue | null;
  readonly scope: OutcomeValueScope | null;
  readonly visualOrTextRegion: string;
  readonly extractionMethod: OutcomeExtractionMethod;
  readonly extractionStatus: OutcomeExtractionStatus;
  readonly evidenceQuality: VietnamOutcomeEvidenceQuality;
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

export interface OutcomeFieldObservation {
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeResolvedFieldState;
  readonly value: OutcomeClaimValue | null;
  readonly scope: OutcomeValueScope | null;
  readonly claimIds: readonly string[];
  readonly supersededClaimIds: readonly string[];
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
  readonly correctionIds: readonly string[];
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
  readonly correctionIds: readonly string[];
  readonly fields: readonly OutcomeFieldObservation[];
}

export interface ScheduleCompetitionReference {
  readonly scheduleEventId: string;
  readonly scheduleEventKey: string;
  readonly competitionKey: string;
  readonly organizer: string;
  readonly seriesName: string;
  readonly eventName: string;
  readonly eventDate: string;
  readonly flightIdentity: string | null;
}

export interface VietnamScheduleCorrectionLineageReference {
  readonly correctionId: string;
  readonly supersededReleaseId: string;
  readonly correctedReleaseId: string;
}

export interface VietnamScheduleLinkageContextInput {
  readonly scheduleReleaseId: string;
  readonly scheduleArtifactId: string;
  readonly scheduleReceiptId: string;
  readonly scheduleArtifactFileSha256: string;
  readonly scheduleSourceCutoff: string;
  readonly correctionLineage: readonly VietnamScheduleCorrectionLineageReference[];
  readonly scheduleCompetitions: readonly ScheduleCompetitionReference[];
}

export interface VietnamScheduleLinkageContext extends VietnamScheduleLinkageContextInput {
  readonly linkageContextId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly scheduleCompetitionIndexSha256:
    typeof VIETNAM_SUPPLY_CURRENT_COMPETITION_INDEX_SHA256;
  readonly correctionLineage: readonly VietnamScheduleCorrectionLineageReference[];
  readonly scheduleCompetitions: readonly ScheduleCompetitionReference[];
}

export interface ScheduleOutcomeLinkInput {
  readonly outcome: VietnamEventOutcome;
  readonly linkageContext: VietnamScheduleLinkageContext;
  readonly sourceCutoff: string;
  readonly expectedCompetitionKey: string | null;
  readonly sourceDeclaredCompetitionKey: string | null;
}

export interface ScheduleOutcomeLink {
  readonly linkId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly linkageContextId: string;
  readonly sourceCutoff: string;
  readonly outcomeId: string;
  readonly outcomeEventKey: string;
  readonly expectedCompetitionKey: string | null;
  readonly sourceDeclaredCompetitionKey: string | null;
  readonly competitionKey: string | null;
  readonly scheduleEventId: string | null;
  readonly state: ScheduleOutcomeLinkState;
  readonly candidateCompetitionKeys: readonly string[];
  readonly candidateScheduleEventIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface VietnamOutcomeInclusionManifest {
  readonly inclusionManifestId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly sourceCutoff: string;
  readonly linkageContextId: string;
  readonly sourceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly correctionIds: readonly string[];
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
  readonly linkageContextId: string;
  readonly inclusionManifestId: string;
  readonly sourceIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly correctionIds: readonly string[];
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
  readonly methodVersion: "explicit-final-event-scope-money-v2";
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
  readonly linkageContext: VietnamScheduleLinkageContext;
  readonly sources: readonly VietnamOutcomeEvidenceSource[];
  readonly claims: readonly VietnamOutcomeEvidenceClaim[];
  readonly corrections: readonly VietnamOutcomeCorrection[];
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
    readonly sourceIdentity: VietnamOutcomeSourceIdentity;
  }[];
}

export interface OutcomeIntakeClaimInput {
  readonly field: OutcomeFieldKey;
  readonly state: OutcomeClaimState;
  readonly value: OutcomeClaimValue | null;
  readonly scope: OutcomeValueScope | null;
  readonly visualOrTextRegion: string;
  readonly extractionMethod: OutcomeExtractionMethod;
  readonly extractionStatus: OutcomeExtractionStatus;
}

export interface OutcomeIntakeRecordInput {
  readonly intakeKey: string;
  readonly fixtureOnly: boolean;
  readonly source: VietnamOutcomeEvidenceSourceInput;
  readonly outcome: Omit<VietnamEventOutcomeInput, "claimIds" | "correctionIds">;
  readonly claims: readonly OutcomeIntakeClaimInput[];
  readonly linkage: {
    readonly expectedCompetitionKey: string | null;
    readonly sourceDeclaredCompetitionKey: string | null;
  };
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly limitationNotes: readonly string[];
}

export interface OutcomeIntakeRecord {
  readonly intakeId: string;
  readonly contractVersion: typeof VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION;
  readonly intakeKey: string;
  readonly fixtureOnly: boolean;
  readonly source: VietnamOutcomeEvidenceSource;
  readonly outcome: Omit<VietnamEventOutcomeInput, "claimIds" | "correctionIds">;
  readonly claims: readonly VietnamOutcomeEvidenceClaim[];
  readonly linkage: {
    readonly expectedCompetitionKey: string | null;
    readonly sourceDeclaredCompetitionKey: string | null;
  };
  readonly reviewerStatus: OutcomeReviewerStatus;
  readonly limitationNotes: readonly string[];
}

export interface VietnamOutcomeEvidenceBundleInput {
  readonly sourceCutoff: string;
  readonly linkageContext: VietnamScheduleLinkageContext;
  readonly sources: readonly VietnamOutcomeEvidenceSource[];
  readonly claims: readonly VietnamOutcomeEvidenceClaim[];
  readonly corrections: readonly VietnamOutcomeCorrection[];
  readonly outcomes: readonly VietnamEventOutcome[];
  readonly links: readonly ScheduleOutcomeLink[];
}

export interface VietnamOutcomeEvidenceBundle {
  readonly inclusionManifest: VietnamOutcomeInclusionManifest;
  readonly release: VietnamOutcomeRelease;
  readonly artifact: VietnamOutcomeArtifact;
}

const FIELD_ORDER = OUTCOME_FIELD_KEYS;
const MONEY_FIELDS = new Set<OutcomeFieldKey>([
  "published_gtd",
  "actual_prize_pool",
  "prize_contribution_per_entry",
  "organizer_fee",
  "min_cash",
  "first_prize",
]);
const COUNT_FIELDS = new Set<OutcomeFieldKey>([
  "entries",
  "unique_players",
  "total_bullets",
  "reentry_count",
  "paid_places",
  "satellite_seats_awarded",
  "satellite_seats_redeemed",
  "satellite_seats_converted",
]);
const DATE_FIELDS = new Set<OutcomeFieldKey>(["event_date"]);
const ACTIVE_VALUE_STATES = new Set<OutcomeClaimState>(["present", "explicit_zero"]);
const ACTIVE_RESOLVED_STATES = new Set<OutcomeResolvedFieldState>(["present", "explicit_zero"]);
const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal"];
const SENSITIVE_QUERY_KEYS = [
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "credential",
  "key",
  "password",
  "secret",
  "signature",
  "token",
];

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

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`, "INVALID_OUTCOME_OBJECT");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = asRecord(value, label);
  const actual = Object.keys(record).sort(compareCanonicalStrings);
  const expected = [...keys].sort(compareCanonicalStrings);
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail(`${label} contains missing or unknown keys`, "INVALID_OUTCOME_OBJECT_KEYS");
  }
  return record;
}

function normalizeText(raw: unknown, label: string, max = 4096): string {
  if (typeof raw !== "string") fail(`${label} must be text`, "INVALID_OUTCOME_TEXT");
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > max) {
    fail(`${label} must be non-blank printable text`, "INVALID_OUTCOME_TEXT");
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      fail(`${label} must be non-blank printable text`, "INVALID_OUTCOME_TEXT");
    }
  }
  return value;
}

function normalizeNullableText(raw: unknown, label: string, max = 4096): string | null {
  return raw === null ? null : normalizeText(raw, label, max);
}

function normalizeKey(raw: unknown, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be a stable key`, "INVALID_STABLE_KEY");
  return normalizeStableKey(raw, label);
}

function normalizeOptionalStableKey(raw: unknown, label: string): string | null {
  return raw === null ? null : normalizeKey(raw, label);
}

function normalizeInstantStrict(raw: unknown, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be an instant`, "INVALID_INSTANT");
  return normalizeInstant(raw);
}

function normalizeLocalDateStrict(raw: unknown, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be a local date`, "INVALID_LOCAL_DATE");
  return normalizeLocalDate(raw).value;
}

function normalizeCurrencyStrict(raw: unknown, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be a currency`, "INVALID_CURRENCY");
  return normalizeCurrency(raw);
}

function normalizeSha256(raw: unknown, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be SHA-256`, "INVALID_OUTCOME_SHA256");
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) fail(`${label} must be SHA-256`, "INVALID_OUTCOME_SHA256");
  return value;
}

function normalizeNonNegativeInteger(raw: unknown, label: string): string {
  if (typeof raw !== "string") fail(`${label} must be an integer string`, "INVALID_INTEGER");
  const value = normalizeIntegerString(raw);
  if (value.startsWith("-")) fail(`${label} cannot be negative`, "NEGATIVE_OUTCOME_COUNT");
  return value;
}

function normalizePositiveInteger(raw: unknown, label: string): string {
  const value = normalizeNonNegativeInteger(raw, label);
  if (BigInt(value) <= 0n) fail(`${label} must be positive`, "INVALID_OUTCOME_BYTE_LENGTH");
  return value;
}

function normalizeEnum<T extends string>(
  raw: unknown,
  values: readonly T[],
  label: string,
  code = "INVALID_OUTCOME_ENUM",
): T {
  if (typeof raw !== "string" || !values.includes(raw as T)) {
    fail(`${label} is not recognized`, code);
  }
  return raw as T;
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  const normalized = values.map((value) => normalizeText(value, label, 1024));
  if (new Set(normalized).size !== normalized.length) {
    fail(`${label} contains duplicates`, "DUPLICATE_OUTCOME_REFERENCE");
  }
  return Object.freeze([...normalized].sort(compareCanonicalStrings));
}

function normalizePublication(raw: unknown): OutcomePublicationTime {
  const record = asRecord(raw, "publication");
  const kind = normalizeEnum(record.kind, ["exact", "not_reported"] as const, "publication kind");
  if (kind === "not_reported") {
    exactKeys(record, ["kind"], "publication");
    return deepFreeze({ kind });
  }
  exactKeys(record, ["kind", "value"], "publication");
  return deepFreeze({ kind, value: normalizeInstantStrict(record.value, "publication value") });
}

function normalizeMediaType(raw: unknown): OutcomeApprovedMediaType {
  return normalizeEnum(raw, OUTCOME_APPROVED_MEDIA_TYPES, "outcome media type", "INVALID_OUTCOME_MEDIA_TYPE");
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const values = parts.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b] = values;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127)
    || a >= 224;
}

function embeddedIpv4FromIpv6(hostname: string): string | null {
  const suffix = hostname.startsWith("::ffff:")
    ? hostname.slice("::ffff:".length)
    : hostname.startsWith("::")
      ? hostname.slice(2)
      : null;
  if (suffix === null) return null;
  if (suffix.includes(".")) return suffix;
  const groups = suffix.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[a-f0-9]{1,4}$/i.test(group))) {
    return null;
  }
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => value.endsWith(suffix))) return true;
  if (isPrivateIpv4(value)) return true;
  if (value.includes(":")) {
    const embeddedIpv4 = embeddedIpv4FromIpv6(value);
    return /^(?:fc|fd|fe8|fe9|fea|feb)/i.test(value)
      || value === "::"
      || (embeddedIpv4 !== null && isPrivateIpv4(embeddedIpv4));
  }
  return false;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizePublicUrl(raw: unknown): string {
  if (typeof raw !== "string" || containsControlCharacter(raw) || /%(?:0[0-9a-f]|7f)/i.test(raw)) {
    fail("public source URL contains control characters", "INVALID_OUTCOME_PUBLIC_URL");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("public source URL is invalid", "INVALID_OUTCOME_PUBLIC_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || isPrivateHostname(url.hostname)) {
    fail("public source URL must be public canonical HTTPS without credentials or fragment", "INVALID_OUTCOME_PUBLIC_URL");
  }
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEYS.includes(key.toLowerCase())) {
      fail("public source URL must not contain credential-like query parameters", "INVALID_OUTCOME_PUBLIC_URL");
    }
  }
  return url.toString();
}

function normalizeSourceIdentity(raw: unknown): VietnamOutcomeSourceIdentity {
  const record = asRecord(raw, "sourceIdentity");
  const kind = normalizeEnum(record.kind, ["repository_file", "public_url"] as const, "source identity kind");
  if (kind === "repository_file") {
    exactKeys(record, ["kind", "path", "sha256", "byteLength", "mediaType"], "repository source identity");
    const path = normalizeText(record.path, "source path", 1024).replace(/\\/g, "/");
    if (
      !path.startsWith("docs/series/evidence/vietnam/outcomes/reviewed/")
      || path.includes("..")
      || /^[A-Za-z]:/.test(path)
    ) {
      fail("release evidence must remain under outcomes/reviewed", "INVALID_OUTCOME_SOURCE_PATH");
    }
    return deepFreeze({
      kind,
      path,
      sha256: normalizeSha256(record.sha256, "source sha256"),
      byteLength: normalizePositiveInteger(record.byteLength, "source byteLength"),
      mediaType: normalizeMediaType(record.mediaType),
    });
  }
  exactKeys(record, ["kind", "url", "sha256", "byteLength", "mediaType"], "public URL source identity");
  const allPreserved = record.sha256 !== null && record.byteLength !== null && record.mediaType !== null;
  const nonePreserved = record.sha256 === null && record.byteLength === null && record.mediaType === null;
  if (!allPreserved && !nonePreserved) {
    fail("public URL preservation metadata must be all present or all absent", "OUTCOME_SOURCE_PRESERVATION_INCOMPLETE");
  }
  return deepFreeze({
    kind,
    url: normalizePublicUrl(record.url),
    sha256: record.sha256 === null ? null : normalizeSha256(record.sha256, "source sha256"),
    byteLength: record.byteLength === null ? null : normalizePositiveInteger(record.byteLength, "source byteLength"),
    mediaType: record.mediaType === null ? null : normalizeMediaType(record.mediaType),
  });
}

function normalizeScope(raw: unknown, field: OutcomeFieldKey, outcomeEventKey: string): OutcomeValueScope | null {
  const requiresScope = MONEY_FIELDS.has(field) || COUNT_FIELDS.has(field);
  if (!requiresScope) {
    if (raw !== null) fail(`${field} must not carry a count/money scope`, "OUTCOME_SCOPE_FORBIDDEN");
    return null;
  }
  if (raw === null) fail(`${field} requires an explicit count/money scope`, "OUTCOME_SCOPE_REQUIRED");
  const record = exactKeys(raw, ["basis", "scopeIdentity"], "outcome value scope");
  const basis = normalizeEnum(record.basis, OUTCOME_VALUE_SCOPE_BASES, "outcome scope basis");
  const scopeIdentity = normalizeKey(record.scopeIdentity, "scopeIdentity");
  if (basis === "event_total" && scopeIdentity !== outcomeEventKey) {
    fail("event_total scope identity must equal outcomeEventKey", "OUTCOME_EVENT_SCOPE_MISMATCH");
  }
  return deepFreeze({ basis, scopeIdentity });
}

function normalizeClaimValue(field: OutcomeFieldKey, raw: unknown): OutcomeClaimValue {
  const value = asRecord(raw, `${field} value`);
  const type = normalizeEnum(value.type, ["text", "integer", "money", "local_date"] as const, "claim value type");
  if (MONEY_FIELDS.has(field)) {
    if (type !== "money") fail(`${field} requires a money value`, "OUTCOME_VALUE_TYPE_MISMATCH");
    exactKeys(value, ["type", "minorUnits", "currency", "scale"], `${field} money value`);
    if (typeof value.scale !== "number") fail("money scale must be numeric", "INVALID_MONEY_SCALE");
    if (typeof value.minorUnits !== "string") {
      fail(`${field} minorUnits must be an integer string`, "INVALID_INTEGER");
    }
    const minorUnits = normalizeIntegerString(value.minorUnits);
    if (minorUnits.startsWith("-")) {
      fail(`${field} money cannot be negative`, "NEGATIVE_OUTCOME_MONEY");
    }
    const money = normalizeMoneyValue({
      minorUnits,
      currency: normalizeCurrencyStrict(value.currency, `${field} currency`),
      scale: value.scale,
    });
    return deepFreeze(money);
  }
  if (COUNT_FIELDS.has(field)) {
    if (type !== "integer") fail(`${field} requires an integer value`, "OUTCOME_VALUE_TYPE_MISMATCH");
    exactKeys(value, ["type", "value"], `${field} integer value`);
    return deepFreeze({ type, value: normalizeNonNegativeInteger(value.value, field) });
  }
  if (DATE_FIELDS.has(field)) {
    if (type !== "local_date") fail(`${field} requires a local date`, "OUTCOME_VALUE_TYPE_MISMATCH");
    exactKeys(value, ["type", "value"], `${field} local date value`);
    return deepFreeze({ type, value: normalizeLocalDateStrict(value.value, field) });
  }
  if (type !== "text") fail(`${field} requires text`, "OUTCOME_VALUE_TYPE_MISMATCH");
  exactKeys(value, ["type", "value"], `${field} text value`);
  let text = normalizeText(value.value, `${field} value`);
  if (field === "currency") text = normalizeCurrencyStrict(text, "currency claim");
  if (field === "completion_status") {
    text = normalizeEnum(text, OUTCOME_COMPLETION_STATUSES, "completion_status", "INVALID_OUTCOME_COMPLETION_STATUS");
  }
  return deepFreeze({ type, value: text });
}

function isZeroValue(value: OutcomeClaimValue): boolean {
  return (value.type === "integer" || value.type === "money")
    && BigInt(value.type === "integer" ? value.value : value.minorUnits) === 0n;
}

function valueEquals(left: OutcomeClaimValue, right: OutcomeClaimValue): boolean {
  return canonicalize(left) === canonicalize(right);
}

function normalizeClaimState(
  rawState: unknown,
  value: OutcomeClaimValue | null,
  extractionStatus: OutcomeExtractionStatus,
): OutcomeClaimState {
  const state = normalizeEnum(rawState, OUTCOME_CLAIM_STATES, "outcome claim state");
  if (ACTIVE_VALUE_STATES.has(state) && value === null) {
    fail(`${state} outcome field requires a value`, "OUTCOME_VALUE_REQUIRED");
  }
  if (["missing", "not_applicable", "rejected"].includes(state) && value !== null) {
    fail(`${state} outcome field must not carry a value`, "OUTCOME_VALUE_FORBIDDEN");
  }
  if (state === "explicit_zero" && (value === null || !isZeroValue(value))) {
    fail("explicit_zero requires an explicit numeric zero", "OUTCOME_EXPLICIT_ZERO_REQUIRED");
  }
  const requiredStatus: Partial<Record<OutcomeClaimState, OutcomeExtractionStatus>> = {
    missing: "missing",
    uncertain: "uncertain",
    conflicting: "conflicting",
    rejected: "rejected",
    present: "verified",
    explicit_zero: "verified",
    not_applicable: "verified",
  };
  if (requiredStatus[state] !== extractionStatus) {
    fail("claim state and extraction status do not agree", "OUTCOME_CLAIM_EXTRACTION_STATUS_MISMATCH");
  }
  return state;
}

function idPayload(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    namespace: `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:${kind}`,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...payload,
  };
}

async function contentAddress(kind: string, content: Record<string, unknown>): Promise<string> {
  return `${VIETNAM_OUTCOME_EVIDENCE_NAMESPACE}:${kind}:${await canonicalHash(idPayload(kind, content))}`;
}

function assertCanonicalRecord(actual: unknown, expected: unknown, code: string, label: string): void {
  if (canonicalize(actual) !== canonicalize(expected)) {
    fail(`${label} identity or content is forged`, code);
  }
}

function claimMap(claims: readonly VietnamOutcomeEvidenceClaim[]): ReadonlyMap<string, VietnamOutcomeEvidenceClaim> {
  const map = new Map<string, VietnamOutcomeEvidenceClaim>();
  for (const claim of claims) {
    if (map.has(claim.claimId)) fail("duplicate outcome claim ID", "DUPLICATE_OUTCOME_CLAIM");
    map.set(claim.claimId, claim);
  }
  return map;
}

function correctionMap(
  corrections: readonly VietnamOutcomeCorrection[],
): ReadonlyMap<string, VietnamOutcomeCorrection> {
  const map = new Map<string, VietnamOutcomeCorrection>();
  for (const correction of corrections) {
    if (map.has(correction.correctionId)) {
      fail("duplicate outcome correction ID", "DUPLICATE_OUTCOME_CORRECTION");
    }
    map.set(correction.correctionId, correction);
  }
  return map;
}

function getField(
  outcome: VietnamEventOutcome,
  key: OutcomeFieldKey,
  basis?: OutcomeValueScopeBasis,
): OutcomeFieldObservation | null {
  return outcome.fields.find((field) =>
    field.field === key && (basis === undefined || field.scope?.basis === basis)
  ) ?? null;
}

function isExplicitMoney(
  field: OutcomeFieldObservation | null,
): field is OutcomeFieldObservation & {
  readonly value: Extract<OutcomeClaimValue, { readonly type: "money" }>;
} {
  return field !== null
    && ACTIVE_RESOLVED_STATES.has(field.state)
    && field.value?.type === "money";
}

function isExplicitInteger(
  field: OutcomeFieldObservation | null,
): field is OutcomeFieldObservation & {
  readonly value: Extract<OutcomeClaimValue, { readonly type: "integer" }>;
} {
  return field !== null
    && ACTIVE_RESOLVED_STATES.has(field.state)
    && field.value?.type === "integer";
}

function getCompletionStatus(outcome: VietnamEventOutcome): OutcomeCompletionStatus | null {
  const field = getField(outcome, "completion_status");
  if (
    field !== null
    && ACTIVE_RESOLVED_STATES.has(field.state)
    && field.value?.type === "text"
    && OUTCOME_COMPLETION_STATUSES.includes(field.value.value as OutcomeCompletionStatus)
  ) {
    return field.value.value as OutcomeCompletionStatus;
  }
  return null;
}

function scopeIdentity(scope: OutcomeValueScope | null): string {
  return scope === null ? "metadata" : `${scope.basis}:${scope.scopeIdentity}`;
}

function assertSameScope(
  left: OutcomeFieldObservation,
  right: OutcomeFieldObservation,
): boolean {
  return canonicalize(left.scope) === canonicalize(right.scope);
}

function assertCountConsistency(fields: readonly OutcomeFieldObservation[]): void {
  const integers = fields.filter((field) => isExplicitInteger(field));
  const byScope = new Map<string, Map<OutcomeFieldKey, bigint>>();
  for (const field of integers) {
    const key = scopeIdentity(field.scope);
    const scopeFields = byScope.get(key) ?? new Map<OutcomeFieldKey, bigint>();
    scopeFields.set(field.field, BigInt(field.value.value));
    byScope.set(key, scopeFields);
  }
  for (const scoped of byScope.values()) {
    const entries = scoped.get("entries");
    const unique = scoped.get("unique_players");
    const bullets = scoped.get("total_bullets");
    const reentries = scoped.get("reentry_count");
    const paidPlaces = scoped.get("paid_places");
    const awarded = scoped.get("satellite_seats_awarded");
    const redeemed = scoped.get("satellite_seats_redeemed");
    const converted = scoped.get("satellite_seats_converted");
    if (unique !== undefined && entries !== undefined && unique > entries) {
      fail("unique players cannot exceed entries in the same scope", "OUTCOME_UNIQUE_EXCEEDS_ENTRIES");
    }
    if (unique !== undefined && bullets !== undefined && unique > bullets) {
      fail("unique players cannot exceed bullets in the same scope", "OUTCOME_UNIQUE_EXCEEDS_BULLETS");
    }
    if (reentries !== undefined && bullets !== undefined && reentries > bullets) {
      fail("reentries cannot exceed bullets in the same scope", "OUTCOME_REENTRIES_EXCEED_BULLETS");
    }
    if (paidPlaces !== undefined && entries !== undefined && paidPlaces > entries) {
      fail("paid places cannot exceed entries in the same scope", "OUTCOME_PAID_PLACES_EXCEED_ENTRIES");
    }
    if (redeemed !== undefined && awarded !== undefined && redeemed > awarded) {
      fail("redeemed satellite seats cannot exceed awarded seats", "OUTCOME_REDEEMED_EXCEEDS_AWARDED");
    }
    if (converted !== undefined && redeemed !== undefined && converted > redeemed) {
      fail("converted satellite seats cannot exceed redeemed seats", "OUTCOME_CONVERTED_EXCEEDS_REDEEMED");
    }
  }
}

function assertMetadataClaims(
  fields: readonly OutcomeFieldObservation[],
  input: Omit<VietnamEventOutcomeInput, "claimIds" | "correctionIds">,
): void {
  const expected: Partial<Record<OutcomeFieldKey, string | null>> = {
    organizer: input.organizer,
    series_name: input.seriesName,
    event_name: input.eventName,
    event_date: input.eventDate,
    flight_identity: input.flightIdentity,
    currency: input.currency,
  };
  for (const [field, expectedValue] of Object.entries(expected) as [OutcomeFieldKey, string | null][]) {
    const observation = fields.find((candidate) => candidate.field === field);
    if (observation === undefined || !ACTIVE_RESOLVED_STATES.has(observation.state)) continue;
    const actual = observation.value?.type === "local_date" || observation.value?.type === "text"
      ? observation.value.value
      : null;
    if (actual !== expectedValue) {
      fail(`${field} claim does not match outcome identity`, "OUTCOME_METADATA_CLAIM_MISMATCH");
    }
  }
}

function compareClaimChronology(
  superseded: VietnamOutcomeEvidenceClaim,
  superseding: VietnamOutcomeEvidenceClaim,
  correctedAt: string,
): void {
  if (superseding.capturedAt < superseded.capturedAt) {
    fail("superseding claim cannot predate the superseded claim", "OUTCOME_CORRECTION_CHRONOLOGY");
  }
  if (correctedAt < superseding.capturedAt || correctedAt < superseded.capturedAt) {
    fail("correction time cannot predate either claim", "OUTCOME_CORRECTION_CHRONOLOGY");
  }
}

function validateCorrectionGraphInternal(
  corrections: readonly VietnamOutcomeCorrection[],
  claims?: readonly VietnamOutcomeEvidenceClaim[],
): void {
  const outgoing = new Map<string, string>();
  const incoming = new Map<string, string>();
  const claimById = claims === undefined ? null : claimMap(claims);
  const correctionIds = new Set<string>();
  for (const correction of corrections) {
    if (correctionIds.has(correction.correctionId)) {
      fail("duplicate correction ID", "DUPLICATE_OUTCOME_CORRECTION");
    }
    correctionIds.add(correction.correctionId);
    if (correction.supersededClaimId === correction.supersedingClaimId) {
      fail("a correction cannot supersede itself", "OUTCOME_CORRECTION_SELF_REFERENCE");
    }
    if (outgoing.has(correction.supersededClaimId)) {
      fail("a claim cannot diverge to multiple corrections", "OUTCOME_CORRECTION_DIVERGENCE");
    }
    if (incoming.has(correction.supersedingClaimId)) {
      fail("multiple correction paths cannot converge on one claim", "OUTCOME_CORRECTION_CONVERGENCE");
    }
    outgoing.set(correction.supersededClaimId, correction.supersedingClaimId);
    incoming.set(correction.supersedingClaimId, correction.supersededClaimId);
    if (claimById !== null) {
      const superseded = claimById.get(correction.supersededClaimId);
      const superseding = claimById.get(correction.supersedingClaimId);
      if (!superseded || !superseding) {
        fail("correction references an unknown claim", "UNKNOWN_OUTCOME_CORRECTION_CLAIM");
      }
      if (
        superseded.outcomeEventKey !== superseding.outcomeEventKey
        || superseded.field !== superseding.field
        || canonicalize(superseded.scope) !== canonicalize(superseding.scope)
      ) {
        fail("a correction must stay within one event, field, and scope", "OUTCOME_CORRECTION_FIELD_MISMATCH");
      }
      compareClaimChronology(superseded, superseding, correction.correctedAt);
    }
  }
  for (const start of outgoing.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = start;
    while (current !== undefined) {
      if (visited.has(current)) fail("outcome correction graph contains a cycle", "OUTCOME_CORRECTION_CYCLE");
      visited.add(current);
      current = outgoing.get(current);
    }
  }
}

function supersededClaimIds(corrections: readonly VietnamOutcomeCorrection[]): ReadonlySet<string> {
  return new Set(corrections.map((correction) => correction.supersededClaimId));
}

function resolveField(
  field: OutcomeFieldKey,
  scope: OutcomeValueScope | null,
  claims: readonly VietnamOutcomeEvidenceClaim[],
  superseded: ReadonlySet<string>,
): OutcomeFieldObservation {
  const ids = sortedUnique(claims.map((claim) => claim.claimId), "claimIds");
  const supersededIds = Object.freeze(
    ids.filter((claimId) => superseded.has(claimId)).sort(compareCanonicalStrings),
  );
  const active = claims.filter((claim) => !superseded.has(claim.claimId));
  if (active.length === 0) {
    return deepFreeze({
      field,
      state: "superseded",
      value: null,
      scope,
      claimIds: ids,
      supersededClaimIds: supersededIds,
    });
  }
  if (active.some((claim) => claim.state === "rejected")) {
    return deepFreeze({
      field,
      state: "rejected",
      value: null,
      scope,
      claimIds: ids,
      supersededClaimIds: supersededIds,
    });
  }
  if (active.some((claim) => claim.state === "conflicting")) {
    return deepFreeze({
      field,
      state: "conflicting",
      value: null,
      scope,
      claimIds: ids,
      supersededClaimIds: supersededIds,
    });
  }
  const usable = active.filter((claim) => ACTIVE_VALUE_STATES.has(claim.state) && claim.value !== null);
  if (usable.length > 0) {
    const value = usable[0].value!;
    if (usable.some((claim) => !valueEquals(value, claim.value!))) {
      return deepFreeze({
        field,
        state: "conflicting",
        value: null,
        scope,
        claimIds: ids,
        supersededClaimIds: supersededIds,
      });
    }
    if (active.some((claim) => claim.state === "uncertain")) {
      return deepFreeze({
        field,
        state: "uncertain",
        value,
        scope,
        claimIds: ids,
        supersededClaimIds: supersededIds,
      });
    }
    return deepFreeze({
      field,
      state: isZeroValue(value) ? "explicit_zero" : "present",
      value,
      scope,
      claimIds: ids,
      supersededClaimIds: supersededIds,
    });
  }
  const state: OutcomeResolvedFieldState = active.some((claim) => claim.state === "uncertain")
    ? "uncertain"
    : active.some((claim) => claim.state === "missing")
      ? "missing"
      : "not_applicable";
  return deepFreeze({
    field,
    state,
    value: null,
    scope,
    claimIds: ids,
    supersededClaimIds: supersededIds,
  });
}

function normalizeScheduleReference(raw: ScheduleCompetitionReference): ScheduleCompetitionReference {
  return deepFreeze({
    scheduleEventId: normalizeText(raw.scheduleEventId, "scheduleEventId", 1024),
    scheduleEventKey: normalizeKey(raw.scheduleEventKey, "scheduleEventKey"),
    competitionKey: normalizeKey(raw.competitionKey, "competitionKey"),
    organizer: normalizeText(raw.organizer, "organizer"),
    seriesName: normalizeText(raw.seriesName, "seriesName"),
    eventName: normalizeText(raw.eventName, "eventName"),
    eventDate: normalizeLocalDateStrict(raw.eventDate, "eventDate"),
    flightIdentity: normalizeNullableText(raw.flightIdentity, "flightIdentity", 512),
  });
}

function normalizeScheduleCorrectionLineage(
  raw: VietnamScheduleCorrectionLineageReference,
): VietnamScheduleCorrectionLineageReference {
  return deepFreeze({
    correctionId: normalizeText(raw.correctionId, "schedule correctionId", 1024),
    supersededReleaseId: normalizeText(raw.supersededReleaseId, "superseded schedule releaseId", 1024),
    correctedReleaseId: normalizeText(raw.correctedReleaseId, "corrected schedule releaseId", 1024),
  });
}

function metadataMatches(
  outcome: VietnamEventOutcome,
  candidate: ScheduleCompetitionReference,
): boolean {
  return candidate.organizer === outcome.organizer
    && candidate.seriesName === outcome.seriesName
    && candidate.eventName === outcome.eventName
    && candidate.eventDate === outcome.eventDate
    && candidate.flightIdentity === outcome.flightIdentity;
}

function localDateAtCutoff(sourceCutoff: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(sourceCutoff));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function isFinalEventScopeOutcome(outcome: VietnamEventOutcome): boolean {
  return getCompletionStatus(outcome) === "result_final"
    && outcome.fields.every((field) => field.state !== "conflicting" && field.state !== "rejected");
}

function isReleaseFixture(value: string): boolean {
  return value.startsWith(VIETNAM_OUTCOME_FIXTURE_PREFIX);
}

export async function createVietnamOutcomeEvidenceSource(
  input: VietnamOutcomeEvidenceSourceInput,
): Promise<VietnamOutcomeEvidenceSource> {
  const sourceCategory = normalizeEnum(
    input.sourceCategory,
    OUTCOME_SOURCE_CATEGORIES,
    "sourceCategory",
  );
  const reviewerStatus = normalizeEnum(
    input.reviewerStatus,
    OUTCOME_REVIEWER_STATUSES,
    "reviewerStatus",
  );
  const evidenceQuality = normalizeEnum(
    input.evidenceQuality,
    OUTCOME_EVIDENCE_QUALITIES,
    "evidenceQuality",
  );
  if (sourceCategory === "rejected" && reviewerStatus !== "rejected") {
    fail("rejected source category requires rejected review", "OUTCOME_REJECTED_SOURCE_STATE");
  }
  if (evidenceQuality === "rejected" && reviewerStatus !== "rejected") {
    fail("rejected evidence requires rejected review", "OUTCOME_REJECTED_EVIDENCE_STATE");
  }
  if (reviewerStatus === "rejected" && evidenceQuality !== "rejected") {
    fail("rejected review requires rejected evidence quality", "OUTCOME_REJECTED_EVIDENCE_STATE");
  }
  const sourceIdentity = normalizeSourceIdentity(input.sourceIdentity);
  const publication = normalizePublication(input.publication);
  const capturedAt = normalizeInstantStrict(input.capturedAt, "capturedAt");
  if (publication.kind === "exact" && publication.value > capturedAt) {
    fail("publicationAt cannot be after capturedAt", "OUTCOME_PUBLICATION_AFTER_CAPTURE");
  }
  const content = {
    sourceKey: normalizeKey(input.sourceKey, "sourceKey"),
    sourceCategory,
    sourceIdentity,
    organizer: normalizeText(input.organizer, "organizer"),
    seriesName: normalizeText(input.seriesName, "seriesName"),
    eventName: normalizeNullableText(input.eventName, "eventName"),
    publication,
    capturedAt,
    expectedCompetitionKey: normalizeOptionalStableKey(
      input.expectedCompetitionKey,
      "expectedCompetitionKey",
    ),
    reviewerStatus,
    evidenceQuality,
    limitationNotes: sortedUnique(input.limitationNotes, "limitationNotes"),
  };
  const sourceId = await contentAddress("source", content);
  return deepFreeze({
    sourceId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

export async function createVietnamOutcomeEvidenceClaim(
  input: VietnamOutcomeEvidenceClaimInput,
): Promise<VietnamOutcomeEvidenceClaim> {
  const outcomeEventKey = normalizeKey(input.outcomeEventKey, "outcomeEventKey");
  const field = normalizeEnum(input.field, OUTCOME_FIELD_KEYS, "outcome field");
  const extractionMethod = normalizeEnum(
    input.extractionMethod,
    OUTCOME_EXTRACTION_METHODS,
    "extractionMethod",
  );
  const extractionStatus = normalizeEnum(
    input.extractionStatus,
    OUTCOME_EXTRACTION_STATUSES,
    "extractionStatus",
  );
  const value = input.value === null ? null : normalizeClaimValue(field, input.value);
  const state = normalizeClaimState(input.state, value, extractionStatus);
  const scope = normalizeScope(input.scope, field, outcomeEventKey);
  const sourceRejected = input.source.reviewerStatus === "rejected"
    || input.source.evidenceQuality === "rejected";
  if (sourceRejected !== (state === "rejected" && extractionStatus === "rejected")) {
    fail("rejected source and claim states must agree", "REJECTED_OUTCOME_EVIDENCE");
  }
  const content = {
    outcomeEventKey,
    sourceId: normalizeText(input.source.sourceId, "sourceId", 1024),
    sourceIdentity: input.source.sourceIdentity,
    publication: input.source.publication,
    capturedAt: input.source.capturedAt,
    field,
    state,
    value,
    scope,
    visualOrTextRegion: normalizeText(input.visualOrTextRegion, "visualOrTextRegion"),
    extractionMethod,
    extractionStatus,
    evidenceQuality: input.source.evidenceQuality,
  };
  const claimId = await contentAddress("claim", content);
  return deepFreeze({
    claimId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

export async function createVietnamOutcomeCorrection(
  input: VietnamOutcomeCorrectionInput,
  claims: readonly VietnamOutcomeEvidenceClaim[],
): Promise<VietnamOutcomeCorrection> {
  const map = claimMap(claims);
  const supersededClaimId = normalizeText(input.supersededClaimId, "supersededClaimId", 1024);
  const supersedingClaimId = normalizeText(input.supersedingClaimId, "supersedingClaimId", 1024);
  const superseded = map.get(supersededClaimId);
  const superseding = map.get(supersedingClaimId);
  if (!superseded || !superseding) {
    fail("correction references an unknown claim", "UNKNOWN_OUTCOME_CORRECTION_CLAIM");
  }
  if (supersededClaimId === supersedingClaimId) {
    fail("a correction cannot supersede itself", "OUTCOME_CORRECTION_SELF_REFERENCE");
  }
  if (
    superseded.outcomeEventKey !== superseding.outcomeEventKey
    || superseded.field !== superseding.field
    || canonicalize(superseded.scope) !== canonicalize(superseding.scope)
  ) {
    fail("a correction must stay within one outcome event, field, and scope", "OUTCOME_CORRECTION_FIELD_MISMATCH");
  }
  const correctedAt = normalizeInstantStrict(input.correctedAt, "correctedAt");
  compareClaimChronology(superseded, superseding, correctedAt);
  const content = {
    correctionKey: normalizeKey(input.correctionKey, "correctionKey"),
    correctedAt,
    supersededClaimId,
    supersedingClaimId,
    reason: normalizeText(input.reason, "correction reason"),
    status: "superseded_by_corrected_claim" as const,
  };
  const correctionId = await contentAddress("correction", content);
  return deepFreeze({
    correctionId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

export function validateOutcomeCorrectionGraph(
  corrections: readonly VietnamOutcomeCorrection[],
  claims?: readonly VietnamOutcomeEvidenceClaim[],
): void {
  validateCorrectionGraphInternal(corrections, claims);
}

export async function createVietnamEventOutcome(
  input: VietnamEventOutcomeInput,
  claims: readonly VietnamOutcomeEvidenceClaim[],
  corrections: readonly VietnamOutcomeCorrection[] = [],
): Promise<VietnamEventOutcome> {
  const map = claimMap(claims);
  const correctionsById = correctionMap(corrections);
  const claimIds = sortedUnique(input.claimIds, "claimIds");
  const correctionIds = sortedUnique(input.correctionIds, "correctionIds");
  if (claimIds.length === 0) fail("outcome requires at least one claim", "OUTCOME_CLAIMS_REQUIRED");
  const selected = claimIds.map((claimId) => {
    const claim = map.get(claimId);
    if (!claim) fail("outcome references an unknown claim", "UNKNOWN_OUTCOME_CLAIM");
    return claim;
  });
  const selectedCorrections = correctionIds.map((correctionId) => {
    const correction = correctionsById.get(correctionId);
    if (!correction) fail("outcome references an unknown correction", "UNKNOWN_OUTCOME_CORRECTION");
    return correction;
  });
  const outcomeEventKey = normalizeKey(input.outcomeEventKey, "outcomeEventKey");
  if (selected.some((claim) => claim.outcomeEventKey !== outcomeEventKey)) {
    fail("outcome claim event key mismatch", "OUTCOME_CLAIM_EVENT_MISMATCH");
  }
  const selectedClaimIds = new Set(claimIds);
  if (selectedCorrections.some((correction) =>
    !selectedClaimIds.has(correction.supersededClaimId)
    || !selectedClaimIds.has(correction.supersedingClaimId)
  )) {
    fail("outcome correction claims must belong to the outcome", "OUTCOME_CORRECTION_OWNERSHIP_MISMATCH");
  }
  validateCorrectionGraphInternal(selectedCorrections, selected);
  const superseded = supersededClaimIds(selectedCorrections);
  const fields: OutcomeFieldObservation[] = [];
  for (const field of FIELD_ORDER) {
    const fieldClaims = selected.filter((claim) => claim.field === field);
    const scopeGroups = new Map<string, VietnamOutcomeEvidenceClaim[]>();
    for (const claim of fieldClaims) {
      const key = scopeIdentity(claim.scope);
      const group = scopeGroups.get(key) ?? [];
      group.push(claim);
      scopeGroups.set(key, group);
    }
    for (const key of [...scopeGroups.keys()].sort(compareCanonicalStrings)) {
      const group = scopeGroups.get(key)!;
      fields.push(resolveField(field, group[0].scope, group, superseded));
    }
  }
  const normalizedIdentity = {
    outcomeEventKey,
    organizer: normalizeText(input.organizer, "organizer"),
    seriesName: normalizeText(input.seriesName, "seriesName"),
    eventName: normalizeText(input.eventName, "eventName"),
    eventDate: normalizeLocalDateStrict(input.eventDate, "eventDate"),
    flightIdentity: normalizeNullableText(input.flightIdentity, "flightIdentity", 512),
    currency: input.currency === null ? null : normalizeCurrencyStrict(input.currency, "currency"),
  };
  assertMetadataClaims(fields, normalizedIdentity);
  assertCountConsistency(fields);
  const content = {
    ...normalizedIdentity,
    sourceClaimIds: claimIds,
    correctionIds,
    fields: Object.freeze(fields),
  };
  const outcomeId = await contentAddress("outcome", content);
  return deepFreeze({
    outcomeId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

export async function createVietnamScheduleLinkageContext(
  input: VietnamScheduleLinkageContextInput,
): Promise<VietnamScheduleLinkageContext> {
  const scheduleReleaseId = normalizeText(input.scheduleReleaseId, "scheduleReleaseId", 1024);
  const scheduleArtifactId = normalizeText(input.scheduleArtifactId, "scheduleArtifactId", 1024);
  const scheduleReceiptId = normalizeText(input.scheduleReceiptId, "scheduleReceiptId", 1024);
  const scheduleArtifactFileSha256 = normalizeSha256(
    input.scheduleArtifactFileSha256,
    "scheduleArtifactFileSha256",
  );
  const scheduleSourceCutoff = normalizeInstantStrict(
    input.scheduleSourceCutoff,
    "scheduleSourceCutoff",
  );
  if (
    scheduleReleaseId !== VIETNAM_SUPPLY_CURRENT_RELEASE_ID
    || scheduleArtifactId !== VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID
    || scheduleReceiptId !== VIETNAM_SUPPLY_CURRENT_RECEIPT_ID
    || scheduleArtifactFileSha256 !== VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256
  ) {
    fail("linkage context must use the current corrected D1A graph", "OUTCOME_D1A_CURRENT_IDENTITY_MISMATCH");
  }
  if (scheduleSourceCutoff !== VIETNAM_SUPPLY_CURRENT_SOURCE_CUTOFF) {
    fail(
      "linkage context source cutoff does not match the current corrected D1A artifact",
      "OUTCOME_D1A_SOURCE_CUTOFF_MISMATCH",
    );
  }
  const correctionLineage = input.correctionLineage.map(normalizeScheduleCorrectionLineage);
  if (
    correctionLineage.length !== 1
    || correctionLineage[0].correctionId !== VIETNAM_SUPPLY_CURRENT_CORRECTION_ID
    || correctionLineage[0].supersededReleaseId !== VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID
    || correctionLineage[0].correctedReleaseId !== VIETNAM_SUPPLY_CURRENT_RELEASE_ID
  ) {
    fail("linkage context correction lineage is not current", "OUTCOME_D1A_CORRECTION_LINEAGE_INVALID");
  }
  const seenCorrections = new Set<string>();
  for (const correction of correctionLineage) {
    if (seenCorrections.has(correction.correctionId)) {
      fail("D1A correction lineage contains duplicates", "OUTCOME_D1A_CORRECTION_LINEAGE_INVALID");
    }
    seenCorrections.add(correction.correctionId);
  }
  const scheduleCompetitions = input.scheduleCompetitions
    .map(normalizeScheduleReference)
    .sort((left, right) => compareCanonicalStrings(left.scheduleEventId, right.scheduleEventId));
  if (scheduleCompetitions.length === 0) {
    fail("linkage context requires current D1A competition identities", "OUTCOME_D1A_COMPETITIONS_REQUIRED");
  }
  if (new Set(scheduleCompetitions.map((item) => item.scheduleEventId)).size !== scheduleCompetitions.length) {
    fail("schedule event references contain duplicates", "DUPLICATE_SCHEDULE_COMPETITION");
  }
  const scheduleCompetitionIndexSha256 = await canonicalHash({
    scheduleReleaseId,
    scheduleCompetitions,
  });
  if (scheduleCompetitionIndexSha256 !== VIETNAM_SUPPLY_CURRENT_COMPETITION_INDEX_SHA256) {
    fail(
      "linkage context competition index does not match the current corrected D1A artifact",
      "OUTCOME_D1A_COMPETITION_INDEX_MISMATCH",
    );
  }
  const content = {
    scheduleReleaseId,
    scheduleArtifactId,
    scheduleReceiptId,
    scheduleArtifactFileSha256,
    scheduleCompetitionIndexSha256,
    scheduleSourceCutoff,
    correctionLineage: Object.freeze(correctionLineage),
    scheduleCompetitions: Object.freeze(scheduleCompetitions),
  };
  const linkageContextId = await contentAddress("schedule-linkage-context", content);
  return deepFreeze({
    linkageContextId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

export async function createScheduleOutcomeLink(
  input: ScheduleOutcomeLinkInput,
): Promise<ScheduleOutcomeLink> {
  await validateLinkageContextRecord(input.linkageContext);
  const expected = normalizeOptionalStableKey(input.expectedCompetitionKey, "expectedCompetitionKey");
  const sourceDeclared = normalizeOptionalStableKey(
    input.sourceDeclaredCompetitionKey,
    "sourceDeclaredCompetitionKey",
  );
  const sourceCutoff = normalizeInstantStrict(input.sourceCutoff, "sourceCutoff");
  if (sourceCutoff < input.linkageContext.scheduleSourceCutoff) {
    fail(
      "outcome linkage cutoff cannot predate the corrected D1A source cutoff",
      "OUTCOME_LINK_BEFORE_D1A_CUTOFF",
    );
  }
  const competitions = input.linkageContext.scheduleCompetitions;
  let candidates: ScheduleCompetitionReference[] = [];
  let state: ScheduleOutcomeLinkState;
  let competitionKey: string | null = null;
  let scheduleEventId: string | null = null;
  let reasonCodes: string[];

  if (expected !== null && sourceDeclared !== null && expected !== sourceDeclared) {
    candidates = competitions.filter((candidate) =>
      candidate.competitionKey === expected || candidate.competitionKey === sourceDeclared
    );
    state = "conflicting";
    reasonCodes = ["expected_and_source_declared_competition_conflict"];
  } else if (expected !== null || sourceDeclared !== null) {
    const selectedKey = expected ?? sourceDeclared!;
    const sameKey = competitions.filter((candidate) => candidate.competitionKey === selectedKey);
    const exactMetadata = sameKey.filter((candidate) => metadataMatches(input.outcome, candidate));
    candidates = sameKey;
    if (exactMetadata.length === 1) {
      competitionKey = selectedKey;
      scheduleEventId = exactMetadata[0].scheduleEventId;
      state = expected !== null ? "exact" : "explicit_source_link";
      reasonCodes = [
        expected !== null
          ? "current_d1a_key_and_metadata_exact_match"
          : "current_d1a_explicit_source_key_and_metadata_match",
      ];
    } else if (exactMetadata.length > 1) {
      candidates = exactMetadata;
      state = "ambiguous";
      reasonCodes = ["multiple_current_d1a_rows_match_key_and_metadata"];
    } else if (sameKey.length > 0) {
      state = "conflicting";
      reasonCodes = ["current_d1a_same_key_metadata_mismatch"];
    } else {
      state = "unlinked";
      reasonCodes = ["explicit_schedule_competition_key_not_found_in_current_d1a"];
    }
  } else {
    const structural = competitions.filter((candidate) => metadataMatches(input.outcome, candidate));
    candidates = structural;
    if (structural.length === 0) {
      state = "unlinked";
      reasonCodes = ["no_explicit_or_structural_current_d1a_match"];
    } else if (structural.length === 1) {
      state = "candidate";
      competitionKey = structural[0].competitionKey;
      scheduleEventId = structural[0].scheduleEventId;
      reasonCodes = ["structural_candidate_requires_review"];
    } else {
      state = "ambiguous";
      reasonCodes = ["multiple_structural_current_d1a_candidates"];
    }
  }
  const candidateCompetitionKeys = Object.freeze(
    [...new Set(candidates.map((candidate) => candidate.competitionKey))].sort(compareCanonicalStrings),
  );
  const candidateScheduleEventIds = Object.freeze(
    [...new Set(candidates.map((candidate) => candidate.scheduleEventId))].sort(compareCanonicalStrings),
  );
  const content = {
    linkageContextId: input.linkageContext.linkageContextId,
    sourceCutoff,
    outcomeId: input.outcome.outcomeId,
    outcomeEventKey: input.outcome.outcomeEventKey,
    expectedCompetitionKey: expected,
    sourceDeclaredCompetitionKey: sourceDeclared,
    competitionKey,
    scheduleEventId,
    state,
    candidateCompetitionKeys,
    candidateScheduleEventIds,
    reasonCodes: Object.freeze(reasonCodes),
  };
  const linkId = await contentAddress("schedule-outcome-link", content);
  return deepFreeze({
    linkId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

export function isAutomaticAggregateResearchEligible(link: ScheduleOutcomeLink): boolean {
  return link.state === "exact" || link.state === "explicit_source_link";
}

export function deriveOutcomeOverlaySurplus(
  outcome: VietnamEventOutcome,
  link: ScheduleOutcomeLink,
): { readonly overlay: OutcomeDerivedMoney | null; readonly surplus: OutcomeDerivedMoney | null } {
  const unavailable = deepFreeze({ overlay: null, surplus: null });
  if (
    link.outcomeId !== outcome.outcomeId
    || !isAutomaticAggregateResearchEligible(link)
    || !isFinalEventScopeOutcome(outcome)
    || outcome.eventDate > localDateAtCutoff(link.sourceCutoff)
  ) {
    return unavailable;
  }
  const gtd = getField(outcome, "published_gtd", "event_total");
  const prizePool = getField(outcome, "actual_prize_pool", "event_total");
  if (!isExplicitMoney(gtd) || !isExplicitMoney(prizePool) || !assertSameScope(gtd, prizePool)) {
    return unavailable;
  }
  if (
    gtd.scope?.scopeIdentity !== outcome.outcomeEventKey
    || prizePool.scope?.scopeIdentity !== outcome.outcomeEventKey
    || gtd.value.currency !== prizePool.value.currency
    || gtd.value.scale !== prizePool.value.scale
    || (outcome.currency !== null && gtd.value.currency !== outcome.currency)
    || BigInt(gtd.value.minorUnits) < 0n
    || BigInt(prizePool.value.minorUnits) < 0n
  ) {
    return unavailable;
  }
  const delta = BigInt(gtd.value.minorUnits) - BigInt(prizePool.value.minorUnits);
  const activeGtdClaimIds = gtd.claimIds.filter((claimId) =>
    !gtd.supersededClaimIds.includes(claimId)
  );
  const activePrizePoolClaimIds = prizePool.claimIds.filter((claimId) =>
    !prizePool.supersededClaimIds.includes(claimId)
  );
  const inputClaimIds = sortedUnique(
    [...activeGtdClaimIds, ...activePrizePoolClaimIds],
    "overlay input claim IDs",
  );
  const make = (kind: "overlay" | "surplus", minorUnits: bigint): OutcomeDerivedMoney =>
    deepFreeze({
      kind,
      minorUnits: minorUnits.toString(),
      currency: gtd.value.currency,
      scale: gtd.value.scale,
      inputClaimIds,
      methodVersion: "explicit-final-event-scope-money-v2",
    });
  return deepFreeze({
    overlay: make("overlay", delta > 0n ? delta : 0n),
    surplus: make("surplus", delta < 0n ? -delta : 0n),
  });
}

export async function createOutcomeReadinessReport(
  outcome: VietnamEventOutcome,
  link: ScheduleOutcomeLink,
): Promise<OutcomeReadinessReport> {
  if (link.outcomeId !== outcome.outcomeId) {
    fail("readiness link does not match outcome", "OUTCOME_LINK_MISMATCH");
  }
  const states = new Set<OutcomeReadinessState>();
  const reasonCodes: string[] = [...link.reasonCodes];
  const entries = getField(outcome, "entries", "event_total");
  const uniquePlayers = getField(outcome, "unique_players", "event_total");
  const bullets = getField(outcome, "total_bullets", "event_total");
  const reentries = getField(outcome, "reentry_count", "event_total");
  const prizePool = getField(outcome, "actual_prize_pool", "event_total");
  const satelliteAwarded = getField(outcome, "satellite_seats_awarded", "event_total");
  const satelliteRedeemed = getField(outcome, "satellite_seats_redeemed", "event_total");
  const satelliteConverted = getField(outcome, "satellite_seats_converted", "event_total");
  const completion = getCompletionStatus(outcome);
  const final = completion === "result_final";
  const future = outcome.eventDate > localDateAtCutoff(link.sourceCutoff);
  const anyConflicting = outcome.fields.some((field) =>
    field.state === "conflicting" || field.state === "rejected"
  );
  const anyObserved = outcome.fields.some((field) => ACTIVE_RESOLVED_STATES.has(field.state));

  if (!anyObserved) {
    states.add("missing_outcome");
    reasonCodes.push("no_explicit_observed_outcome_fields");
  }
  if (!final || future) {
    states.add("partial_outcome");
    reasonCodes.push(future ? "outcome_event_is_future_at_source_cutoff" : "outcome_is_not_result_final");
  }
  if (anyConflicting) {
    states.add("conflicting_outcome");
    reasonCodes.push("one_or_more_outcome_fields_conflicting_or_rejected");
  }
  if (link.state === "ambiguous" || link.state === "candidate") states.add("ambiguous_linkage");

  if (isExplicitInteger(entries) && final && !future) {
    if (isExplicitMoney(prizePool)) states.add("turnout_economics_ready");
    else states.add("entries_only");
  } else if (isExplicitMoney(prizePool)) {
    states.add("prize_pool_only");
  }
  if (!isExplicitInteger(uniquePlayers)) {
    states.add("unique_player_analysis_blocked");
    reasonCodes.push("missing_or_nonexplicit_event_total_unique_players");
  }
  if (
    !isExplicitInteger(uniquePlayers)
    || !isExplicitInteger(bullets)
    || !isExplicitInteger(reentries)
  ) {
    states.add("reentry_analysis_blocked");
    reasonCodes.push("explicit_event_total_reentry_count_is_required");
  }
  if (
    !isExplicitInteger(satelliteAwarded)
    || !isExplicitInteger(satelliteRedeemed)
    || !isExplicitInteger(satelliteConverted)
  ) {
    states.add("satellite_conversion_blocked");
    reasonCodes.push("missing_or_nonexplicit_event_total_satellite_conversion_fields");
  }
  if (
    final
    && !future
    && !anyConflicting
    && isExplicitInteger(entries)
    && isAutomaticAggregateResearchEligible(link)
  ) {
    states.add("outcome_ready");
  }
  const derived = deriveOutcomeOverlaySurplus(outcome, link);
  const normalizedStates = Object.freeze([...states].sort(compareCanonicalStrings));
  const normalizedReasons = sortedUnique(reasonCodes, "readiness reasons");
  const content = {
    outcomeId: outcome.outcomeId,
    competitionKey: link.competitionKey,
    states: normalizedStates,
    reasonCodes: normalizedReasons,
    overlay: derived.overlay,
    surplus: derived.surplus,
  };
  const readinessId = await contentAddress("readiness", content);
  return deepFreeze({ readinessId, ...content });
}

async function validateSourceRecord(source: VietnamOutcomeEvidenceSource): Promise<void> {
  const rebuilt = await createVietnamOutcomeEvidenceSource({
    sourceKey: source.sourceKey,
    sourceCategory: source.sourceCategory,
    sourceIdentity: source.sourceIdentity,
    organizer: source.organizer,
    seriesName: source.seriesName,
    eventName: source.eventName,
    publication: source.publication,
    capturedAt: source.capturedAt,
    expectedCompetitionKey: source.expectedCompetitionKey,
    reviewerStatus: source.reviewerStatus,
    evidenceQuality: source.evidenceQuality,
    limitationNotes: source.limitationNotes,
  });
  assertCanonicalRecord(source, rebuilt, "FORGED_OUTCOME_SOURCE", "outcome source");
}

async function validateClaimRecord(
  claim: VietnamOutcomeEvidenceClaim,
  source: VietnamOutcomeEvidenceSource,
): Promise<void> {
  const rebuilt = await createVietnamOutcomeEvidenceClaim({
    outcomeEventKey: claim.outcomeEventKey,
    source,
    field: claim.field,
    state: claim.state,
    value: claim.value,
    scope: claim.scope,
    visualOrTextRegion: claim.visualOrTextRegion,
    extractionMethod: claim.extractionMethod,
    extractionStatus: claim.extractionStatus,
  });
  assertCanonicalRecord(claim, rebuilt, "FORGED_OUTCOME_CLAIM", "outcome claim");
}

async function validateCorrectionRecord(
  correction: VietnamOutcomeCorrection,
  claims: readonly VietnamOutcomeEvidenceClaim[],
): Promise<void> {
  const rebuilt = await createVietnamOutcomeCorrection({
    correctionKey: correction.correctionKey,
    correctedAt: correction.correctedAt,
    supersededClaimId: correction.supersededClaimId,
    supersedingClaimId: correction.supersedingClaimId,
    reason: correction.reason,
  }, claims);
  assertCanonicalRecord(correction, rebuilt, "FORGED_OUTCOME_CORRECTION", "outcome correction");
}

async function validateOutcomeRecord(
  outcome: VietnamEventOutcome,
  claims: readonly VietnamOutcomeEvidenceClaim[],
  corrections: readonly VietnamOutcomeCorrection[],
): Promise<void> {
  const rebuilt = await createVietnamEventOutcome({
    outcomeEventKey: outcome.outcomeEventKey,
    organizer: outcome.organizer,
    seriesName: outcome.seriesName,
    eventName: outcome.eventName,
    eventDate: outcome.eventDate,
    flightIdentity: outcome.flightIdentity,
    currency: outcome.currency,
    claimIds: outcome.sourceClaimIds,
    correctionIds: outcome.correctionIds,
  }, claims, corrections);
  assertCanonicalRecord(outcome, rebuilt, "FORGED_EVENT_OUTCOME", "event outcome");
}

async function validateLinkageContextRecord(
  context: VietnamScheduleLinkageContext,
): Promise<void> {
  const rebuilt = await createVietnamScheduleLinkageContext({
    scheduleReleaseId: context.scheduleReleaseId,
    scheduleArtifactId: context.scheduleArtifactId,
    scheduleReceiptId: context.scheduleReceiptId,
    scheduleArtifactFileSha256: context.scheduleArtifactFileSha256,
    scheduleSourceCutoff: context.scheduleSourceCutoff,
    correctionLineage: context.correctionLineage,
    scheduleCompetitions: context.scheduleCompetitions,
  });
  assertCanonicalRecord(context, rebuilt, "FORGED_D1A_LINKAGE_CONTEXT", "D1A linkage context");
}

async function validateLinkRecord(
  link: ScheduleOutcomeLink,
  outcome: VietnamEventOutcome,
  context: VietnamScheduleLinkageContext,
): Promise<void> {
  const rebuilt = await createScheduleOutcomeLink({
    outcome,
    linkageContext: context,
    sourceCutoff: link.sourceCutoff,
    expectedCompetitionKey: link.expectedCompetitionKey,
    sourceDeclaredCompetitionKey: link.sourceDeclaredCompetitionKey,
  });
  assertCanonicalRecord(link, rebuilt, "FORGED_SCHEDULE_OUTCOME_LINK", "schedule-outcome link");
}

function assertExactOwnership(
  ids: readonly string[],
  expectedIds: readonly string[],
  label: string,
  code: string,
): void {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const expected of expectedIds) {
    if (counts.get(expected) !== 1) fail(`${label} must be referenced exactly once`, code);
  }
  if ([...counts.keys()].some((id) => !expectedIds.includes(id))) {
    fail(`${label} references an unknown record`, code);
  }
}

export async function createVietnamOutcomeEvidenceBundle(
  input: VietnamOutcomeEvidenceBundleInput,
): Promise<VietnamOutcomeEvidenceBundle> {
  if (
    input.sources.length === 0
    || input.claims.length === 0
    || input.outcomes.length === 0
    || input.links.length === 0
  ) {
    fail("Vietnam Outcome Evidence V1 cannot emit an empty research release", "OUTCOME_RELEASE_EMPTY");
  }
  const sourceCutoff = normalizeInstantStrict(input.sourceCutoff, "sourceCutoff");
  await validateLinkageContextRecord(input.linkageContext);

  const sources = [...input.sources].sort((left, right) =>
    compareCanonicalStrings(left.sourceId, right.sourceId)
  );
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    fail("duplicate outcome source ID", "DUPLICATE_OUTCOME_SOURCE");
  }
  for (const source of sources) {
    await validateSourceRecord(source);
    if (
      source.reviewerStatus !== "reviewed"
      || source.evidenceQuality === "rejected"
      || source.sourceIdentity.kind !== "repository_file"
    ) {
      fail("only reviewed preserved repository evidence may enter a release", "OUTCOME_SOURCE_NOT_RELEASE_ELIGIBLE");
    }
    if (
      source.capturedAt > sourceCutoff
      || (source.publication.kind === "exact" && source.publication.value > source.capturedAt)
    ) {
      fail("publication, capture, and cutoff chronology is invalid", "OUTCOME_SOURCE_AFTER_CUTOFF");
    }
    if (isReleaseFixture(source.sourceKey)) {
      fail("fixture evidence cannot enter a release", "OUTCOME_FIXTURE_RELEASE_FORBIDDEN");
    }
  }

  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  const claims = [...input.claims].sort((left, right) =>
    compareCanonicalStrings(left.claimId, right.claimId)
  );
  if (new Set(claims.map((claim) => claim.claimId)).size !== claims.length) {
    fail("duplicate outcome claim ID", "DUPLICATE_OUTCOME_CLAIM");
  }
  for (const claim of claims) {
    const source = sourcesById.get(claim.sourceId);
    if (!source) fail("release claim source is not included", "OUTCOME_RELEASE_SOURCE_MISMATCH");
    await validateClaimRecord(claim, source);
    if (claim.state === "rejected" || claim.extractionStatus === "rejected") {
      fail("rejected extraction cannot enter a release", "OUTCOME_REJECTED_CLAIM_IN_RELEASE");
    }
    if (isReleaseFixture(claim.outcomeEventKey)) {
      fail("fixture outcome cannot enter a release", "OUTCOME_FIXTURE_RELEASE_FORBIDDEN");
    }
  }
  if (!claims.some((claim) => ACTIVE_VALUE_STATES.has(claim.state))) {
    fail("missing-only evidence cannot create a release", "OUTCOME_RELEASE_MISSING_ONLY");
  }
  const claimsById = claimMap(claims);

  const corrections = [...input.corrections].sort((left, right) =>
    compareCanonicalStrings(left.correctionId, right.correctionId)
  );
  if (new Set(corrections.map((correction) => correction.correctionId)).size !== corrections.length) {
    fail("duplicate outcome correction ID", "DUPLICATE_OUTCOME_CORRECTION");
  }
  for (const correction of corrections) await validateCorrectionRecord(correction, claims);
  validateCorrectionGraphInternal(corrections, claims);

  const outcomes = [...input.outcomes].sort((left, right) =>
    compareCanonicalStrings(left.outcomeId, right.outcomeId)
  );
  if (new Set(outcomes.map((outcome) => outcome.outcomeId)).size !== outcomes.length) {
    fail("duplicate outcome ID", "DUPLICATE_OUTCOME_ID");
  }
  for (const outcome of outcomes) await validateOutcomeRecord(outcome, claims, corrections);
  assertExactOwnership(
    outcomes.flatMap((outcome) => outcome.sourceClaimIds),
    claims.map((claim) => claim.claimId),
    "outcome claim",
    "OUTCOME_CLAIM_OWNERSHIP_INVALID",
  );
  assertExactOwnership(
    outcomes.flatMap((outcome) => outcome.correctionIds),
    corrections.map((correction) => correction.correctionId),
    "outcome correction",
    "OUTCOME_CORRECTION_OWNERSHIP_INVALID",
  );

  const outcomesById = new Map(outcomes.map((outcome) => [outcome.outcomeId, outcome]));
  const links = [...input.links].sort((left, right) =>
    compareCanonicalStrings(left.linkId, right.linkId)
  );
  if (new Set(links.map((link) => link.linkId)).size !== links.length) {
    fail("duplicate schedule-outcome link ID", "DUPLICATE_OUTCOME_LINK");
  }
  for (const link of links) {
    const outcome = outcomesById.get(link.outcomeId);
    if (!outcome) fail("release link outcome is not included", "OUTCOME_RELEASE_LINK_MISMATCH");
    if (
      link.linkageContextId !== input.linkageContext.linkageContextId
      || link.sourceCutoff !== sourceCutoff
    ) {
      fail("release link context or cutoff mismatch", "OUTCOME_RELEASE_LINK_CONTEXT_MISMATCH");
    }
    const sourceExpectedKeys = new Set<string>();
    for (const claimId of outcome.sourceClaimIds) {
      const claim = claimsById.get(claimId)!;
      const source = sourcesById.get(claim.sourceId)!;
      if (source.expectedCompetitionKey !== null) {
        sourceExpectedKeys.add(source.expectedCompetitionKey);
      }
    }
    const sourceExpectedCompetitionKey = sourceExpectedKeys.size === 1
      ? [...sourceExpectedKeys][0]
      : null;
    if (
      sourceExpectedKeys.size > 1
      || link.expectedCompetitionKey !== sourceExpectedCompetitionKey
    ) {
      fail(
        "schedule link expectation does not match included source evidence",
        "OUTCOME_LINK_EXPECTED_KEY_PROVENANCE_MISMATCH",
      );
    }
    await validateLinkRecord(link, outcome, input.linkageContext);
  }
  assertExactOwnership(
    links.map((link) => link.outcomeId),
    outcomes.map((outcome) => outcome.outcomeId),
    "outcome link",
    "OUTCOME_LINK_OWNERSHIP_INVALID",
  );

  const readinessReports = await Promise.all(outcomes.map(async (outcome) => {
    const link = links.find((candidate) => candidate.outcomeId === outcome.outcomeId)!;
    return createOutcomeReadinessReport(outcome, link);
  }));
  if (!readinessReports.some((report) => report.states.includes("outcome_ready"))) {
    fail(
      "first outcome release requires a final exact or explicit-linked event outcome",
      "OUTCOME_RELEASE_FINAL_LINKED_OUTCOME_REQUIRED",
    );
  }

  const sourceIds = Object.freeze(sources.map((source) => source.sourceId));
  const claimIds = Object.freeze(claims.map((claim) => claim.claimId));
  const correctionIds = Object.freeze(corrections.map((correction) => correction.correctionId));
  const outcomeIds = Object.freeze(outcomes.map((outcome) => outcome.outcomeId));
  const linkIds = Object.freeze(links.map((link) => link.linkId));
  const sourceContentHashes = Object.freeze(
    sources.map((source) => source.sourceIdentity.sha256).sort(compareCanonicalStrings),
  );
  const inclusionContent = {
    sourceCutoff,
    linkageContextId: input.linkageContext.linkageContextId,
    sourceIds,
    claimIds,
    correctionIds,
    outcomeIds,
    linkIds,
    sourceContentHashes,
  };
  const inclusionManifestId = await contentAddress("inclusion", inclusionContent);
  const inclusionManifest = deepFreeze({
    inclusionManifestId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...inclusionContent,
  });
  const evidenceQuality = Object.freeze(
    [...new Set(sources.map((source) => source.evidenceQuality))].sort(compareCanonicalStrings),
  );
  const releaseContent = {
    releaseKind: "observed_public_outcome_evidence" as const,
    releaseKey: "vietnam-outcome-evidence-v1" as const,
    market: "vietnam" as const,
    country: "Vietnam" as const,
    scopeKind: "country" as const,
    sourceCutoff,
    linkageContextId: input.linkageContext.linkageContextId,
    inclusionManifestId,
    sourceIds,
    claimIds,
    correctionIds,
    outcomeIds,
    linkIds,
    evidenceQuality,
  };
  const releaseId = await contentAddress("release", releaseContent);
  const release = deepFreeze({
    releaseId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...releaseContent,
  });
  const limitations = Object.freeze([
    "Observed public outcome evidence is separate from planned schedule supply.",
    "Absent evidence remains missing and is never interpreted as zero.",
    "No public release contains private player, registration, or operator records.",
    "Only final event-scope evidence with exact or explicit current-D1A linkage may enter aggregate research.",
    "Partial, future, ambiguous, conflicting, cancelled, or incompatible money evidence remains unavailable.",
  ]);
  const orderedReadiness = Object.freeze(
    [...readinessReports].sort((left, right) =>
      compareCanonicalStrings(left.readinessId, right.readinessId)
    ),
  );
  const artifactContent = {
    artifactType: "vietnam_outcome_evidence" as const,
    releaseId,
    sourceCutoff,
    linkageContext: input.linkageContext,
    sources: Object.freeze(sources),
    claims: Object.freeze(claims),
    corrections: Object.freeze(corrections),
    outcomes: Object.freeze(outcomes),
    links: Object.freeze(links),
    readinessReports: orderedReadiness,
    limitations,
  };
  const contentHash = await canonicalHash(idPayload("artifact-content", artifactContent));
  const artifactId = await contentAddress("artifact", { releaseId, contentHash });
  const artifact = deepFreeze({
    artifactId,
    contentHash,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...artifactContent,
  });
  return deepFreeze({ inclusionManifest, release, artifact });
}

export async function createVietnamOutcomeReceipt(input: {
  readonly bundle: VietnamOutcomeEvidenceBundle;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
}): Promise<VietnamOutcomeReceipt> {
  const artifactPath = normalizeText(input.artifactPath, "artifactPath", 1024)
    .replace(/\\/g, "/");
  if (
    !artifactPath.startsWith("src/lib/series-market/datasets/vietnam/outcomes/")
    || artifactPath.includes("..")
  ) {
    fail(
      "outcome artifact path must be repository-relative under Vietnam outcomes",
      "INVALID_OUTCOME_ARTIFACT_PATH",
    );
  }
  const sourceReceipts = Object.freeze(
    input.bundle.artifact.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceIdentity: source.sourceIdentity,
    })),
  );
  const content = {
    releaseId: input.bundle.release.releaseId,
    artifactId: input.bundle.artifact.artifactId,
    artifactContentHash: input.bundle.artifact.contentHash,
    artifactPath,
    artifactFileSha256: normalizeSha256(input.artifactFileSha256, "artifactFileSha256"),
    sourceReceipts,
  };
  const receiptId = await contentAddress("receipt", content);
  return deepFreeze({
    receiptId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    ...content,
  });
}

function normalizeOutcomeIdentity(
  input: OutcomeIntakeRecordInput["outcome"],
): OutcomeIntakeRecord["outcome"] {
  return deepFreeze({
    outcomeEventKey: normalizeKey(input.outcomeEventKey, "outcomeEventKey"),
    organizer: normalizeText(input.organizer, "outcome organizer"),
    seriesName: normalizeText(input.seriesName, "outcome seriesName"),
    eventName: normalizeText(input.eventName, "outcome eventName"),
    eventDate: normalizeLocalDateStrict(input.eventDate, "outcome eventDate"),
    flightIdentity: normalizeNullableText(input.flightIdentity, "outcome flightIdentity", 512),
    currency: input.currency === null ? null : normalizeCurrencyStrict(input.currency, "outcome currency"),
  });
}

export async function createOutcomeIntakeRecord(
  input: OutcomeIntakeRecordInput,
): Promise<OutcomeIntakeRecord> {
  if (typeof input.fixtureOnly !== "boolean") {
    fail("fixtureOnly must be boolean", "INVALID_OUTCOME_FIXTURE_MARKER");
  }
  const intakeKey = normalizeKey(input.intakeKey, "intakeKey");
  if (input.fixtureOnly !== isReleaseFixture(intakeKey)) {
    fail("fixture intake keys must use the reserved fixture namespace", "OUTCOME_FIXTURE_NAMESPACE_MISMATCH");
  }
  const source = await createVietnamOutcomeEvidenceSource(input.source);
  const outcome = normalizeOutcomeIdentity(input.outcome);
  if (input.fixtureOnly && (!isReleaseFixture(source.sourceKey) || !isReleaseFixture(outcome.outcomeEventKey))) {
    fail("fixture source and outcome keys must use the reserved fixture namespace", "OUTCOME_FIXTURE_NAMESPACE_MISMATCH");
  }
  const claims = await Promise.all(input.claims.map((claim) =>
    createVietnamOutcomeEvidenceClaim({
      outcomeEventKey: outcome.outcomeEventKey,
      source,
      ...claim,
    })
  ));
  if (claims.length === 0) fail("outcome intake requires at least one claim", "OUTCOME_INTAKE_CLAIMS_REQUIRED");
  const reviewerStatus = normalizeEnum(
    input.reviewerStatus,
    OUTCOME_REVIEWER_STATUSES,
    "intake reviewerStatus",
  );
  if (reviewerStatus !== source.reviewerStatus) {
    fail("intake review status must match source review status", "OUTCOME_INTAKE_REVIEW_MISMATCH");
  }
  const linkage = deepFreeze({
    expectedCompetitionKey: normalizeOptionalStableKey(
      input.linkage.expectedCompetitionKey,
      "intake expectedCompetitionKey",
    ),
    sourceDeclaredCompetitionKey: normalizeOptionalStableKey(
      input.linkage.sourceDeclaredCompetitionKey,
      "intake sourceDeclaredCompetitionKey",
    ),
  });
  if (linkage.expectedCompetitionKey !== source.expectedCompetitionKey) {
    fail(
      "intake linkage expectation must match its source evidence",
      "OUTCOME_INTAKE_EXPECTED_LINK_MISMATCH",
    );
  }
  const content = {
    intakeKey,
    fixtureOnly: input.fixtureOnly,
    sourceId: source.sourceId,
    outcome,
    claimIds: Object.freeze(claims.map((claim) => claim.claimId).sort(compareCanonicalStrings)),
    linkage,
    reviewerStatus,
    limitationNotes: sortedUnique(input.limitationNotes, "intake limitationNotes"),
  };
  const intakeId = await contentAddress("intake", content);
  return deepFreeze({
    intakeId,
    contractVersion: VIETNAM_OUTCOME_EVIDENCE_CONTRACT_VERSION,
    intakeKey,
    fixtureOnly: input.fixtureOnly,
    source,
    outcome,
    claims: Object.freeze([...claims].sort((left, right) =>
      compareCanonicalStrings(left.claimId, right.claimId)
    )),
    linkage,
    reviewerStatus,
    limitationNotes: content.limitationNotes,
  });
}
