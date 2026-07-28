import { canonicalHash } from "../series-intelligence/provenanceHash";
import {
  resolveSourceClaims,
  type ClaimStatus,
  type DatasetRelease,
  type MarketEntityType,
  type SourceClaim,
  validateClaimSupersession,
} from "./contracts";
import {
  compareCanonicalStrings,
  normalizeInstant,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";

export const PUBLIC_SOURCE_COVERAGE_CONTRACT_VERSION = "v1" as const;
export const PUBLIC_SOURCE_COVERAGE_NAMESPACE =
  `series-market:v1:public-source-coverage:${PUBLIC_SOURCE_COVERAGE_CONTRACT_VERSION}` as const;

export type PublicMarketScopeKind = "venue" | "country" | "defined_market";
export type PublicCoverageReadinessState =
  | "supported_for_current_exploratory_use"
  | "partially_supported"
  | "blocked_missing_required_fields"
  | "blocked_missing_time_series"
  | "blocked_unverified_evidence"
  | "blocked_insufficient_market_diversity"
  | "not_production_eligible";
export type PublicCoveragePriority = "P0" | "P1" | "P2";
export type PublicCoverageCapabilityKey =
  | "verified_market_explorer"
  | "comparable_event_engine_v0"
  | "historical_gtd_stress"
  | "ridge_challenger"
  | "negative_binomial_challenger"
  | "tabpfn_challenger"
  | "registration_curve_nowcasting"
  | "causal_intervention_analysis"
  | "cross_market_evaluation"
  | "production_forecast_eligibility";

export const PUBLIC_SOURCE_COVERAGE_PRIVATE_FIELD_KEYS = [
  "registration_timestamps",
  "hashed_player_or_cohort_identities",
  "re_entry_and_bullet_linkage",
  "private_satellite_linkage",
  "capacity",
  "cashier_queue",
  "staffing",
  "marketing_spend",
  "decision_log",
  "operating_economics",
] as const;

export interface PublicCoverageEntity {
  readonly id: string;
  readonly entityType: MarketEntityType;
}

export interface PublicCoverageConflict {
  readonly entityId: string;
  readonly entityType: MarketEntityType;
  readonly field: string;
  readonly claimIds: readonly string[];
}

export interface PublicMarketScope {
  readonly marketKey: string;
  readonly scopeKind: PublicMarketScopeKind;
  readonly scopeDefinition: string;
}

export interface PublicSourceCoverageInput {
  readonly release: DatasetRelease;
  readonly scope: PublicMarketScope;
  readonly entities: readonly PublicCoverageEntity[];
  readonly claims: readonly SourceClaim[];
  readonly conflicts: readonly PublicCoverageConflict[];
}

export interface PublicSourceCoverageCounts {
  readonly festivals: number;
  readonly events: number;
  readonly entities: number;
  readonly totalClaims: number;
  readonly presentClaims: number;
  readonly missingClaims: number;
  readonly conflictingClaims: number;
  readonly conflictGroups: number;
  readonly entriesOutcomeAvailableEvents: number;
  readonly gtdStressEligibleEvents: number;
}

export interface PublicSourceFieldCoverage {
  readonly entityType: MarketEntityType;
  readonly field: string;
  readonly totalClaims: number;
  readonly presentClaims: number;
  readonly missingClaims: number;
  readonly conflictGroups: number;
  readonly evidenceStatusCounts: Readonly<Partial<Record<ClaimStatus, number>>>;
}

export interface PublicEvidenceStateCoverage {
  readonly status: ClaimStatus;
  readonly claimCount: number;
}

export interface PublicCoverageCapabilityReadiness {
  readonly capabilityKey: PublicCoverageCapabilityKey;
  readonly state: PublicCoverageReadinessState;
  readonly reasonCodes: readonly string[];
}

export interface PublicCoveragePriorityGap {
  readonly priority: PublicCoveragePriority;
  readonly categoryKey: string;
  readonly fieldKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface PlannedMarketRelease {
  readonly releasePlanId: string;
  readonly releaseKey: "jeju-v2" | "vietnam-v1" | "sea-v1";
  readonly marketKey: string;
  readonly scopeKind: PublicMarketScopeKind;
  readonly scopeDefinition: string;
  readonly allowedMarketKeys: readonly string[];
  readonly compatibilityRules: readonly string[];
}

export interface CrossMarketCorpusPlan {
  readonly releasePlanId: string;
  readonly releaseKey: "cross-market-corpus-v1";
  readonly immutableConstituentReleaseIds: readonly string[];
  readonly requiredConstituentReleaseKeys: readonly PlannedMarketRelease["releaseKey"][];
  readonly state: "not_created";
  readonly reasonCodes: readonly string[];
  readonly compatibilityRules: readonly string[];
}

export interface PublicMarketReleasePlan {
  readonly plannedReleases: readonly PlannedMarketRelease[];
  readonly crossMarketCorpus: CrossMarketCorpusPlan;
}

export interface PublicSourceCoverageArtifact {
  readonly artifactId: string;
  readonly contractVersion: typeof PUBLIC_SOURCE_COVERAGE_CONTRACT_VERSION;
  readonly artifactType: "public-source-coverage";
  readonly artifactSchemaVersion: "v1";
  readonly contentHash: string;
  readonly releaseId: string;
  readonly marketKey: string;
  readonly sourceCutoff: string;
  readonly scope: PublicMarketScope;
  readonly counts: PublicSourceCoverageCounts;
  readonly fieldCoverage: readonly PublicSourceFieldCoverage[];
  readonly evidenceStateCoverage: readonly PublicEvidenceStateCoverage[];
  readonly capabilityReadiness: readonly PublicCoverageCapabilityReadiness[];
  readonly priorityGaps: readonly PublicCoveragePriorityGap[];
  readonly marketReleasePlan: PublicMarketReleasePlan;
  readonly privateFieldsExcluded: readonly string[];
  readonly limitations: readonly string[];
}

export interface PublicSourceCoverageReceipt {
  readonly receiptId: string;
  readonly contractVersion: typeof PUBLIC_SOURCE_COVERAGE_CONTRACT_VERSION;
  readonly artifactId: string;
  readonly artifactContentHash: string;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
}

interface ResolvedField {
  readonly state: "resolved" | "missing" | "conflict";
  readonly claims: readonly SourceClaim[];
}

const CAPABILITY_ORDER: readonly PublicCoverageCapabilityKey[] = [
  "verified_market_explorer",
  "comparable_event_engine_v0",
  "historical_gtd_stress",
  "ridge_challenger",
  "negative_binomial_challenger",
  "tabpfn_challenger",
  "registration_curve_nowcasting",
  "causal_intervention_analysis",
  "cross_market_evaluation",
  "production_forecast_eligibility",
];

const STATUS_ORDER: readonly ClaimStatus[] = [
  "official_confirmed",
  "cross_verified",
  "unverified",
  "conflicting",
  "stale",
  "rejected",
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

function canonicalReference(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 512) fail(`${label} must be a non-blank reference`, "INVALID_PUBLIC_COVERAGE_REFERENCE");
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) fail(`${label} contains a control character`, "INVALID_PUBLIC_COVERAGE_REFERENCE");
  }
  return value;
}

function canonicalText(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 4096) fail(`${label} must be non-blank text`, "INVALID_PUBLIC_COVERAGE_TEXT");
  return value;
}

function sortedUniqueReferences(rawValues: readonly string[], label: string): readonly string[] {
  const values = rawValues.map((value) => canonicalReference(value, label));
  const unique = new Set(values);
  if (unique.size !== values.length) fail(`${label} contains a duplicate`, "DUPLICATE_PUBLIC_COVERAGE_REFERENCE");
  return [...unique].sort(compareCanonicalStrings);
}

function normalizeScope(input: PublicMarketScope): PublicMarketScope {
  const marketKey = normalizeStableKey(input.marketKey, "scope.marketKey");
  if (input.scopeKind !== "venue" && input.scopeKind !== "country" && input.scopeKind !== "defined_market") {
    fail("scope.scopeKind is unsupported", "INVALID_PUBLIC_MARKET_SCOPE_KIND");
  }
  return deepFreeze({
    marketKey,
    scopeKind: input.scopeKind,
    scopeDefinition: canonicalText(input.scopeDefinition, "scope.scopeDefinition"),
  });
}

function normalizeEntities(input: readonly PublicCoverageEntity[]): readonly PublicCoverageEntity[] {
  const byId = new Map<string, PublicCoverageEntity>();
  for (const entity of input) {
    const id = canonicalReference(entity.id, "entity.id");
    if (entity.entityType !== "festival" && entity.entityType !== "event") {
      fail("entity.entityType is unsupported", "INVALID_PUBLIC_COVERAGE_ENTITY_TYPE");
    }
    const normalized = { id, entityType: entity.entityType } as const;
    const prior = byId.get(id);
    if (prior && prior.entityType !== normalized.entityType) {
      fail("entity identity has conflicting types", "PUBLIC_COVERAGE_ENTITY_COLLISION");
    }
    if (prior) fail("entity input contains a duplicate", "DUPLICATE_PUBLIC_COVERAGE_ENTITY");
    byId.set(id, normalized);
  }
  return [...byId.values()].sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateReleaseReferences(
  release: DatasetRelease,
  scope: PublicMarketScope,
  entities: readonly PublicCoverageEntity[],
  claims: readonly SourceClaim[],
): void {
  const releaseId = canonicalReference(release.id, "release.id");
  if (releaseId !== release.id || normalizeStableKey(release.marketKey, "release.marketKey") !== release.marketKey) {
    fail("release identity or market key is not canonical", "NON_CANONICAL_PUBLIC_COVERAGE_RELEASE");
  }
  if (normalizeInstant(release.sourceCutoff) !== release.sourceCutoff) {
    fail("release sourceCutoff is not canonical UTC", "NON_CANONICAL_PUBLIC_COVERAGE_CUTOFF");
  }
  if (release.marketKey !== scope.marketKey) fail("scope market key does not match release", "PUBLIC_COVERAGE_SCOPE_MISMATCH");
  const releaseEntityIds = sortedUniqueReferences(release.entityIds, "release.entityIds");
  const actualEntityIds = entities.map((entity) => entity.id);
  if (!sameStrings(releaseEntityIds, actualEntityIds)) {
    fail("coverage entities do not match the immutable release", "PUBLIC_COVERAGE_ENTITY_RELEASE_MISMATCH");
  }
  const releaseClaimIds = sortedUniqueReferences(release.claimIds, "release.claimIds");
  const actualClaimIds = sortedUniqueReferences(claims.map((claim) => claim.id), "coverage.claimIds");
  if (!sameStrings(releaseClaimIds, actualClaimIds)) {
    fail("coverage claims do not match the immutable release", "PUBLIC_COVERAGE_CLAIM_RELEASE_MISMATCH");
  }
}

function normalizeConflicts(input: readonly PublicCoverageConflict[]): readonly PublicCoverageConflict[] {
  const normalized = input.map((conflict) => {
    if (conflict.entityType !== "festival" && conflict.entityType !== "event") {
      fail("conflict.entityType is unsupported", "INVALID_PUBLIC_COVERAGE_CONFLICT_TYPE");
    }
    return {
      entityId: canonicalReference(conflict.entityId, "conflict.entityId"),
      entityType: conflict.entityType,
      field: normalizeStableKey(conflict.field, "conflict.field"),
      claimIds: sortedUniqueReferences(conflict.claimIds, "conflict.claimIds"),
    } as const;
  });
  const keys = new Set<string>();
  for (const conflict of normalized) {
    const key = `${conflict.entityType}:${conflict.entityId}:${conflict.field}`;
    if (keys.has(key)) fail("conflict input contains a duplicate group", "DUPLICATE_PUBLIC_COVERAGE_CONFLICT");
    keys.add(key);
  }
  return normalized.sort((left, right) => {
    const leftKey = `${left.entityType}:${left.entityId}:${left.field}`;
    const rightKey = `${right.entityType}:${right.entityId}:${right.field}`;
    return compareCanonicalStrings(leftKey, rightKey);
  });
}

function conflictKey(entityType: MarketEntityType, entityId: string, field: string): string {
  return `${entityType}:${entityId}:${field}`;
}

function groupResolvedFields(claims: readonly SourceClaim[]): ReadonlyMap<string, ResolvedField> {
  const grouped = new Map<string, SourceClaim[]>();
  for (const claim of claims) {
    const key = conflictKey(claim.entityType, claim.entityId, claim.field);
    const values = grouped.get(key) ?? [];
    values.push(claim);
    grouped.set(key, values);
  }
  const resolved = new Map<string, ResolvedField>();
  for (const [key, values] of grouped) {
    const outcome = resolveSourceClaims(values);
    resolved.set(key, deepFreeze({
      state: outcome.state,
      claims: outcome.state === "conflict" ? outcome.claims : outcome.claim === null ? [] : [outcome.claim],
    }));
  }
  return resolved;
}

function buildFieldCoverage(
  claims: readonly SourceClaim[],
  conflicts: readonly PublicCoverageConflict[],
): readonly PublicSourceFieldCoverage[] {
  const groups = new Map<string, SourceClaim[]>();
  for (const claim of claims) {
    const key = `${claim.entityType}:${claim.field}`;
    const values = groups.get(key) ?? [];
    values.push(claim);
    groups.set(key, values);
  }
  const conflictCounts = new Map<string, number>();
  for (const conflict of conflicts) {
    const key = `${conflict.entityType}:${conflict.field}`;
    conflictCounts.set(key, (conflictCounts.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].map(([key, fieldClaims]) => {
    const [entityType, field] = key.split(":") as [MarketEntityType, string];
    const evidenceStatusCounts: Partial<Record<ClaimStatus, number>> = {};
    for (const claim of fieldClaims) evidenceStatusCounts[claim.status] = (evidenceStatusCounts[claim.status] ?? 0) + 1;
    return deepFreeze({
      entityType,
      field,
      totalClaims: fieldClaims.length,
      presentClaims: fieldClaims.filter((claim) => claim.value.type !== "missing").length,
      missingClaims: fieldClaims.filter((claim) => claim.value.type === "missing").length,
      conflictGroups: conflictCounts.get(key) ?? 0,
      evidenceStatusCounts: Object.fromEntries(
        STATUS_ORDER.filter((status) => evidenceStatusCounts[status] !== undefined)
          .map((status) => [status, evidenceStatusCounts[status]!]),
      ),
    });
  }).sort((left, right) => {
    const leftKey = `${left.entityType}:${left.field}`;
    const rightKey = `${right.entityType}:${right.field}`;
    return compareCanonicalStrings(leftKey, rightKey);
  });
}

function isResolvedMoney(field: ResolvedField | undefined): boolean {
  return field?.state === "resolved" && field.claims[0]?.value.type === "money";
}

function isGtdStressEligible(eventId: string, resolved: ReadonlyMap<string, ResolvedField>): boolean {
  const gtd = resolved.get(conflictKey("event", eventId, "gtd"));
  const contribution = resolved.get(conflictKey("event", eventId, "buy_in_prize"));
  if (!isResolvedMoney(gtd) || !isResolvedMoney(contribution)) return false;
  const gtdValue = gtd.claims[0]!.value;
  const contributionValue = contribution.claims[0]!.value;
  if (gtdValue.type !== "money" || contributionValue.type !== "money") return false;
  return gtdValue.currency === contributionValue.currency && gtdValue.scale === contributionValue.scale;
}

function fieldCoverageByKey(
  fieldCoverage: readonly PublicSourceFieldCoverage[],
  entityType: MarketEntityType,
  field: string,
): PublicSourceFieldCoverage | undefined {
  return fieldCoverage.find((coverage) => coverage.entityType === entityType && coverage.field === field);
}

function hasOnlyUnverifiedEvidence(coverage: readonly PublicEvidenceStateCoverage[]): boolean {
  const nonUnverified = coverage.filter((row) => row.status !== "unverified" && row.claimCount > 0);
  return nonUnverified.length === 0 && coverage.some((row) => row.status === "unverified" && row.claimCount > 0);
}

function capabilityReadiness(
  counts: PublicSourceCoverageCounts,
  fields: readonly PublicSourceFieldCoverage[],
  evidence: readonly PublicEvidenceStateCoverage[],
): readonly PublicCoverageCapabilityReadiness[] {
  const hasUnverifiedOnlyEvidence = hasOnlyUnverifiedEvidence(evidence);
  const entries = fieldCoverageByKey(fields, "event", "entries");
  const gtd = fieldCoverageByKey(fields, "event", "gtd");
  const prizeContribution = fieldCoverageByKey(fields, "event", "buy_in_prize");
  const organizerFee = fieldCoverageByKey(fields, "event", "organizer_fee");
  const basicComparableFields = ["event_date", "event_type", "game", "buy_in", "entries"]
    .map((field) => fieldCoverageByKey(fields, "event", field))
    .every((field) => field !== undefined && field.missingClaims === 0 && field.conflictGroups === 0);
  const modelReasons = [
    ...(entries?.presentClaims === 0 ? ["missing_entries_outcomes"] : ["event_entries_outcomes_available"]),
    ...(hasUnverifiedOnlyEvidence ? ["all_public_evidence_unverified"] : []),
    ...(gtd?.missingClaims ?? 0) > 0 ? ["missing_gtd_coverage"] : [],
    ...(prizeContribution?.missingClaims ?? 0) > 0 ? ["missing_prize_contribution_coverage"] : [],
    ...(organizerFee?.missingClaims ?? 0) > 0 ? ["missing_organizer_fee_coverage"] : [],
    "single_market_scope_only",
    "not_production_eligible",
  ];
  const readiness: Readonly<Record<PublicCoverageCapabilityKey, PublicCoverageCapabilityReadiness>> = {
    verified_market_explorer: {
      capabilityKey: "verified_market_explorer",
      state: "supported_for_current_exploratory_use",
      reasonCodes: [
        "immutable_release_present",
        "field_and_evidence_coverage_derived",
        ...(hasUnverifiedOnlyEvidence ? ["all_public_evidence_unverified"] : []),
      ],
    },
    comparable_event_engine_v0: {
      capabilityKey: "comparable_event_engine_v0",
      state: basicComparableFields && entries?.presentClaims === counts.events
        ? "supported_for_current_exploratory_use"
        : "blocked_missing_required_fields",
      reasonCodes: [
        ...(basicComparableFields ? ["required_comparable_fields_available"] : ["missing_required_comparable_fields"]),
        ...(hasUnverifiedOnlyEvidence ? ["all_public_evidence_unverified"] : []),
        "exploratory_only",
      ],
    },
    historical_gtd_stress: {
      capabilityKey: "historical_gtd_stress",
      state: counts.gtdStressEligibleEvents > 0 ? "partially_supported" : "blocked_missing_required_fields",
      reasonCodes: [
        ...(counts.gtdStressEligibleEvents > 0 ? ["constant_contribution_inputs_available_for_some_events"] : ["no_compatible_gtd_and_prize_contribution"]),
        ...(gtd?.missingClaims ?? 0) > 0 ? ["missing_gtd_coverage"] : [],
        ...(prizeContribution?.missingClaims ?? 0) > 0 ? ["missing_prize_contribution_coverage"] : [],
        ...(hasUnverifiedOnlyEvidence ? ["all_public_evidence_unverified"] : []),
        "historical_scenario_only",
      ],
    },
    ridge_challenger: {
      capabilityKey: "ridge_challenger",
      state: entries?.presentClaims === 0 ? "blocked_missing_required_fields" : "partially_supported",
      reasonCodes: modelReasons,
    },
    negative_binomial_challenger: {
      capabilityKey: "negative_binomial_challenger",
      state: entries?.presentClaims === 0 ? "blocked_missing_required_fields" : "partially_supported",
      reasonCodes: modelReasons,
    },
    tabpfn_challenger: {
      capabilityKey: "tabpfn_challenger",
      state: entries?.presentClaims === 0 ? "blocked_missing_required_fields" : "partially_supported",
      reasonCodes: [...modelReasons, "checkpoint_and_license_gate_required"],
    },
    registration_curve_nowcasting: {
      capabilityKey: "registration_curve_nowcasting",
      state: "blocked_missing_time_series",
      reasonCodes: ["registration_timestamp_curves_are_private_and_absent", "no_completed_registration_curves"],
    },
    causal_intervention_analysis: {
      capabilityKey: "causal_intervention_analysis",
      state: "blocked_missing_required_fields",
      reasonCodes: ["no_intervention_design", "no_treatment_timing", "no_private_decision_or_action_log"],
    },
    cross_market_evaluation: {
      capabilityKey: "cross_market_evaluation",
      state: "blocked_insufficient_market_diversity",
      reasonCodes: ["single_market_release_only", "no_compatible_cross_market_corpus", "fx_conversion_forbidden"],
    },
    production_forecast_eligibility: {
      capabilityKey: "production_forecast_eligibility",
      state: "not_production_eligible",
      reasonCodes: [
        ...(hasUnverifiedOnlyEvidence ? ["all_public_evidence_unverified"] : []),
        "no_calibration_evidence",
        "no_private_prospective_shadow",
        "no_cross_market_validation",
      ],
    },
  };
  return CAPABILITY_ORDER.map((key) => deepFreeze({
    ...readiness[key],
    reasonCodes: sortedUniqueReferences(readiness[key].reasonCodes, `${key}.reasonCodes`),
  }));
}

function priorityGaps(fields: readonly PublicSourceFieldCoverage[], evidence: readonly PublicEvidenceStateCoverage[]): readonly PublicCoveragePriorityGap[] {
  const missing = (field: string): boolean => (fieldCoverageByKey(fields, "event", field)?.missingClaims ?? 0) > 0;
  const evidenceUnverified = evidence.some((row) => row.status === "unverified" && row.claimCount > 0);
  return [
    {
      priority: "P0",
      categoryKey: "evidence_verification",
      fieldKeys: evidenceUnverified ? ["all_current_public_claims"] : [],
      reasonCodes: evidenceUnverified ? ["all_public_evidence_unverified"] : ["no_unverified_evidence_detected"],
    },
    {
      priority: "P0",
      categoryKey: "historical_gtd_stress_inputs",
      fieldKeys: ["gtd", "buy_in_prize"].filter(missing),
      reasonCodes: [
        ...(missing("gtd") ? ["missing_gtd_coverage"] : []),
        ...(missing("buy_in_prize") ? ["missing_prize_contribution_coverage"] : []),
      ],
    },
    {
      priority: "P1",
      categoryKey: "event_economics_coverage",
      fieldKeys: missing("organizer_fee") ? ["organizer_fee"] : [],
      reasonCodes: missing("organizer_fee") ? ["missing_organizer_fee_coverage"] : [],
    },
    {
      priority: "P2",
      categoryKey: "market_diversity",
      fieldKeys: [],
      reasonCodes: ["separate_market_releases_required_before_cross_market_evaluation"],
    },
  ].map((gap) => deepFreeze({
    ...gap,
    fieldKeys: [...gap.fieldKeys].sort(compareCanonicalStrings),
    reasonCodes: [...gap.reasonCodes].sort(compareCanonicalStrings),
  }));
}

async function createPlannedRelease(
  releaseKey: PlannedMarketRelease["releaseKey"],
  marketKey: string,
  scopeKind: PublicMarketScopeKind,
  scopeDefinition: string,
): Promise<PlannedMarketRelease> {
  const content = {
    releaseKey,
    marketKey,
    scopeKind,
    scopeDefinition,
    allowedMarketKeys: [marketKey],
    compatibilityRules: [
      "each_market_dataset_release_contains_one_market_scope",
      "preserve_explicit_currency_values",
      "no_fx_conversion",
      "append_only_corrections_use_superseding_claims_or_a_new_release",
    ],
  } as const;
  const hash = await canonicalHash(content);
  return deepFreeze({
    releasePlanId: `${PUBLIC_SOURCE_COVERAGE_NAMESPACE}:market-release-plan:${hash}`,
    ...content,
  });
}

async function createMarketReleasePlan(release: DatasetRelease): Promise<PublicMarketReleasePlan> {
  const plannedReleases = await Promise.all([
    createPlannedRelease("jeju-v2", "jeju", "defined_market", "Jeju-only public live-poker event corpus."),
    createPlannedRelease("vietnam-v1", "vietnam", "country", "Vietnam public live-poker event corpus."),
    createPlannedRelease("sea-v1", "sea", "defined_market", "Defined Southeast Asia public market corpus; no implied country relabeling."),
  ]);
  const immutableConstituentReleaseIds = [canonicalReference(release.id, "release.id")];
  const crossMarketContent = {
    releaseKey: "cross-market-corpus-v1" as const,
    immutableConstituentReleaseIds,
    requiredConstituentReleaseKeys: ["jeju-v2", "vietnam-v1", "sea-v1"] as const,
    state: "not_created" as const,
    reasonCodes: ["vietnam_v1_not_created", "sea_v1_not_created", "cross_market_compatibility_not_yet_established"],
    compatibilityRules: [
      "reference_immutable_market_release_ids_only",
      "preserve_market_identity_and_scope_kind",
      "no_fx_conversion",
      "cross_market_evaluation_requires_leave_one_market_out",
    ],
  };
  const crossMarketHash = await canonicalHash(crossMarketContent);
  return deepFreeze({
    plannedReleases: plannedReleases.sort((left, right) => compareCanonicalStrings(left.releaseKey, right.releaseKey)),
    crossMarketCorpus: {
      releasePlanId: `${PUBLIC_SOURCE_COVERAGE_NAMESPACE}:cross-market-corpus-plan:${crossMarketHash}`,
      ...crossMarketContent,
    },
  });
}

export async function createPublicSourceCoverageArtifact(
  input: PublicSourceCoverageInput,
): Promise<PublicSourceCoverageArtifact> {
  const scope = normalizeScope(input.scope);
  const entities = normalizeEntities(input.entities);
  const claims = validateClaimSupersession(input.claims);
  validateReleaseReferences(input.release, scope, entities, claims);
  const conflicts = normalizeConflicts(input.conflicts);
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  for (const conflict of conflicts) {
    const entity = entityById.get(conflict.entityId);
    if (!entity || entity.entityType !== conflict.entityType) {
      fail("conflict references an unknown entity", "UNKNOWN_PUBLIC_COVERAGE_CONFLICT_ENTITY");
    }
    for (const claimId of conflict.claimIds) {
      if (!claims.some((claim) => claim.id === claimId)) {
        fail("conflict references a claim outside the immutable release", "UNKNOWN_PUBLIC_COVERAGE_CONFLICT_CLAIM");
      }
    }
  }

  const resolved = groupResolvedFields(claims);
  const fieldCoverage = buildFieldCoverage(claims, conflicts);
  const evidenceStateCoverage = STATUS_ORDER
    .map((status) => ({ status, claimCount: claims.filter((claim) => claim.status === status).length }))
    .filter((row) => row.claimCount > 0)
    .map((row) => deepFreeze(row));
  const eventIds = entities.filter((entity) => entity.entityType === "event").map((entity) => entity.id);
  const counts: PublicSourceCoverageCounts = deepFreeze({
    festivals: entities.filter((entity) => entity.entityType === "festival").length,
    events: eventIds.length,
    entities: entities.length,
    totalClaims: claims.length,
    presentClaims: claims.filter((claim) => claim.value.type !== "missing").length,
    missingClaims: claims.filter((claim) => claim.value.type === "missing").length,
    conflictingClaims: claims.filter((claim) => claim.status === "conflicting").length,
    conflictGroups: conflicts.length,
    entriesOutcomeAvailableEvents: eventIds.filter((eventId) =>
      resolved.get(conflictKey("event", eventId, "entries"))?.state === "resolved",
    ).length,
    gtdStressEligibleEvents: eventIds.filter((eventId) => isGtdStressEligible(eventId, resolved)).length,
  });
  const capabilityReadinessRows = capabilityReadiness(counts, fieldCoverage, evidenceStateCoverage);
  const priorityGapsRows = priorityGaps(fieldCoverage, evidenceStateCoverage);
  const marketReleasePlan = await createMarketReleasePlan(input.release);
  const content = {
    contractVersion: PUBLIC_SOURCE_COVERAGE_CONTRACT_VERSION,
    artifactType: "public-source-coverage" as const,
    artifactSchemaVersion: "v1" as const,
    releaseId: input.release.id,
    marketKey: input.release.marketKey,
    sourceCutoff: input.release.sourceCutoff,
    scope,
    counts,
    fieldCoverage,
    evidenceStateCoverage,
    capabilityReadiness: capabilityReadinessRows,
    priorityGaps: priorityGapsRows,
    marketReleasePlan,
    privateFieldsExcluded: [...PUBLIC_SOURCE_COVERAGE_PRIVATE_FIELD_KEYS],
    limitations: [
      "Public evidence remains descriptive and unverified unless a later release carries stronger evidence status.",
      "This audit does not ingest data, generate a forecast, estimate a probability, optimize a decision, or recommend an action.",
      "Explicit zero remains present evidence and is never treated as missing evidence.",
      "Cross-market analysis remains unavailable until separately scoped immutable releases and compatibility rules exist.",
    ],
  };
  const contentHash = await canonicalHash(content);
  return deepFreeze({
    artifactId: `${PUBLIC_SOURCE_COVERAGE_NAMESPACE}:artifact:${contentHash}`,
    ...content,
    contentHash,
  });
}

export async function createPublicSourceCoverageReceipt(input: {
  readonly artifact: PublicSourceCoverageArtifact;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
}): Promise<PublicSourceCoverageReceipt> {
  const artifactPath = canonicalReference(input.artifactPath, "artifactPath");
  const artifactFileSha256 = input.artifactFileSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(artifactFileSha256)) {
    fail("artifactFileSha256 must be a SHA-256 digest", "INVALID_PUBLIC_COVERAGE_FILE_SHA256");
  }
  const content = {
    artifactId: canonicalReference(input.artifact.artifactId, "artifact.artifactId"),
    artifactContentHash: canonicalReference(input.artifact.contentHash, "artifact.contentHash"),
    artifactPath,
    artifactFileSha256,
  };
  const receiptHash = await canonicalHash(content);
  return deepFreeze({
    receiptId: `${PUBLIC_SOURCE_COVERAGE_NAMESPACE}:receipt:${receiptHash}`,
    contractVersion: PUBLIC_SOURCE_COVERAGE_CONTRACT_VERSION,
    ...content,
  });
}
