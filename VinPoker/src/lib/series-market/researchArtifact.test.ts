import { describe, expect, it } from "vitest";
import { SeriesMarketValidationError } from "./normalization";
import {
  createResearchArtifact,
  validateResearchArtifact,
  type ResearchArtifact,
} from "./researchArtifact";

const BASE = {
  executionId: "series-market:research:v1:execution:test",
  researchDefinitionId: "series-market:research:v1:definition:test",
  artifactType: "test-evaluation",
  artifactSchemaVersion: "v1",
  createdAt: "2026-07-25T00:00:00Z",
  determinismLevel: "exact" as const,
  limitations: ["Exploratory only."],
  allowedClaims: ["The test output is deterministic."],
  forbiddenClaims: ["The test output is a production forecast."],
};

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

    await expect(validateResearchArtifact(forged)).rejects.toMatchObject<Partial<SeriesMarketValidationError>>({
      code: "RESEARCH_ARTIFACT_INTEGRITY_MISMATCH",
    });
  });
});
