import { canonicalize } from "../series-intelligence/provenanceHash";
import {
  resolveSourceClaims,
  SERIES_MARKET_CONTRACT_VERSION,
  type DatasetRelease,
  type SourceClaim,
  validateSourceClaim,
} from "./contracts";
import {
  COMPARABLE_DISTRIBUTION_METHOD_ID,
  COMPARABLE_SELECTION_PROTOCOL_ID,
  COMPARABLE_TAXONOMY_VERSION,
} from "./comparableEvent";
import {
  COMPARABLE_V0_ARTIFACT_SCHEMA_VERSION,
  COMPARABLE_V0_ARTIFACT_TYPE,
  COMPARABLE_V0_FEATURE_SCHEMA_ID,
  COMPARABLE_V0_FOLD_PROTOCOL_ID,
  COMPARABLE_V0_OUTCOME_DEFINITION_ID,
  COMPARABLE_V0_RESEARCH_METHOD_ID,
  COMPARABLE_V0_RESEARCH_METHOD_VERSION,
  type ComparableV0ResearchBundle,
  type FoldPrediction,
  validateComparableV0Parameters,
} from "./comparableResearchArtifact";
import {
  createGtdStressScenario,
  GTD_STRESS_CALCULATION_PROTOCOL_ID,
  GTD_STRESS_CALCULATION_PROTOCOL_VERSION,
  type GtdStressMoneyEvidenceInput,
  type GtdStressResult,
} from "./gtdStress";
import { createDatasetReleaseId, createSourceClaimId } from "./identity";
import {
  compareCanonicalStrings,
  SeriesMarketValidationError,
} from "./normalization";
import { validateResearchArtifactGraph } from "./researchArtifact";
import type { ResearchRecordGraph } from "./researchRun";
import { VERIFIED_JEJU_RELEASE_ID } from "./verifiedMarketReadModel";

export const GTD_STRESS_COMPARABLE_ADAPTER_VERSION = "v1" as const;

export interface GtdStressComparableAdapterInput {
  readonly bundle: ComparableV0ResearchBundle;
  readonly datasetRelease: DatasetRelease;
  readonly targetEventId: string;
  readonly foldId: string;
  readonly gtdClaims: readonly SourceClaim[];
  readonly prizeContributionClaims: readonly SourceClaim[];
}

export interface GtdStressTrustedFoldProvenance {
  readonly sourceArtifactId: string;
  readonly datasetReleaseId: string;
  readonly sourceCutoff: string;
  readonly foldId: string;
  readonly targetEventId: string;
  readonly evaluationProtocolId: FoldPrediction["evaluationProtocolId"];
  readonly availabilityState: FoldPrediction["availabilityState"];
  readonly failureState: FoldPrediction["failureState"];
  readonly selectionProtocolId: typeof COMPARABLE_SELECTION_PROTOCOL_ID;
  readonly distributionMethodId: typeof COMPARABLE_DISTRIBUTION_METHOD_ID;
}

export interface GtdStressFromComparableArtifactResult {
  readonly adapterVersion: typeof GTD_STRESS_COMPARABLE_ADAPTER_VERSION;
  readonly provenance: GtdStressTrustedFoldProvenance;
  readonly scenario: GtdStressResult;
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

function normalizeReference(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 512) {
    fail(`${label} must be a non-blank canonical reference`, "INVALID_GTD_STRESS_ADAPTER_REFERENCE");
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) {
      fail(`${label} contains a forbidden control character`, "INVALID_GTD_STRESS_ADAPTER_REFERENCE");
    }
  }
  return value;
}

function assertUniqueReferences(values: readonly string[], label: string): readonly string[] {
  if (values.length === 0) fail(`${label} must not be empty`, "GTD_STRESS_ADAPTER_REFERENCES_REQUIRED");
  const normalized = values.map((value) => normalizeReference(value, label));
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    fail(`${label} contains duplicate references`, "DUPLICATE_GTD_STRESS_ADAPTER_REFERENCE");
  }
  return normalized.sort(compareCanonicalStrings);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function researchGraph(bundle: ComparableV0ResearchBundle): ResearchRecordGraph {
  return {
    inputSliceManifests: [bundle.inputSliceManifest],
    outcomeExclusionManifests: [bundle.outcomeExclusionManifest],
    informationSets: [bundle.informationSet],
    definitions: [bundle.researchDefinition],
    executions: [bundle.researchExecution],
    challenges: [],
    supersessions: [],
  };
}

async function validateDatasetRelease(release: DatasetRelease): Promise<void> {
  if (
    release.contractVersion !== SERIES_MARKET_CONTRACT_VERSION
    || release.marketKey !== "jeju"
    || release.id !== VERIFIED_JEJU_RELEASE_ID
    || release.parentReleaseId !== null
  ) {
    fail("dataset release is not the locked Jeju V1 release", "GTD_STRESS_DATASET_RELEASE_MISMATCH");
  }
  const entityIds = assertUniqueReferences(release.entityIds, "datasetRelease.entityIds");
  const claimIds = assertUniqueReferences(release.claimIds, "datasetRelease.claimIds");
  const sourceRevisionIds = assertUniqueReferences(
    release.sourceRevisionIds,
    "datasetRelease.sourceRevisionIds",
  );
  const recomputed = await createDatasetReleaseId({
    marketKey: release.marketKey,
    sourceCutoff: release.sourceCutoff,
    entityIds,
    claimIds,
    sourceRevisionIds,
  });
  if (recomputed !== release.id) {
    fail("dataset release identity does not match its content", "GTD_STRESS_DATASET_RELEASE_INTEGRITY_MISMATCH");
  }
}

function assertComparableContract(bundle: ComparableV0ResearchBundle): void {
  const { artifact, researchDefinition, researchExecution } = bundle;
  const { payload } = artifact;
  if (
    artifact.artifactType !== COMPARABLE_V0_ARTIFACT_TYPE
    || artifact.artifactSchemaVersion !== COMPARABLE_V0_ARTIFACT_SCHEMA_VERSION
    || artifact.determinismLevel !== "exact"
  ) {
    fail("artifact is not a locked Comparable V0 exact artifact", "GTD_STRESS_COMPARABLE_ARTIFACT_MISMATCH");
  }
  if (
    payload.label !== "Historical Benchmark"
    || payload.methodId !== COMPARABLE_V0_RESEARCH_METHOD_ID
    || payload.methodVersion !== COMPARABLE_V0_RESEARCH_METHOD_VERSION
    || payload.modelCard.modelName !== "Comparable Event Engine V0"
    || payload.modelCard.methodId !== COMPARABLE_V0_RESEARCH_METHOD_ID
    || payload.modelCard.methodVersion !== COMPARABLE_V0_RESEARCH_METHOD_VERSION
    || payload.modelCard.selectionProtocolId !== COMPARABLE_SELECTION_PROTOCOL_ID
    || payload.modelCard.taxonomyVersion !== COMPARABLE_TAXONOMY_VERSION
    || payload.modelCard.distributionMethodId !== COMPARABLE_DISTRIBUTION_METHOD_ID
    || payload.modelCard.status !== "exploratory"
    || payload.modelCard.calibrated !== false
    || payload.modelCard.productionForecast !== false
    || payload.modelCard.causalInterpretation !== false
  ) {
    fail("Comparable V0 payload or model card is not locked", "GTD_STRESS_COMPARABLE_METHOD_MISMATCH");
  }
  if (
    researchDefinition.methodId !== COMPARABLE_V0_RESEARCH_METHOD_ID
    || researchDefinition.methodVersion !== COMPARABLE_V0_RESEARCH_METHOD_VERSION
    || researchDefinition.featureSchemaId !== COMPARABLE_V0_FEATURE_SCHEMA_ID
    || researchDefinition.foldProtocolId !== COMPARABLE_V0_FOLD_PROTOCOL_ID
    || researchDefinition.outcomeDefinitionId !== COMPARABLE_V0_OUTCOME_DEFINITION_ID
    || researchExecution.determinismLevel !== "exact"
  ) {
    fail("Comparable V0 definition or execution is not locked", "GTD_STRESS_COMPARABLE_DEFINITION_MISMATCH");
  }
  const normalizedParameters = validateComparableV0Parameters(payload.parameters);
  if (canonicalize(normalizedParameters) !== canonicalize(researchDefinition.parameters)) {
    fail("artifact and definition parameters differ", "GTD_STRESS_COMPARABLE_PARAMETER_MISMATCH");
  }
}

function assertReleaseLinkage(
  bundle: ComparableV0ResearchBundle,
  release: DatasetRelease,
): void {
  const { artifact, inputSliceManifest, outcomeExclusionManifest, informationSet, researchDefinition } = bundle;
  const releaseIds = [release.id];
  if (
    artifact.payload.datasetReleaseId !== release.id
    || artifact.payload.modelCard.datasetReleaseId !== release.id
    || artifact.payload.sourceCutoff !== release.sourceCutoff
    || artifact.payload.modelCard.sourceCutoff !== release.sourceCutoff
    || researchDefinition.sourceCutoff !== release.sourceCutoff
    || informationSet.sourceCutoff !== release.sourceCutoff
    || inputSliceManifest.sourceCutoff !== release.sourceCutoff
    || outcomeExclusionManifest.sourceCutoff !== release.sourceCutoff
    || !sameStrings(researchDefinition.datasetReleaseIds, releaseIds)
    || !sameStrings(informationSet.datasetReleaseIds, releaseIds)
    || !sameStrings(inputSliceManifest.datasetReleaseIds, releaseIds)
    || !sameStrings(outcomeExclusionManifest.datasetReleaseIds, releaseIds)
  ) {
    fail("Comparable graph and dataset release do not match", "GTD_STRESS_COMPARABLE_RELEASE_MISMATCH");
  }
}

async function validateEvidenceClaims(
  claims: readonly SourceClaim[],
  targetEventId: string,
  field: "gtd" | "buy_in_prize",
  release: DatasetRelease,
): Promise<GtdStressMoneyEvidenceInput> {
  if (claims.length === 0) {
    fail(`${field} requires explicit evidence claims`, "GTD_STRESS_EVIDENCE_REQUIRED");
  }
  const claimIds = assertUniqueReferences(claims.map((claim) => claim.id), `${field}.claimIds`);
  const releaseClaimIds = new Set(release.claimIds);
  const releaseEntityIds = new Set(release.entityIds);
  const releaseRevisionIds = new Set(release.sourceRevisionIds);
  for (const claim of claims) {
    validateSourceClaim(claim);
    if (claim.entityType !== "event" || claim.entityId !== targetEventId || claim.field !== field) {
      fail(`${field} claim does not belong to the target event`, "GTD_STRESS_EVIDENCE_TARGET_MISMATCH");
    }
    if (!releaseEntityIds.has(claim.entityId) || !releaseClaimIds.has(claim.id)) {
      fail(`${field} claim is not a member of the dataset release`, "GTD_STRESS_EVIDENCE_RELEASE_MISMATCH");
    }
    if (claim.sourceRevisionId !== null && !releaseRevisionIds.has(claim.sourceRevisionId)) {
      fail(`${field} claim source revision is not in the dataset release`, "GTD_STRESS_EVIDENCE_RELEASE_MISMATCH");
    }
    if (
      claim.observedAt > release.sourceCutoff
      || (claim.effectiveAt !== null && claim.effectiveAt > release.sourceCutoff)
    ) {
      fail(`${field} claim is after the release cutoff`, "GTD_STRESS_EVIDENCE_AFTER_CUTOFF");
    }
    const recomputedClaimId = await createSourceClaimId({
      entityId: claim.entityId,
      field: claim.field,
      value: claim.value,
      sourceRevisionId: claim.sourceRevisionId,
      effectiveAt: claim.effectiveAt,
    });
    if (recomputedClaimId !== claim.id) {
      fail(`${field} claim identity does not match its content`, "GTD_STRESS_EVIDENCE_IDENTITY_MISMATCH");
    }
    if (claim.status !== "unverified") {
      fail("Jeju V1 evidence status cannot be upgraded", "GTD_STRESS_EVIDENCE_QUALITY_MISMATCH");
    }
  }

  const resolution = resolveSourceClaims(claims);
  if (resolution.state === "conflict") {
    return { state: "conflicting", value: null, claimIds };
  }
  if (resolution.state === "missing") {
    return { state: "missing", value: null, claimIds };
  }
  if (resolution.claim.value.type !== "money") {
    fail(`${field} resolved claim must contain money`, "GTD_STRESS_EVIDENCE_NOT_MONEY");
  }
  if (
    resolution.claim.unit !== null
    && resolution.claim.unit.toUpperCase() !== resolution.claim.value.currency
  ) {
    fail(`${field} claim unit and currency differ`, "GTD_STRESS_EVIDENCE_CURRENCY_MISMATCH");
  }
  return {
    state: "resolved",
    value: {
      minorUnits: resolution.claim.value.minorUnits,
      currency: resolution.claim.value.currency,
      scale: resolution.claim.value.scale,
    },
    claimIds,
  };
}

function selectFold(
  bundle: ComparableV0ResearchBundle,
  foldId: string,
  targetEventId: string,
): FoldPrediction {
  const matches = bundle.artifact.payload.foldPredictions.filter((fold) => fold.foldId === foldId);
  if (matches.length !== 1) {
    fail("foldId must identify exactly one artifact fold", "GTD_STRESS_FOLD_CARDINALITY_MISMATCH");
  }
  const fold = matches[0];
  if (
    fold.targetEventId !== targetEventId
    || !bundle.researchDefinition.targetEntityIds.includes(targetEventId)
  ) {
    fail("selected fold does not match the target event", "GTD_STRESS_FOLD_TARGET_MISMATCH");
  }
  const available = fold.availabilityState === "available";
  if (
    (available && (fold.historicalQuantiles === null || fold.failureState !== null))
    || (!available && (fold.historicalQuantiles !== null || fold.failureState === null))
  ) {
    fail("selected fold availability fields are inconsistent", "GTD_STRESS_FOLD_AVAILABILITY_MISMATCH");
  }
  return fold;
}

export async function createGtdStressScenarioFromComparableArtifact(
  input: GtdStressComparableAdapterInput,
): Promise<GtdStressFromComparableArtifactResult> {
  const targetEventId = normalizeReference(input.targetEventId, "targetEventId");
  const foldId = normalizeReference(input.foldId, "foldId");
  await validateResearchArtifactGraph({
    artifact: input.bundle.artifact,
    researchGraph: researchGraph(input.bundle),
  });
  await validateDatasetRelease(input.datasetRelease);
  assertComparableContract(input.bundle);
  assertReleaseLinkage(input.bundle, input.datasetRelease);
  const fold = selectFold(input.bundle, foldId, targetEventId);
  const gtd = await validateEvidenceClaims(
    input.gtdClaims,
    targetEventId,
    "gtd",
    input.datasetRelease,
  );
  const prizeContributionPerEntry = await validateEvidenceClaims(
    input.prizeContributionClaims,
    targetEventId,
    "buy_in_prize",
    input.datasetRelease,
  );
  if (
    gtd.state === "resolved"
    && prizeContributionPerEntry.state === "resolved"
    && gtd.value?.currency !== prizeContributionPerEntry.value?.currency
  ) {
    fail("GTD and prize contribution currencies differ", "GTD_STRESS_EVIDENCE_CURRENCY_MISMATCH");
  }
  const resolvedGtd = resolveSourceClaims(input.gtdClaims);
  if (
    gtd.state === "resolved"
    && (
      resolvedGtd.state !== "resolved"
      || !fold.inputClaimIds.includes(resolvedGtd.claim.id)
    )
  ) {
    fail("selected fold does not reference the resolved GTD evidence", "GTD_STRESS_FOLD_EVIDENCE_MISMATCH");
  }

  const scenario = await createGtdStressScenario({
    targetEventId,
    sourceArtifactId: input.bundle.artifact.artifactId,
    comparableProvenance: {
      comparableAnalysisId: fold.foldId,
      selectionProtocolId: input.bundle.artifact.payload.modelCard.selectionProtocolId,
      distributionMethodId: input.bundle.artifact.payload.modelCard.distributionMethodId,
    },
    gtd,
    prizeContributionPerEntry,
    historicalComparableQuantiles: fold.historicalQuantiles,
    evidenceQuality: "unverified",
    calculationProtocolId: GTD_STRESS_CALCULATION_PROTOCOL_ID,
    calculationProtocolVersion: GTD_STRESS_CALCULATION_PROTOCOL_VERSION,
  });

  return deepFreeze({
    adapterVersion: GTD_STRESS_COMPARABLE_ADAPTER_VERSION,
    provenance: {
      sourceArtifactId: input.bundle.artifact.artifactId,
      datasetReleaseId: input.datasetRelease.id,
      sourceCutoff: input.datasetRelease.sourceCutoff,
      foldId: fold.foldId,
      targetEventId: fold.targetEventId,
      evaluationProtocolId: fold.evaluationProtocolId,
      availabilityState: fold.availabilityState,
      failureState: fold.failureState,
      selectionProtocolId: COMPARABLE_SELECTION_PROTOCOL_ID,
      distributionMethodId: COMPARABLE_DISTRIBUTION_METHOD_ID,
    },
    scenario,
  });
}
