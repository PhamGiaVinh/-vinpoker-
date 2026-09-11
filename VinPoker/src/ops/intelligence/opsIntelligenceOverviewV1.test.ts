import { describe, expect, it } from "vitest";
import { buildOpsIntelligenceOverviewV1, sourceTarget, type OverviewInputV1 } from "./opsIntelligenceOverviewV1";
import type { TournamentContextV1 } from "./opsIntelligenceContextV1";

const child = (tournamentId: string): TournamentContextV1 => ({ tournamentId, name: tournamentId, status: "scheduled", startTime: null, buyIn: null, gtd: 2_000_000_000, phase: "flight", flightLabel: null });
const input = (): OverviewInputV1 => ({
  clubId: "club", scope: { kind: "club" }, contextReason: null,
  context: { observedAt: "2026-09-10T00:00:01.000Z", value: { version: "ops-intelligence-context-v1", clubId: "club", asOf: "2026-09-10T00:00:00.000Z", dailyTournaments: [], festivals: [{ festivalId: "festival", name: "Festival", status: "scheduled", finalTournamentId: null, tournaments: [child("flight-a"), child("flight-b")] }] } },
  pulse: null, registration: { observedAt: "2026-09-10T00:00:01.000Z", value: { version: "ops-registration-observed-q0", clubId: "club", asOf: "2026-09-10T00:00:00.000Z", window: { from: "2026-09-09T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z" }, events: [] } }, sepay: null,
  operations: { asOf: null, observedAt: "", availability: "unavailable", reasonCode: "READ_FAILED", rows: [], runningTournamentIds: [], openTableCount: null, configuredTableCount: null, operationalTableCount: null, dealersOnDutyCount: null, countComparisonEligible: false },
});
describe("Wave 2 overview truth", () => {
  it.each([
    ["registration", "health", "Mở Data Health"],
    ["sepay", "health", "Mở Data Health"],
    ["operations", "live", "Mở Live Ops"],
    ["context", "overview", "Đọc lại phạm vi"],
  ])("routes unavailable %s to its actual owner", (source, tab, label) => {
    const value = { ...input(), context: null, registration: null };
    expect(sourceTarget(source)).toMatchObject({ tab, label });
    const action = buildOpsIntelligenceOverviewV1(value).actions.find((row) => row.id === source);
    expect(action).toMatchObject({ tab, scope: value.scope });
    expect(action?.retryContext === true).toBe(source === "context");
  });
  it("does not offer history or unknown sources false remediation", () => {
    expect(sourceTarget("history")).toBeNull();
    expect(sourceTarget("unknown")).toBeNull();
    expect(buildOpsIntelligenceOverviewV1(input()).actions.some((row) => row.source === "history")).toBe(false);
  });
  it("keeps structural context gaps at their exact scope without a retry action", () => {
    const actions = buildOpsIntelligenceOverviewV1(input()).actions;
    expect(actions.find((row) => row.reason === "FINAL_TOURNAMENT_MISSING")).toMatchObject({ tab: "overview", scope: { kind: "festival", festivalId: "festival" } });
    expect(actions.find((row) => row.reason === "FINAL_TOURNAMENT_MISSING")?.retryContext).toBeUndefined();
  });
  it("remains useful without Q0-window events without fabricating zero observations", () => {
    const model = buildOpsIntelligenceOverviewV1(input());
    expect(model.noWindowEvents).toBe(true);
    expect(model.metrics.every((row) => row.value === null)).toBe(true);
    expect(model.festivals).toHaveLength(1);
    expect(model.sources.find((row) => row.id === "registration")?.availability).toBe("exact");
    expect(model.sources.find((row) => row.id === "history")?.reason).toBe("HISTORY_NOT_MOUNTED");
    expect(model.actions.some((row) => row.reason === "FINAL_TOURNAMENT_MISSING")).toBe(true);
    expect(model.actions.some((row) => row.reason === "PHASE_UNSPECIFIED")).toBe(false);
  });
  it("does not turn unavailable Operations into zero allocated tables", () => {
    const value = input();
    value.scope = { kind: "flight", festivalId: "festival", tournamentId: "flight-a" };
    expect(buildOpsIntelligenceOverviewV1(value).metrics.find((row) => row.id === "selected-tables")?.value).toBeNull();
    value.operations = { ...value.operations, availability: "exact", observedAt: "2026-09-10T00:00:01.000Z" };
    const exact = buildOpsIntelligenceOverviewV1(value);
    expect(exact.metrics.find((row) => row.id === "selected-tables")?.value).toBe(0);
    expect(exact.metrics.find((row) => row.id === "selected-dealers")?.value).toBe(0);
  });
  it("never aggregates flight entries, unique players, shared GTD or final counts as festival truth", () => {
    const value = input();
    value.scope = { kind: "festival", festivalId: "festival" };
    value.operations = { ...value.operations, availability: "exact" };
    const model = buildOpsIntelligenceOverviewV1(value);
    expect(model.metrics.filter((row) => row.id.startsWith("selected-")).every((row) => row.value === null && row.availability === "unavailable")).toBe(true);
    expect(model.resolved.tournamentId).toBeNull();
    expect(model).not.toHaveProperty("gtd");
    expect(model.festivals[0].tournaments.map((row) => row.gtd)).toEqual([2_000_000_000, 2_000_000_000]);
  });
  it("does not change missing requested identities and keeps last-read semantics source-owned", () => {
    const value = input();
    value.scope = { kind: "daily", tournamentId: "removed" };
    const first = buildOpsIntelligenceOverviewV1(value);
    const second = buildOpsIntelligenceOverviewV1(value);
    expect(first).toEqual(second);
    expect(first.resolved.valid).toBe(false);
    expect(first.actions.find((row) => row.id === "scope")?.scope).toEqual(value.scope);
    expect(first.sources.find((row) => row.id === "operations")?.observedAt).toBeNull();
  });
});
