import { describe, expect, it } from "vitest";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import type { OpsLiveOperationInputV1 } from "./opsIntelligenceReadModel";
import type { OpsRegistrationEventQ0, OpsRegistrationPaceQ0 } from "./opsQuantDataHealthQ0";
import { buildOpsQuantDashboardQ1, classifyGtdPressure, explainQuantArtifact, propagateQuantTruth, selectQuantEvent } from "./opsQuantDashboardQ1";
import { parsePrizePool } from "./opsQuantDashboardQ1Queries";

const TARGET_ID = "00000000-0000-4000-8000-000000000099";

describe("Ops Quant Dashboard Q1", () => {
  it("selects exact requested event, otherwise the earliest eligible future event", () => {
    const later = registrationEvent(TARGET_ID, "2026-06-12T12:00:00.000Z");
    const earlier = registrationEvent("00000000-0000-4000-8000-000000000098", "2026-06-10T12:00:00.000Z");
    expect(selectQuantEvent([later, earlier], "2026-06-01T00:00:00.000Z", [], TARGET_ID)?.eventId).toBe(TARGET_ID);
    expect(selectQuantEvent([later, earlier], "2026-06-01T00:00:00.000Z", [], null)?.eventId).toBe(earlier.eventId);
    expect(selectQuantEvent([later], "2026-07-01T00:00:00.000Z", [TARGET_ID], null)?.eventId).toBe(TARGET_ID);
  });

  it("propagates unavailable before hypothesis before derived", () => {
    expect(propagateQuantTruth(["OBSERVED", "DERIVED"])).toBe("DERIVED");
    expect(propagateQuantTruth(["OBSERVED", "HYPOTHESIS"])).toBe("HYPOTHESIS");
    expect(propagateQuantTruth(["HYPOTHESIS", "UNAVAILABLE"])).toBe("UNAVAILABLE");
  });

  it("uses non-overlapping GTD pressure inequalities", () => {
    expect(classifyGtdPressure(301, 200, 300)).toBe("PRESSURE");
    expect(classifyGtdPressure(250, 200, 300)).toBe("WATCH");
    expect(classifyGtdPressure(200, 200, 300)).toBe("ON_TRACK");
    expect(classifyGtdPressure(null, 200, 300)).toBe("UNAVAILABLE");
  });

  it("excludes every Q0-window event from research history and labels finality unverified", () => {
    const registration = registrationRead([registrationEvent(TARGET_ID, "2026-06-20T12:00:00.000Z")]);
    const history = Array.from({ length: 12 }, (_, index) => seriesEvent(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, `2025-${String(index + 1).padStart(2, "0")}-01T12:00:00.000Z`, 100 + index * 10));
    const target = seriesEvent(TARGET_ID, "2026-06-20T12:00:00.000Z", 9999);
    const model = buildOpsQuantDashboardQ1(baseInput(registration, [...history.slice(0, 5), target, ...history.slice(5)]));
    expect(model.selectedEvent?.eventId).toBe(TARGET_ID);
    expect(model.forecast.reasonCode).toBe("HISTORY_FINALITY_UNVERIFIED");
    expect(model.forecast.sampleSize).toBe(12);
    expect(model.forecast.truth).toBe("HYPOTHESIS");
  });

  it("compares demand with exact event allocation instead of club-wide context", () => {
    const registration = registrationRead([registrationEvent(TARGET_ID, "2026-06-20T12:00:00.000Z")]);
    const operations = operationInput(true);
    const model = buildOpsQuantDashboardQ1({ ...baseInput(registration, [seriesEvent(TARGET_ID, "2026-06-20T12:00:00.000Z", 200)]), operations, seatsPerTable: 9, customEntries: 36 });
    expect(model.capacity.eventAllocatedTableCount).toBe(2);
    expect(model.capacity.eventAssignedDealerCount).toBe(1);
    expect(model.capacity.clubConfiguredTableCount).toBe(40);
    const custom = model.scenarios.find((scenario) => scenario.scenarioId === "custom");
    expect(custom?.requiredTables).toBe(4);
    expect(custom?.additionalTableNeed).toBe(2);
    expect(custom?.additionalDealerNeed).toBe(3);
    expect(custom?.capacityStatus).toBe("WATCH");
  });

  it("keeps upcoming capacity as planning and standard scenarios isolated from custom inputs", () => {
    const registration = registrationRead([registrationEvent(TARGET_ID, "2026-06-20T12:00:00.000Z")]);
    const history = Array.from({ length: 12 }, (_, index) => seriesEvent(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, `2025-${String(index + 1).padStart(2, "0")}-01T12:00:00.000Z`, 100 + index));
    const model = buildOpsQuantDashboardQ1({ ...baseInput(registration, [...history, seriesEvent(TARGET_ID, "2026-06-20T12:00:00.000Z", 0)]), seatsPerTable: 9, customEntries: 500, customGtd: 9_000_000_000 });
    const base = model.scenarios.find((scenario) => scenario.scenarioId === "base");
    const custom = model.scenarios.find((scenario) => scenario.scenarioId === "custom");
    expect(base?.gtd).toBe(2_000_000_000);
    expect(custom?.gtd).toBe(9_000_000_000);
    expect(base?.entries).not.toBe(500);
    expect(custom?.capacityStatus).toBe("PLANNING_SCENARIO");
  });

  it("preserves observed zero and rejects malformed prize-pool payloads", () => {
    expect(parsePrizePool([{ prize_pool: 0, confirmed_entry_count: 0 }])).toEqual({ prizePool: 0, confirmedEntryCount: 0 });
    expect(() => parsePrizePool([{ prize_pool: "0", confirmed_entry_count: 0 }])).toThrow("PRIZE_POOL_READ_MALFORMED");
    expect(() => parsePrizePool([])).toThrow("PRIZE_POOL_READ_MALFORMED");
  });

  it("produces deterministic artifact explanations without claiming unsupported superiority", () => {
    const model = buildOpsQuantDashboardQ1(baseInput(registrationRead([]), []));
    const a = explainQuantArtifact(model, "baseline");
    const b = explainQuantArtifact(model, "baseline");
    expect(a).toEqual(b);
    expect(a.body).toContain("Chưa đủ bằng chứng");
  });
});

function baseInput(registration: OpsRegistrationPaceQ0, seriesEvents: readonly SeriesEvent[]) {
  return {
    requestedEventId: null,
    pulse: null,
    pulseAvailability: "unavailable" as const,
    operations: operationInput(false),
    registration,
    registrationAvailability: "exact" as const,
    sepay: null,
    sepayAvailability: "unavailable" as const,
    seriesEvents,
    seriesAvailability: "exact" as const,
    truePrizePool: null,
    prizePoolAvailability: "unavailable" as const,
    seatsPerTable: null,
    customEntries: null,
    customGtd: null,
  };
}

function registrationRead(events: readonly OpsRegistrationEventQ0[]): OpsRegistrationPaceQ0 {
  return Object.freeze({ version: "ops-registration-observed-q0", clubId: "00000000-0000-4000-8000-000000000001", asOf: "2026-06-01T00:00:00.000Z", window: { from: "2026-05-31T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" }, events });
}

function registrationEvent(eventId: string, startTime: string): OpsRegistrationEventQ0 {
  return Object.freeze({ eventId, eventName: `Event ${eventId.slice(-2)}`, eventState: "scheduled", startTime, confirmedEntries: 12, uniquePlayers: 10, reentries: 2, firstRegistrationAt: "2026-05-31T10:00:00.000Z", lastRegistrationAt: "2026-05-31T11:00:00.000Z", last1h: 2, last6h: 5, last24h: 12, timelineAvailability: "exact", timelineReasonCode: null, timeline: Object.freeze([{ bucketStart: "2026-05-31T10:00:00.000Z", observedCount: 12, cumulativeCount: 12 }]) });
}

function seriesEvent(eventId: string, eventDate: string, entries: number): SeriesEvent {
  return { event_id: eventId, event_name: "Main Event", event_date: eventDate, buy_in: 2_000_000, fee: 300_000, serviceFeeAmount: null, gtd: 2_000_000_000, prize_pool_actual: null, total_entries: entries, unique_entries: entries, reentries: 0, capacity: null, source: "native", clubId: "00000000-0000-4000-8000-000000000001", missingFields: ["prize_pool_actual"] };
}

function operationInput(running: boolean): OpsLiveOperationInputV1 {
  return Object.freeze({ observedAt: "2026-06-01T00:00:00.000Z", asOf: null, availability: "exact", reasonCode: null, rows: Object.freeze([
    { tableId: "table-1", tableName: "T1", tableStatus: "active", tournamentId: TARGET_ID, tournamentName: "Main", currentLevel: 4, averageStack: 30_000, dealerName: "Dealer A", dealerAssignmentState: "assigned", sourceAvailability: "exact" },
    { tableId: "table-2", tableName: "T2", tableStatus: "active", tournamentId: TARGET_ID, tournamentName: "Main", currentLevel: 4, averageStack: 30_000, dealerName: null, dealerAssignmentState: "missing", sourceAvailability: "exact" },
  ]), runningTournamentIds: Object.freeze(running ? [TARGET_ID] : []), openTableCount: 18, configuredTableCount: 40, operationalTableCount: 2, dealersOnDutyCount: 20, countComparisonEligible: true });
}
