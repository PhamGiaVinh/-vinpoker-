import { describe, expect, it } from "vitest";
import { buildAlignedTimelineRows, parseOpsIntelligenceTimelineV1 } from "./opsIntelligenceTimelineV1";
import { timelineQueryOptions } from "./opsIntelligenceTimelineQuery";

const clubId = "22222222-2222-2222-2222-222222222222";
const tournamentId = "11111111-1111-1111-1111-111111111111";
const fixture = () => ({
  version: "ops-intelligence-timeline-v1", clubId, tournamentId, asOf: "2026-09-14T10:00:00.000Z",
  entries: { availability: "exact", reasonCode: null, points: [{ at: "2026-09-14T08:00:00.000Z", value: 2 }, { at: "2026-09-14T09:00:00.000Z", value: 1 }] },
  tables: { availability: "exact", reasonCode: null, capacityAvailability: "exact", capacityReasonCode: null, points: [{ at: "2026-09-14T08:00:00.000Z", value: 1, seatCapacity: 9 }] },
  dealers: { availability: "exact", reasonCode: null, points: [{ at: "2026-09-14T08:15:00.000Z", value: 1 }] },
  gtd: { availability: "exact", reasonCode: null, guaranteeState: "available", guaranteeAmount: 100, points: [{ at: "2026-09-14T07:00:00.000Z", value: 0 }, { at: "2026-09-14T08:30:00.000Z", value: 50 }] },
  dealerGaps: [{ from: "2026-09-14T08:00:00.000Z", to: "2026-09-14T08:15:00.000Z", maxGap: 1 }],
});

describe("Wave 3 operational timeline boundary", () => {
  it("preserves exact zero, active-entry steps and a shared step axis", () => {
    const value = parseOpsIntelligenceTimelineV1(fixture(), clubId, tournamentId);
    expect(value.gtd.points[0].value).toBe(0);
    expect(value.entries.points.map((row) => row.value)).toEqual([2, 1]);
    expect(buildAlignedTimelineRows(value).map((row) => row.at)).toEqual([
      "2026-09-14T07:00:00.000Z", "2026-09-14T08:00:00.000Z", "2026-09-14T08:15:00.000Z", "2026-09-14T08:30:00.000Z", "2026-09-14T09:00:00.000Z",
    ]);
  });
  it("keeps missing GTD unavailable and zero GTD as NO_GUARANTEE", () => {
    const missing = fixture();
    missing.gtd = { availability: "unavailable", reasonCode: "GTD_NOT_REPORTED", guaranteeState: "unavailable", guaranteeAmount: null, points: [] };
    expect(parseOpsIntelligenceTimelineV1(missing, clubId, tournamentId).gtd.guaranteeState).toBe("unavailable");
    const zero = fixture();
    zero.gtd = { availability: "exact", reasonCode: null, guaranteeState: "no_guarantee", guaranteeAmount: 0, points: [{ at: "2026-09-14T07:00:00.000Z", value: 0 }] };
    expect(parseOpsIntelligenceTimelineV1(zero, clubId, tournamentId).gtd.guaranteeAmount).toBe(0);
  });
  it("fails closed on partial bindings and never accepts a dealer gap from partial dealer truth", () => {
    const partial = fixture();
    partial.tables.capacityAvailability = "partial";
    partial.tables.capacityReasonCode = "TABLE_CAPACITY_BINDING_INCOMPLETE";
    partial.tables.points[0].seatCapacity = null;
    partial.dealers = { availability: "partial", reasonCode: "DEALER_SESSION_BINDING_INCOMPLETE", points: [] };
    partial.dealerGaps = [];
    expect(parseOpsIntelligenceTimelineV1(partial, clubId, tournamentId).dealers.availability).toBe("partial");
    partial.dealerGaps.push({ from: "2026-09-14T08:00:00.000Z", to: "2026-09-14T08:15:00.000Z", maxGap: 1 });
    expect(() => parseOpsIntelligenceTimelineV1(partial, clubId, tournamentId)).toThrow();
  });
  it("preserves partial lifecycle and GTD quality without inventing exact zero", () => {
    const partial = fixture();
    partial.entries = { availability: "partial", reasonCode: "ENTRY_SEATED_AT_MISSING", points: [] };
    partial.gtd = { availability: "partial", reasonCode: "CONFIRMED_AT_MISSING", guaranteeState: "available", guaranteeAmount: 100, points: [] };
    const parsed = parseOpsIntelligenceTimelineV1(partial, clubId, tournamentId);
    expect(parsed.entries.availability).toBe("partial");
    expect(parsed.gtd.availability).toBe("partial");
    expect(parsed.entries.points).toEqual([]);
    expect(parsed.gtd.points).toEqual([]);
  });
  it.each([
    ["wrong identity", (value: ReturnType<typeof fixture>) => { value.tournamentId = "33333333-3333-3333-3333-333333333333"; }],
    ["unknown key", (value: ReturnType<typeof fixture>) => { Object.assign(value, { playerNames: [] }); }],
    ["negative count", (value: ReturnType<typeof fixture>) => { value.entries.points[0].value = -1; }],
    ["unordered points", (value: ReturnType<typeof fixture>) => { value.entries.points.reverse(); }],
    ["missing reason", (value: ReturnType<typeof fixture>) => { value.dealers.availability = "partial"; }],
  ])("rejects %s", (_name, mutate) => { const value = fixture(); mutate(value); expect(() => parseOpsIntelligenceTimelineV1(value, clubId, tournamentId)).toThrow(); });
  it("uses one exact query key and freezes observedAt only after an accepted response", async () => {
    const client = { rpc: async () => ({ data: fixture(), error: null }) } as unknown as Parameters<typeof timelineQueryOptions>[0];
    const options = timelineQueryOptions(client, clubId, tournamentId);
    expect(options.queryKey).toEqual(["ops", clubId, "intelligence", "timeline-v1", tournamentId]);
    const accepted = await options.queryFn();
    expect(accepted.value.tournamentId).toBe(tournamentId);
    expect(Number.isFinite(Date.parse(accepted.observedAt))).toBe(true);
    const denied = { rpc: async () => ({ data: null, error: { code: "42501" } }) } as unknown as typeof client;
    await expect(timelineQueryOptions(denied, clubId, tournamentId).queryFn()).rejects.toThrow("OPERATIONAL_TIMELINE_READ_UNAVAILABLE");
  });
});
