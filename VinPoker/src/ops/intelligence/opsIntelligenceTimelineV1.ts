import type { OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";

export interface TimelinePointV1 { at: string; value: number }
export interface TableTimelinePointV1 extends TimelinePointV1 { seatCapacity: number | null }
export interface DealerGapV1 { from: string; to: string; maxGap: number }
export interface TimelineSeriesV1<T extends TimelinePointV1> {
  availability: OpsSourceAvailabilityV1;
  reasonCode: string | null;
  points: T[];
}
export interface OpsIntelligenceTimelineV1 {
  version: "ops-intelligence-timeline-v1";
  clubId: string;
  tournamentId: string;
  asOf: string;
  entries: TimelineSeriesV1<TimelinePointV1>;
  tables: TimelineSeriesV1<TableTimelinePointV1> & { capacityAvailability: "exact" | "partial"; capacityReasonCode: string | null };
  dealers: TimelineSeriesV1<TimelinePointV1>;
  gtd: TimelineSeriesV1<TimelinePointV1> & { guaranteeState: "available" | "no_guarantee" | "unavailable"; guaranteeAmount: number | null };
  dealerGaps: DealerGapV1[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
function fail(): never { throw new Error("OPS_INTELLIGENCE_TIMELINE_PAYLOAD_INVALID"); }
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !(key in row))) return fail();
  return row;
}
function uuid(value: unknown) { return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : fail(); }
function timestamp(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) return fail();
  return value;
}
function count(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail(); }
function money(value: unknown) { return value === null ? null : count(value); }
function nullableReason(value: unknown) { return value === null ? null : typeof value === "string" && value.length > 0 ? value : fail(); }
function availability(value: unknown): OpsSourceAvailabilityV1 { return value === "exact" || value === "partial" || value === "unavailable" ? value : fail(); }
function array(value: unknown) { return Array.isArray(value) ? value : fail(); }
function point(value: unknown): TimelinePointV1 {
  const row = object(value, ["at", "value"]);
  return { at: timestamp(row.at), value: count(row.value) };
}
function points(value: unknown) {
  const result = array(value).map(point);
  if (result.some((row, index) => index > 0 && row.at <= result[index - 1].at)) return fail();
  return result;
}
function series(value: unknown): TimelineSeriesV1<TimelinePointV1> {
  const row = object(value, ["availability", "reasonCode", "points"]);
  const result = { availability: availability(row.availability), reasonCode: nullableReason(row.reasonCode), points: points(row.points) };
  if ((result.availability === "exact") !== (result.reasonCode === null) || result.availability === "unavailable" && result.points.length) return fail();
  return result;
}

export function parseOpsIntelligenceTimelineV1(value: unknown, expectedClubId: string, expectedTournamentId: string): OpsIntelligenceTimelineV1 {
  const root = object(value, ["version", "clubId", "tournamentId", "asOf", "entries", "tables", "dealers", "gtd", "dealerGaps"]);
  if (root.version !== "ops-intelligence-timeline-v1" || uuid(root.clubId) !== uuid(expectedClubId) || uuid(root.tournamentId) !== uuid(expectedTournamentId)) return fail();
  const tableRaw = object(root.tables, ["availability", "reasonCode", "capacityAvailability", "capacityReasonCode", "points"]);
  const tableBase = series({ availability: tableRaw.availability, reasonCode: tableRaw.reasonCode, points: [] });
  const tablePoints = array(tableRaw.points).map((value): TableTimelinePointV1 => {
    const row = object(value, ["at", "value", "seatCapacity"]);
    return { at: timestamp(row.at), value: count(row.value), seatCapacity: money(row.seatCapacity) };
  });
  if (tablePoints.some((row, index) => index > 0 && row.at <= tablePoints[index - 1].at)) return fail();
  const capacityAvailability = tableRaw.capacityAvailability === "exact" || tableRaw.capacityAvailability === "partial" ? tableRaw.capacityAvailability : fail();
  const capacityReasonCode = nullableReason(tableRaw.capacityReasonCode);
  if ((capacityAvailability === "exact") !== (capacityReasonCode === null) || (capacityAvailability === "partial" && tablePoints.some((row) => row.seatCapacity !== null))) return fail();
  const gtdRaw = object(root.gtd, ["availability", "reasonCode", "guaranteeState", "guaranteeAmount", "points"]);
  const gtdBase = series({ availability: gtdRaw.availability, reasonCode: gtdRaw.reasonCode, points: gtdRaw.points });
  const guaranteeState = gtdRaw.guaranteeState === "available" || gtdRaw.guaranteeState === "no_guarantee" || gtdRaw.guaranteeState === "unavailable" ? gtdRaw.guaranteeState : fail();
  const guaranteeAmount = money(gtdRaw.guaranteeAmount);
  if (guaranteeState === "unavailable" ? guaranteeAmount !== null || gtdBase.availability !== "unavailable" : guaranteeAmount === null || gtdBase.availability === "unavailable") return fail();
  if ((guaranteeState === "no_guarantee") !== (guaranteeAmount === 0)) return fail();
  const dealerGaps = array(root.dealerGaps).map((value): DealerGapV1 => {
    const row = object(value, ["from", "to", "maxGap"]);
    const from = timestamp(row.from); const to = timestamp(row.to);
    if (to <= from || count(row.maxGap) === 0) return fail();
    return { from, to, maxGap: count(row.maxGap) };
  });
  const dealers = series(root.dealers);
  if ((dealers.availability !== "exact" || tableBase.availability !== "exact") && dealerGaps.length) return fail();
  return {
    version: root.version, clubId: uuid(root.clubId), tournamentId: uuid(root.tournamentId), asOf: timestamp(root.asOf),
    entries: series(root.entries),
    tables: { ...tableBase, points: tablePoints, capacityAvailability, capacityReasonCode },
    dealers,
    gtd: { ...gtdBase, guaranteeState, guaranteeAmount },
    dealerGaps,
  };
}

export function latestTimelineValue(points: readonly TimelinePointV1[]): number | null {
  return points.at(-1)?.value ?? null;
}

export function buildAlignedTimelineRows(value: OpsIntelligenceTimelineV1) {
  const timestamps = [...new Set([...value.entries.points, ...value.tables.points, ...value.dealers.points, ...value.gtd.points].map((row) => row.at))].sort();
  const latest = <T extends TimelinePointV1>(rows: readonly T[], at: string): T | null => [...rows].reverse().find((row) => row.at <= at) ?? null;
  return timestamps.map((at) => {
    const table = latest(value.tables.points, at);
    return { at, entries: latest(value.entries.points, at)?.value ?? null, tables: table?.value ?? null, capacity: table?.seatCapacity ?? null, dealers: latest(value.dealers.points, at)?.value ?? null, gtd: latest(value.gtd.points, at)?.value ?? null };
  });
}
