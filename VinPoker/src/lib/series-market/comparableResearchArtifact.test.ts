import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../series-intelligence/provenanceHash";
import {
  buildJejuComparableCorpus,
  evaluateComparableV0,
  type ComparableCorpus,
} from "./comparableEvent";
import {
  createComparableV0FoldPredictions,
  emitComparableV0ResearchBundle,
  validateComparableV0Parameters,
  type BiasDimension,
} from "./comparableResearchArtifact";
import { SeriesMarketValidationError } from "./normalization";
import { createVerifiedJejuReadModel } from "./verifiedMarketReadModel";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

async function model() {
  return createVerifiedJejuReadModel({
    canonicalImport: artifact("canonical/jeju_import_v1.json"),
    release: artifact("release.json"),
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
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

describe("Comparable V0 Research OS vertical slice", () => {
  it("emits byte-identical exact bundles with immutable, distinct identities", async () => {
    const readModel = await model();
    const first = await emitComparableV0ResearchBundle({ model: readModel, ...EXECUTION });
    const second = await emitComparableV0ResearchBundle({ model: readModel, ...EXECUTION });

    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(first.artifact.artifactId).toBe(second.artifact.artifactId);
    expect(first.artifact.artifactId).not.toBe(first.researchDefinition.researchDefinitionId);
    expect(first.artifact.artifactId).not.toBe(first.researchExecution.executionId);
    expect(first.researchExecution.determinismLevel).toBe("exact");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.artifact.payload.foldPredictions)).toBe(true);
  }, 120_000);

  it("reproduces PR #903 metrics without changing Comparable V0", async () => {
    const bundle = await emitComparableV0ResearchBundle({ model: await model(), ...EXECUTION });
    const chronological = bundle.artifact.payload.evaluationReports.find(
      (report) => report.evaluationProtocolId === "chronological-v1",
    )!;
    const lofo = bundle.artifact.payload.evaluationReports.find(
      (report) => report.evaluationProtocolId === "leave-one-festival-out-v1",
    )!;

    expect(chronological).toMatchObject({
      totalTargets: 87,
      pairedTargets: 54,
      unavailableTargets: 33,
      comparableMeanAbsoluteError: "204.852",
      baselineMeanAbsoluteError: "223.407",
      comparableMedianAbsoluteError: "56",
      comparableMeanSignedError: "-155.111",
    });
    expect(lofo).toMatchObject({
      totalTargets: 87,
      pairedTargets: 43,
      unavailableTargets: 44,
      comparableMeanAbsoluteError: "222.674",
      baselineMeanAbsoluteError: "238.698",
      comparableMedianAbsoluteError: "55",
      comparableMeanSignedError: "-198.907",
    });
    expect(chronological.pairedErrorDeltas).toHaveLength(54);
    expect(lofo.pairedErrorDeltas).toHaveLength(43);
  }, 120_000);

  it("keeps every unavailable fold explicit and labels quantiles as historical fields", async () => {
    const bundle = await emitComparableV0ResearchBundle({ model: await model(), ...EXECUTION });
    const folds = bundle.artifact.payload.foldPredictions;
    const unavailable = folds.filter((fold) => fold.availabilityState === "unavailable");
    const available = folds.filter((fold) => fold.availabilityState === "available");

    expect(folds).toHaveLength(174);
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable.every((fold) =>
      fold.failureState === "insufficient_historical_sample"
      && fold.historicalQuantiles === null
      && fold.pointBenchmark === null
      && fold.absoluteError === null,
    )).toBe(true);
    expect(available.every((fold) =>
      fold.historicalQuantiles?.interpretation === "historical comparable field quantiles",
    )).toBe(true);
  }, 120_000);

  it("keeps target outcomes out of fold selection identity and joins them afterward", async () => {
    const readModel = await model();
    const originalCorpus = buildJejuComparableCorpus(readModel);
    const originalEvaluation = evaluateComparableV0(originalCorpus);
    const latestFold = originalEvaluation.chronological.folds.at(-1)!;
    const changedOutcomes = originalCorpus.outcomes.map((outcome) =>
      outcome.eventId === latestFold.targetId
        ? { ...outcome, entries: (BigInt(outcome.entries) + 1n).toString() }
        : outcome,
    );
    const changedCorpus: ComparableCorpus = {
      ...originalCorpus,
      outcomes: changedOutcomes,
    };
    const changedEvaluation = evaluateComparableV0(changedCorpus);
    const parameters = validateComparableV0Parameters(undefined);
    const originalFolds = await createComparableV0FoldPredictions(
      originalCorpus,
      originalEvaluation,
      parameters,
    );
    const changedFolds = await createComparableV0FoldPredictions(
      changedCorpus,
      changedEvaluation,
      parameters,
    );
    const original = originalFolds.predictions.find(
      (fold) => fold.evaluationProtocolId === "chronological-v1" && fold.targetEventId === latestFold.targetId,
    )!;
    const changed = changedFolds.predictions.find(
      (fold) => fold.evaluationProtocolId === "chronological-v1" && fold.targetEventId === latestFold.targetId,
    )!;

    expect(changed.foldId).toBe(original.foldId);
    expect(changed.selectedComparableIds).toEqual(original.selectedComparableIds);
    expect(changed.actualEntries).not.toBe(original.actualEntries);
    expect(changed.signedError).not.toBe(original.signedError);
  }, 120_000);

  it("emits every requested bias dimension as non-causal exploratory diagnostics", async () => {
    const bundle = await emitComparableV0ResearchBundle({ model: await model(), ...EXECUTION });
    const expected = new Set<BiasDimension>([
      "event_family",
      "tour",
      "currency",
      "flagship_status",
      "buy_in_ratio_band",
      "gtd_state",
      "chronology_quarter",
      "festival",
      "field_size_bucket",
    ]);
    for (const report of bundle.artifact.payload.biasDecompositionReports) {
      expect(report.label).toBe("Exploratory Diagnostic");
      expect(report.causalInterpretationAllowed).toBe(false);
      expect(report.postHocBiasCorrectionApplied).toBe(false);
      expect(new Set(report.groups.map((group) => group.dimension))).toEqual(expected);
      expect(report.dimensionNotes.field_size_bucket).toMatch(/Post-outcome diagnostic only/);
    }
  }, 120_000);

  it("limits the model card to exploratory, same-currency, no-FX use", async () => {
    const card = (await emitComparableV0ResearchBundle({ model: await model(), ...EXECUTION }))
      .artifact.payload.modelCard;
    expect(card.status).toBe("exploratory");
    expect(card.calibrated).toBe(false);
    expect(card.productionForecast).toBe(false);
    expect(card.causalInterpretation).toBe(false);
    expect(card.boundaries.join(" ")).toMatch(/same currency/i);
    expect(card.prohibitedUse.join(" ")).toMatch(/FX conversion/);
    expect(card.intendedUse.join(" ")).not.toMatch(/overlay probability|optimal GTD|recommended GTD/i);
  }, 120_000);

  it("rejects unknown, nested, outcome, future, and mutable Comparable parameters", () => {
    expect(validateComparableV0Parameters(undefined)).toEqual({
      requestedComparables: 12,
      minimumDistributionN: 5,
    });
    expect(validateComparableV0Parameters({ requestedComparables: 8, minimumDistributionN: 4 }))
      .toEqual({ requestedComparables: 8, minimumDistributionN: 4 });
    for (const value of [
      { arbitrary: 1 },
      { requestedComparables: { nested: 1 } },
    ]) {
      expect(() => validateComparableV0Parameters(value)).toThrowError(
        expect.objectContaining<Partial<SeriesMarketValidationError>>({
          code: expect.stringMatching(/UNKNOWN_COMPARABLE_V0_PARAMETER|INVALID_COMPARABLE_V0_PARAMETER/),
        }),
      );
    }
    expect(() => validateComparableV0Parameters({ actualEntries: 999 })).toThrowError(
      expect.objectContaining({ code: "COMPARABLE_V0_PARAMETER_OUTCOME_LEAKAGE" }),
    );
    expect(() => validateComparableV0Parameters({ futureClaims: ["claim"] })).toThrowError(
      expect.objectContaining({ code: "COMPARABLE_V0_PARAMETER_MUTABLE_INPUT" }),
    );
    expect(() => validateComparableV0Parameters({ executedAt: "2026-07-25T00:00:00Z" })).toThrowError(
      expect.objectContaining({ code: "COMPARABLE_V0_PARAMETER_MUTABLE_INPUT" }),
    );
  });
});
