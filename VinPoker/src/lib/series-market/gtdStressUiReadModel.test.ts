import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createGtdStressEventReadModel,
  createJejuGtdStressResearchContext,
  getGtdStressEventEligibility,
  GTD_STRESS_UI_BUNDLE_FILE_SHA256,
  type JejuGtdStressResearchContext,
} from "./gtdStressUiReadModel";
import { SeriesMarketValidationError } from "./normalization";
import {
  createVerifiedJejuReadModel,
  type VerifiedMarketReadModel,
} from "./verifiedMarketReadModel";

const APP_ROOT = existsSync(join(process.cwd(), "src/lib/series-market"))
  ? process.cwd()
  : join(process.cwd(), "VinPoker");
const RELEASE_ROOT = join(APP_ROOT, "src/lib/series-market/datasets/jeju/v1");

function artifact(name: string): unknown {
  return JSON.parse(readFileSync(join(RELEASE_ROOT, name), "utf8")) as unknown;
}

function rawArtifact(name: string): string {
  return readFileSync(join(RELEASE_ROOT, name), "utf8");
}

let model: VerifiedMarketReadModel;
let context: JejuGtdStressResearchContext;

beforeAll(async () => {
  const canonicalImport = artifact("canonical/jeju_import_v1.json");
  const datasetRelease = artifact("release.json");
  model = await createVerifiedJejuReadModel({
    canonicalImport,
    release: datasetRelease,
    sourceManifest: artifact("source-manifest.json"),
    dataQuality: artifact("data-quality.json"),
  });
  context = await createJejuGtdStressResearchContext({
    model,
    rawBundle: rawArtifact("research/comparable-v0-exact-v1.json"),
    canonicalImport,
    datasetRelease,
  });
}, 60_000);

async function errorCode(task: Promise<unknown>): Promise<string | undefined> {
  try {
    await task;
    return undefined;
  } catch (error) {
    return error instanceof SeriesMarketValidationError ? error.code : undefined;
  }
}

describe("GTD Stress P2 read model", () => {
  it("locks the committed exact Comparable bundle by file SHA-256", () => {
    expect(context.artifactFileSha256).toBe(GTD_STRESS_UI_BUNDLE_FILE_SHA256);
    expect(context.bundle.artifact.payload.datasetReleaseId).toBe(model.releaseId);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.bundle)).toBe(true);
    expect(Object.isFrozen(context.bundle.artifact.payload.foldPredictions)).toBe(true);
  });

  it("identifies exactly seven Jeju V1 events with resolved GTD and prize contribution", () => {
    expect(context.readyEventIds).toHaveLength(7);
    expect(
      model.events.filter((event) => getGtdStressEventEligibility(event).state === "ready"),
    ).toHaveLength(7);
  });

  it("binds all seven eligible events to a validated chronological fold", async () => {
    let available = 0;
    for (const eventId of context.readyEventIds) {
      const readModel = await createGtdStressEventReadModel(context, eventId);
      expect(readModel.state).toBe("research");
      if (readModel.state !== "research") continue;
      expect(readModel.result.provenance.targetEventId).toBe(eventId);
      expect(readModel.result.provenance.evaluationProtocolId).toBe("chronological-v1");
      expect(readModel.result.scenario.evidenceQuality).toBe("unverified");
      expect(readModel.result.scenario.evidenceState).toBe("unverified_evidence");
      expect(readModel.evidenceN).toBeGreaterThanOrEqual(0);
      if (readModel.result.scenario.state === "available") available += 1;
    }
    expect(available).toBeGreaterThan(0);
  }, 90_000);

  it("keeps missing requirements explicit without fabricating a scenario", async () => {
    const event = model.events.find(
      (candidate) => getGtdStressEventEligibility(candidate).state === "requirements_missing",
    )!;
    const readModel = await createGtdStressEventReadModel(context, event.id);
    expect(readModel.state).toBe("requirements_missing");
    expect(readModel.eligibility.requirements.some((item) => item.state === "missing")).toBe(true);
    expect(readModel).not.toHaveProperty("result");
  });

  it("fails closed when the committed artifact bytes change", async () => {
    const rawBundle = rawArtifact("research/comparable-v0-exact-v1.json");
    expect(
      await errorCode(createJejuGtdStressResearchContext({
        model,
        rawBundle: `${rawBundle} `,
        canonicalImport: artifact("canonical/jeju_import_v1.json"),
        datasetRelease: artifact("release.json"),
      })),
    ).toBe("GTD_STRESS_UI_BUNDLE_HASH_MISMATCH");
  });

  it("rejects an unknown target and returns deeply immutable read models", async () => {
    expect(await errorCode(createGtdStressEventReadModel(context, "unknown-event")))
      .toBe("GTD_STRESS_UI_EVENT_CARDINALITY");

    const readModel = await createGtdStressEventReadModel(context, context.readyEventIds[0]!);
    expect(Object.isFrozen(readModel)).toBe(true);
    expect(Object.isFrozen(readModel.eligibility.requirements)).toBe(true);
    if (readModel.state === "research") {
      expect(Object.isFrozen(readModel.result.scenario)).toBe(true);
    }
  });
});
