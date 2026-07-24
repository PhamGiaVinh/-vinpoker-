import { describe, expect, it } from "vitest";
import type { CanonicalParameterValue } from "./contracts";
import {
  createForecastOriginInformationSet,
  createInputSliceManifest,
  createOutcomeExclusionManifest,
  createResearchChallenge,
  createResearchDefinition,
  createResearchExecution,
  createResearchSupersession,
  validateResearchRecordGraph,
  type ForecastOriginInformationSet,
  type ResearchDefinition,
  type ResearchEnvironmentFingerprintInput,
  type ResearchExecution,
} from "./researchRun";

const RELEASE_A = `series-market:v1:release:jeju:${"a".repeat(64)}`;
const RELEASE_B = `series-market:v1:release:vietnam:${"b".repeat(64)}`;
const CLAIM_A = `series-market:v1:claim:${"1".repeat(64)}`;
const CLAIM_B = `series-market:v1:claim:${"2".repeat(64)}`;
const OUTCOME_A = `series-market:v1:claim:${"3".repeat(64)}`;
const CODE_SHA = "4".repeat(40);
const LOCK_SHA = "5".repeat(64);
const CUTOFF = "2026-07-25T00:00:00.000Z";

const ENVIRONMENT: ResearchEnvironmentFingerprintInput = {
  runtimeName: "node",
  runtimeVersion: "22.16.0",
  platform: "win32",
  architecture: "x64",
  cpu: "test cpu",
  gpu: null,
  threadCount: 2,
  modelCheckpointId: null,
  modelCheckpointHash: null,
};

async function informationSet(
  options: {
    releases?: readonly string[];
    cutoff?: string;
    inputClaims?: readonly string[];
    outcomes?: readonly string[];
    featureSchemaId?: string;
  } = {},
): Promise<ForecastOriginInformationSet> {
  const releases = options.releases ?? [RELEASE_A];
  const cutoff = options.cutoff ?? CUTOFF;
  const inputSliceManifest = await createInputSliceManifest({
    datasetReleaseIds: releases,
    sourceCutoff: cutoff,
    memberKind: "claim_id",
    memberIds: options.inputClaims ?? [CLAIM_A, CLAIM_B],
    rowCount: 2,
  });
  const outcomeExclusionManifest = await createOutcomeExclusionManifest({
    datasetReleaseIds: releases,
    sourceCutoff: cutoff,
    outcomeClaimIds: options.outcomes ?? [OUTCOME_A],
  });
  return createForecastOriginInformationSet({
    inputSliceManifest,
    outcomeExclusionManifest,
    featureSchemaId: options.featureSchemaId ?? "series-market:feature-schema:public-event-v1",
  });
}

async function definition(
  options: {
    info?: ForecastOriginInformationSet;
    questionKey?: string;
    targets?: readonly string[];
    methodId?: string;
    methodVersion?: string;
    foldProtocolId?: string;
    outcomeDefinitionId?: string;
    parameters?: CanonicalParameterValue;
    displayLabel?: string | null;
    notes?: string | null;
  } = {},
): Promise<ResearchDefinition> {
  return createResearchDefinition({
    questionKey: options.questionKey ?? "turnout.entries",
    informationSet: options.info ?? await informationSet(),
    targetEntityIds: options.targets ?? ["event-b", "event-a"],
    methodId: options.methodId ?? "comparable-event",
    methodVersion: options.methodVersion ?? "v0",
    foldProtocolId: options.foldProtocolId ?? "chronological-v1",
    outcomeDefinitionId: options.outcomeDefinitionId ?? "entries-v1",
    parameters: options.parameters ?? { minimumN: 5, requestedComparables: 12 },
    displayLabel: options.displayLabel ?? "Comparable V0",
    notes: options.notes ?? "Exploratory only",
  });
}

async function execution(
  researchDefinition: ResearchDefinition,
  options: {
    codeSha?: string;
    executedAt?: string;
    determinismLevel?: "exact" | "seeded" | "statistical";
    seedPolicy?:
      | { readonly kind: "none" }
      | { readonly kind: "fixed"; readonly seed: string }
      | { readonly kind: "recorded"; readonly seeds: readonly string[] };
  } = {},
): Promise<ResearchExecution> {
  return createResearchExecution({
    researchDefinition,
    codeSha: options.codeSha ?? CODE_SHA,
    dependencyLockHash: LOCK_SHA,
    environment: ENVIRONMENT,
    determinismLevel: options.determinismLevel ?? "exact",
    seedPolicy: options.seedPolicy ?? { kind: "none" },
    executedAt: options.executedAt ?? "2026-07-25T01:00:00.000Z",
  });
}

async function graphFixture() {
  const inputSliceManifest = await createInputSliceManifest({
    datasetReleaseIds: [RELEASE_A],
    sourceCutoff: CUTOFF,
    memberKind: "claim_id",
    memberIds: [CLAIM_A, CLAIM_B],
    rowCount: 2,
  });
  const outcomeExclusionManifest = await createOutcomeExclusionManifest({
    datasetReleaseIds: [RELEASE_A],
    sourceCutoff: CUTOFF,
    outcomeClaimIds: [OUTCOME_A],
  });
  const information = await createForecastOriginInformationSet({
    inputSliceManifest,
    outcomeExclusionManifest,
    featureSchemaId: "series-market:feature-schema:public-event-v1",
  });
  const researchDefinition = await definition({ info: information });
  const run = await execution(researchDefinition);
  return {
    inputSliceManifest,
    outcomeExclusionManifest,
    information,
    researchDefinition,
    run,
  };
}

describe("series-market Research OS R1 contracts", () => {
  it("creates order-independent input manifests without mutating inputs", async () => {
    const input = {
      datasetReleaseIds: [RELEASE_B, RELEASE_A],
      sourceCutoff: "2026-07-25T07:00:00+07:00",
      memberKind: "claim_id" as const,
      memberIds: [CLAIM_B, CLAIM_A],
      rowCount: 7,
    };
    const before = structuredClone(input);
    const first = await createInputSliceManifest(input);
    const second = await createInputSliceManifest({
      ...input,
      datasetReleaseIds: [RELEASE_A, RELEASE_B],
      memberIds: [CLAIM_A, CLAIM_B],
    });

    expect(first.inputSliceManifestId).toBe(second.inputSliceManifestId);
    expect(first.datasetReleaseIds).toEqual([RELEASE_A, RELEASE_B]);
    expect(first.memberIds).toEqual([CLAIM_A, CLAIM_B]);
    expect(first.sourceCutoff).toBe(CUTOFF);
    expect(input).toEqual(before);
  });

  it("rejects duplicate manifest members after normalization", async () => {
    await expect(
      createInputSliceManifest({
        datasetReleaseIds: [RELEASE_A],
        sourceCutoff: CUTOFF,
        memberKind: "claim_id",
        memberIds: [CLAIM_A, ` ${CLAIM_A} `],
        rowCount: 1,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_RESEARCH_REFERENCE" });

    await expect(
      createInputSliceManifest({
        datasetReleaseIds: [RELEASE_A],
        sourceCutoff: CUTOFF,
        memberKind: "row_hash",
        memberIds: ["A".repeat(64), "a".repeat(64)],
        rowCount: 1,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_RESEARCH_REFERENCE" });
  });

  it("keeps an empty outcome mask distinct from one excluded outcome", async () => {
    const empty = await createOutcomeExclusionManifest({
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: CUTOFF,
      outcomeClaimIds: [],
    });
    const excluded = await createOutcomeExclusionManifest({
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: CUTOFF,
      outcomeClaimIds: [OUTCOME_A],
    });
    expect(empty.outcomeCount).toBe(0);
    expect(empty.outcomeExclusionManifestId).not.toBe(excluded.outcomeExclusionManifestId);
  });

  it("fails closed when an excluded outcome claim leaks into the input slice", async () => {
    await expect(
      informationSet({
        inputClaims: [CLAIM_A, OUTCOME_A],
        outcomes: [OUTCOME_A],
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_OUTCOME_LEAKAGE" });
  });

  it("rejects mismatched release and cutoff manifests", async () => {
    const inputSliceManifest = await createInputSliceManifest({
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: CUTOFF,
      memberKind: "claim_id",
      memberIds: [CLAIM_A],
      rowCount: 1,
    });
    const wrongRelease = await createOutcomeExclusionManifest({
      datasetReleaseIds: [RELEASE_B],
      sourceCutoff: CUTOFF,
      outcomeClaimIds: [],
    });
    await expect(
      createForecastOriginInformationSet({
        inputSliceManifest,
        outcomeExclusionManifest: wrongRelease,
        featureSchemaId: "feature-schema-v1",
      }),
    ).rejects.toMatchObject({ code: "INFORMATION_SET_RELEASE_MISMATCH" });

    const wrongCutoff = await createOutcomeExclusionManifest({
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: "2026-07-24T00:00:00Z",
      outcomeClaimIds: [],
    });
    await expect(
      createForecastOriginInformationSet({
        inputSliceManifest,
        outcomeExclusionManifest: wrongCutoff,
        featureSchemaId: "feature-schema-v1",
      }),
    ).rejects.toMatchObject({ code: "INFORMATION_SET_CUTOFF_MISMATCH" });
  });

  it("rejects a forged manifest before building an information set", async () => {
    const valid = await createInputSliceManifest({
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: CUTOFF,
      memberKind: "claim_id",
      memberIds: [CLAIM_A],
      rowCount: 1,
    });
    const forged = { ...valid, rowCount: 2 };
    const outcomes = await createOutcomeExclusionManifest({
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: CUTOFF,
      outcomeClaimIds: [],
    });

    await expect(
      createForecastOriginInformationSet({
        inputSliceManifest: forged,
        outcomeExclusionManifest: outcomes,
        featureSchemaId: "feature-schema-v1",
      }),
    ).rejects.toMatchObject({ code: "INPUT_SLICE_INTEGRITY_MISMATCH" });
  });

  it("rejects forged information-set and definition records before deriving child identities", async () => {
    const info = await informationSet();
    await expect(
      definition({
        info: {
          ...info,
          sourceCutoff: "2026-07-24T00:00:00.000Z",
        },
      }),
    ).rejects.toMatchObject({ code: "INFORMATION_SET_INTEGRITY_MISMATCH" });

    const researchDefinition = await definition({ info });
    await expect(
      execution({
        ...researchDefinition,
        methodVersion: "forged-v1",
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_DEFINITION_INTEGRITY_MISMATCH" });
  });

  it("keeps semantic definition identity stable across ordering, labels, notes, and object key order", async () => {
    const info = await informationSet();
    const first = await definition({
      info,
      targets: ["event-b", "event-a"],
      parameters: { alpha: "0.1", bands: { high: 90, low: 10 } },
      displayLabel: "First label",
      notes: "First note",
    });
    const second = await definition({
      info,
      targets: ["event-a", "event-b"],
      parameters: { bands: { low: 10, high: 90 }, alpha: "0.1" },
      displayLabel: "Different label",
      notes: "Different note",
    });

    expect(first.researchDefinitionId).toBe(second.researchDefinitionId);
    expect(first.displayLabel).not.toBe(second.displayLabel);
    expect(first.notes).not.toBe(second.notes);
  });

  it("changes definition identity for semantic fields and preserves zero versus null", async () => {
    const base = await definition({ parameters: { threshold: 0 } });
    const cases = await Promise.all([
      definition({ questionKey: "turnout.unique-players", parameters: { threshold: 0 } }),
      definition({ methodVersion: "v1", parameters: { threshold: 0 } }),
      definition({ foldProtocolId: "leave-one-festival-out-v1", parameters: { threshold: 0 } }),
      definition({ outcomeDefinitionId: "unique-players-v1", parameters: { threshold: 0 } }),
      definition({ parameters: { threshold: null } }),
      definition({ info: await informationSet({ featureSchemaId: "feature-schema-v2" }), parameters: { threshold: 0 } }),
      definition({ info: await informationSet({ releases: [RELEASE_B] }), parameters: { threshold: 0 } }),
    ]);
    expect(new Set([
      base.researchDefinitionId,
      ...cases.map((item) => item.researchDefinitionId),
    ]).size).toBe(cases.length + 1);
  });

  it("rejects actual outcome values embedded in research parameters", async () => {
    await expect(
      definition({ parameters: { actualEntries: 1000 } }),
    ).rejects.toMatchObject({ code: "RESEARCH_OUTCOME_LEAKAGE" });
    await expect(
      definition({ parameters: { nested: { outcome_value: 1000 } } }),
    ).rejects.toMatchObject({ code: "RESEARCH_OUTCOME_LEAKAGE" });
  });

  it("normalizes equivalent execution instants and changes execution identity for code or time", async () => {
    const researchDefinition = await definition();
    const first = await execution(researchDefinition, { executedAt: "2026-07-25T08:00:00+07:00" });
    const equivalent = await execution(researchDefinition, { executedAt: "2026-07-25T01:00:00Z" });
    const later = await execution(researchDefinition, { executedAt: "2026-07-25T01:00:01Z" });
    const newCode = await execution(researchDefinition, { codeSha: "6".repeat(40) });

    expect(first.executionId).toBe(equivalent.executionId);
    expect(later.executionId).not.toBe(first.executionId);
    expect(newCode.executionId).not.toBe(first.executionId);
  });

  it("includes lock, environment, seed policy, and determinism in execution identity", async () => {
    const researchDefinition = await definition();
    const exact = await execution(researchDefinition);
    const newLock = await createResearchExecution({
      researchDefinition,
      codeSha: CODE_SHA,
      dependencyLockHash: "7".repeat(64),
      environment: ENVIRONMENT,
      determinismLevel: "exact",
      seedPolicy: { kind: "none" },
      executedAt: "2026-07-25T01:00:00Z",
    });
    const newEnvironment = await createResearchExecution({
      researchDefinition,
      codeSha: CODE_SHA,
      dependencyLockHash: LOCK_SHA,
      environment: { ...ENVIRONMENT, threadCount: 1 },
      determinismLevel: "exact",
      seedPolicy: { kind: "none" },
      executedAt: "2026-07-25T01:00:00Z",
    });
    const seeded = await execution(researchDefinition, {
      determinismLevel: "seeded",
      seedPolicy: { kind: "fixed", seed: "42" },
    });

    expect(new Set([
      exact.executionId,
      newLock.executionId,
      newEnvironment.executionId,
      seeded.executionId,
    ]).size).toBe(4);
  });

  it("enforces seed policy for exact, seeded, and statistical executions", async () => {
    const researchDefinition = await definition();
    await expect(
      execution(researchDefinition, {
        determinismLevel: "exact",
        seedPolicy: { kind: "fixed", seed: "42" },
      }),
    ).rejects.toMatchObject({ code: "EXACT_RESEARCH_HAS_SEED" });
    await expect(
      execution(researchDefinition, {
        determinismLevel: "seeded",
        seedPolicy: { kind: "none" },
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_SEED_REQUIRED" });

    const seeded = await execution(researchDefinition, {
      determinismLevel: "seeded",
      seedPolicy: { kind: "fixed", seed: "+0042" },
    });
    const statistical = await execution(researchDefinition, {
      determinismLevel: "statistical",
      seedPolicy: { kind: "recorded", seeds: ["22", "11"] },
    });
    expect(seeded.seedPolicy).toEqual({ kind: "fixed", seed: "42" });
    expect(statistical.seedPolicy).toEqual({ kind: "recorded", seeds: ["11", "22"] });
  });

  it("requires checkpoint identity and hash together", async () => {
    const researchDefinition = await definition();
    await expect(
      createResearchExecution({
        researchDefinition,
        codeSha: CODE_SHA,
        dependencyLockHash: LOCK_SHA,
        environment: {
          ...ENVIRONMENT,
          modelCheckpointId: "tabpfn-v2",
          modelCheckpointHash: null,
        },
        determinismLevel: "statistical",
        seedPolicy: { kind: "fixed", seed: "42" },
        executedAt: "2026-07-25T01:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "MODEL_CHECKPOINT_INCOMPLETE" });
  });

  it("returns deeply immutable records and does not mutate caller inputs", async () => {
    const input = {
      datasetReleaseIds: [RELEASE_A],
      sourceCutoff: CUTOFF,
      memberKind: "claim_id" as const,
      memberIds: [CLAIM_B, CLAIM_A],
      rowCount: 2,
    };
    const before = structuredClone(input);
    const manifest = await createInputSliceManifest(input);
    const researchDefinition = await definition();
    const run = await execution(researchDefinition);

    expect(input).toEqual(before);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.memberIds)).toBe(true);
    expect(Object.isFrozen(researchDefinition.parameters)).toBe(true);
    expect(Object.isFrozen(run.environment)).toBe(true);
    expect(Object.isFrozen(run.seedPolicy)).toBe(true);
  });

  it("creates append-only challenges without changing the execution", async () => {
    const researchDefinition = await definition();
    const run = await execution(researchDefinition);
    const before = structuredClone(run);
    const first = await createResearchChallenge({
      targetExecutionId: run.executionId,
      challengeType: "bias-review",
      evidenceIds: ["evidence-b", "evidence-a"],
      createdAt: "2026-07-25T02:00:00Z",
      note: "Check negative bias by event family.",
    });
    const same = await createResearchChallenge({
      targetExecutionId: run.executionId,
      challengeType: "bias-review",
      evidenceIds: ["evidence-a", "evidence-b"],
      createdAt: "2026-07-25T02:00:00Z",
      note: "Check negative bias by event family.",
    });

    expect(first.challengeId).toBe(same.challengeId);
    expect(run).toEqual(before);
    expect(Object.isFrozen(first.evidenceIds)).toBe(true);
  });

  it("rejects self-supersession", async () => {
    await expect(
      createResearchSupersession({
        supersedingExecutionId: "execution-a",
        supersededExecutionId: "execution-a",
        reason: "same run",
        createdAt: "2026-07-25T03:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "SELF_RESEARCH_SUPERSESSION" });
  });

  it("validates challenge targets and definition references in graph context", async () => {
    const fixture = await graphFixture();
    const challenge = await createResearchChallenge({
      targetExecutionId: "missing-execution",
      challengeType: "bias-review",
      evidenceIds: ["evidence-a"],
      createdAt: "2026-07-25T02:00:00Z",
      note: "Missing target.",
    });

    await expect(
      validateResearchRecordGraph({
        inputSliceManifests: [fixture.inputSliceManifest],
        outcomeExclusionManifests: [fixture.outcomeExclusionManifest],
        informationSets: [fixture.information],
        definitions: [fixture.researchDefinition],
        executions: [fixture.run],
        challenges: [challenge],
        supersessions: [],
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_CHALLENGE_EXECUTION" });

    await expect(
      validateResearchRecordGraph({
        inputSliceManifests: [fixture.inputSliceManifest],
        outcomeExclusionManifests: [fixture.outcomeExclusionManifest],
        informationSets: [fixture.information],
        definitions: [],
        executions: [fixture.run],
        challenges: [],
        supersessions: [],
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_RESEARCH_DEFINITION" });
  });

  it("rejects supersession cycles while accepting a valid append-only chain", async () => {
    const fixture = await graphFixture();
    const first = fixture.run;
    const second = await execution(fixture.researchDefinition, { executedAt: "2026-07-25T02:00:00Z" });
    const third = await execution(fixture.researchDefinition, { executedAt: "2026-07-25T03:00:00Z" });
    const firstToSecond = await createResearchSupersession({
      supersedingExecutionId: second.executionId,
      supersededExecutionId: first.executionId,
      reason: "new code",
      createdAt: "2026-07-25T02:30:00Z",
    });
    const secondToThird = await createResearchSupersession({
      supersedingExecutionId: third.executionId,
      supersededExecutionId: second.executionId,
      reason: "new evidence",
      createdAt: "2026-07-25T03:30:00Z",
    });

    await expect(
      validateResearchRecordGraph({
        inputSliceManifests: [fixture.inputSliceManifest],
        outcomeExclusionManifests: [fixture.outcomeExclusionManifest],
        informationSets: [fixture.information],
        definitions: [fixture.researchDefinition],
        executions: [first, second, third],
        challenges: [],
        supersessions: [firstToSecond, secondToThird],
      })
    ).resolves.toBeUndefined();

    const thirdToFirst = await createResearchSupersession({
      supersedingExecutionId: first.executionId,
      supersededExecutionId: third.executionId,
      reason: "invalid cycle",
      createdAt: "2026-07-25T04:00:00Z",
    });
    await expect(
      validateResearchRecordGraph({
        inputSliceManifests: [fixture.inputSliceManifest],
        outcomeExclusionManifests: [fixture.outcomeExclusionManifest],
        informationSets: [fixture.information],
        definitions: [fixture.researchDefinition],
        executions: [first, second, third],
        challenges: [],
        supersessions: [firstToSecond, secondToThird, thirdToFirst],
      })
    ).rejects.toMatchObject({ code: "RESEARCH_SUPERSESSION_CYCLE" });
  });
});
