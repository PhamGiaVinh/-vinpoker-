import { describe, expect, it } from "vitest";
import { festivalGaps, parseOpsIntelligenceContextV1, resolveIntelligenceScope, scopeForTournament, scopeKey, tournamentGaps } from "./opsIntelligenceContextV1";
import { contextQueryOptions } from "./opsIntelligenceContextQuery";

const clubId = "22222222-2222-2222-2222-222222222222";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tournament = (n: number, phase: string | null = null) => ({ tournamentId: id(n), name: "Not an identity", status: "scheduled", startTime: null, buyIn: 0, gtd: null, phase, flightLabel: null });
const fixture = () => ({ version: "ops-intelligence-context-v1", clubId, asOf: "2026-09-10T10:00:00.000Z", dailyTournaments: [tournament(1)], festivals: [{ festivalId: id(9), name: "Festival", status: "scheduled", finalTournamentId: id(3), tournaments: [tournament(2, "flight"), tournament(3, "final"), tournament(4)] }] });

describe("Wave 2 exact context boundary", () => {
  it("accepts PostgreSQL UUIDs, exact daily linkage, zero money and missing values", () => {
    const result = parseOpsIntelligenceContextV1(fixture(), clubId);
    expect(result.dailyTournaments[0]).toMatchObject({ buyIn: 0, gtd: null, startTime: null });
    expect(scopeForTournament(result, id(1))).toEqual({ kind: "daily", tournamentId: id(1) });
    expect(scopeForTournament(result, id(2))).toEqual({ kind: "flight", festivalId: id(9), tournamentId: id(2) });
    expect(scopeForTournament(result, id(3))?.kind).toBe("final");
    expect(scopeForTournament(result, id(4))).toBeNull();
    expect(scopeForTournament(result, id(9))).toBeNull();
    expect(resolveIntelligenceScope(result, { kind: "festival", festivalId: id(9) }).tournamentId).toBeNull();
    expect(resolveIntelligenceScope(result, { kind: "flight", festivalId: id(9), tournamentId: id(3) }).valid).toBe(false);
    expect(resolveIntelligenceScope(result, { kind: "daily", tournamentId: id(9) }).valid).toBe(false);
  });
  it("keeps unknown roles unknown and exposes gaps without repair", () => {
    const result = parseOpsIntelligenceContextV1(fixture(), clubId);
    expect(tournamentGaps(result.festivals[0].tournaments[2], true)).toContain("PHASE_UNSPECIFIED");
    expect(tournamentGaps(result.festivals[0].tournaments[0], true)).toContain("FLIGHT_LABEL_MISSING");
    expect(festivalGaps({ ...result.festivals[0], finalTournamentId: id(55) })).toEqual(["FINAL_POINTER_NOT_IN_LINKED_SET"]);
    expect(festivalGaps({ ...result.festivals[0], finalTournamentId: null, tournaments: [] })).toEqual(["NO_LINKED_TOURNAMENTS", "FINAL_TOURNAMENT_MISSING"]);
  });
  it.each([
    ["cross club", (f: ReturnType<typeof fixture>) => { f.clubId = id(99); }],
    ["duplicate tournament", (f: ReturnType<typeof fixture>) => { f.festivals[0].tournaments.push(tournament(1)); }],
    ["duplicate festival", (f: ReturnType<typeof fixture>) => { f.festivals.push(f.festivals[0]); }],
    ["daily role", (f: ReturnType<typeof fixture>) => { f.dailyTournaments[0].phase = "flight"; }],
    ["negative money", (f: ReturnType<typeof fixture>) => { f.dailyTournaments[0].buyIn = -1; }],
    ["unknown key", (f: ReturnType<typeof fixture>) => { Object.assign(f, { playerNames: [] }); }],
  ])("rejects %s", (_name, mutate) => { const value = fixture(); mutate(value); expect(() => parseOpsIntelligenceContextV1(value, clubId)).toThrow(); });
  it("preserves an exact empty result and does not silently resolve an absent request", () => {
    const result = parseOpsIntelligenceContextV1({ ...fixture(), dailyTournaments: [], festivals: [] }, clubId);
    expect(resolveIntelligenceScope(result, { kind: "club" }).valid).toBe(true);
    expect(resolveIntelligenceScope(result, { kind: "daily", tournamentId: id(1) }).valid).toBe(false);
    expect(scopeKey({ kind: "daily", tournamentId: id(9) })).not.toBe(scopeKey({ kind: "festival", festivalId: id(9) }));
  });
  it("has one canonical context key and fails without accepting a receipt on RPC errors", async () => {
    const client = { rpc: async () => ({ data: fixture(), error: null }) } as unknown as Parameters<typeof contextQueryOptions>[0];
    const options = contextQueryOptions(client, clubId);
    expect(options.queryKey).toEqual(["ops", clubId, "intelligence", "context-v1"]);
    expect((await options.queryFn()).value.clubId).toBe(clubId);
    const bad = { rpc: async () => ({ data: fixture(), error: { message: "denied" } }) } as unknown as typeof client;
    await expect(contextQueryOptions(bad, clubId).queryFn()).rejects.toThrow("CONTEXT_READ_UNAVAILABLE");
  });
});
