import { canonicalHash, canonicalize } from "../series-intelligence/provenanceHash";
import {
  compareCanonicalStrings,
  normalizeInstant,
  normalizeStableKey,
  SeriesMarketValidationError,
} from "./normalization";
import {
  SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
  SERIES_MARKET_RESEARCH_NAMESPACE,
  type DeterminismLevel,
  type ResearchRecordGraph,
  validateResearchRecordGraph,
} from "./researchRun";

export const RESEARCH_ARTIFACT_SCHEMA_VERSION = "v1" as const;
export const RESEARCH_ARTIFACT_NAMESPACE =
  `${SERIES_MARKET_RESEARCH_NAMESPACE}:artifact:${RESEARCH_ARTIFACT_SCHEMA_VERSION}` as const;

export interface ResearchArtifactInput<TPayload> {
  readonly executionId: string;
  readonly researchDefinitionId: string;
  readonly artifactType: string;
  readonly artifactSchemaVersion: string;
  readonly createdAt: string;
  readonly determinismLevel: DeterminismLevel;
  readonly payload: TPayload;
  readonly limitations: readonly string[];
  readonly allowedClaims: readonly string[];
  readonly forbiddenClaims: readonly string[];
}

export interface ResearchArtifact<TPayload = unknown> {
  readonly artifactId: string;
  readonly contractVersion: typeof SERIES_MARKET_RESEARCH_CONTRACT_VERSION;
  readonly executionId: string;
  readonly researchDefinitionId: string;
  readonly artifactType: string;
  readonly artifactSchemaVersion: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly determinismLevel: DeterminismLevel;
  readonly payload: TPayload;
  readonly limitations: readonly string[];
  readonly allowedClaims: readonly string[];
  readonly forbiddenClaims: readonly string[];
}

export interface ResearchArtifactGraphValidationInput {
  readonly artifact: ResearchArtifact;
  readonly researchGraph: ResearchRecordGraph;
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

function normalizeReference(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > 512 || containsForbiddenControl(value, false)) {
    fail(`${label} must be a non-blank canonical reference`, "INVALID_RESEARCH_ARTIFACT_REFERENCE");
  }
  return value;
}

function canonicalTextSet(rawValues: readonly string[], label: string): readonly string[] {
  if (rawValues.length === 0) fail(`${label} must not be empty`, "RESEARCH_ARTIFACT_TEXT_REQUIRED");
  const values = rawValues.map((raw) => {
    const value = raw.normalize("NFC").trim();
    if (value === "" || value.length > 4096 || containsForbiddenControl(value, true)) {
      fail(`${label} must contain non-blank text`, "INVALID_RESEARCH_ARTIFACT_TEXT");
    }
    return value;
  });
  const unique = new Set(values);
  if (unique.size !== values.length) fail(`${label} contains a duplicate`, "DUPLICATE_RESEARCH_ARTIFACT_TEXT");
  return [...unique].sort(compareCanonicalStrings);
}

function normalizeDeterminismLevel(value: DeterminismLevel): DeterminismLevel {
  if (value !== "exact" && value !== "seeded" && value !== "statistical") {
    fail("determinismLevel is unsupported", "INVALID_RESEARCH_ARTIFACT_DETERMINISM");
  }
  return value;
}

function normalizePayload<TPayload>(payload: TPayload): TPayload {
  try {
    return JSON.parse(canonicalize(payload)) as TPayload;
  } catch {
    return fail("artifact payload must be a canonical plain JSON value", "INVALID_RESEARCH_ARTIFACT_PAYLOAD");
  }
}

function assertCanonicalStoredValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (value !== value.normalize("NFC")) {
      fail(`${path} must use NFC-normalized text`, "NON_CANONICAL_RESEARCH_ARTIFACT");
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail(`${path} must use a canonical finite number`, "NON_CANONICAL_RESEARCH_ARTIFACT");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((nested, index) => assertCanonicalStoredValue(nested, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(`${path} must be a plain JSON object`, "NON_CANONICAL_RESEARCH_ARTIFACT");
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key !== key.normalize("NFC")) {
        fail(`${path} contains a non-NFC key`, "NON_CANONICAL_RESEARCH_ARTIFACT");
      }
      assertCanonicalStoredValue(nested, `${path}.${key}`);
    }
    return;
  }
  fail(`${path} must be canonical JSON`, "NON_CANONICAL_RESEARCH_ARTIFACT");
}

export async function createResearchArtifact<TPayload>(
  input: ResearchArtifactInput<TPayload>,
): Promise<ResearchArtifact<TPayload>> {
  const executionId = normalizeReference(input.executionId, "executionId");
  const researchDefinitionId = normalizeReference(input.researchDefinitionId, "researchDefinitionId");
  if (executionId === researchDefinitionId) {
    fail("execution and definition identities must be distinct", "RESEARCH_ARTIFACT_IDENTITY_COLLISION");
  }
  const artifactType = normalizeStableKey(input.artifactType, "artifactType");
  const artifactSchemaVersion = normalizeReference(input.artifactSchemaVersion, "artifactSchemaVersion");
  const createdAt = normalizeInstant(input.createdAt);
  const determinismLevel = normalizeDeterminismLevel(input.determinismLevel);
  const payload = normalizePayload(input.payload);
  const limitations = canonicalTextSet(input.limitations, "limitations");
  const allowedClaims = canonicalTextSet(input.allowedClaims, "allowedClaims");
  const forbiddenClaims = canonicalTextSet(input.forbiddenClaims, "forbiddenClaims");

  const content = {
    contractVersion: SERIES_MARKET_RESEARCH_CONTRACT_VERSION,
    executionId,
    researchDefinitionId,
    artifactType,
    artifactSchemaVersion,
    createdAt,
    determinismLevel,
    payload,
    limitations,
    allowedClaims,
    forbiddenClaims,
  };
  const contentHash = await canonicalHash(content);
  const artifactId = `${RESEARCH_ARTIFACT_NAMESPACE}:${artifactType}:${contentHash}`;

  return deepFreeze({
    artifactId,
    ...content,
    contentHash,
  });
}

export async function validateResearchArtifact(
  artifact: ResearchArtifact,
): Promise<void> {
  assertCanonicalStoredValue(artifact, "artifact");
  const rebuilt = await createResearchArtifact({
    executionId: artifact.executionId,
    researchDefinitionId: artifact.researchDefinitionId,
    artifactType: artifact.artifactType,
    artifactSchemaVersion: artifact.artifactSchemaVersion,
    createdAt: artifact.createdAt,
    determinismLevel: artifact.determinismLevel,
    payload: artifact.payload,
    limitations: artifact.limitations,
    allowedClaims: artifact.allowedClaims,
    forbiddenClaims: artifact.forbiddenClaims,
  });
  if (
    artifact.contractVersion !== SERIES_MARKET_RESEARCH_CONTRACT_VERSION
    || artifact.artifactId !== rebuilt.artifactId
    || artifact.contentHash !== rebuilt.contentHash
    || canonicalize(artifact) !== canonicalize(rebuilt)
  ) {
    fail("research artifact identity does not match its content", "RESEARCH_ARTIFACT_INTEGRITY_MISMATCH");
  }
}

export async function validateResearchArtifactGraph(
  input: ResearchArtifactGraphValidationInput,
): Promise<void> {
  await validateResearchArtifact(input.artifact);
  await validateResearchRecordGraph(input.researchGraph);

  const execution = input.researchGraph.executions.find(
    (candidate) => candidate.executionId === input.artifact.executionId,
  );
  if (!execution) {
    fail("artifact references an unknown research execution", "UNKNOWN_RESEARCH_ARTIFACT_EXECUTION");
  }
  const definition = input.researchGraph.definitions.find(
    (candidate) => candidate.researchDefinitionId === input.artifact.researchDefinitionId,
  );
  if (!definition) {
    fail("artifact references an unknown research definition", "UNKNOWN_RESEARCH_ARTIFACT_DEFINITION");
  }
  if (
    input.artifact.executionId !== execution.executionId
    || input.artifact.researchDefinitionId !== execution.researchDefinitionId
    || execution.researchDefinitionId !== definition.researchDefinitionId
  ) {
    fail("artifact execution and definition do not form one R1 graph path", "RESEARCH_ARTIFACT_GRAPH_MISMATCH");
  }
  if (input.artifact.determinismLevel !== execution.determinismLevel) {
    fail("artifact determinism differs from its execution", "RESEARCH_ARTIFACT_DETERMINISM_MISMATCH");
  }
  if (input.artifact.createdAt < execution.executedAt) {
    fail("artifact cannot predate its execution", "RESEARCH_ARTIFACT_PRECEDES_EXECUTION");
  }
}
