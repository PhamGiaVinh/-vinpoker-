import { describe, expect, it } from "vitest";
import {
  buildDecisionPacketContent,
  buildEventActualRevision,
  buildEventActualRevisionContent,
  DecisionPacketValidationError,
  isEventActualEligibleForScoring,
  resolveEventActualTruth,
  validateEventActualRevisionGraph,
  type DecisionPacketContentInput,
  type EventActualMetricsInput,
  type EventActualRevision,
  type EventActualRevisionInput,
} from "./decisionPacketV1";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const CLUB = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";
const PACKET_PARENT = "44444444-4444-4444-8444-444444444444";
const REVISION_IDS = {
  r1: "50000000-0000-4000-8000-000000000001",
  r2: "50000000-0000-4000-8000-000000000002",
  r3: "50000000-0000-4000-8000-000000000003",
  r4: "50000000-0000-4000-8000-000000000004",
  r1Auto: "50000000-0000-4000-8000-000000000005",
  missing: "50000000-0000-4000-8000-000000000006",
  auto: "50000000-0000-4000-8000-000000000007",
  manual: "50000000-0000-4000-8000-000000000008",
  reconciled: "50000000-0000-4000-8000-000000000009",
  auto2: "50000000-0000-4000-8000-000000000010",
} as const;

function revisionId(label: keyof typeof REVISION_IDS): string {
  return REVISION_IDS[label];
}

const packetInput = (): DecisionPacketContentInput => ({
  clubId: CLUB,
  eventId: EVENT,
  horizon: "T-7",
  targetMetric: "entries",
  asOfTs: "2026-08-01T10:00:00+07:00",
  sourceCutoff: "2026-08-01T02:00:00Z",
  targetEventTs: "2026-08-08T10:00:00+07:00",
  forecastSnapshotId: SNAPSHOT,
  forecastState: "forecast_identity_eligible",
  manualExpectation: null,
  publicEvidence: [
    {
      kind: "public_research_artifact",
      referenceId: "artifact:vietnam-supply-v1",
      contentHash: SHA_A,
      sourceCutoff: "2026-07-31T00:00:00Z",
    },
  ],
  registrationSlice: {
    manifestId: "registration-slice:1",
    contentHash: SHA_B,
    observationCount: 12,
    sourceCutoff: "2026-08-01T01:59:59Z",
  },
  campaignSlice: null,
  knownInformation: {
    confirmedRegistrationObservations: 12,
    currentGtdMinor: "6000000000",
  },
  recommendedAction: {
    text: "Review the current staffing assumption.",
    sourceKind: "research_artifact",
    sourceReferenceId: "artifact:vietnam-supply-v1",
  },
  ownerDecision: "Keep the published schedule.",
  publicAction: null,
  decisionReason: "Preserve the current player communication.",
  alternatives: ["Delay a public update", "Keep the current announcement"],
  assumptions: ["Registration observations are incomplete"],
  uncertaintyNotes: "No unique-player count is available.",
  supersedesPacketId: null,
  correctionReason: null,
});

const missingCount = () => ({ availability: "missing" as const, value: null });
const count = (value: number) => ({
  availability: value === 0 ? "explicit_zero" as const : "present" as const,
  value,
});
const missingMoney = () => ({
  availability: "missing" as const,
  amountMinor: null,
  currency: null,
  scale: null,
});
const money = (amountMinor: string) => ({
  availability: amountMinor === "0" ? "explicit_zero" as const : "present" as const,
  amountMinor,
  currency: "VND",
  scale: 0,
});

const metrics = (): EventActualMetricsInput => ({
  entries: count(100),
  uniquePlayers: count(70),
  totalBullets: count(100),
  reentries: count(30),
  registrationRecords: count(100),
  paidPlaces: count(15),
  prizePool: money("600000000"),
  overlay: money("0"),
});

const actualInput = (
  revisionId: string,
  overrides: Partial<EventActualRevisionInput> = {},
): EventActualRevisionInput => ({
  revisionId,
  clubId: CLUB,
  eventId: EVENT,
  scope: "event_total",
  finality: "final",
  sourceKind: "auto_capture",
  sourceTimestampState: "exact",
  sourceTimestamp: "2026-08-09T00:00:00Z",
  capturedAt: "2026-08-09T00:05:00Z",
  reconciliationStatus: "auto_only",
  metrics: metrics(),
  supersedesRevisionId: null,
  reconcilesAutoRevisionId: null,
  reconcilesManualRevisionId: null,
  idempotencyKey: `actual:${revisionId}`,
  correctionReason: null,
  ...overrides,
});

async function revision(
  revisionLabel: keyof typeof REVISION_IDS,
  overrides: Partial<EventActualRevisionInput> = {},
): Promise<EventActualRevision> {
  return buildEventActualRevision(actualInput(revisionId(revisionLabel), overrides));
}

function expectCode(action: () => unknown | Promise<unknown>, code: string) {
  return expect(action).rejects.toMatchObject<Partial<DecisionPacketValidationError>>({ code });
}

describe("Decision Packet V1 content", () => {
  it("normalizes timezone-equivalent inputs and is deterministic", async () => {
    const first = await buildDecisionPacketContent(packetInput());
    const second = await buildDecisionPacketContent({
      ...packetInput(),
      asOfTs: "2026-08-01T03:00:00Z",
      targetEventTs: "2026-08-08T03:00:00Z",
      publicEvidence: [...packetInput().publicEvidence].reverse(),
      assumptions: [...packetInput().assumptions].reverse(),
      alternatives: [...packetInput().alternatives].reverse(),
    });
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.asOfTs).toBe("2026-08-01T03:00:00.000Z");
    expect(first.targetEventTs).toBe("2026-08-08T03:00:00.000Z");
  });

  it("does not mutate caller input and deeply freezes the result", async () => {
    const input = packetInput();
    const original = JSON.stringify(input);
    const result = await buildDecisionPacketContent(input);
    expect(JSON.stringify(input)).toBe(original);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.knownInformation)).toBe(true);
    expect(Object.isFrozen(result.publicEvidence)).toBe(true);
  });

  it("keeps missing forecast distinct from a manual zero expectation", async () => {
    const unavailable = await buildDecisionPacketContent({
      ...packetInput(),
      forecastSnapshotId: null,
      forecastState: "no_forecast_available",
      manualExpectation: null,
      recommendedAction: null,
    });
    const zero = await buildDecisionPacketContent({
      ...packetInput(),
      forecastSnapshotId: null,
      forecastState: "manual_expectation",
      manualExpectation: 0,
      recommendedAction: null,
    });
    expect(unavailable.contentHash).not.toBe(zero.contentHash);
    expect(zero.manualExpectation).toBe(0);
  });

  it("keeps an ineligible snapshot explicit and only links snapshots to entries", async () => {
    const ineligible = await buildDecisionPacketContent({
      ...packetInput(),
      forecastState: "forecast_not_identity_eligible",
    });
    expect(ineligible.forecastState).toBe("forecast_not_identity_eligible");

    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        targetMetric: "unique_players",
      }),
      "FORECAST_TARGET_MISMATCH",
    );
  });

  it("fails closed on future evidence, duplicate evidence, and malformed forecast shapes", async () => {
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        publicEvidence: [{
          ...packetInput().publicEvidence[0],
          sourceCutoff: "2026-08-02T00:00:00Z",
        }],
      }),
      "EVIDENCE_AFTER_CUTOFF",
    );
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        publicEvidence: [packetInput().publicEvidence[0], packetInput().publicEvidence[0]],
      }),
      "DUPLICATE_EVIDENCE",
    );
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        forecastState: "no_forecast_available",
      }),
      "INVALID_FORECAST_SHAPE",
    );
  });

  it("rejects control characters in references and narrative text", async () => {
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        publicEvidence: [{
          ...packetInput().publicEvidence[0],
          referenceId: "artifact:\u0000invalid",
        }],
      }),
      "INVALID_REFERENCE",
    );
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        ownerDecision: "Keep\u0001the schedule.",
      }),
      "INVALID_TEXT",
    );
  });

  it.each([
    ["actual_entries", 100],
    ["actualEntries", 100],
    ["FINALENTRIES", 100],
    ["final_prize_pool", "600000000"],
    ["player_id", "private-player-id"],
    ["playerId", "private-player-id"],
    ["Full Name", "private-player-name"],
    ["phone", "0900000000"],
  ])("rejects outcome or PII key %s anywhere in the information set", async (key, value) => {
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        knownInformation: { nested: { [key]: value } },
      }),
      "OUTCOME_OR_PII_LEAKAGE",
    );
  });

  it("requires sourced recommendations and append-only correction pairing", async () => {
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        recommendedAction: {
          text: "Act on the attached forecast.",
          sourceKind: "forecast_snapshot",
          sourceReferenceId: "wrong-snapshot",
        },
      }),
      "RECOMMENDATION_SOURCE_MISMATCH",
    );
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        recommendedAction: {
          text: "Use evidence that was not attached.",
          sourceKind: "research_artifact",
          sourceReferenceId: "artifact:not-attached",
        },
      }),
      "RECOMMENDATION_SOURCE_MISMATCH",
    );
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        recommendedAction: {
          text: "Unsupported source family.",
          sourceKind: "human_analysis" as never,
          sourceReferenceId: "human:untracked",
        },
      }),
      "INVALID_RECOMMENDATION",
    );
    await expectCode(
      () => buildDecisionPacketContent({
        ...packetInput(),
        supersedesPacketId: PACKET_PARENT,
        correctionReason: null,
      }),
      "INVALID_PACKET_CORRECTION",
    );
  });
});

describe("Event actual revision V1", () => {
  it("keeps missing, explicit zero, and positive values distinct", async () => {
    const missing = await buildEventActualRevisionContent({
      ...actualInput("r1"),
      metrics: { ...metrics(), overlay: missingMoney() },
    });
    const zero = await buildEventActualRevisionContent(actualInput("r2"));
    const positive = await buildEventActualRevisionContent({
      ...actualInput("r3"),
      metrics: { ...metrics(), overlay: money("1000000") },
    });
    expect(new Set([missing.contentHash, zero.contentHash, positive.contentHash]).size).toBe(3);
  });

  it("does not infer reentries from entries and unique players", async () => {
    const result = await buildEventActualRevisionContent({
      ...actualInput("r1"),
      metrics: { ...metrics(), reentries: missingCount() },
    });
    expect(result.metrics.reentries).toEqual({ availability: "missing", value: null });
  });

  it("enforces same-scope count and money invariants", async () => {
    await expectCode(
      () => buildEventActualRevisionContent({
        ...actualInput("r1"),
        metrics: { ...metrics(), uniquePlayers: count(101) },
      }),
      "ACTUAL_COUNT_INVARIANT",
    );
    await expectCode(
      () => buildEventActualRevisionContent({
        ...actualInput("r2"),
        metrics: {
          ...metrics(),
          overlay: { ...money("100"), currency: "USD" },
        },
      }),
      "MONEY_SCOPE_MISMATCH",
    );
  });

  it("requires exact publication semantics and append-only correction lineage", async () => {
    await expectCode(
      () => buildEventActualRevisionContent({
        ...actualInput("r1"),
        sourceTimestampState: "not_reported",
      }),
      "INVALID_SOURCE_TIME",
    );
    await expectCode(
      () => buildEventActualRevisionContent({
        ...actualInput("r2"),
        finality: "corrected",
      }),
      "INVALID_ACTUAL_CORRECTION",
    );
    await expectCode(
      () => buildEventActualRevisionContent({
        ...actualInput("r3"),
        finality: "void",
        supersedesRevisionId: revisionId("r1"),
        correctionReason: "Void invalid source.",
      }),
      "VOID_ACTUAL_HAS_VALUES",
    );
  });

  it("rejects self-reference, forged hashes, unknown parents, divergence, and chronology reversal", async () => {
    await expectCode(
      () => revision("r1", {
        finality: "corrected",
        supersedesRevisionId: revisionId("r1"),
        correctionReason: "Self reference.",
      }),
      "SELF_REFERENTIAL_REVISION",
    );

    const root = await revision("r1");
    const forged = { ...root, contentHash: SHA_A };
    await expectCode(() => validateEventActualRevisionGraph([forged]), "FORGED_REVISION");

    const secondAutoRoot = await revision("r1Auto", {
      idempotencyKey: "actual:r1-auto",
    });
    await expectCode(() => validateEventActualRevisionGraph([root, secondAutoRoot]), "DIVERGENT_REVISION");

    const unknown = await revision("r2", {
      finality: "corrected",
      supersedesRevisionId: revisionId("missing"),
      correctionReason: "Unknown parent.",
      capturedAt: "2026-08-10T00:00:00Z",
    });
    await expectCode(() => validateEventActualRevisionGraph([root, unknown]), "UNKNOWN_PREDECESSOR");

    const childA = await revision("r2", {
      finality: "corrected",
      supersedesRevisionId: revisionId("r1"),
      correctionReason: "Correction A.",
      capturedAt: "2026-08-10T00:00:00Z",
    });
    const childB = await revision("r3", {
      finality: "corrected",
      supersedesRevisionId: revisionId("r1"),
      correctionReason: "Correction B.",
      capturedAt: "2026-08-11T00:00:00Z",
    });
    await expectCode(() => validateEventActualRevisionGraph([root, childA, childB]), "DIVERGENT_REVISION");

    const reversed = await revision("r4", {
      finality: "corrected",
      supersedesRevisionId: revisionId("r1"),
      correctionReason: "Too early.",
      capturedAt: "2026-08-08T00:00:00Z",
      sourceTimestamp: "2026-08-08T00:00:00Z",
    });
    await expectCode(() => validateEventActualRevisionGraph([root, reversed]), "INVALID_REVISION_CHRONOLOGY");
  });

  it("requires explicit reconciliation when auto and manual heads coexist", async () => {
    const auto = await revision("auto");
    const manual = await revision("manual", {
      sourceKind: "owner_manual",
      reconciliationStatus: "manual_only",
      idempotencyKey: "manual:1",
    });
    const unresolved = await resolveEventActualTruth([auto, manual], EVENT, "event_total");
    expect(unresolved).toEqual({
      state: "needs_reconciliation",
      autoRevisionIds: [revisionId("auto")],
      manualRevisionIds: [revisionId("manual")],
    });

    const reconciled = await revision("reconciled", {
      sourceKind: "reconciled",
      reconciliationStatus: "matching",
      reconcilesAutoRevisionId: revisionId("auto"),
      reconcilesManualRevisionId: revisionId("manual"),
      idempotencyKey: "reconciled:1",
    });
    const resolved = await resolveEventActualTruth([auto, manual, reconciled], EVENT, "event_total");
    expect(resolved.state).toBe("current");
    if (resolved.state === "current") {
      expect(resolved.sourceState).toBe("reconciled");
      expect(resolved.revision.revisionId).toBe(revisionId("reconciled"));
    }
  });

  it("detects a reconciliation that no longer references current source heads", async () => {
    const auto = await revision("auto");
    const manual = await revision("manual", {
      sourceKind: "owner_manual",
      reconciliationStatus: "manual_only",
      idempotencyKey: "manual:1",
    });
    const reconciled = await revision("reconciled", {
      sourceKind: "reconciled",
      reconciliationStatus: "matching",
      reconcilesAutoRevisionId: revisionId("auto"),
      reconcilesManualRevisionId: revisionId("manual"),
      idempotencyKey: "reconciled:1",
    });
    const correctedAuto = await revision("auto2", {
      finality: "corrected",
      supersedesRevisionId: revisionId("auto"),
      correctionReason: "Late system correction.",
      capturedAt: "2026-08-10T00:00:00Z",
      sourceTimestamp: "2026-08-10T00:00:00Z",
    });
    const result = await resolveEventActualTruth(
      [auto, manual, reconciled, correctedAuto],
      EVENT,
      "event_total",
    );
    expect(result).toMatchObject({ state: "conflict", reason: "stale_reconciliation" });
  });

  it("only admits exact, post-cutoff, final event-total metrics for scoring", async () => {
    const exact = await revision("r1");
    expect(isEventActualEligibleForScoring(exact, "entries", "2026-08-08T00:00:00Z")).toBe(true);
    expect(isEventActualEligibleForScoring(exact, "unique_players", "2026-08-10T00:00:00Z")).toBe(false);

    const partial = await revision("r2", { scope: "partial_result", finality: "partial" });
    expect(isEventActualEligibleForScoring(partial, "entries", "2026-08-08T00:00:00Z")).toBe(false);

    const noUnique = await revision("r3", {
      metrics: { ...metrics(), uniquePlayers: missingCount() },
    });
    expect(isEventActualEligibleForScoring(noUnique, "unique_players", "2026-08-08T00:00:00Z")).toBe(false);
  });
});
