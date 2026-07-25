import { describe, expect, it } from "vitest";
import { SeriesMarketValidationError } from "./normalization";
import {
  createResearchArtifact,
  validateResearchArtifactGraph,
  validateResearchArtifact,
  type ResearchArtifact,
} from "./researchArtifact";
import {
  createForecastOriginInformationSet,
  createInputSliceManifest,
  createOutcomeExclusionManifest,
  createResearchDefinition,
  createResearchExecution,
  type ResearchRecordGraph,
} from "./researchRun";

const BASE = {
  executionId: "series-market:research:v1:execution:test",
  researchDefinitionId: "series-market:research:v1:definition:test",
  artifactType: "test-evaluation",
  artifactSchemaVersion: "v1",
  createdAt: "2026-07-25T00:00:00Z",
  determinismLevel: "exact" as const,
  limitations: ["Exploratory only.", "Small public sample."],
  allowedClaims: ["Historical benchmark only.", "The test output is deterministic."],
  forbiddenClaims: ["No causal claim.", "The test output is a production forecast."],
};

async function graphFixture() {
  const inputSliceManifest = await createInputSliceManifest({
    datasetReleaseIds: [`series-market:v1:release:jeju:${"a".repeat(64)}`],
    sourceCutoff: "2026-07-25T00:00:00.000Z",
    memberKind: "claim_id",
    memberIds: [`series-market:v1:claim:${"1".repeat(64)}`],
    rowCount: 1,
  });
  const outcomeExclusionManifest = await createOutcomeExclusionManifest({
    datasetReleaseIds: inputSliceManifest.datasetReleaseIds,
    sourceCutoff: inputSliceManifest.sourceCutoff,
    outcomeClaimIds: [`series-market:v1:claim:${"2".repeat(64)}`],
  });
  const informationSet = await createForecastOriginInformationSet({
    inputSliceManifest,
    outcomeExclusionManifest,
    featureSchemaId: "series-market:feature-schema:test-v1",
  });
  const definition = await createResearchDefinition({
    questionKey: "artifact-linkage",
    informationSet,
    targetEntityIds: ["event-a"],
    methodId: "test-method",
    methodVersion: "v1",
    foldProtocolId: "chronological-v1",
    outcomeDefinitionId: "entries-v1",
    parameters: { minimumN: 1 },
  });
  const execution = await createResearchExecution({
    researchDefinition: definition,
    codeSha: "3".repeat(40),
    dependencyLockHash: "4".repeat(64),
    environment: {
      runtimeName: "node",
      runtimeVersion: "22.17.0",
      platform: "win32",
      architecture: "x64",
      cpu: "test-cpu",
      gpu: null,
      threadCount: 1,
      modelCheckpointId: null,
      modelCheckpointHash: null,
    },
    seedPolicy: { kind: "none" },
    determinismLevel: "exact",
    executedAt: "2026-07-25T01:00:00.000Z",
  });
  const graph: ResearchRecordGraph = {
    inputSliceManifests: [inputSliceManifest],
    outcomeExclusionManifests: [outcomeExclusionManifest],
    informationSets: [informationSet],
    definitions: [definition],
    executions: [execution],
    challenges: [],
    supersessions: [],
  };
  return { definition, execution, graph, informationSet };
}

describe("ResearchArtifact", () => {
  it("content-addresses the full canonical output independently from definition and execution", async () => {
    const first = await createResearchArtifact({ ...BASE, payload: { b: 2, a: 1 } });
    const reordered = await createResearchArtifact({ ...BASE, payload: { a: 1, b: 2 } });
    const changed = await createResearchArtifact({ ...BASE, payload: { a: 1, b: 3 } });

    expect(first).toEqual(reordered);
    expect(first.artifactId).not.toBe(BASE.executionId);
    expect(first.artifactId).not.toBe(BASE.researchDefinitionId);
    expect(changed.artifactId).not.toBe(first.artifactId);
    expect(changed.contentHash).not.toBe(first.contentHash);
    await expect(validateResearchArtifact(first)).resolves.toBeUndefined();
  });

  it("keeps missing and zero distinct and deeply freezes canonical payloads", async () => {
    const missing = await createResearchArtifact({ ...BASE, payload: { gtd: null } });
    const zero = await createResearchArtifact({ ...BASE, payload: { gtd: "0" } });

    expect(missing.artifactId).not.toBe(zero.artifactId);
    expect(Object.isFrozen(zero)).toBe(true);
    expect(Object.isFrozen(zero.payload)).toBe(true);
  });

  it("fails closed when a stored artifact payload is forged", async () => {
    const artifact = await createResearchArtifact({ ...BASE, payload: { metric: "1" } });
    const forged = {
      ...artifact,
      payload: { metric: "2" },
    } as ResearchArtifact;

    await expect(validateResearchArtifact(forged)).rejects.toMatchObject({
      code: "RESEARCH_ARTIFACT_INTEGRITY_MISMATCH",
    });
  });

  it("rejects noncanonical stored representations and unknown runtime fields", async () => {
    const artifact = await createResearchArtifact({ ...BASE, payload: { metric: "1" } });
    const variants: ResearchArtifact[] = [
      { ...artifact, limitations: [...artifact.limitations].reverse() },
      { ...artifact, allowedClaims: [` ${artifact.allowedClaims[0]} `, ...artifact.allowedClaims.slice(1)] },
      { ...artifact, executionId: ` ${artifact.executionId} ` },
      { ...artifact, allowedClaims: ["Cafe\u0301 benchmark.", ...artifact.allowedClaims] },
      { ...artifact, unexpectedRuntimeField: true } as ResearchArtifact,
    ];

    for (const variant of variants) {
      await expect(validateResearchArtifact(variant)).rejects.toBeInstanceOf(SeriesMarketValidationError);
    }
  });

  it("rejects forged identity fields and contract versions", async () => {
    const artifact = await createResearchArtifact({ ...BASE, payload: { metric: "1" } });
    for (const variant of [
      { ...artifact, artifactId: `${artifact.artifactId}-forged` },
      { ...artifact, contentHash: "f".repeat(64) },
      { ...artifact, contractVersion: "series-market:research:v999" },
    ] as ResearchArtifact[]) {
      await expect(validateResearchArtifact(variant)).rejects.toMatchObject({
        code: "RESEARCH_ARTIFACT_INTEGRITY_MISMATCH",
      });
    }
  });

  it("accepts only an artifact linked to its validated R1 execution and definition", async () => {
    const fixture = await graphFixture();
    const artifact = await createResearchArtifact({
      ...BASE,
      executionId: fixture.execution.executionId,
      researchDefinitionId: fixture.definition.researchDefinitionId,
      createdAt: "2026-07-25T01:00:00.000Z",
      payload: { metric: "1" },
    });

    await expect(
      validateResearchArtifactGraph({ artifact, researchGraph: fixture.graph }),
    ).resolves.toBeUndefined();
  });

  it("rejects mismatched or unknown execution and definition references", async () => {
    const fixture = await graphFixture();
    const secondDefinition = await createResearchDefinition({
      questionKey: "different-artifact-linkage",
      informationSet: fixture.informationSet,
      targetEntityIds: ["event-b"],
      methodId: "test-method",
      methodVersion: "v1",
      foldProtocolId: "chronological-v1",
      outcomeDefinitionId: "entries-v1",
      parameters: { minimumN: 1 },
    });
    const graph = {
      ...fixture.graph,
      definitions: [...fixture.graph.definitions, secondDefinition],
    };
    const mismatched = await createResearchArtifact({
      ...BASE,
      executionId: fixture.execution.executionId,
      researchDefinitionId: secondDefinition.researchDefinitionId,
      createdAt: "2026-07-25T01:00:00.000Z",
      payload: { metric: "1" },
    });
    const unknownExecution = await createResearchArtifact({
      ...BASE,
      executionId: "series-market:research:v1:execution:unknown",
      researchDefinitionId: fixture.definition.researchDefinitionId,
      createdAt: "2026-07-25T01:00:00.000Z",
      payload: { metric: "1" },
    });
    const unknownDefinition = await createResearchArtifact({
      ...BASE,
      executionId: fixture.execution.executionId,
      researchDefinitionId: "series-market:research:v1:definition:unknown",
      createdAt: "2026-07-25T01:00:00.000Z",
      payload: { metric: "1" },
    });

    await expect(validateResearchArtifactGraph({ artifact: mismatched, researchGraph: graph }))
      .rejects.toMatchObject({ code: "RESEARCH_ARTIFACT_GRAPH_MISMATCH" });
    await expect(validateResearchArtifactGraph({ artifact: unknownExecution, researchGraph: fixture.graph }))
      .rejects.toMatchObject({ code: "UNKNOWN_RESEARCH_ARTIFACT_EXECUTION" });
    await expect(validateResearchArtifactGraph({ artifact: unknownDefinition, researchGraph: fixture.graph }))
      .rejects.toMatchObject({ code: "UNKNOWN_RESEARCH_ARTIFACT_DEFINITION" });
  });

  it("rejects determinism drift and artifacts created before execution", async () => {
    const fixture = await graphFixture();
    const wrongDeterminism = await createResearchArtifact({
      ...BASE,
      executionId: fixture.execution.executionId,
      researchDefinitionId: fixture.definition.researchDefinitionId,
      createdAt: "2026-07-25T01:00:00.000Z",
      determinismLevel: "seeded",
      payload: { metric: "1" },
    });
    const tooEarly = await createResearchArtifact({
      ...BASE,
      executionId: fixture.execution.executionId,
      researchDefinitionId: fixture.definition.researchDefinitionId,
      createdAt: "2026-07-25T00:59:59.999Z",
      payload: { metric: "1" },
    });

    await expect(validateResearchArtifactGraph({
      artifact: wrongDeterminism,
      researchGraph: fixture.graph,
    })).rejects.toMatchObject({ code: "RESEARCH_ARTIFACT_DETERMINISM_MISMATCH" });
    await expect(validateResearchArtifactGraph({
      artifact: tooEarly,
      researchGraph: fixture.graph,
    })).rejects.toMatchObject({ code: "RESEARCH_ARTIFACT_PRECEDES_EXECUTION" });
  });
});
