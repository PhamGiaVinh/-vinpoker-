import type { ClubPulseV1, CopilotMetricV1 } from "./seriesCopilotContextV1";

export const SERIES_CLUB_LIVE_PULSE_VERSION = "series-club-live-pulse-v1" as const;
export const SERIES_CLUB_PULSE_PRIVACY_THRESHOLD = 5 as const;

export const SERIES_CLUB_PULSE_METRIC_KEYS = [
  "clubMemberProfiles",
  "uniquePlayersToday",
  "entriesToday",
  "playersPlayingNow",
  "runningEvents",
  "openTables",
  "dealersOnDuty",
] as const;

export type SeriesClubPulseMetricKey = typeof SERIES_CLUB_PULSE_METRIC_KEYS[number];
export type SeriesClubPulseAvailability = "exact" | "partial" | "stale" | "unavailable";
export type SeriesClubPulsePrivacyState = "safe" | "small_cohort_suppressed" | "not_exportable";
export type SeriesClubPulseUnavailableReason =
  | "CLUB_TIMEZONE_UNAVAILABLE"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_READ_FAILED"
  | "COUNT_EXCEEDS_JS_SAFE_INTEGER";

export interface SeriesClubPulseMetricDefinition {
  readonly metricId: string;
  readonly sourceId: string;
  readonly grain: string;
  readonly definitionVersion: string;
}

export const SERIES_CLUB_PULSE_METRIC_DEFINITIONS: Readonly<Record<SeriesClubPulseMetricKey, SeriesClubPulseMetricDefinition>> = Object.freeze({
  clubMemberProfiles: Object.freeze({
    metricId: "club_member_profiles",
    sourceId: "club_members",
    grain: "club",
    definitionVersion: "club-member-profiles-v1",
  }),
  uniquePlayersToday: Object.freeze({
    metricId: "unique_players_today",
    sourceId: "tournaments.tournament_registrations.tournament_entries",
    grain: "club_event_start_local_calendar_day",
    definitionVersion: "club-unique-players-event-day-v1",
  }),
  entriesToday: Object.freeze({
    metricId: "entries_today",
    sourceId: "tournaments.tournament_registrations",
    grain: "club_event_start_local_calendar_day",
    definitionVersion: "club-entries-event-day-v1",
  }),
  playersPlayingNow: Object.freeze({
    metricId: "players_playing_now",
    sourceId: "tournament_seats.tournament_entries",
    grain: "club_live_tournaments",
    definitionVersion: "club-active-seated-players-v1",
  }),
  runningEvents: Object.freeze({
    metricId: "running_events",
    sourceId: "tournaments",
    grain: "club_live_tournaments",
    definitionVersion: "club-running-events-v1",
  }),
  openTables: Object.freeze({
    metricId: "open_tables",
    sourceId: "tournament_tables",
    grain: "club_tournament_tables",
    definitionVersion: "club-open-tables-v1",
  }),
  dealersOnDuty: Object.freeze({
    metricId: "dealers_on_duty",
    sourceId: "dealer_attendance.dealers",
    grain: "club_current_attendance",
    definitionVersion: "club-dealers-on-duty-v1",
  }),
});

export interface SeriesClubPulseMetricV1 {
  readonly metricId: string;
  readonly value: number | null;
  readonly unit: "count";
  readonly availability: SeriesClubPulseAvailability;
  readonly privacyState: SeriesClubPulsePrivacyState;
  readonly asOf: string;
  readonly sourceId: string;
  readonly grain: string;
  readonly definitionVersion: string;
  readonly unavailableReason?: SeriesClubPulseUnavailableReason;
}

export interface SeriesClubLivePulseV1 {
  readonly version: typeof SERIES_CLUB_LIVE_PULSE_VERSION;
  readonly clubId: string;
  readonly asOf: string;
  readonly clubLocalDate: string | null;
  readonly timezone: string | null;
  readonly clubMemberProfiles: SeriesClubPulseMetricV1;
  readonly uniquePlayersToday: SeriesClubPulseMetricV1;
  readonly entriesToday: SeriesClubPulseMetricV1;
  readonly playersPlayingNow: SeriesClubPulseMetricV1;
  readonly runningEvents: SeriesClubPulseMetricV1;
  readonly openTables: SeriesClubPulseMetricV1;
  readonly dealersOnDuty: SeriesClubPulseMetricV1;
  readonly dataQuality: {
    readonly unavailableMetricIds: readonly string[];
    readonly partialMetricIds: readonly string[];
    readonly staleMetricIds: readonly string[];
  };
}

const AVAILABILITY = new Set<SeriesClubPulseAvailability>(["exact", "partial", "stale", "unavailable"]);
const PRIVACY_STATES = new Set<SeriesClubPulsePrivacyState>(["safe", "small_cohort_suppressed", "not_exportable"]);
const UNAVAILABLE_REASONS = new Set<SeriesClubPulseUnavailableReason>([
  "CLUB_TIMEZONE_UNAVAILABLE",
  "SOURCE_UNAVAILABLE",
  "SOURCE_READ_FAILED",
  "COUNT_EXCEEDS_JS_SAFE_INTEGER",
]);
// Club identities can predate RFC-versioned UUID generation but remain valid PostgreSQL uuid values.
const POSTGRES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_MILLISECOND_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMEZONE = /^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*$/;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function strictRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
  for (const key of required) if (!(key in record)) throw new Error(`${label}.${key} is required`);
  return record;
}

function parseAsOf(value: unknown, label: string): string {
  if (typeof value !== "string" || !UTC_MILLISECOND_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a UTC millisecond instant`);
  }
  return new Date(value).toISOString();
}

function parseMetric(value: unknown, key: SeriesClubPulseMetricKey, pulseAsOf: string): SeriesClubPulseMetricV1 {
  const definition = SERIES_CLUB_PULSE_METRIC_DEFINITIONS[key];
  const record = strictRecord(value, key, [
    "metricId", "value", "unit", "availability", "privacyState", "asOf", "sourceId", "grain", "definitionVersion",
  ], ["unavailableReason"]);
  if (record.metricId !== definition.metricId) throw new Error(`${key}.metricId is invalid`);
  if (record.unit !== "count") throw new Error(`${key}.unit is invalid`);
  if (typeof record.availability !== "string" || !AVAILABILITY.has(record.availability as SeriesClubPulseAvailability)) {
    throw new Error(`${key}.availability is invalid`);
  }
  const availability = record.availability as SeriesClubPulseAvailability;
  if (typeof record.privacyState !== "string" || !PRIVACY_STATES.has(record.privacyState as SeriesClubPulsePrivacyState)) {
    throw new Error(`${key}.privacyState is invalid`);
  }
  const privacyState = record.privacyState as SeriesClubPulsePrivacyState;
  const metricAsOf = parseAsOf(record.asOf, `${key}.asOf`);
  if (metricAsOf !== pulseAsOf) throw new Error(`${key}.asOf must equal pulse asOf`);
  if (record.sourceId !== definition.sourceId || record.grain !== definition.grain || record.definitionVersion !== definition.definitionVersion) {
    throw new Error(`${key} provenance metadata is invalid`);
  }

  let metricValue: number | null = null;
  let unavailableReason: SeriesClubPulseUnavailableReason | undefined;
  if (availability === "unavailable") {
    if (record.value !== null) throw new Error(`${key}.value must be null when unavailable`);
    if (typeof record.unavailableReason !== "string" || !UNAVAILABLE_REASONS.has(record.unavailableReason as SeriesClubPulseUnavailableReason)) {
      throw new Error(`${key}.unavailableReason is invalid`);
    }
    if (privacyState !== "not_exportable") throw new Error(`${key} unavailable value must be not_exportable`);
    unavailableReason = record.unavailableReason as SeriesClubPulseUnavailableReason;
  } else {
    if (!Number.isSafeInteger(record.value) || (record.value as number) < 0) throw new Error(`${key}.value must be a non-negative safe integer`);
    if ("unavailableReason" in record) throw new Error(`${key}.unavailableReason is only valid when unavailable`);
    metricValue = record.value as number;
    if (privacyState === "small_cohort_suppressed" && (metricValue < 1 || metricValue >= SERIES_CLUB_PULSE_PRIVACY_THRESHOLD)) {
      throw new Error(`${key}.privacyState does not match the small-cohort policy`);
    }
    if (privacyState === "safe" && metricValue > 0 && metricValue < SERIES_CLUB_PULSE_PRIVACY_THRESHOLD) {
      throw new Error(`${key}.privacyState does not protect the small cohort`);
    }
  }

  return {
    metricId: definition.metricId,
    value: metricValue,
    unit: "count",
    availability,
    privacyState,
    asOf: metricAsOf,
    sourceId: definition.sourceId,
    grain: definition.grain,
    definitionVersion: definition.definitionVersion,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

function parseMetricIdArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
  const ids = [...value] as string[];
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicates`);
  const allowed = new Set(Object.values(SERIES_CLUB_PULSE_METRIC_DEFINITIONS).map((item) => item.metricId));
  if (ids.some((id) => !allowed.has(id))) throw new Error(`${label} contains an unknown metric`);
  return ids.sort();
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function parseSeriesClubLivePulseV1(value: unknown): SeriesClubLivePulseV1 {
  const record = strictRecord(value, "pulse", [
    "version", "clubId", "asOf", "clubLocalDate", "timezone",
    ...SERIES_CLUB_PULSE_METRIC_KEYS,
    "dataQuality",
  ]);
  if (record.version !== SERIES_CLUB_LIVE_PULSE_VERSION) throw new Error("pulse.version is invalid");
  if (typeof record.clubId !== "string" || !POSTGRES_UUID.test(record.clubId)) throw new Error("pulse.clubId is invalid");
  const asOf = parseAsOf(record.asOf, "pulse.asOf");

  let timezone: string | null = null;
  let clubLocalDate: string | null = null;
  if (record.timezone === null || record.clubLocalDate === null) {
    if (record.timezone !== null || record.clubLocalDate !== null) throw new Error("pulse timezone and local date must be available together");
  } else {
    if (typeof record.timezone !== "string" || !TIMEZONE.test(record.timezone)) throw new Error("pulse.timezone is invalid");
    if (typeof record.clubLocalDate !== "string" || !LOCAL_DATE.test(record.clubLocalDate)) throw new Error("pulse.clubLocalDate is invalid");
    timezone = record.timezone;
    clubLocalDate = record.clubLocalDate;
  }

  const parsedMetrics = Object.fromEntries(SERIES_CLUB_PULSE_METRIC_KEYS.map((key) => [key, parseMetric(record[key], key, asOf)])) as unknown as Record<SeriesClubPulseMetricKey, SeriesClubPulseMetricV1>;
  if (timezone === null) {
    for (const key of ["uniquePlayersToday", "entriesToday"] as const) {
      const metric = parsedMetrics[key];
      if (metric.availability !== "unavailable" || metric.unavailableReason !== "CLUB_TIMEZONE_UNAVAILABLE") {
        throw new Error(`${key} must fail closed when club timezone is unavailable`);
      }
    }
  }

  const quality = strictRecord(record.dataQuality, "pulse.dataQuality", ["unavailableMetricIds", "partialMetricIds", "staleMetricIds"]);
  const unavailableMetricIds = parseMetricIdArray(quality.unavailableMetricIds, "dataQuality.unavailableMetricIds");
  const partialMetricIds = parseMetricIdArray(quality.partialMetricIds, "dataQuality.partialMetricIds");
  const staleMetricIds = parseMetricIdArray(quality.staleMetricIds, "dataQuality.staleMetricIds");
  const expected = (availability: SeriesClubPulseAvailability) => SERIES_CLUB_PULSE_METRIC_KEYS
    .map((key) => parsedMetrics[key])
    .filter((metric) => metric.availability === availability)
    .map((metric) => metric.metricId)
    .sort();
  if (!sameMembers(unavailableMetricIds, expected("unavailable"))
    || !sameMembers(partialMetricIds, expected("partial"))
    || !sameMembers(staleMetricIds, expected("stale"))) {
    throw new Error("pulse.dataQuality does not match metric availability");
  }

  return deepFreeze({
    version: SERIES_CLUB_LIVE_PULSE_VERSION,
    clubId: record.clubId.toLowerCase(),
    asOf,
    clubLocalDate,
    timezone,
    ...parsedMetrics,
    dataQuality: { unavailableMetricIds, partialMetricIds, staleMetricIds },
  }) as SeriesClubLivePulseV1;
}

function mapMetric(metric: SeriesClubPulseMetricV1, redactForExternalContext: boolean): CopilotMetricV1 {
  const shouldSuppress = redactForExternalContext
    && metric.availability !== "unavailable"
    && metric.privacyState !== "safe";
  return {
    metricId: metric.metricId,
    value: shouldSuppress ? null : metric.value,
    unit: metric.unit,
    availability: metric.availability,
    privacyState: metric.privacyState,
    asOf: metric.asOf,
    sourceId: metric.sourceId,
    grain: metric.grain,
    definitionVersion: metric.definitionVersion,
    ...(metric.unavailableReason ? { unavailableReason: metric.unavailableReason } : {}),
    ...(shouldSuppress
      ? { suppressionReason: metric.privacyState === "small_cohort_suppressed" ? "SMALL_COHORT_SUPPRESSED" as const : "NOT_EXPORTABLE" as const }
      : {}),
  };
}

export function mapSeriesClubLivePulseToOwnerClubPulseV1(pulse: SeriesClubLivePulseV1): ClubPulseV1 {
  const trustedPulse = parseSeriesClubLivePulseV1(pulse);
  const metrics: CopilotMetricV1[] = SERIES_CLUB_PULSE_METRIC_KEYS.map((key) => {
    return mapMetric(trustedPulse[key], false);
  });
  return deepFreeze({ version: "series-club-pulse-v1", sourceMode: "server_aggregate", metrics });
}

export function mapClubPulseToExternalCopilotContextV1(pulse: SeriesClubLivePulseV1): ClubPulseV1 {
  const trustedPulse = parseSeriesClubLivePulseV1(pulse);
  const metrics = SERIES_CLUB_PULSE_METRIC_KEYS.map((key) => mapMetric(trustedPulse[key], true));
  return deepFreeze({ version: "series-club-pulse-v1", sourceMode: "server_aggregate", metrics });
}
