import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import type { DatasetRelease, SourceClaim } from "./contracts";
import {
  COMPARABLE_V0_ARTIFACT_SCHEMA_VERSION,
  COMPARABLE_V0_ARTIFACT_TYPE,
  emitComparableV0ResearchBundle,
  type ComparableV0ResearchBundle,
  type FoldPrediction,
} from "./comparableResearchArtifact";
import {
  createGtdStressScenarioFromComparableArtifact,
  type GtdStressComparableAdapterInput,
} from "./gtdStressComparableAdapter";
import { createResearchArtifact } from "./researchArtifact";
import {
  parseJejuImportJson,
  type JejuImportDataset,
  type JejuImportJsonDocument,
} from "./importer";
import { createVerifiedJejuReadModel } from "./verifiedMarketReadModel";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

const EXECUTION = {
  codeSha: "a".repeat(40),
  dependencyLockHash: "b".repeat(64),
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
  executedAt: "2026-07-25T00:00:00Z",
  createdAt: "2026-07-25T00:00:01Z",
} as const;

let bundle: ComparableV0ResearchBundle;
let unavailableBundle: ComparableV0ResearchBundle;
let changedExecutionBundle: ComparableV0ResearchBundle;
let changedDefinitionBundle: ComparableV0ResearchBundle;
let dataset: JejuImportDataset;
let release: DatasetRelease;
let availableFold: FoldPrediction;
let unavailableFold: FoldPrediction;

function claimsFor(eventId: string, field: "gtd" | "buy_in_prize"): readonly SourceClaim[] {
  return dataset.claims.filter((claim) => claim.entityId === eventId && claim.field === field);
}

function hasMoneyEvidence(eventId: string): boolean {
  return claimsFor(eventId, "gtd").some((claim) => claim.value.type === "money")
    && claimsFor(eventId, "buy_in_prize").some((claim) => claim.value.type === "money");
}

function adapterInput(
  fold: FoldPrediction = availableFold,
  overrides: Partial<GtdStressComparableAdapterInput> = {},
): GtdStressComparableAdapterInput {
  return {
    bundle,
    datasetRelease: release,
    targetEventId: fold.targetEventId,
    foldId: fold.foldId,
    gtdClaims: claimsFor(fold.targetEventId, "gtd"),
    prizeContributionClaims: claimsFor(fold.targetEventId, "buy_in_prize"),
    ...overrides,
  };
}

async function rebuiltArtifact(
  source: ComparableV0ResearchBundle["artifact"],
  overrides: Partial<Parameters<typeof createResearchArtifact>[0]>,
) {
  return createResearchArtifact({
    executionId: source.executionId,
    researchDefinitionId: source.researchDefinitionId,
    artifactType: source.artifactType,
    artifactSchemaVersion: source.artifactSchemaVersion,
    createdAt: source.createdAt,
    determinismLevel: source.determinismLevel,
    payload: source.payload,
    limitations: source.limitations,
    allowedClaims: source.allowedClaims,
    forbiddenClaims: source.forbiddenClaims,
    ...overrides,
  });
}

beforeAll(async () => {
  const canonicalImport = artifact("canonical/jeju_import_v1.json");
  const parsed = await parseJejuImportJson(canonicalImport as JejuImportJsonDocument);
  if (!parsed.ok) {
    throw new Error(`Jeju fixture import failed: ${JSON.stringify(parsed.errors)}`);
  }
  dataset = parsed.value;
  release = artifact("release.json") as DatasetRelease;
  const model = await createVerifiedJejuReadModel({
    canonicalImport,
    release,
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
  bundle = await emitComparableV0ResearchBundle({ model, ...EXECUTION });
  changedExecutionBundle = await emitComparableV0ResearchBundle({
    model,
    ...EXECUTION,
    codeSha: "c".repeat(40),
  });
  changedDefinitionBundle = await emitComparableV0ResearchBundle({
    model,
    ...EXECUTION,
    parameters: { requestedComparables: 8, minimumDistributionN: 5 },
  });
  availableFold = bundle.artifact.payload.foldPredictions.find(
    (fold) =>
      fold.evaluationProtocolId === "chronological-v1"
      && fold.availabilityState === "available"
      && hasMoneyEvidence(fold.targetEventId),
  )!;
  expect(availableFold).toBeDefined();
  const unavailablePayload = {
    ...bundle.artifact.payload,
    foldPredictions: bundle.artifact.payload.foldPredictions.map((fold) =>
      fold.foldId === availableFold.foldId
        ? {
          ...fold,
          availabilityState: "unavailable" as const,
          historicalQuantiles: null,
          pointBenchmark: null,
          absoluteError: null,
          signedError: null,
          failureState: "insufficient_historical_sample" as const,
        }
        : fold
    ),
  };
  const unavailableArtifact = await rebuiltArtifact(bundle.artifact, {
    payload: unavailablePayload,
  });
  unavailableBundle = {
    ...bundle,
    artifact: unavailableArtifact as ComparableV0ResearchBundle["artifact"],
  };
  unavailableFold = unavailableBundle.artifact.payload.foldPredictions.find(
    (fold) => fold.foldId === availableFold.foldId,
  )!;
  expect(unavailableFold).toBeDefined();
}, 120_000);

describe("trusted GTD Stress Comparable artifact adapter", () => {
  it("derives artifact provenance, quantiles, evidence quality, and exact arithmetic", async () => {
    const result = await createGtdStressScenarioFromComparableArtifact(adapterInput());
    expect(result.provenance.sourceArtifactId).toBe(bundle.artifact.artifactId);
    expect(result.provenance.foldId).toBe(availableFold.foldId);
    expect(result.scenario.sourceArtifactId).toBe(bundle.artifact.artifactId);
    expect(result.scenario.comparableProvenance.comparableAnalysisId).toBe(availableFold.foldId);
    expect(result.scenario.evidenceQuality).toBe("unverified");
    expect(result.scenario.evidenceState).toBe("unverified_evidence");
    expect(result.scenario.state).toBe("available");
    if (result.scenario.state !== "available") return;
    expect(result.scenario.quantileScenarios.map((scenario) => scenario.historicalFieldEntries))
      .toEqual([
        availableFold.historicalQuantiles!.p10,
        availableFold.historicalQuantiles!.p25,
        availableFold.historicalQuantiles!.p50,
        availableFold.historicalQuantiles!.p75,
        availableFold.historicalQuantiles!.p90,
      ]);
    const gtd = BigInt(result.scenario.gtd.minorUnits)
      * (10n ** BigInt(result.scenario.calculationScale - result.scenario.gtd.scale));
    const contribution = BigInt(result.scenario.prizeContributionPerEntry.minorUnits)
      * (10n ** BigInt(
        result.scenario.calculationScale - result.scenario.prizeContributionPerEntry.scale
      ));
    expect(result.scenario.requiredEntries).toBe(((gtd + contribution - 1n) / contribution).toString());
  });

  it("does not let an extra caller field upgrade Jeju evidence quality", async () => {
    const inputWithIgnoredUpgrade = {
      ...adapterInput(),
      evidenceQuality: "verified",
    } as GtdStressComparableAdapterInput;
    const result = await createGtdStressScenarioFromComparableArtifact(inputWithIgnoredUpgrade);
    expect(result.scenario.evidenceQuality).toBe("unverified");
  });

  it("keeps identical trusted inputs byte-identical and deeply immutable", async () => {
    const first = await createGtdStressScenarioFromComparableArtifact(adapterInput());
    const second = await createGtdStressScenarioFromComparableArtifact(adapterInput());
    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.provenance)).toBe(true);
    expect(Object.isFrozen(first.scenario)).toBe(true);
  });

  it("keeps an unavailable artifact fold unavailable without fabricating quantiles", async () => {
    const result = await createGtdStressScenarioFromComparableArtifact(
      adapterInput(unavailableFold, { bundle: unavailableBundle }),
    );
    expect(result.provenance.failureState).toBe(unavailableFold.failureState);
    expect(result.provenance.availabilityState).toBe("unavailable");
    expect(result.scenario.state).toBe("unavailable");
    if (result.scenario.state === "unavailable") {
      expect(result.scenario.unavailableReason).toBe("unavailable_historical_distribution");
      expect(result.scenario.quantileScenarios).toEqual([]);
    }
  });

  it("rejects a fold ID from a different valid artifact and an unknown fold ID", async () => {
    const foreignFold = changedDefinitionBundle.artifact.payload.foldPredictions.find(
      (fold) => fold.targetEventId === availableFold.targetEventId
        && fold.evaluationProtocolId === availableFold.evaluationProtocolId,
    )!;
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      foldId: foreignFold.foldId,
    }))).rejects.toMatchObject({ code: "GTD_STRESS_FOLD_CARDINALITY_MISMATCH" });
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      foldId: "unknown-fold",
    }))).rejects.toMatchObject({ code: "GTD_STRESS_FOLD_CARDINALITY_MISMATCH" });
  });

  it("rejects wrong target events and target-mismatched GTD or contribution claims", async () => {
    const otherEvent = dataset.events.find((event) => event.id !== availableFold.targetEventId)!;
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      targetEventId: otherEvent.id,
    }))).rejects.toMatchObject({ code: "GTD_STRESS_FOLD_TARGET_MISMATCH" });
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      gtdClaims: claimsFor(otherEvent.id, "gtd"),
    }))).rejects.toMatchObject({ code: "GTD_STRESS_EVIDENCE_TARGET_MISMATCH" });
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      prizeContributionClaims: claimsFor(otherEvent.id, "buy_in_prize"),
    }))).rejects.toMatchObject({ code: "GTD_STRESS_EVIDENCE_TARGET_MISMATCH" });
  });

  it("rejects a forged artifact whose content no longer matches its identity", async () => {
    const forged = structuredClone(bundle);
    (forged.artifact as { artifactId: string }).artifactId = `${bundle.artifact.artifactId}-forged`;
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      bundle: forged,
    }))).rejects.toMatchObject({ code: "RESEARCH_ARTIFACT_INTEGRITY_MISMATCH" });
  });

  it("rejects artifact/execution and artifact/definition graph mismatches", async () => {
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      bundle: { ...bundle, researchExecution: changedExecutionBundle.researchExecution },
    }))).rejects.toMatchObject({
      code: expect.stringMatching(/UNKNOWN_RESEARCH_ARTIFACT_EXECUTION|RESEARCH_ARTIFACT_GRAPH_MISMATCH/),
    });
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      bundle: { ...bundle, researchDefinition: changedDefinitionBundle.researchDefinition },
    }))).rejects.toMatchObject({
      code: expect.stringMatching(/UNKNOWN_RESEARCH_DEFINITION|UNKNOWN_RESEARCH_ARTIFACT_DEFINITION/),
    });
  });

  it("rejects wrong artifact type and schema even when the artifact hash is valid", async () => {
    for (const override of [
      { artifactType: "other-research-artifact" },
      { artifactSchemaVersion: "v2" },
    ]) {
      const changed = await rebuiltArtifact(bundle.artifact, override);
      await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
        bundle: { ...bundle, artifact: changed as ComparableV0ResearchBundle["artifact"] },
      }))).rejects.toMatchObject({ code: "GTD_STRESS_COMPARABLE_ARTIFACT_MISMATCH" });
    }
    expect(bundle.artifact.artifactType).toBe(COMPARABLE_V0_ARTIFACT_TYPE);
    expect(bundle.artifact.artifactSchemaVersion).toBe(COMPARABLE_V0_ARTIFACT_SCHEMA_VERSION);
  });

  it("rejects wrong method, selection protocol, and distribution method", async () => {
    const payloads = [
      { ...bundle.artifact.payload, methodId: "wrong-method" },
      {
        ...bundle.artifact.payload,
        modelCard: { ...bundle.artifact.payload.modelCard, selectionProtocolId: "wrong-selection" },
      },
      {
        ...bundle.artifact.payload,
        modelCard: { ...bundle.artifact.payload.modelCard, distributionMethodId: "wrong-distribution" },
      },
    ];
    for (const payload of payloads) {
      const changed = await rebuiltArtifact(bundle.artifact, { payload });
      await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
        bundle: { ...bundle, artifact: changed as ComparableV0ResearchBundle["artifact"] },
      }))).rejects.toMatchObject({ code: "GTD_STRESS_COMPARABLE_METHOD_MISMATCH" });
    }
  });

  it("rejects duplicate matching folds even when the enclosing artifact is valid", async () => {
    const payload = {
      ...bundle.artifact.payload,
      foldPredictions: [...bundle.artifact.payload.foldPredictions, availableFold],
    };
    const changed = await rebuiltArtifact(bundle.artifact, { payload });
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      bundle: { ...bundle, artifact: changed as ComparableV0ResearchBundle["artifact"] },
    }))).rejects.toMatchObject({ code: "GTD_STRESS_FOLD_CARDINALITY_MISMATCH" });
  });

  it("rejects forged claim content and a claim outside the release", async () => {
    const original = claimsFor(availableFold.targetEventId, "gtd")[0];
    const forgedValue = {
      ...original,
      value: original.value.type === "money"
        ? { ...original.value, minorUnits: (BigInt(original.value.minorUnits) + 1n).toString() }
        : original.value,
    } as SourceClaim;
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      gtdClaims: [forgedValue],
    }))).rejects.toMatchObject({ code: "GTD_STRESS_EVIDENCE_IDENTITY_MISMATCH" });
    await expect(createGtdStressScenarioFromComparableArtifact(adapterInput(availableFold, {
      gtdClaims: [{ ...original, id: "claim-outside-release" }],
    }))).rejects.toMatchObject({ code: "GTD_STRESS_EVIDENCE_RELEASE_MISMATCH" });
  });
});
