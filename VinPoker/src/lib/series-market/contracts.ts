import { canonicalize } from "../series-intelligence/provenanceHash";
import {
  compareCanonicalStrings,
  normalizeClaimValue,
  normalizeInstant,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";

export const SERIES_MARKET_CONTRACT_VERSION = "v1" as const;
export const SERIES_MARKET_NAMESPACE = `series-market:${SERIES_MARKET_CONTRACT_VERSION}` as const;

export type SeriesMarketContractVersion = typeof SERIES_MARKET_CONTRACT_VERSION;
export type MarketEntityType = "festival" | "event";
export type MarketEventRelationshipType =
  | "flight_of"
  | "satellite_to"
  | "day_2_of"
  | "feeder_to"
  | "replacement_of"
  | "schedule_revision_of";

export type ClaimKind = "observed" | "reported" | "missing";
export type ClaimStatus =
  | "official_confirmed"
  | "cross_verified"
  | "unverified"
  | "conflicting"
  | "stale"
  | "rejected";
export type EvidenceConfidence = "high" | "medium" | "low" | "unknown";
export type MissingReason = "not_disclosed" | "not_found" | "not_applicable" | "unknown";
export type LocalDateTimePrecision = "minute" | "second";

export interface TextClaimValue {
  readonly type: "text";
  readonly value: string;
}

export interface BooleanClaimValue {
  readonly type: "boolean";
  readonly value: boolean;
}

export interface IntegerClaimValue {
  readonly type: "integer";
  readonly value: string;
}

export interface DecimalClaimValue {
  readonly type: "decimal";
  readonly value: string;
}

export interface MoneyClaimValue {
  readonly type: "money";
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
}

export interface LocalDateClaimValue {
  readonly type: "local_date";
  readonly value: string;
}

export interface PartialLocalDateTimeClaimValue {
  readonly type: "partial_local_datetime";
  readonly local: string;
  readonly timeZone: string;
  readonly precision: LocalDateTimePrecision;
}

export interface InstantClaimValue {
  readonly type: "instant";
  readonly value: string;
}

export interface MissingClaimValue {
  readonly type: "missing";
  readonly reason: MissingReason;
}

export type ClaimValue =
  | TextClaimValue
  | BooleanClaimValue
  | IntegerClaimValue
  | DecimalClaimValue
  | MoneyClaimValue
  | LocalDateClaimValue
  | PartialLocalDateTimeClaimValue
  | InstantClaimValue
  | MissingClaimValue;

export type NonMissingClaimValue = Exclude<ClaimValue, MissingClaimValue>;

export type CanonicalParameterValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalParameterValue[]
  | { readonly [key: string]: CanonicalParameterValue };

export interface MarketFestival {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly entityType: "festival";
  readonly marketKey: string;
  readonly festivalKey: string;
}

export interface MarketEvent {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly entityType: "event";
  readonly marketKey: string;
  readonly festivalKey: string;
  readonly eventKey: string;
  readonly festivalId: string;
}

export interface MarketEventRelationship {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly relationshipType: MarketEventRelationshipType;
  readonly fromEventId: string;
  readonly toEventId: string;
  readonly evidenceClaimIds: readonly string[];
}

export type SourceDocumentType =
  | "official_schedule"
  | "official_result"
  | "official_structure"
  | "official_poster"
  | "organizer_or_venue"
  | "trusted_results_database"
  | "trusted_report"
  | "other_public";

export interface SourceDocument {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly documentKey: string;
  readonly sourceType: SourceDocumentType;
  readonly canonicalUrl: string | null;
  readonly sourceReference: string | null;
  readonly publisher: string | null;
  readonly title: string | null;
}

export interface SourceRevision {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly sourceDocumentId: string;
  readonly revisionKey: string;
  readonly retrievedAt: string;
  readonly effectiveAt: string | null;
  readonly contentHash: string | null;
  readonly supersedesSourceRevisionId: string | null;
}

export type ExtractionMethod = "manual_curated" | "structured_import" | "document_parse";

export interface SourceClaim {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly entityType: MarketEntityType;
  readonly entityId: string;
  readonly field: string;
  readonly kind: ClaimKind;
  readonly status: ClaimStatus;
  readonly confidence: EvidenceConfidence;
  readonly value: ClaimValue;
  readonly rawValue: string | null;
  readonly unit: string | null;
  readonly sourceRevisionId: string | null;
  readonly observedAt: string;
  readonly effectiveAt: string | null;
  readonly extractionMethod: ExtractionMethod;
  readonly supersedesClaimId: string | null;
  readonly notes: string | null;
}

export interface DerivedMetric {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly entityId: string | null;
  readonly metricKey: string;
  readonly methodVersion: string;
  readonly inputClaimIds: readonly string[];
  readonly parameters: CanonicalParameterValue;
  readonly value: NonMissingClaimValue;
  readonly unit: string | null;
  readonly confidence: EvidenceConfidence;
  readonly computedAt: string;
  readonly notes: string | null;
}

export interface DatasetRelease {
  readonly id: string;
  readonly contractVersion: SeriesMarketContractVersion;
  readonly marketKey: string;
  readonly sourceCutoff: string;
  readonly entityIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly sourceRevisionIds: readonly string[];
  readonly parentReleaseId: string | null;
  readonly notes: string | null;
}

export type ClaimResolution =
  | { readonly state: "resolved"; readonly claim: SourceClaim }
  | { readonly state: "missing"; readonly claim: SourceClaim | null }
  | { readonly state: "conflict"; readonly claims: readonly SourceClaim[] };

const requireText = (value: string, label: string): void => {
  if (value.trim() === "") throw new SeriesMarketValidationError(`${label} must not be blank`, "BLANK_FIELD");
};

/** Validate one already-normalized claim. This never mutates or silently repairs the claim. */
export function validateSourceClaim(claim: SourceClaim): void {
  if (claim.contractVersion !== SERIES_MARKET_CONTRACT_VERSION) {
    throw new SeriesMarketValidationError("unsupported contract version", "CONTRACT_VERSION_MISMATCH");
  }
  requireText(claim.id, "claim.id");
  requireText(claim.entityId, "claim.entityId");
  requireText(claim.field, "claim.field");
  requireText(claim.observedAt, "claim.observedAt");
  if (normalizeStableKey(claim.field, "claim.field") !== claim.field) {
    throw new SeriesMarketValidationError("claim field is not canonical", "NON_CANONICAL_FIELD");
  }
  if (normalizeInstant(claim.observedAt) !== claim.observedAt) {
    throw new SeriesMarketValidationError("claim observedAt is not canonical UTC", "NON_CANONICAL_OBSERVED_AT");
  }
  if (claim.effectiveAt !== null && normalizeInstant(claim.effectiveAt) !== claim.effectiveAt) {
    throw new SeriesMarketValidationError("claim effectiveAt is not canonical UTC", "NON_CANONICAL_EFFECTIVE_AT");
  }

  const normalizedValue = normalizeClaimValue(claim.value);
  if (canonicalize(normalizedValue) !== canonicalize(claim.value)) {
    throw new SeriesMarketValidationError("claim value is not canonical", "NON_CANONICAL_CLAIM_VALUE");
  }

  if (claim.kind === "missing" && claim.value.type !== "missing") {
    throw new SeriesMarketValidationError("missing claim must carry a missing value", "MISSING_CLAIM_HAS_VALUE");
  }
  if (claim.kind !== "missing" && claim.value.type === "missing") {
    throw new SeriesMarketValidationError("non-missing claim cannot carry a missing value", "NON_MISSING_CLAIM_HAS_MISSING_VALUE");
  }
  if (claim.kind !== "missing" && (claim.sourceRevisionId === null || claim.sourceRevisionId.trim() === "")) {
    throw new SeriesMarketValidationError("observed/reported claim requires source lineage", "SOURCE_LINEAGE_REQUIRED");
  }
  if (claim.supersedesClaimId !== null && claim.supersedesClaimId.trim() === "") {
    throw new SeriesMarketValidationError("supersedesClaimId must be null or non-blank", "INVALID_SUPERSESSION_ID");
  }
  if (claim.supersedesClaimId === claim.id) {
    throw new SeriesMarketValidationError("claim cannot supersede itself", "SELF_SUPERSESSION");
  }
}

/** Collapse exact duplicate retries by ID; fail closed if one ID carries different semantic content. */
export function dedupeSourceClaims(claims: readonly SourceClaim[]): readonly SourceClaim[] {
  const byId = new Map<string, SourceClaim>();
  for (const claim of claims) {
    const previous = byId.get(claim.id);
    if (previous && canonicalize(previous) !== canonicalize(claim)) {
      throw new SeriesMarketValidationError(`claim identity collision: ${claim.id}`, "IDENTITY_COLLISION");
    }
    if (!previous) byId.set(claim.id, claim);
  }
  return [...byId.values()].sort((a, b) => compareCanonicalStrings(a.id, b.id));
}

/** Validate append-only supersession scope and reject missing targets or cycles. */
export function validateClaimSupersession(claims: readonly SourceClaim[]): readonly SourceClaim[] {
  const unique = dedupeSourceClaims(claims);
  const byId = new Map(unique.map((claim) => [claim.id, claim] as const));
  for (const claim of unique) {
    validateSourceClaim(claim);
    if (claim.supersedesClaimId === null) continue;
    const previous = byId.get(claim.supersedesClaimId);
    if (!previous) {
      throw new SeriesMarketValidationError(
        `superseded claim is missing: ${claim.supersedesClaimId}`,
        "SUPERSESSION_TARGET_MISSING",
      );
    }
    if (previous.entityId !== claim.entityId || previous.entityType !== claim.entityType || previous.field !== claim.field) {
      throw new SeriesMarketValidationError(
        "superseding claim must target the same entity and field",
        "SUPERSESSION_SCOPE_MISMATCH",
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new SeriesMarketValidationError("supersession cycle detected", "SUPERSESSION_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id);
    const previous = byId.get(id)?.supersedesClaimId;
    if (previous !== null && previous !== undefined) visit(previous);
    visiting.delete(id);
    visited.add(id);
  };
  for (const claim of unique) visit(claim.id);
  return unique;
}

/** Append a claim as a new immutable record. Exact duplicate retries collapse deterministically. */
export function appendSourceClaim(existing: readonly SourceClaim[], next: SourceClaim): readonly SourceClaim[] {
  return validateClaimSupersession([...existing, next]);
}

const STATUS_PRECEDENCE: Readonly<Record<ClaimStatus, number>> = {
  official_confirmed: 3,
  cross_verified: 2,
  unverified: 1,
  conflicting: 0,
  stale: -1,
  rejected: -1,
};

/** Resolve one entity-field claim set without hiding equal-precedence disagreement. */
export function resolveSourceClaims(claims: readonly SourceClaim[]): ClaimResolution {
  if (claims.length === 0) return { state: "missing", claim: null };
  const unique = validateClaimSupersession(claims);
  const first = unique[0];
  for (const claim of unique) {
    if (claim.entityId !== first.entityId || claim.entityType !== first.entityType || claim.field !== first.field) {
      throw new SeriesMarketValidationError("resolver accepts one entity and field at a time", "RESOLUTION_SCOPE_MISMATCH");
    }
  }

  // A rejected correction does not deactivate the prior evidence. Every other appended correction does.
  const superseded = new Set(
    unique
      .filter((claim) => claim.status !== "rejected" && claim.supersedesClaimId !== null)
      .map((claim) => claim.supersedesClaimId as string),
  );
  const current = unique.filter(
    (claim) => !superseded.has(claim.id) && claim.status !== "rejected" && claim.status !== "stale",
  );
  if (current.length === 0) return { state: "missing", claim: null };
  if (current.some((claim) => claim.status === "conflicting")) {
    return { state: "conflict", claims: current };
  }

  const top = Math.max(...current.map((claim) => STATUS_PRECEDENCE[claim.status]));
  const candidates = current.filter((claim) => STATUS_PRECEDENCE[claim.status] === top);
  const values = new Set(candidates.map((claim) => canonicalize(claim.value)));
  if (values.size > 1) return { state: "conflict", claims: candidates };

  const winner = [...candidates].sort((a, b) => compareCanonicalStrings(a.id, b.id))[0];
  return winner.value.type === "missing"
    ? { state: "missing", claim: winner }
    : { state: "resolved", claim: winner };
}

export function validateDerivedMetric(metric: DerivedMetric): void {
  if (metric.contractVersion !== SERIES_MARKET_CONTRACT_VERSION) {
    throw new SeriesMarketValidationError("unsupported contract version", "CONTRACT_VERSION_MISMATCH");
  }
  requireText(metric.id, "metric.id");
  requireText(metric.metricKey, "metric.metricKey");
  requireText(metric.methodVersion, "metric.methodVersion");
  if (metric.inputClaimIds.length === 0) {
    throw new SeriesMarketValidationError("derived metric requires input claims", "DERIVED_INPUTS_REQUIRED");
  }
  if (metric.inputClaimIds.some((id) => id.trim() === "")) {
    throw new SeriesMarketValidationError("derived metric input claim ID is blank", "BLANK_DERIVED_INPUT");
  }
  if (new Set(metric.inputClaimIds).size !== metric.inputClaimIds.length) {
    throw new SeriesMarketValidationError("derived metric input claim IDs must be unique", "DUPLICATE_DERIVED_INPUT");
  }
  const normalized = normalizeClaimValue(metric.value);
  if (normalized.type === "missing") {
    throw new SeriesMarketValidationError("derived metric cannot have a missing value", "DERIVED_VALUE_MISSING");
  }
  if (canonicalize(normalized) !== canonicalize(metric.value)) {
    throw new SeriesMarketValidationError("derived metric value is not canonical", "NON_CANONICAL_DERIVED_VALUE");
  }
  if (normalizeInstant(metric.computedAt) !== metric.computedAt) {
    throw new SeriesMarketValidationError("metric computedAt is not canonical UTC", "NON_CANONICAL_COMPUTED_AT");
  }
  canonicalize(metric.parameters); // fail closed on undefined, non-finite, or non-plain parameters
}

export { SeriesMarketValidationError };
