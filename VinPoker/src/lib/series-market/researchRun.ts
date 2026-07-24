import { canonicalHash, canonicalize } from "../series-intelligence/provenanceHash";
import {
  SERIES_MARKET_NAMESPACE,
  type CanonicalParameterValue,
} from "./contracts";
import {
  compareCanonicalStrings,
  normalizeInstant,
  normalizeIntegerString,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";

export const SERIES_MARKET_RESEARCH_CONTRACT_VERSION = "v1" as const;
export const SERIES_MARKET_RESEARCH_NAMESPACE =
  `${SERIES_MARKET_NAMESPACE}:research:${SERIES_MARKET_RESEARCH_CONTRACT_VERSION}` as const;

export type SeriesMarketResearchContractVersion = typeof SERIES_MARKET_RESEARCH_CONTRACT_VERSION;
export type DeterminismLevel = "exact" | "seeded" | "statistical";
export type InputSliceMemberKind = "claim_id" | "row_hash";

export interface InputSliceManifestInput {
  readonly datasetReleaseIds: readonly string[];
  readonly sourceCutoff: string;
  readonly memberKind: InputSliceMemberKind;
  readonly memberIds: readonly string[];
  readonly rowCount: number;
}

export interface InputSliceManifest {
  readonly inputSliceManifestId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly datasetReleaseIds: readonly string[];
  readonly sourceCutoff: string;
  readonly memberKind: InputSliceMemberKind;
  readonly memberIds: readonly string[];
  readonly memberCount: number;
  readonly rowCount: number;
  readonly contentHash: string;
}

export interface OutcomeExclusionManifestInput {
  readonly datasetReleaseIds: readonly string[];
  readonly sourceCutoff: string;
  readonly outcomeClaimIds: readonly string[];
}

export interface OutcomeExclusionManifest {
  readonly outcomeExclusionManifestId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly datasetReleaseIds: readonly string[];
  readonly sourceCutoff: string;
  readonly outcomeClaimIds: readonly string[];
  readonly outcomeCount: number;
  readonly contentHash: string;
}

export interface ForecastOriginInformationSetInput {
  readonly inputSliceManifest: InputSliceManifest;
  readonly outcomeExclusionManifest: OutcomeExclusionManifest;
  readonly featureSchemaId: string;
}

export interface ForecastOriginInformationSet {
  readonly informationSetId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly datasetReleaseIds: readonly string[];
  readonly sourceCutoff: string;
  readonly inputSliceManifestId: string;
  readonly outcomeExclusionManifestId: string;
  readonly featureSchemaId: string;
}

export interface ResearchDefinitionInput {
  readonly questionKey: string;
  readonly informationSet: ForecastOriginInformationSet;
  readonly targetEntityIds: readonly string[];
  readonly methodId: string;
  readonly methodVersion: string;
  readonly foldProtocolId: string;
  readonly outcomeDefinitionId: string;
  readonly parameters: CanonicalParameterValue;
  readonly displayLabel?: string | null;
  readonly notes?: string | null;
}

export interface ResearchDefinition {
  readonly researchDefinitionId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly questionKey: string;
  readonly datasetReleaseIds: readonly string[];
  readonly sourceCutoff: string;
  readonly informationSetId: string;
  readonly inputSliceManifestId: string;
  readonly targetEntityIds: readonly string[];
  readonly methodId: string;
  readonly methodVersion: string;
  readonly featureSchemaId: string;
  readonly foldProtocolId: string;
  readonly outcomeDefinitionId: string;
  readonly parameters: CanonicalParameterValue;
  readonly displayLabel: string | null;
  readonly notes: string | null;
}

export interface ResearchEnvironmentFingerprintInput {
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly cpu: string | null;
  readonly gpu: string | null;
  readonly threadCount: number;
  readonly modelCheckpointId: string | null;
  readonly modelCheckpointHash: string | null;
}

export interface ResearchEnvironmentFingerprint {
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly cpu: string | null;
  readonly gpu: string | null;
  readonly threadCount: number;
  readonly modelCheckpointId: string | null;
  readonly modelCheckpointHash: string | null;
}

export type ResearchSeedPolicyInput =
  | { readonly kind: "none" }
  | { readonly kind: "fixed"; readonly seed: string }
  | { readonly kind: "recorded"; readonly seeds: readonly string[] };

export type ResearchSeedPolicy =
  | { readonly kind: "none" }
  | { readonly kind: "fixed"; readonly seed: string }
  | { readonly kind: "recorded"; readonly seeds: readonly string[] };

export interface ResearchExecutionInput {
  readonly researchDefinition: ResearchDefinition;
  readonly codeSha: string;
  readonly dependencyLockHash: string | null;
  readonly environment: ResearchEnvironmentFingerprintInput;
  readonly seedPolicy: ResearchSeedPolicyInput;
  readonly determinismLevel: DeterminismLevel;
  readonly executedAt: string;
}

export interface ResearchExecution {
  readonly executionId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly researchDefinitionId: string;
  readonly codeSha: string;
  readonly dependencyLockHash: string | null;
  readonly environment: ResearchEnvironmentFingerprint;
  readonly seedPolicy: ResearchSeedPolicy;
  readonly determinismLevel: DeterminismLevel;
  readonly executedAt: string;
}

export interface ResearchChallengeInput {
  readonly targetExecutionId: string;
  readonly challengeType: string;
  readonly evidenceIds: readonly string[];
  readonly createdAt: string;
  readonly note: string;
}

export interface ResearchChallenge {
  readonly challengeId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly targetExecutionId: string;
  readonly challengeType: string;
  readonly evidenceIds: readonly string[];
  readonly createdAt: string;
  readonly note: string;
}

export interface ResearchSupersessionInput {
  readonly supersedingExecutionId: string;
  readonly supersededExecutionId: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface ResearchSupersession {
  readonly supersessionId: string;
  readonly contractVersion: SeriesMarketResearchContractVersion;
  readonly supersedingExecutionId: string;
  readonly supersededExecutionId: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface ResearchRecordGraph {
  readonly inputSliceManifests: readonly InputSliceManifest[];
  readonly outcomeExclusionManifests: readonly OutcomeExclusionManifest[];
  readonly informationSets: readonly ForecastOriginInformationSet[];
  readonly definitions: readonly ResearchDefinition[];
  readonly executions: readonly ResearchExecution[];
  readonly challenges: readonly ResearchChallenge[];
  readonly supersessions: readonly ResearchSupersession[];
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

function containsForbiddenControl(value: string, allowTextWhitespace: boolean): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 127) return true;
    if (code < 32 && !(allowTextWhitespace && (code === 9 || code === 10 || code === 13))) return true;
  }
  return false;
}

function normalizeReferenceId(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 512 || containsForbiddenControl(value, false)) {
    fail(`${label} must be a non-blank canonical reference`, "INVALID_RESEARCH_REFERENCE");
  }
  return value;
}

function normalizeRequiredText(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 4096 || containsForbiddenControl(value, true)) {
    fail(`${label} must be non-blank text`, "INVALID_RESEARCH_TEXT");
  }
  return value;
}

function normalizeOptionalText(raw: string | null | undefined, label: string): string | null {
  if (raw === null || raw === undefined) return null;
  return normalizeRequiredText(raw, label);
}

function normalizeSha256(raw: string, label: string): string {
  const value = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) fail(`${label} must be a SHA-256 digest`, "INVALID_RESEARCH_SHA256");
  return value;
}

function normalizeCodeSha(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    fail("codeSha must be a full 40- or 64-character git digest", "INVALID_RESEARCH_CODE_SHA");
  }
  return value;
}

function normalizeCount(raw: number, label: string, allowZero: boolean): number {
  if (!Number.isSafeInteger(raw) || raw < (allowZero ? 0 : 1)) {
    fail(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`, "INVALID_RESEARCH_COUNT");
  }
  return raw;
}

function canonicalUniqueReferences(
  rawValues: readonly string[],
  label: string,
  allowEmpty = false,
): readonly string[] {
  if (!allowEmpty && rawValues.length === 0) fail(`${label} must not be empty`, "RESEARCH_REFERENCES_REQUIRED");
  const values = rawValues.map((value) => normalizeReferenceId(value, label));
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains a duplicate after normalization`, "DUPLICATE_RESEARCH_REFERENCE");
    seen.add(value);
  }
  return values.sort(compareCanonicalStrings);
}

function canonicalUniqueHashes(rawValues: readonly string[], label: string): readonly string[] {
  if (rawValues.length === 0) fail(`${label} must not be empty`, "RESEARCH_REFERENCES_REQUIRED");
  const values = rawValues.map((value) => normalizeSha256(value, label));
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${label} contains a duplicate after normalization`, "DUPLICATE_RESEARCH_REFERENCE");
    seen.add(value);
  }
  return values.sort(compareCanonicalStrings);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeParameters(parameters: CanonicalParameterValue): CanonicalParameterValue {
  const forbiddenOutcomeKeys = new Set([
    "actual",
    "actualentries",
    "actualvalue",
    "finalentries",
    "observedoutcome",
    "outcomevalue",
    "realizedoutcome",
    "targetvalue",
  ]);

  const visit = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("research parameters require finite numbers", "INVALID_RESEARCH_PARAMETERS");
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      fail("research parameters must contain plain canonical values", "INVALID_RESEARCH_PARAMETERS");
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.normalize("NFC").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbiddenOutcomeKeys.has(normalizedKey)) {
        fail("actual outcome values cannot be research definition parameters", "RESEARCH_OUTCOME_LEAKAGE");
      }
      visit(nested);
    }
  };

  visit(parameters);
  try {
    return JSON.parse(canonicalize(parameters)) as CanonicalParameterValue;
  } catch {
    fail("research parameters are not canonically serializable", "INVALID_RESEARCH_PARAMETERS");
  }
}

async function createResearchId(kind: string, payload: Record<string, unknown>): Promise<string> {
  const namespace = `${SERIES_MARKET_RESEARCH_NAMESPACE}:${kind}`;
  const digest = await canonicalHash({
    namespace,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    ...payload,
  });
  return `${namespace}:${digest}`;
}

async function assertInputSliceManifestIntegrity(manifest: InputSliceManifest): Promise<void> {
  const rebuilt = await createInputSliceManifest({
    datasetReleaseIds: manifest.datasetReleaseIds,
    sourceCutoff: manifest.sourceCutoff,
    memberKind: manifest.memberKind,
    memberIds: manifest.memberIds,
    rowCount: manifest.rowCount,
  });
  if (
    rebuilt.inputSliceManifestId !== manifest.inputSliceManifestId
    || rebuilt.contentHash !== manifest.contentHash
  ) {
    fail("input slice manifest identity does not match its content", "INPUT_SLICE_INTEGRITY_MISMATCH");
  }
}

async function assertOutcomeExclusionManifestIntegrity(manifest: OutcomeExclusionManifest): Promise<void> {
  const rebuilt = await createOutcomeExclusionManifest({
    datasetReleaseIds: manifest.datasetReleaseIds,
    sourceCutoff: manifest.sourceCutoff,
    outcomeClaimIds: manifest.outcomeClaimIds,
  });
  if (
    rebuilt.outcomeExclusionManifestId !== manifest.outcomeExclusionManifestId
    || rebuilt.contentHash !== manifest.contentHash
  ) {
    fail("outcome exclusion manifest identity does not match its content", "OUTCOME_MANIFEST_INTEGRITY_MISMATCH");
  }
}

export async function createInputSliceManifest(input: InputSliceManifestInput): Promise<InputSliceManifest> {
  const datasetReleaseIds = canonicalUniqueReferences(input.datasetReleaseIds, "datasetReleaseIds");
  const sourceCutoff = normalizeInstant(input.sourceCutoff);
  if (input.memberKind !== "claim_id" && input.memberKind !== "row_hash") {
    fail("memberKind is unsupported", "INVALID_INPUT_SLICE_MEMBER_KIND");
  }
  const memberIds = input.memberKind === "row_hash"
    ? canonicalUniqueHashes(input.memberIds, "memberIds")
    : canonicalUniqueReferences(input.memberIds, "memberIds");
  const rowCount = normalizeCount(input.rowCount, "rowCount", false);
  const contentHash = await canonicalHash({ memberKind: input.memberKind, memberIds });
  const inputSliceManifestId = await createResearchId("input-slice", {
    datasetReleaseIds,
    sourceCutoff,
    memberKind: input.memberKind,
    contentHash,
    memberCount: memberIds.length,
    rowCount,
  });

  return deepFreeze({
    inputSliceManifestId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    datasetReleaseIds: [...datasetReleaseIds],
    sourceCutoff,
    memberKind: input.memberKind,
    memberIds: [...memberIds],
    memberCount: memberIds.length,
    rowCount,
    contentHash,
  });
}

export async function createOutcomeExclusionManifest(
  input: OutcomeExclusionManifestInput,
): Promise<OutcomeExclusionManifest> {
  const datasetReleaseIds = canonicalUniqueReferences(input.datasetReleaseIds, "datasetReleaseIds");
  const sourceCutoff = normalizeInstant(input.sourceCutoff);
  const outcomeClaimIds = canonicalUniqueReferences(input.outcomeClaimIds, "outcomeClaimIds", true);
  const contentHash = await canonicalHash({ outcomeClaimIds });
  const outcomeExclusionManifestId = await createResearchId("outcome-exclusion", {
    datasetReleaseIds,
    sourceCutoff,
    contentHash,
    outcomeCount: outcomeClaimIds.length,
  });

  return deepFreeze({
    outcomeExclusionManifestId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    datasetReleaseIds: [...datasetReleaseIds],
    sourceCutoff,
    outcomeClaimIds: [...outcomeClaimIds],
    outcomeCount: outcomeClaimIds.length,
    contentHash,
  });
}

export async function createForecastOriginInformationSet(
  input: ForecastOriginInformationSetInput,
): Promise<ForecastOriginInformationSet> {
  await assertInputSliceManifestIntegrity(input.inputSliceManifest);
  await assertOutcomeExclusionManifestIntegrity(input.outcomeExclusionManifest);

  if (!sameStrings(input.inputSliceManifest.datasetReleaseIds, input.outcomeExclusionManifest.datasetReleaseIds)) {
    fail("input and outcome manifests must use the same releases", "INFORMATION_SET_RELEASE_MISMATCH");
  }
  if (input.inputSliceManifest.sourceCutoff !== input.outcomeExclusionManifest.sourceCutoff) {
    fail("input and outcome manifests must use the same cutoff", "INFORMATION_SET_CUTOFF_MISMATCH");
  }
  if (input.inputSliceManifest.memberKind === "claim_id") {
    const excluded = new Set(input.outcomeExclusionManifest.outcomeClaimIds);
    if (input.inputSliceManifest.memberIds.some((id) => excluded.has(id))) {
      fail("an excluded outcome claim is present in the input slice", "RESEARCH_OUTCOME_LEAKAGE");
    }
  }

  const featureSchemaId = normalizeReferenceId(input.featureSchemaId, "featureSchemaId");
  const datasetReleaseIds = [...input.inputSliceManifest.datasetReleaseIds];
  const sourceCutoff = input.inputSliceManifest.sourceCutoff;
  const informationSetId = await createResearchId("information-set", {
    datasetReleaseIds,
    sourceCutoff,
    inputSliceManifestId: input.inputSliceManifest.inputSliceManifestId,
    outcomeExclusionManifestId: input.outcomeExclusionManifest.outcomeExclusionManifestId,
    featureSchemaId,
  });

  return deepFreeze({
    informationSetId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    datasetReleaseIds,
    sourceCutoff,
    inputSliceManifestId: input.inputSliceManifest.inputSliceManifestId,
    outcomeExclusionManifestId: input.outcomeExclusionManifest.outcomeExclusionManifestId,
    featureSchemaId,
  });
}

async function assertInformationSetIntegrity(informationSet: ForecastOriginInformationSet): Promise<void> {
  const datasetReleaseIds = canonicalUniqueReferences(informationSet.datasetReleaseIds, "datasetReleaseIds");
  const sourceCutoff = normalizeInstant(informationSet.sourceCutoff);
  const inputSliceManifestId = normalizeReferenceId(
    informationSet.inputSliceManifestId,
    "inputSliceManifestId",
  );
  const outcomeExclusionManifestId = normalizeReferenceId(
    informationSet.outcomeExclusionManifestId,
    "outcomeExclusionManifestId",
  );
  const featureSchemaId = normalizeReferenceId(informationSet.featureSchemaId, "featureSchemaId");
  const informationSetId = await createResearchId("information-set", {
    datasetReleaseIds,
    sourceCutoff,
    inputSliceManifestId,
    outcomeExclusionManifestId,
    featureSchemaId,
  });

  if (
    informationSet.contractVersion !== SERIES_MARKET_RESEARCH_CONTRACT_VERSION
    || informationSet.informationSetId !== informationSetId
    || !sameStrings(informationSet.datasetReleaseIds, datasetReleaseIds)
    || informationSet.sourceCutoff !== sourceCutoff
    || informationSet.inputSliceManifestId !== inputSliceManifestId
    || informationSet.outcomeExclusionManifestId !== outcomeExclusionManifestId
    || informationSet.featureSchemaId !== featureSchemaId
  ) {
    fail("forecast-origin information-set identity does not match its content", "INFORMATION_SET_INTEGRITY_MISMATCH");
  }
}

export async function createResearchDefinition(input: ResearchDefinitionInput): Promise<ResearchDefinition> {
  await assertInformationSetIntegrity(input.informationSet);
  const questionKey = normalizeStableKey(input.questionKey, "questionKey");
  const targetEntityIds = canonicalUniqueReferences(input.targetEntityIds, "targetEntityIds");
  const methodId = normalizeReferenceId(input.methodId, "methodId");
  const methodVersion = normalizeReferenceId(input.methodVersion, "methodVersion");
  const foldProtocolId = normalizeReferenceId(input.foldProtocolId, "foldProtocolId");
  const outcomeDefinitionId = normalizeReferenceId(input.outcomeDefinitionId, "outcomeDefinitionId");
  const parameters = normalizeParameters(input.parameters);
  const displayLabel = normalizeOptionalText(input.displayLabel, "displayLabel");
  const notes = normalizeOptionalText(input.notes, "notes");

  const identity = {
    questionKey,
    datasetReleaseIds: input.informationSet.datasetReleaseIds,
    sourceCutoff: input.informationSet.sourceCutoff,
    informationSetId: normalizeReferenceId(
      input.informationSet.informationSetId,
      "informationSet.informationSetId",
    ),
    inputSliceManifestId: normalizeReferenceId(
      input.informationSet.inputSliceManifestId,
      "informationSet.inputSliceManifestId",
    ),
    targetEntityIds,
    methodId,
    methodVersion,
    featureSchemaId: normalizeReferenceId(input.informationSet.featureSchemaId, "featureSchemaId"),
    foldProtocolId,
    outcomeDefinitionId,
    parameters,
  };
  const researchDefinitionId = await createResearchId("definition", identity);

  return deepFreeze({
    researchDefinitionId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    ...identity,
    datasetReleaseIds: [...identity.datasetReleaseIds],
    targetEntityIds: [...targetEntityIds],
    displayLabel,
    notes,
  });
}

async function assertResearchDefinitionIntegrity(definition: ResearchDefinition): Promise<void> {
  const questionKey = normalizeStableKey(definition.questionKey, "questionKey");
  const datasetReleaseIds = canonicalUniqueReferences(definition.datasetReleaseIds, "datasetReleaseIds");
  const sourceCutoff = normalizeInstant(definition.sourceCutoff);
  const informationSetId = normalizeReferenceId(definition.informationSetId, "informationSetId");
  const inputSliceManifestId = normalizeReferenceId(definition.inputSliceManifestId, "inputSliceManifestId");
  const targetEntityIds = canonicalUniqueReferences(definition.targetEntityIds, "targetEntityIds");
  const methodId = normalizeReferenceId(definition.methodId, "methodId");
  const methodVersion = normalizeReferenceId(definition.methodVersion, "methodVersion");
  const featureSchemaId = normalizeReferenceId(definition.featureSchemaId, "featureSchemaId");
  const foldProtocolId = normalizeReferenceId(definition.foldProtocolId, "foldProtocolId");
  const outcomeDefinitionId = normalizeReferenceId(definition.outcomeDefinitionId, "outcomeDefinitionId");
  const parameters = normalizeParameters(definition.parameters);
  const researchDefinitionId = await createResearchId("definition", {
    questionKey,
    datasetReleaseIds,
    sourceCutoff,
    informationSetId,
    inputSliceManifestId,
    targetEntityIds,
    methodId,
    methodVersion,
    featureSchemaId,
    foldProtocolId,
    outcomeDefinitionId,
    parameters,
  });

  if (
    definition.contractVersion !== SERIES_MARKET_RESEARCH_CONTRACT_VERSION
    || definition.researchDefinitionId !== researchDefinitionId
    || definition.questionKey !== questionKey
    || !sameStrings(definition.datasetReleaseIds, datasetReleaseIds)
    || definition.sourceCutoff !== sourceCutoff
    || definition.informationSetId !== informationSetId
    || definition.inputSliceManifestId !== inputSliceManifestId
    || !sameStrings(definition.targetEntityIds, targetEntityIds)
    || definition.methodId !== methodId
    || definition.methodVersion !== methodVersion
    || definition.featureSchemaId !== featureSchemaId
    || definition.foldProtocolId !== foldProtocolId
    || definition.outcomeDefinitionId !== outcomeDefinitionId
    || canonicalize(definition.parameters) !== canonicalize(parameters)
  ) {
    fail("research definition identity does not match its content", "RESEARCH_DEFINITION_INTEGRITY_MISMATCH");
  }
}

function normalizeEnvironment(input: ResearchEnvironmentFingerprintInput): ResearchEnvironmentFingerprint {
  const modelCheckpointId = input.modelCheckpointId === null
    ? null
    : normalizeReferenceId(input.modelCheckpointId, "modelCheckpointId");
  const modelCheckpointHash = input.modelCheckpointHash === null
    ? null
    : normalizeSha256(input.modelCheckpointHash, "modelCheckpointHash");
  if ((modelCheckpointId === null) !== (modelCheckpointHash === null)) {
    fail("model checkpoint ID and hash must be supplied together", "MODEL_CHECKPOINT_INCOMPLETE");
  }

  return {
    runtimeName: normalizeStableKey(input.runtimeName, "runtimeName"),
    runtimeVersion: normalizeReferenceId(input.runtimeVersion, "runtimeVersion"),
    platform: normalizeStableKey(input.platform, "platform"),
    architecture: normalizeStableKey(input.architecture, "architecture"),
    cpu: normalizeOptionalText(input.cpu, "cpu"),
    gpu: normalizeOptionalText(input.gpu, "gpu"),
    threadCount: normalizeCount(input.threadCount, "threadCount", false),
    modelCheckpointId,
    modelCheckpointHash,
  };
}

function normalizeSeedPolicy(
  input: ResearchSeedPolicyInput,
  determinismLevel: DeterminismLevel,
): ResearchSeedPolicy {
  if (input.kind === "none") {
    if (determinismLevel !== "exact") {
      fail("seeded/statistical execution requires a recorded seed", "RESEARCH_SEED_REQUIRED");
    }
    return { kind: "none" };
  }
  if (determinismLevel === "exact") {
    fail("exact execution must not carry a random seed", "EXACT_RESEARCH_HAS_SEED");
  }
  if (input.kind === "fixed") {
    const seed = normalizeIntegerString(input.seed);
    if (BigInt(seed) < 0n) fail("seed must be non-negative", "INVALID_RESEARCH_SEED");
    return { kind: "fixed", seed };
  }
  if (input.kind === "recorded") {
    const seeds = canonicalUniqueReferences(
      input.seeds.map((seed) => {
        const normalized = normalizeIntegerString(seed);
        if (BigInt(normalized) < 0n) fail("seed must be non-negative", "INVALID_RESEARCH_SEED");
        return normalized;
      }),
      "seeds",
    );
    return { kind: "recorded", seeds: [...seeds] };
  }
  return fail("seed policy is unsupported", "INVALID_RESEARCH_SEED_POLICY");
}

export async function createResearchExecution(input: ResearchExecutionInput): Promise<ResearchExecution> {
  if (!["exact", "seeded", "statistical"].includes(input.determinismLevel)) {
    fail("determinismLevel is unsupported", "INVALID_DETERMINISM_LEVEL");
  }
  await assertResearchDefinitionIntegrity(input.researchDefinition);
  const researchDefinitionId = normalizeReferenceId(
    input.researchDefinition.researchDefinitionId,
    "researchDefinition.researchDefinitionId",
  );
  const codeSha = normalizeCodeSha(input.codeSha);
  const dependencyLockHash = input.dependencyLockHash === null
    ? null
    : normalizeSha256(input.dependencyLockHash, "dependencyLockHash");
  const environment = normalizeEnvironment(input.environment);
  const seedPolicy = normalizeSeedPolicy(input.seedPolicy, input.determinismLevel);
  const executedAt = normalizeInstant(input.executedAt);
  const identity = {
    researchDefinitionId,
    codeSha,
    dependencyLockHash,
    environment,
    seedPolicy,
    determinismLevel: input.determinismLevel,
    executedAt,
  };
  const executionId = await createResearchId("execution", identity);

  return deepFreeze({
    executionId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    ...identity,
  });
}

export async function createResearchChallenge(input: ResearchChallengeInput): Promise<ResearchChallenge> {
  const targetExecutionId = normalizeReferenceId(input.targetExecutionId, "targetExecutionId");
  const challengeType = normalizeStableKey(input.challengeType, "challengeType");
  const evidenceIds = canonicalUniqueReferences(input.evidenceIds, "evidenceIds");
  const createdAt = normalizeInstant(input.createdAt);
  const note = normalizeRequiredText(input.note, "note");
  const identity = { targetExecutionId, challengeType, evidenceIds, createdAt, note };
  const challengeId = await createResearchId("challenge", identity);

  return deepFreeze({
    challengeId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    ...identity,
    evidenceIds: [...evidenceIds],
  });
}

export async function createResearchSupersession(
  input: ResearchSupersessionInput,
): Promise<ResearchSupersession> {
  const supersedingExecutionId = normalizeReferenceId(input.supersedingExecutionId, "supersedingExecutionId");
  const supersededExecutionId = normalizeReferenceId(input.supersededExecutionId, "supersededExecutionId");
  if (supersedingExecutionId === supersededExecutionId) {
    fail("an execution cannot supersede itself", "SELF_RESEARCH_SUPERSESSION");
  }
  const reason = normalizeRequiredText(input.reason, "reason");
  const createdAt = normalizeInstant(input.createdAt);
  const identity = { supersedingExecutionId, supersededExecutionId, reason, createdAt };
  const supersessionId = await createResearchId("supersession", identity);

  return deepFreeze({
    supersessionId,
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    ...identity,
  });
}

function uniqueRecordsById<T>(
  records: readonly T[],
  getId: (record: T) => string,
  label: string,
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const record of records) {
    const id = normalizeReferenceId(getId(record), `${label}.id`);
    if (indexed.has(id)) fail(`${label} contains duplicate record IDs`, "DUPLICATE_RESEARCH_RECORD");
    indexed.set(id, record);
  }
  return indexed;
}

export async function validateResearchRecordGraph(graph: ResearchRecordGraph): Promise<void> {
  const inputSlices = uniqueRecordsById(
    graph.inputSliceManifests,
    (record) => record.inputSliceManifestId,
    "inputSliceManifests",
  );
  const outcomeMasks = uniqueRecordsById(
    graph.outcomeExclusionManifests,
    (record) => record.outcomeExclusionManifestId,
    "outcomeExclusionManifests",
  );
  const informationSets = uniqueRecordsById(
    graph.informationSets,
    (record) => record.informationSetId,
    "informationSets",
  );
  const definitions = uniqueRecordsById(
    graph.definitions,
    (record) => record.researchDefinitionId,
    "definitions",
  );
  const executions = uniqueRecordsById(
    graph.executions,
    (record) => record.executionId,
    "executions",
  );
  uniqueRecordsById(graph.challenges, (record) => record.challengeId, "challenges");
  uniqueRecordsById(graph.supersessions, (record) => record.supersessionId, "supersessions");

  for (const manifest of graph.inputSliceManifests) await assertInputSliceManifestIntegrity(manifest);
  for (const manifest of graph.outcomeExclusionManifests) {
    await assertOutcomeExclusionManifestIntegrity(manifest);
  }

  for (const informationSet of graph.informationSets) {
    await assertInformationSetIntegrity(informationSet);
    const inputSliceManifest = inputSlices.get(informationSet.inputSliceManifestId);
    const outcomeExclusionManifest = outcomeMasks.get(informationSet.outcomeExclusionManifestId);
    if (!inputSliceManifest || !outcomeExclusionManifest) {
      fail("information set references an unknown manifest", "UNKNOWN_INFORMATION_SET_MANIFEST");
    }
    const rebuilt = await createForecastOriginInformationSet({
      inputSliceManifest,
      outcomeExclusionManifest,
      featureSchemaId: informationSet.featureSchemaId,
    });
    if (rebuilt.informationSetId !== informationSet.informationSetId) {
      fail(
        "forecast-origin information-set identity does not match its graph inputs",
        "INFORMATION_SET_INTEGRITY_MISMATCH",
      );
    }
  }

  for (const execution of graph.executions) {
    const researchDefinition = definitions.get(execution.researchDefinitionId);
    if (!researchDefinition) {
      fail("execution references an unknown research definition", "UNKNOWN_RESEARCH_DEFINITION");
    }
    const rebuilt = await createResearchExecution({
      researchDefinition,
      codeSha: execution.codeSha,
      dependencyLockHash: execution.dependencyLockHash,
      environment: execution.environment,
      seedPolicy: execution.seedPolicy,
      determinismLevel: execution.determinismLevel,
      executedAt: execution.executedAt,
    });
    if (rebuilt.executionId !== execution.executionId) {
      fail("research execution identity does not match its content", "RESEARCH_EXECUTION_INTEGRITY_MISMATCH");
    }
  }

  for (const definition of graph.definitions) {
    await assertResearchDefinitionIntegrity(definition);
    const informationSet = informationSets.get(definition.informationSetId);
    if (!informationSet) {
      fail("definition references an unknown information set", "UNKNOWN_RESEARCH_INFORMATION_SET");
    }
    const rebuilt = await createResearchDefinition({
      questionKey: definition.questionKey,
      informationSet,
      targetEntityIds: definition.targetEntityIds,
      methodId: definition.methodId,
      methodVersion: definition.methodVersion,
      foldProtocolId: definition.foldProtocolId,
      outcomeDefinitionId: definition.outcomeDefinitionId,
      parameters: definition.parameters,
      displayLabel: definition.displayLabel,
      notes: definition.notes,
    });
    if (rebuilt.researchDefinitionId !== definition.researchDefinitionId) {
      fail(
        "research definition identity does not match its graph inputs",
        "RESEARCH_DEFINITION_INTEGRITY_MISMATCH",
      );
    }
  }

  for (const challenge of graph.challenges) {
    if (!executions.has(challenge.targetExecutionId)) {
      fail("challenge references an unknown execution", "UNKNOWN_CHALLENGE_EXECUTION");
    }
    const rebuilt = await createResearchChallenge({
      targetExecutionId: challenge.targetExecutionId,
      challengeType: challenge.challengeType,
      evidenceIds: challenge.evidenceIds,
      createdAt: challenge.createdAt,
      note: challenge.note,
    });
    if (rebuilt.challengeId !== challenge.challengeId) {
      fail("research challenge identity does not match its content", "RESEARCH_CHALLENGE_INTEGRITY_MISMATCH");
    }
  }

  const successors = new Map<string, string[]>();
  for (const supersession of graph.supersessions) {
    if (
      !executions.has(supersession.supersedingExecutionId)
      || !executions.has(supersession.supersededExecutionId)
    ) {
      fail("supersession references an unknown execution", "UNKNOWN_SUPERSESSION_EXECUTION");
    }
    if (supersession.supersedingExecutionId === supersession.supersededExecutionId) {
      fail("an execution cannot supersede itself", "SELF_RESEARCH_SUPERSESSION");
    }
    const rebuilt = await createResearchSupersession({
      supersedingExecutionId: supersession.supersedingExecutionId,
      supersededExecutionId: supersession.supersededExecutionId,
      reason: supersession.reason,
      createdAt: supersession.createdAt,
    });
    if (rebuilt.supersessionId !== supersession.supersessionId) {
      fail(
        "research supersession identity does not match its content",
        "RESEARCH_SUPERSESSION_INTEGRITY_MISMATCH",
      );
    }
    const current = successors.get(supersession.supersededExecutionId) ?? [];
    current.push(supersession.supersedingExecutionId);
    successors.set(supersession.supersededExecutionId, current);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail("research supersession graph contains a cycle", "RESEARCH_SUPERSESSION_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const successor of successors.get(id) ?? []) visit(successor);
    visiting.delete(id);
    visited.add(id);
  };
  for (const executionId of executions.keys()) visit(executionId);
}
