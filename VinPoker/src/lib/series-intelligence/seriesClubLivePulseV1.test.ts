import { describe, expect, it } from "vitest";
import {
  mapSeriesClubLivePulseToCopilotClubPulseV1,
  parseSeriesClubLivePulseV1,
  SERIES_CLUB_PULSE_METRIC_DEFINITIONS,
  SERIES_CLUB_PULSE_METRIC_KEYS,
  type SeriesClubPulseMetricKey,
} from "./seriesClubLivePulseV1";

const AS_OF = "2026-08-09T12:34:56.789Z";
const CLUB_ID = "11111111-1111-4111-8111-111111111111";

function metric(key: SeriesClubPulseMetricKey, value: number, availability: "exact" | "partial" = "exact") {
  const definition = SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key];
  return {
    ...definition,
    value,
    unit: "count",
    availability,
    privacyState: value > 0 && value < 5 ? "small_cohort_suppressed" : "safe",
    asOf: AS_OF,
  };
}

function validPayload(): Record<string, unknown> {
  return {
    version: "series-club-live-pulse-v1",
    clubId: CLUB_ID,
    asOf: AS_OF,
    clubLocalDate: "2026-08-09",
    timezone: "Asia/Ho_Chi_Minh",
    clubMemberProfiles: metric("clubMemberProfiles", 12),
    uniquePlayersToday: metric("uniquePlayersToday", 3, "partial"),
    entriesToday: metric("entriesToday", 7),
    playersPlayingNow: metric("playersPlayingNow", 2, "partial"),
    runningEvents: metric("runningEvents", 1),
    openTables: metric("openTables", 4),
    dealersOnDuty: metric("dealersOnDuty", 5),
    dataQuality: {
      unavailableMetricIds: [],
      partialMetricIds: ["players_playing_now", "unique_players_today"],
      staleMetricIds: [],
    },
  };
}

describe("SeriesClubLivePulseV1", () => {
  it("parses and deeply freezes the complete owner aggregate", () => {
    const pulse = parseSeriesClubLivePulseV1(validPayload());
    expect(pulse.clubId).toBe(CLUB_ID);
    expect(pulse.uniquePlayersToday.availability).toBe("partial");
    expect(Object.isFrozen(pulse)).toBe(true);
    expect(Object.isFrozen(pulse.dataQuality.partialMetricIds)).toBe(true);
  });

  it.each([
    ["negative count", (payload: Record<string, unknown>) => ({ ...payload, runningEvents: metric("runningEvents", -1) })],
    ["fractional count", (payload: Record<string, unknown>) => ({ ...payload, runningEvents: metric("runningEvents", 1.5) })],
    ["unsafe count", (payload: Record<string, unknown>) => ({ ...payload, runningEvents: metric("runningEvents", Number.MAX_SAFE_INTEGER + 1) })],
    ["forged source", (payload: Record<string, unknown>) => ({ ...payload, runningEvents: { ...metric("runningEvents", 1), sourceId: "browser_guess" } })],
    ["unknown top-level key", (payload: Record<string, unknown>) => ({ ...payload, ownerName: "private" })],
    ["quality mismatch", (payload: Record<string, unknown>) => ({ ...payload, dataQuality: { unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] } })],
  ])("fails closed on %s", (_label, mutate) => {
    expect(() => parseSeriesClubLivePulseV1(mutate(validPayload()))).toThrow();
  });

  it("keeps missing distinct from zero and requires the timezone failure reason", () => {
    const payload = validPayload();
    const unavailable = (key: "uniquePlayersToday" | "entriesToday") => ({
      ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key],
      value: null,
      unit: "count",
      availability: "unavailable",
      privacyState: "not_exportable",
      asOf: AS_OF,
      unavailableReason: "CLUB_TIMEZONE_UNAVAILABLE",
    });
    payload.timezone = null;
    payload.clubLocalDate = null;
    payload.uniquePlayersToday = unavailable("uniquePlayersToday");
    payload.entriesToday = unavailable("entriesToday");
    payload.dataQuality = {
      unavailableMetricIds: ["entries_today", "unique_players_today"],
      partialMetricIds: ["players_playing_now"],
      staleMetricIds: [],
    };
    const pulse = parseSeriesClubLivePulseV1(payload);
    expect(pulse.entriesToday.value).toBeNull();
    expect(pulse.runningEvents.value).toBe(1);

    const forgedZero = structuredClone(payload);
    (forgedZero.entriesToday as Record<string, unknown>).value = 0;
    expect(() => parseSeriesClubLivePulseV1(forgedZero)).toThrow(/must be null/);
  });

  it("enforces small-cohort privacy without hiding the owner-visible aggregate", () => {
    const payload = validPayload();
    payload.runningEvents = { ...metric("runningEvents", 1), privacyState: "safe" };
    expect(() => parseSeriesClubLivePulseV1(payload)).toThrow(/small cohort/);
  });

  it("maps every trusted metric to the existing Copilot context without losing provenance", () => {
    const pulse = parseSeriesClubLivePulseV1(validPayload());
    const mapped = mapSeriesClubLivePulseToCopilotClubPulseV1(pulse);
    expect(mapped.sourceMode).toBe("server_aggregate");
    expect(mapped.metrics).toHaveLength(SERIES_CLUB_PULSE_METRIC_KEYS.length);
    const unique = mapped.metrics.find((item) => item.metricId === "unique_players_today");
    expect(unique).toMatchObject({
      value: 3,
      availability: "partial",
      privacyState: "small_cohort_suppressed",
      sourceId: "tournament_registrations.tournament_entries",
      grain: "club_local_calendar_day",
      definitionVersion: "club-unique-players-local-day-v1",
    });
    expect(Object.isFrozen(mapped)).toBe(true);
  });
});
