import {
  buildDecisionPacketContent,
  buildDecisionPacketCreateRequestIdentity,
  buildEventActualCreateRequestIdentity,
  buildEventActualRevisionContent,
  decisionPacketContentHashPayload,
  eventActualRevisionContentHashPayload,
  type DecisionPacketContentInput,
  type EventActualMetricsInput,
} from "./decisionPacketV1";
import { normalizeDecisionPacketTextSet } from "./decisionPacketCanonicalV1";

export interface DecisionPacketCanonicalVectorDefinition {
  readonly id: string;
  readonly payload: unknown;
}

const CLUB_ID = "ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF";
const EVENT_ID = "BCDEFABC-DEFA-4BCD-8BCD-BCDEFABCDEF1";
const SNAPSHOT_ID = "CDEFABCD-EFAB-4CDE-8CDE-CDEFABCDEF12";

function count(value: number) {
  return {
    availability: value === 0 ? "explicit_zero" as const : "present" as const,
    value,
  };
}

function money(amountMinor: string) {
  return {
    availability: amountMinor === "0" ? "explicit_zero" as const : "present" as const,
    amountMinor,
    currency: "VND",
    scale: 0,
  };
}

function metrics(): EventActualMetricsInput {
  return {
    entries: count(100),
    uniquePlayers: count(70),
    totalBullets: count(100),
    reentries: count(30),
    registrationRecords: count(100),
    paidPlaces: count(15),
    prizePool: money("600000000"),
    overlay: money("0"),
  };
}

function packetInput(): DecisionPacketContentInput {
  return {
    clubId: CLUB_ID,
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
        kind: "public_research_artifact",
        referenceId: "artifact:vietnam-supply-v1",
        contentHash: "a".repeat(64),
        sourceCutoff: "2026-07-31T00:00:00Z",
      },
      {
        kind: "forecast_snapshot",
        referenceId: SNAPSHOT_ID,
        contentHash: "b".repeat(64),
        sourceCutoff: "2026-08-01T02:00:00Z",
      },
    ],
    registrationSlice: {
      manifestId: "registration-slice:1",
      contentHash: "c".repeat(64),
      observationCount: 0,
      sourceCutoff: "2026-08-01T01:59:59Z",
    },
    campaignSlice: null,
    knownInformation: {
      currentGtdMinor: "6000000000",
      note: "Cafe\u0301",
      zeroObservedRegistrations: 0,
    },
    recommendedAction: {
      text: "Review the current staffing assumption.",
      sourceKind: "research_artifact",
      sourceReferenceId: "artifact:vietnam-supply-v1",
    },
    ownerDecision: "Keep the published schedule.",
    publicAction: null,
    decisionReason: "Preserve the current player communication.",
    alternatives: ["Keep the current announcement", "Delay a public update"],
    assumptions: ["Registration observations are incomplete"],
    uncertaintyNotes: "No unique-player count is available.",
    supersedesPacketId: null,
    correctionReason: null,
  };
}

export async function buildDecisionPacketCanonicalVectorDefinitions(): Promise<
  readonly DecisionPacketCanonicalVectorDefinition[]
> {
  const packet = await buildDecisionPacketContent(packetInput());
  if (packet.registrationSlice === null) throw new Error("canonical vector requires registration slice");
  const { clubId: _clubId, ...packetCreateRequestInput } = packetInput();
  const packetRequest = await buildDecisionPacketCreateRequestIdentity({
    ...packetCreateRequestInput,
    idempotencyKey: "packet:canonical-vector-1",
  });
  const actual = await buildEventActualRevisionContent({
    clubId: CLUB_ID,
    eventId: EVENT_ID,
    scope: "event_total",
    finality: "final",
    sourceKind: "owner_manual",
    sourceTimestampState: "exact",
    sourceTimestamp: "2026-08-09T00:00:00.000Z",
    capturedAt: "2026-08-09T00:05:00.000Z",
    reconciliationStatus: "manual_only",
    metrics: metrics(),
    supersedesRevisionId: null,
    reconcilesAutoRevisionId: null,
    reconcilesManualRevisionId: null,
    idempotencyKey: "actual:canonical-vector-1",
    correctionReason: null,
  });
  const actualRequest = await buildEventActualCreateRequestIdentity({
    eventId: EVENT_ID,
    scope: "event_total",
    finality: "final",
    sourceTimestampState: "exact",
    sourceTimestamp: "2026-08-09T00:00:00.000Z",
    metrics: metrics(),
    supersedesRevisionId: null,
    idempotencyKey: "actual:canonical-vector-1",
    correctionReason: null,
  });
  const setForward = normalizeDecisionPacketTextSet(["  Beta  ", "Alpha"], "vector set");
  const setReversed = normalizeDecisionPacketTextSet(["Alpha", "Beta"], "vector set");

  return [
    {
      id: "generic-nfc-object",
      payload: {
        alpha: "Cafe\u0301",
        beta: 0,
        nested: { a: true, z: null },
      },
    },
    {
      id: "generic-key-order-reversed",
      payload: {
        nested: { z: null, a: true },
        beta: 0,
        alpha: "Caf\u00e9",
      },
    },
    {
      id: "generic-json-escaping-and-unicode",
      payload: {
        emoji: "Poker 🂡",
        lineBreak: "first\nsecond\tvalue",
        quote: "\"quoted\" \\ escaped \u2028 separator",
      },
    },
    {
      id: "generic-zero-null-and-safe-integer",
      payload: {
        amountMinor: "600000000",
        missing: null,
        zero: 0,
        maxSafeInteger: Number.MAX_SAFE_INTEGER,
      },
    },
    {
      id: "semantic-array-forward",
      payload: { values: ["first", "second"] },
    },
    {
      id: "semantic-array-reversed",
      payload: { values: ["second", "first"] },
    },
    {
      id: "normalized-set-forward",
      payload: { values: setForward },
    },
    {
      id: "normalized-set-reversed",
      payload: { values: setReversed },
    },
    {
      id: "public-evidence-manifest",
      payload: packet.publicEvidence,
    },
    {
      id: "registration-slice-manifest",
      payload: packet.registrationSlice,
    },
    {
      id: "campaign-slice-manifest",
      payload: {
        manifestId: "campaign-slice:1",
        contentHash: "d".repeat(64),
        observationCount: 7,
        sourceCutoff: "2026-08-01T01:58:00.000Z",
      },
    },
    {
      id: "known-information",
      payload: packet.knownInformation,
    },
    {
      id: "packet-content",
      payload: decisionPacketContentHashPayload(packet),
    },
    {
      id: "packet-create-request",
      payload: JSON.parse(packetRequest.canonical) as unknown,
    },
    {
      id: "actual-content",
      payload: eventActualRevisionContentHashPayload(actual),
    },
    {
      id: "actual-create-request",
      payload: JSON.parse(actualRequest.canonical) as unknown,
    },
  ] as const;
}
