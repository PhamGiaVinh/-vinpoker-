import { describe, expect, it } from "vitest";
import { buildServerCopilotContextV1, parseApprovedScheduleInputsV1, unavailableScheduleInputsV1 } from "./serverContext";

const CLUB_ID = "11111111-1111-4111-8111-111111111111";
const AS_OF = "2026-08-09T03:00:00.000Z";

function pulse() {
  const metric = (metricId: string, value: number, privacyState: "safe" | "small_cohort_suppressed" = "safe") => ({
    metricId, value, unit: "count", availability: "exact", privacyState, asOf: AS_OF,
    sourceId: `source_${metricId}`, grain: "club", definitionVersion: `${metricId}_v1`,
  });
  return {
    version: "series-club-live-pulse-v1", clubId: CLUB_ID, asOf: AS_OF,
    clubMemberProfiles: metric("club_member_profiles", 100),
    uniquePlayersToday: metric("unique_players_today", 4, "small_cohort_suppressed"),
    entriesToday: metric("entries_today", 8),
    playersPlayingNow: metric("players_playing_now", 3, "small_cohort_suppressed"),
    runningEvents: metric("running_events", 1, "small_cohort_suppressed"),
    openTables: metric("open_tables", 2, "small_cohort_suppressed"),
    dealersOnDuty: metric("dealers_on_duty", 6),
  };
}

describe("server Club Pulse context", () => {
  it("redacts small cohorts before calculating the context hash", async () => {
    const first = await buildServerCopilotContextV1(pulse(), CLUB_ID, unavailableScheduleInputsV1());
    const hidden = first.clubPulse.metrics.find((item) => item.metricId === "unique_players_today");
    expect(hidden).toMatchObject({ value: null, suppressionReason: "SMALL_COHORT_SUPPRESSED" });
    const changed = pulse();
    changed.uniquePlayersToday.value = 2;
    const second = await buildServerCopilotContextV1(changed, CLUB_ID, unavailableScheduleInputsV1());
    expect(second.contextHash).toBe(first.contextHash);
  });

  it("fails on forged club identity", async () => {
    await expect(buildServerCopilotContextV1(pulse(), "22222222-2222-4222-8222-222222222222", unavailableScheduleInputsV1())).rejects.toThrow("identity");
  });

  it("accepts matching legacy PostgreSQL club identities", async () => {
    const legacyClubId = "22222222-2222-2222-2222-222222222222";
    const legacyPulse = { ...pulse(), clubId: legacyClubId };
    await expect(buildServerCopilotContextV1(legacyPulse, legacyClubId, unavailableScheduleInputsV1())).resolves.toMatchObject({
      clubPulse: { sourceMode: "server_aggregate" },
    });
  });

  it("strictly parses approved server candidates and rejects unknown evidence", () => {
    const raw = {
      version: "series-approved-schedule-candidates-v1",
      clubId: CLUB_ID,
      asOf: AS_OF,
      candidateOptions: [{
        optionId: "option_a", labelVi: "Phương án A",
        buyIn: { amountMinor: "2000000", currency: "VND", scale: 0 },
        gtd: { amountMinor: "200000000", currency: "VND", scale: 0 },
        flights: 2, expectedDurationMinutes: null, requiredField: 100,
        structureState: "complete", capacityState: "unknown", collisionState: "unknown",
        gtdStressState: "supported", evidenceRefs: ["schedule_review"],
      }],
      evidence: [{ evidenceId: "schedule_review", labelVi: "Owner duyệt", sourceId: "series_schedule_candidates_v1", asOf: AS_OF, quality: "owner_scoped_server_aggregate", privacyState: "safe", metricIds: [] }],
      dataGaps: [],
    };
    expect(parseApprovedScheduleInputsV1(raw, CLUB_ID).candidateOptions[0].requiredField).toBe(100);
    raw.candidateOptions[0].evidenceRefs = ["unknown_evidence"];
    expect(() => parseApprovedScheduleInputsV1(raw, CLUB_ID)).toThrow("unknown evidence");
  });

  type MutableBoundaryFixture = {
    candidateOptions: Array<{
      gtd: { amountMinor: string; currency: string; scale: number };
      flights: number;
      requiredField: number | null;
    }>;
  };

  it.each([
    ["non-VND money", (raw: MutableBoundaryFixture) => { raw.candidateOptions[0].gtd.currency = "USD"; }],
    ["negative money", (raw: MutableBoundaryFixture) => { raw.candidateOptions[0].gtd.amountMinor = "-1"; }],
    ["fractional count", (raw: MutableBoundaryFixture) => { raw.candidateOptions[0].flights = 1.5; }],
    ["forged GTD support", (raw: MutableBoundaryFixture) => { raw.candidateOptions[0].requiredField = null; }],
  ])("rejects %s from the server boundary", (_label, mutate) => {
    const raw = {
      version: "series-approved-schedule-candidates-v1", clubId: CLUB_ID, asOf: AS_OF,
      candidateOptions: [{
        optionId: "option_a", labelVi: "Phương án A",
        buyIn: { amountMinor: "2000000", currency: "VND", scale: 0 },
        gtd: { amountMinor: "200000000", currency: "VND", scale: 0 },
        flights: 2, expectedDurationMinutes: null, requiredField: 100,
        structureState: "complete", capacityState: "unknown", collisionState: "unknown",
        gtdStressState: "supported", evidenceRefs: ["schedule_review"],
      }],
      evidence: [{ evidenceId: "schedule_review", labelVi: "Owner duyệt", sourceId: "series_schedule_candidates_v1", asOf: AS_OF, quality: "owner_scoped_server_aggregate", privacyState: "safe", metricIds: [] }],
      dataGaps: [],
    };
    mutate(raw);
    expect(() => parseApprovedScheduleInputsV1(raw, CLUB_ID)).toThrow();
  });
});

export { AS_OF, CLUB_ID, pulse };
