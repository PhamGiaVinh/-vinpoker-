import { describe, expect, it } from "vitest";
import {
  createDatasetReleaseId,
  createDerivedMetricId,
  createMarketEventId,
  createMarketEventRelationshipId,
  createMarketFestivalId,
  createSourceClaimId,
  createSourceDocumentId,
  createSourceRevisionId,
} from "./identity";

describe("series-market deterministic identities", () => {
  it("uses visible versioned namespaces and prevents collisions across entity types and markets", async () => {
    const festival = await createMarketFestivalId({ marketKey: "jeju", festivalKey: "apt-2026" });
    const event = await createMarketEventId({ marketKey: "jeju", festivalKey: "apt-2026", eventKey: "main" });
    const otherMarket = await createMarketEventId({ marketKey: "seoul", festivalKey: "apt-2026", eventKey: "main" });

    expect(festival).toMatch(/^series-market:v1:festival:jeju:apt-2026:[0-9a-f]{64}$/);
    expect(event).toMatch(/^series-market:v1:event:jeju:apt-2026:main:[0-9a-f]{64}$/);
    expect(new Set([festival, event, otherMarket]).size).toBe(3);
  });

  it("gives equivalent canonical entity input the same ID", async () => {
    const a = await createMarketEventId({ marketKey: " JEJU ", festivalKey: "APT-2026", eventKey: "MAIN" });
    const b = await createMarketEventId({ marketKey: "jeju", festivalKey: "apt-2026", eventKey: "main" });
    expect(a).toBe(b);
  });

  it("normalizes claim values and preserves zero versus missing identity", async () => {
    const common = {
      entityId: "series-market:v1:event:jeju:apt-2026:main:abc",
      field: "entries",
      sourceRevisionId: "series-market:v1:source-revision:def",
      effectiveAt: "2026-07-13T09:30:00Z",
    } as const;
    const canonical = await createSourceClaimId({ ...common, value: { type: "integer", value: "120" } });
    const padded = await createSourceClaimId({ ...common, value: { type: "integer", value: "+00120" } });
    const zero = await createSourceClaimId({ ...common, value: { type: "integer", value: "0" } });
    const missing = await createSourceClaimId({ ...common, value: { type: "missing", reason: "not_disclosed" } });
    expect(canonical).toBe(padded);
    expect(zero).not.toBe(missing);
  });

  it("makes release identity order-independent without mutating caller arrays", async () => {
    const input = {
      marketKey: "jeju",
      sourceCutoff: "2026-07-13T09:30:00Z",
      entityIds: ["event-b", "event-a", "event-b"],
      claimIds: ["claim-c", "claim-a", "claim-b"],
      sourceRevisionIds: ["revision-b", "revision-a"],
    };
    const before = structuredClone(input);
    const a = await createDatasetReleaseId(input);
    const b = await createDatasetReleaseId({
      ...input,
      entityIds: ["event-a", "event-b"],
      claimIds: ["claim-b", "claim-c", "claim-a"],
      sourceRevisionIds: ["revision-a", "revision-b"],
    });
    expect(a).toBe(b);
    expect(input).toEqual(before);
  });

  it("makes metric identity order-independent for claim sets and object parameter keys", async () => {
    const a = await createDerivedMetricId({
      entityId: "event-a",
      metricKey: "required-field",
      methodVersion: "required-field-v1",
      inputClaimIds: ["claim-b", "claim-a", "claim-b"],
      parameters: { alpha: "0.1", bands: { high: 75, low: 25 } },
    });
    const b = await createDerivedMetricId({
      entityId: "event-a",
      metricKey: "required-field",
      methodVersion: "required-field-v1",
      inputClaimIds: ["claim-a", "claim-b"],
      parameters: { bands: { low: 25, high: 75 }, alpha: "0.1" },
    });
    expect(a).toBe(b);
    await expect(
      createDerivedMetricId({
        entityId: null,
        metricKey: "x",
        methodVersion: "v1",
        inputClaimIds: [],
        parameters: null,
      }),
    ).rejects.toMatchObject({ code: "DERIVED_INPUTS_REQUIRED" });
  });

  it("hashes source and relationship identities deterministically", async () => {
    const document = await createSourceDocumentId({ documentKey: "apt-results-2026", sourceType: "official_result" });
    const revision = await createSourceRevisionId({
      sourceDocumentId: document,
      revisionKey: "retrieval-1",
      retrievedAt: "2026-07-13T09:30:00Z",
      contentHash: "A".repeat(64),
    });
    const relationA = await createMarketEventRelationshipId({
      relationshipType: "satellite_to",
      fromEventId: "satellite",
      toEventId: "main",
      evidenceClaimIds: ["claim-b", "claim-a"],
    });
    const relationB = await createMarketEventRelationshipId({
      relationshipType: "satellite_to",
      fromEventId: "satellite",
      toEventId: "main",
      evidenceClaimIds: ["claim-a", "claim-b"],
    });
    expect(document).toMatch(/^series-market:v1:source-document:/);
    expect(revision).toMatch(/^series-market:v1:source-revision:/);
    expect(relationA).toBe(relationB);
  });
});
