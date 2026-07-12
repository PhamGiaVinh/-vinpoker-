import { canonicalHash } from "../series-intelligence/provenanceHash";
import {
  SERIES_MARKET_CONTRACT_VERSION,
  SERIES_MARKET_NAMESPACE,
  type CanonicalParameterValue,
  type ClaimValue,
  type MarketEventRelationshipType,
  type SourceDocumentType,
} from "./contracts";
import {
  canonicalStringSet,
  normalizeClaimValue,
  normalizeInstant,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";

async function namespacedId(namespace: string, payload: Record<string, unknown>): Promise<string> {
  const digest = await canonicalHash({
    ...payload,
    namespace,
    contractVersion: SERIES_MARKET_CONTRACT_VERSION,
  });
  return `${namespace}:${digest}`;
}

export interface FestivalIdentityInput {
  readonly marketKey: string;
  readonly festivalKey: string;
}

export async function createMarketFestivalId(input: FestivalIdentityInput): Promise<string> {
  const marketKey = normalizeStableKey(input.marketKey, "marketKey");
  const festivalKey = normalizeStableKey(input.festivalKey, "festivalKey");
  const namespace = `${SERIES_MARKET_NAMESPACE}:festival:${marketKey}:${festivalKey}`;
  return namespacedId(namespace, { entityType: "festival", marketKey, festivalKey });
}

export interface EventIdentityInput extends FestivalIdentityInput {
  readonly eventKey: string;
}

export async function createMarketEventId(input: EventIdentityInput): Promise<string> {
  const marketKey = normalizeStableKey(input.marketKey, "marketKey");
  const festivalKey = normalizeStableKey(input.festivalKey, "festivalKey");
  const eventKey = normalizeStableKey(input.eventKey, "eventKey");
  const namespace = `${SERIES_MARKET_NAMESPACE}:event:${marketKey}:${festivalKey}:${eventKey}`;
  return namespacedId(namespace, { entityType: "event", marketKey, festivalKey, eventKey });
}

export interface RelationshipIdentityInput {
  readonly relationshipType: MarketEventRelationshipType;
  readonly fromEventId: string;
  readonly toEventId: string;
  readonly evidenceClaimIds: readonly string[];
}

export async function createMarketEventRelationshipId(input: RelationshipIdentityInput): Promise<string> {
  return namespacedId(`${SERIES_MARKET_NAMESPACE}:relationship`, {
    relationshipType: input.relationshipType,
    fromEventId: input.fromEventId.normalize("NFC").trim(),
    toEventId: input.toEventId.normalize("NFC").trim(),
    evidenceClaimIds: canonicalStringSet(input.evidenceClaimIds),
  });
}

export interface SourceDocumentIdentityInput {
  readonly documentKey: string;
  readonly sourceType: SourceDocumentType;
}

export async function createSourceDocumentId(input: SourceDocumentIdentityInput): Promise<string> {
  const documentKey = normalizeStableKey(input.documentKey, "documentKey");
  return namespacedId(`${SERIES_MARKET_NAMESPACE}:source-document:${documentKey}`, {
    documentKey,
    sourceType: input.sourceType,
  });
}

export interface SourceRevisionIdentityInput {
  readonly sourceDocumentId: string;
  readonly revisionKey: string;
  readonly retrievedAt: string;
  readonly contentHash: string | null;
}

function normalizeContentHash(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new SeriesMarketValidationError("contentHash must be a lowercase SHA-256 digest", "INVALID_CONTENT_HASH");
  }
  return normalized;
}

export async function createSourceRevisionId(input: SourceRevisionIdentityInput): Promise<string> {
  return namespacedId(`${SERIES_MARKET_NAMESPACE}:source-revision`, {
    sourceDocumentId: input.sourceDocumentId.normalize("NFC").trim(),
    revisionKey: normalizeStableKey(input.revisionKey, "revisionKey"),
    retrievedAt: normalizeInstant(input.retrievedAt),
    contentHash: normalizeContentHash(input.contentHash),
  });
}

export interface SourceClaimIdentityInput {
  readonly entityId: string;
  readonly field: string;
  readonly value: ClaimValue;
  readonly sourceRevisionId: string | null;
  readonly effectiveAt: string | null;
}

export async function createSourceClaimId(input: SourceClaimIdentityInput): Promise<string> {
  const field = normalizeStableKey(input.field, "field");
  return namespacedId(`${SERIES_MARKET_NAMESPACE}:claim`, {
    entityId: input.entityId.normalize("NFC").trim(),
    field,
    value: normalizeClaimValue(input.value),
    sourceRevisionId: input.sourceRevisionId?.normalize("NFC").trim() ?? null,
    effectiveAt: input.effectiveAt === null ? null : normalizeInstant(input.effectiveAt),
  });
}

export interface DatasetReleaseIdentityInput {
  readonly marketKey: string;
  readonly sourceCutoff: string;
  readonly entityIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly sourceRevisionIds: readonly string[];
}

export async function createDatasetReleaseId(input: DatasetReleaseIdentityInput): Promise<string> {
  const marketKey = normalizeStableKey(input.marketKey, "marketKey");
  return namespacedId(`${SERIES_MARKET_NAMESPACE}:release:${marketKey}`, {
    marketKey,
    sourceCutoff: normalizeInstant(input.sourceCutoff),
    entityIds: canonicalStringSet(input.entityIds),
    claimIds: canonicalStringSet(input.claimIds),
    sourceRevisionIds: canonicalStringSet(input.sourceRevisionIds),
  });
}

export interface DerivedMetricIdentityInput {
  readonly entityId: string | null;
  readonly metricKey: string;
  readonly methodVersion: string;
  readonly inputClaimIds: readonly string[];
  readonly parameters: CanonicalParameterValue;
}

export async function createDerivedMetricId(input: DerivedMetricIdentityInput): Promise<string> {
  if (input.inputClaimIds.length === 0) {
    throw new SeriesMarketValidationError("derived metric identity requires input claims", "DERIVED_INPUTS_REQUIRED");
  }
  return namespacedId(`${SERIES_MARKET_NAMESPACE}:derived-metric`, {
    entityId: input.entityId?.normalize("NFC").trim() ?? null,
    metricKey: normalizeStableKey(input.metricKey, "metricKey"),
    methodVersion: normalizeStableKey(input.methodVersion, "methodVersion"),
    inputClaimIds: canonicalStringSet(input.inputClaimIds),
    parameters: input.parameters,
  });
}
