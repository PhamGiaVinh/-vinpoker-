import { describe, expect, it } from "vitest";
import { buildServerCopilotContextV1, unavailableScheduleInputsV1 } from "./serverContext";

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
});

export { AS_OF, CLUB_ID, pulse };
