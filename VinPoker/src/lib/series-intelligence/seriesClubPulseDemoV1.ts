import {
  mapClubPulseToExternalCopilotContextV1,
  parseSeriesClubLivePulseV1,
  SERIES_CLUB_PULSE_METRIC_DEFINITIONS,
  type SeriesClubLivePulseV1,
  type SeriesClubPulseMetricKey,
} from "./seriesClubLivePulseV1";
import type { ClubPulseV1 } from "./seriesCopilotContextV1";

export const SERIES_CLUB_PULSE_DEMO_VALUES = Object.freeze({
  clubMemberProfiles: 1_248,
  uniquePlayersToday: 86,
  entriesToday: 143,
  playersPlayingNow: 52,
  runningEvents: 5,
  openTables: 18,
  dealersOnDuty: 24,
} satisfies Readonly<Record<SeriesClubPulseMetricKey, number>>);

function localDateAt(asOf: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(asOf));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function demoMetric(key: SeriesClubPulseMetricKey, asOf: string) {
  return {
    ...SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key],
    value: SERIES_CLUB_PULSE_DEMO_VALUES[key],
    unit: "count",
    availability: "exact",
    privacyState: "safe",
    asOf,
  };
}

export function createSeriesClubPulseDemoV1(clubId: string, explicitAsOf: string): SeriesClubLivePulseV1 {
  const asOf = new Date(explicitAsOf).toISOString();
  return parseSeriesClubLivePulseV1({
    version: "series-club-live-pulse-v1",
    clubId,
    asOf,
    clubLocalDate: localDateAt(asOf),
    timezone: "Asia/Ho_Chi_Minh",
    clubMemberProfiles: demoMetric("clubMemberProfiles", asOf),
    uniquePlayersToday: demoMetric("uniquePlayersToday", asOf),
    entriesToday: demoMetric("entriesToday", asOf),
    playersPlayingNow: demoMetric("playersPlayingNow", asOf),
    runningEvents: demoMetric("runningEvents", asOf),
    openTables: demoMetric("openTables", asOf),
    dealersOnDuty: demoMetric("dealersOnDuty", asOf),
    dataQuality: {
      unavailableMetricIds: [],
      partialMetricIds: [],
      staleMetricIds: [],
    },
  });
}

export function mapSeriesClubPulseDemoToCopilotContextV1(pulse: SeriesClubLivePulseV1): ClubPulseV1 {
  const mapped = mapClubPulseToExternalCopilotContextV1(pulse);
  return Object.freeze({
    ...mapped,
    sourceMode: "mock_local_fixture",
  });
}
