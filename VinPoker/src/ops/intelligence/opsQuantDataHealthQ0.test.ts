import { describe, expect, it } from "vitest";
import { buildOpsDataHealthQ0, parseOpsRegistrationPaceQ0, parseOpsSepayReadStateQ0 } from "./opsQuantDataHealthQ0";

const CLUB = "10000000-0000-4000-8000-000000000001";
const EVENT = "20000000-0000-4000-8000-000000000001";
const AS_OF = "2026-08-29T10:00:00.000Z";

function registration(overrides: Record<string, unknown> = {}) {
  return {
    version: "ops-registration-observed-q0", clubId: CLUB, asOf: AS_OF,
    window: { from: "2026-08-28T10:00:00.000Z", to: "2026-09-12T10:00:00.000Z" },
    events: [{ eventId: EVENT, eventName: "Main Event", eventState: "scheduled", startTime: "2026-08-30T10:00:00.000Z", confirmedEntries: 2, uniquePlayers: 1, reentries: 1, firstRegistrationAt: "2026-08-29T09:00:00.000Z", lastRegistrationAt: "2026-08-29T09:30:00.000Z", last1h: 2, last6h: 2, last24h: 2, timelineAvailability: "exact", timelineReasonCode: null, timeline: [{ bucketStart: "2026-08-29T09:00:00.000Z", observedCount: 2, cumulativeCount: 2 }] }],
    ...overrides,
  };
}

function sepay(overrides: Record<string, unknown> = {}) {
  return {
    version: "ops-sepay-read-state-q0", clubId: CLUB, asOf: AS_OF,
    window: { from: "2026-08-28T10:00:00.000Z", to: AS_OF }, latestObservedTransactionAt: "2026-08-29T09:30:00.000Z",
    buckets: [
      { state: "actionable", transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact", amountReasonCode: null },
      { state: "resolved", transactionCount: 2, inboundAmountVnd: 4_000_000, amountAvailability: "exact", amountReasonCode: null },
      { state: "quarantined", transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact", amountReasonCode: null },
    ], ...overrides,
  };
}

describe("Ops Quant Data Health Q0 contracts", () => {
  it("preserves exact zero without converting it to missing", () => {
    const parsed = parseOpsSepayReadStateQ0(sepay());
    expect(parsed.buckets[0]).toMatchObject({ transactionCount: 0, inboundAmountVnd: 0, amountAvailability: "exact" });
  });

  it("accepts empty exact registration events", () => {
    expect(parseOpsRegistrationPaceQ0(registration({ events: [] })).events).toEqual([]);
  });

  it("rejects malformed timestamps and unordered timeline buckets", () => {
    expect(() => parseOpsRegistrationPaceQ0(registration({ asOf: "today" }))).toThrow(/INVALID/);
    const value = registration();
    const event = (value.events as Record<string, unknown>[])[0];
    event.timeline = [
      { bucketStart: "2026-08-29T09:00:00.000Z", observedCount: 1, cumulativeCount: 1 },
      { bucketStart: "2026-08-29T08:00:00.000Z", observedCount: 1, cumulativeCount: 2 },
    ];
    expect(() => parseOpsRegistrationPaceQ0(value)).toThrow(/ORDERING/);
  });

  it("does not permit invented unique or re-entry counts", () => {
    const value = registration();
    (value.events as Record<string, unknown>[])[0].uniquePlayers = 3;
    expect(() => parseOpsRegistrationPaceQ0(value)).toThrow(/INVARIANT/);
  });

  it("keeps a partial registration timeline explicitly partial", () => {
    const value = registration();
    Object.assign((value.events as Record<string, unknown>[])[0], { timelineAvailability: "partial", timelineReasonCode: "CONFIRMED_AT_MISSING" });
    expect(parseOpsRegistrationPaceQ0(value).events[0]).toMatchObject({ timelineAvailability: "partial", timelineReasonCode: "CONFIRMED_AT_MISSING" });
  });

  it("accepts a future-timestamp partial timeline whose observed total is below the confirmed count", () => {
    const value = registration();
    Object.assign((value.events as Record<string, unknown>[])[0], {
      confirmedEntries: 3,
      uniquePlayers: 2,
      timelineAvailability: "partial",
      timelineReasonCode: "FUTURE_CONFIRMED_AT",
    });
    expect(parseOpsRegistrationPaceQ0(value).events[0]).toMatchObject({
      confirmedEntries: 3,
      timelineAvailability: "partial",
      timelineReasonCode: "FUTURE_CONFIRMED_AT",
    });
  });

  it("rejects invented rolling-window and cumulative counts", () => {
    const windows = registration();
    (windows.events as Record<string, unknown>[])[0].last1h = 3;
    expect(() => parseOpsRegistrationPaceQ0(windows)).toThrow(/WINDOW_INVARIANT/);

    const cumulative = registration();
    ((cumulative.events as Record<string, unknown>[])[0].timeline as Record<string, unknown>[])[0].cumulativeCount = 3;
    expect(() => parseOpsRegistrationPaceQ0(cumulative)).toThrow(/TIMELINE_INVARIANT/);
  });

  it("rejects unsafe VND and sensitive raw SePay fields", () => {
    const unsafe = sepay();
    (unsafe.buckets as Record<string, unknown>[])[0].inboundAmountVnd = Number.MAX_SAFE_INTEGER + 1;
    expect(() => parseOpsSepayReadStateQ0(unsafe)).toThrow(/INVALID/);
    expect(() => parseOpsSepayReadStateQ0({ ...sepay(), accountNumber: "secret" })).toThrow(/UNEXPECTED_FIELDS/);
  });

  it("fails closed on unknown SePay state and malformed amount availability", () => {
    const unknown = sepay();
    (unknown.buckets as Record<string, unknown>[])[0].state = "pending";
    expect(() => parseOpsSepayReadStateQ0(unknown)).toThrow(/SEPAY_STATE/);
    const partial = sepay();
    Object.assign((partial.buckets as Record<string, unknown>[])[0], { amountAvailability: "partial", amountReasonCode: null });
    expect(() => parseOpsSepayReadStateQ0(partial)).toThrow(/AMOUNT_REASON/);
  });

  it("freezes accepted source receipts and marks the unapproved event source unavailable", () => {
    const model = buildOpsDataHealthQ0({ registration: { value: parseOpsRegistrationPaceQ0(registration()), observedAt: AS_OF, reasonCode: null }, sepay: { value: parseOpsSepayReadStateQ0(sepay()), observedAt: AS_OF, reasonCode: null }, eventStreamObservedAt: AS_OF });
    expect(model.find((row) => row.sourceId === "event-stream")).toMatchObject({ availability: "unavailable", reasonCode: "EVENT_SOURCE_NOT_APPROVED" });
    expect(model[0].observedAt).toBe(AS_OF);
    expect(Object.isFrozen(model)).toBe(true);
  });

  it("propagates partial source semantics without claiming a freshness policy", () => {
    const partialRegistration = registration();
    Object.assign((partialRegistration.events as Record<string, unknown>[])[0], { timelineAvailability: "partial", timelineReasonCode: "CONFIRMED_AT_MISSING" });
    const partialSepay = sepay();
    Object.assign((partialSepay.buckets as Record<string, unknown>[])[0], { amountAvailability: "partial", amountReasonCode: "INBOUND_AMOUNT_MISSING" });
    const model = buildOpsDataHealthQ0({ registration: { value: parseOpsRegistrationPaceQ0(partialRegistration), observedAt: AS_OF, reasonCode: null }, sepay: { value: parseOpsSepayReadStateQ0(partialSepay), observedAt: AS_OF, reasonCode: null }, eventStreamObservedAt: AS_OF });
    expect(model.find((row) => row.sourceId === "registration-pace")).toMatchObject({ availability: "partial", freshness: "unknown", reasonCode: "REGISTRATION_TIMELINE_PARTIAL" });
    expect(model.find((row) => row.sourceId === "sepay")).toMatchObject({ availability: "partial", freshness: "unknown", reasonCode: "SEPAY_AMOUNT_PARTIAL" });
  });
});
