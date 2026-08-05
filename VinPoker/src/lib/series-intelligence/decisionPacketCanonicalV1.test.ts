import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DecisionPacketCanonicalError,
  canonicalizeDecisionPacketV1,
  hashDecisionPacketV1,
  normalizeDecisionPacketCanonicalValue,
  normalizeDecisionPacketTextSet,
} from "./decisionPacketCanonicalV1";
import { buildDecisionPacketCanonicalVectorDefinitions } from "./decisionPacketCanonicalVectors";
import {
  buildDecisionPacketCreateRequestIdentity,
  buildEventActualCreateRequestIdentity,
  buildEventActualRevisionContent,
  eventActualCreateRequestHashPayload,
  eventActualRevisionContentHashPayload,
  type DecisionPacketCreateRequestInput,
  type EventActualCreateRequestInput,
} from "./decisionPacketV1";

const VECTOR_PATH = resolve(process.cwd(), "src/lib/series-intelligence/fixtures/decisionPacketCanonicalV1.vectors.json");

const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT_ID = "33333333-3333-4333-8333-333333333333";

function packetRequest(overrides: Partial<DecisionPacketCreateRequestInput> = {}): DecisionPacketCreateRequestInput {
  return {
    eventId: EVENT_ID,
    horizon: "T-7",
    targetMetric: "entries",
    asOfTs: "2026-08-01T10:00:00+07:00",
    sourceCutoff: "2026-08-01T02:00:00Z",
    targetEventTs: "2026-08-08T10:00:00+07:00",
    forecastSnapshotId: SNAPSHOT_ID,
    forecastState: "forecast_identity_eligible",
    manualExpectation: null,
    publicEvidence: [
      {
        kind: "forecast_snapshot",
        referenceId: SNAPSHOT_ID,
        contentHash: "a".repeat(64),
        sourceCutoff: "2026-08-01T02:00:00Z",
      },
    ],
    registrationSlice: null,
    campaignSlice: null,
    knownInformation: { observedRegistrationCount: 0 },
    recommendedAction: {
      text: "Review the attached snapshot.",
      sourceKind: "forecast_snapshot",
      sourceReferenceId: SNAPSHOT_ID,
    },
    ownerDecision: null,
    publicAction: null,
    decisionReason: null,
    alternatives: [],
    assumptions: [],
    uncertaintyNotes: null,
    supersedesPacketId: null,
    correctionReason: null,
    idempotencyKey: "packet:canonical-request-1",
    ...overrides,
  };
}

function actualRequest(overrides: Partial<EventActualCreateRequestInput> = {}): EventActualCreateRequestInput {
  const count = (value: number) => ({ availability: value === 0 ? "explicit_zero" as const : "present" as const, value });
  const money = (amountMinor: string) => ({
    availability: amountMinor === "0" ? "explicit_zero" as const : "present" as const,
    amountMinor,
    currency: "VND",
    scale: 0,
  });
  return {
    eventId: EVENT_ID,
    scope: "event_total",
    finality: "final",
    sourceTimestampState: "exact",
    sourceTimestamp: "2026-08-09T00:00:00.000Z",
    metrics: {
      entries: count(100),
      uniquePlayers: count(70),
      totalBullets: count(100),
      reentries: count(30),
      registrationRecords: count(100),
      paidPlaces: count(15),
      prizePool: money("600000000"),
      overlay: money("0"),
    },
    supersedesRevisionId: null,
    idempotencyKey: "actual:canonical-request-1",
    correctionReason: null,
    ...overrides,
  };
}

describe("decision packet canonical contract v1", () => {
  it("normalizes NFC and object order while preserving semantic array order", async () => {
    const first = await hashDecisionPacketV1({ beta: 0, alpha: "Cafe\u0301", list: [1, 2] });
    const reordered = await hashDecisionPacketV1({ list: [1, 2], alpha: "Caf\u00e9", beta: 0 });
    const differentArray = await hashDecisionPacketV1({ beta: 0, alpha: "Caf\u00e9", list: [2, 1] });
    expect(first).toEqual(reordered);
    expect(first.sha256).not.toBe(differentArray.sha256);
    expect(first.canonicalText).toContain("Caf\u00e9");
  });

  it("rejects unsupported machine keys, unsafe numbers, and post-normalization duplicate set members", () => {
    expect(() => normalizeDecisionPacketCanonicalValue({ snake_case: 1 })).toThrowError(
      expect.objectContaining<Partial<DecisionPacketCanonicalError>>({ code: "INVALID_CANONICAL_KEY" }),
    );
    expect(() => normalizeDecisionPacketCanonicalValue({ count: Number.MAX_SAFE_INTEGER + 1 })).toThrowError(
      expect.objectContaining<Partial<DecisionPacketCanonicalError>>({ code: "INVALID_CANONICAL_NUMBER" }),
    );
    expect(() => normalizeDecisionPacketTextSet(["Cafe\u0301", "Caf\u00e9"], "labels")).toThrowError(
      expect.objectContaining<Partial<DecisionPacketCanonicalError>>({ code: "DUPLICATE_LIST_MEMBER" }),
    );
  });

  it("rejects sub-millisecond timestamp inputs instead of silently truncating them", async () => {
    await expect(buildDecisionPacketCreateRequestIdentity(packetRequest({
      asOfTs: "2026-08-01T03:00:00.0001Z",
    }))).rejects.toMatchObject({ code: "INVALID_INSTANT" });
  });

  it("rejects invalid calendar timestamps instead of silently rolling them forward", async () => {
    await expect(buildDecisionPacketCreateRequestIdentity(packetRequest({
      asOfTs: "2026-02-30T03:00:00.000Z",
    }))).rejects.toMatchObject({ code: "INVALID_INSTANT" });
  });

  it("keeps idempotency transport details outside request identity but retains semantic changes", async () => {
    const first = await buildDecisionPacketCreateRequestIdentity(packetRequest({ idempotencyKey: "packet:request-0001" }));
    const retry = await buildDecisionPacketCreateRequestIdentity(packetRequest({ idempotencyKey: "packet:request-0002" }));
    const changed = await buildDecisionPacketCreateRequestIdentity(packetRequest({
      uncertaintyNotes: "Registration timing is incomplete.",
    }));
    expect(first).toEqual(retry);
    expect(first.requestHash).not.toBe(changed.requestHash);

    const actualFirst = await buildEventActualCreateRequestIdentity(actualRequest({ idempotencyKey: "actual:request-0001" }));
    const actualRetry = await buildEventActualCreateRequestIdentity(actualRequest({ idempotencyKey: "actual:request-0002" }));
    expect(actualFirst).toEqual(actualRetry);
  });

  it("binds actual content to its stored idempotency key while excluding it from request identity", async () => {
    const content = await buildEventActualRevisionContent({
      clubId: "11111111-1111-4111-8111-111111111111",
      eventId: EVENT_ID,
      scope: "event_total",
      finality: "final",
      sourceKind: "owner_manual",
      sourceTimestampState: "exact",
      sourceTimestamp: "2026-08-09T00:00:00.000Z",
      capturedAt: "2026-08-09T00:05:00.000Z",
      reconciliationStatus: "manual_only",
      metrics: actualRequest().metrics,
      supersedesRevisionId: null,
      reconcilesAutoRevisionId: null,
      reconcilesManualRevisionId: null,
      idempotencyKey: "actual:content-identity-1",
      correctionReason: null,
    });
    const contentPayload = eventActualRevisionContentHashPayload(content) as Record<string, unknown>;
    const requestPayload = eventActualCreateRequestHashPayload(content) as Record<string, unknown>;
    expect(contentPayload.idempotencyKey).toBe("actual:content-identity-1");
    expect(requestPayload).not.toHaveProperty("idempotencyKey");
  });

  it("matches the generated vector artifact without hand-maintained digests", async () => {
    const artifact = JSON.parse(await readFile(VECTOR_PATH, "utf8")) as {
      vectors: readonly { id: string; payload: unknown; canonicalText: string; utf8ByteLength: number; sha256: string }[];
    };
    const definitions = await buildDecisionPacketCanonicalVectorDefinitions();
    expect(artifact.vectors.map((vector) => vector.id)).toEqual(definitions.map((definition) => definition.id));
    for (const vector of artifact.vectors) {
      const hash = await hashDecisionPacketV1(vector.payload);
      expect(hash).toMatchObject({
        canonicalText: vector.canonicalText,
        utf8ByteLength: vector.utf8ByteLength,
        sha256: vector.sha256,
      });
    }
    expect(canonicalizeDecisionPacketV1(artifact.vectors[0].payload)).toBe(artifact.vectors[0].canonicalText);
  });
});
