import { canonicalHash } from "../series-intelligence/provenanceHash";
import {
  compareCanonicalStrings,
  normalizeInstant,
  SeriesMarketValidationError,
} from "./normalization";

export const VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION = "v1" as const;
export const VIETNAM_SCHEDULE_SUPPLY_NAMESPACE =
  `series-market:v1:vietnam-schedule-supply:${VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION}` as const;
export const SCHEDULE_EVIDENCE_QUALITY = "owner_provided_public_image_unverified" as const;

export type ScheduleExtractionStatus =
  | "manual_verified"
  | "manual_verified_with_owner_context"
  | "uncertain"
  | "missing"
  | "conflicting";
export type ScheduleMissingReason =
  | "not_displayed"
  | "dash_displayed"
  | "unreadable"
  | "not_applicable";
export type ScheduleGtdInput =
  | {
      readonly type: "monetary";
      readonly minorUnits: string;
      readonly currency: string;
      readonly scale: number;
    }
  | {
      readonly type: "seats";
      readonly quantity: string;
    }
  | {
      readonly type: "tickets";
      readonly quantity: string;
    }
  | {
      readonly type: "missing";
      readonly reason: ScheduleMissingReason;
    };
export type ScheduleClaimValue =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "integer"; readonly value: string }
  | { readonly type: "money"; readonly minorUnits: string; readonly currency: string; readonly scale: number }
  | { readonly type: "local_date"; readonly value: string }
  | { readonly type: "local_time"; readonly value: string }
  | { readonly type: "percent_bps"; readonly value: string }
  | { readonly type: "duration_sequence_minutes"; readonly values: readonly string[] }
  | { readonly type: "seats"; readonly quantity: string }
  | { readonly type: "tickets"; readonly quantity: string }
  | { readonly type: "missing"; readonly reason: ScheduleMissingReason };

export type ScheduleFieldKey =
  | "market"
  | "country"
  | "city"
  | "venue"
  | "organizer"
  | "series_name"
  | "schedule_date"
  | "local_start_time"
  | "day_flight_identity"
  | "event_number"
  | "event_name"
  | "event_family"
  | "game"
  | "currency"
  | "total_buy_in"
  | "prize_contribution"
  | "organizer_fee"
  | "staff_fee_bps"
  | "gtd"
  | "starting_stack"
  | "level_duration"
  | "registration_close_level"
  | "registration_close_time"
  | "itm_statement"
  | "play_to_statement"
  | "satellite_linkage"
  | "promotion_note"
  | "floor";

export interface ScheduleEvidenceSource {
  readonly sourceId: string;
  readonly posterIdentity: "rpt" | "center_p" | "grand_loyal";
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly sourceByteLength: string;
  readonly widthPixels: string;
  readonly heightPixels: string;
  readonly organizer: string;
  readonly venue: string | null;
  readonly seriesName: string;
  readonly city: string | null;
  readonly country: "Vietnam";
  readonly market: "vietnam";
  readonly displayedScheduleDates: readonly string[];
  readonly evidenceQuality: typeof SCHEDULE_EVIDENCE_QUALITY;
}

export interface ScheduleSeedEvent {
  readonly eventKey: string;
  readonly competitionKey: string;
  readonly sourceId: string;
  readonly scheduleDate: string;
  readonly localStartTime: string;
  readonly dayFlightIdentity: string | null;
  readonly eventNumber: string | null;
  readonly eventName: string;
  readonly eventFamily: string;
  readonly game: string;
  readonly currency: string;
  readonly totalBuyInMinorUnits: string | null;
  readonly prizeContributionMinorUnits: string | null;
  readonly organizerFeeMinorUnits: string | null;
  readonly staffFeeBps: string | null;
  readonly gtd: ScheduleGtdInput;
  readonly startingStack: string | null;
  readonly levelDurationMinutes: readonly string[];
  readonly registrationCloseLevel: string | null;
  readonly registrationCloseTime: string | null;
  readonly itmStatement: string | null;
  readonly playToStatement: string | null;
  readonly satelliteLinkage: string | null;
  readonly promotionNote: string | null;
  readonly floor: string | null;
  readonly visualRegion: string;
  readonly missingReasons?: Readonly<Partial<Record<ScheduleFieldKey, ScheduleMissingReason>>>;
  readonly uncertainFields?: readonly ScheduleFieldKey[];
  readonly ownerContextFields?: readonly ScheduleFieldKey[];
  readonly conflictingFields?: readonly ScheduleFieldKey[];
  readonly fieldRegions?: Readonly<Partial<Record<ScheduleFieldKey, string>>>;
}

export interface ScheduleEvidenceClaim {
  readonly claimId: string;
  readonly contractVersion: typeof VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION;
  readonly eventKey: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly posterIdentity: ScheduleEvidenceSource["posterIdentity"];
  readonly scheduleDate: string;
  readonly visualRegion: string;
  readonly field: ScheduleFieldKey;
  readonly value: ScheduleClaimValue;
  readonly extractionStatus: ScheduleExtractionStatus;
  readonly evidenceQuality: typeof SCHEDULE_EVIDENCE_QUALITY;
}

export interface VietnamScheduleEvent {
  readonly eventId: string;
  readonly eventKey: string;
  readonly competitionKey: string;
  readonly sourceId: string;
  readonly posterIdentity: ScheduleEvidenceSource["posterIdentity"];
  readonly market: "vietnam";
  readonly country: "Vietnam";
  readonly city: string | null;
  readonly venue: string | null;
  readonly organizer: string;
  readonly seriesName: string;
  readonly scheduleDate: string;
  readonly localStartTime: string;
  readonly dayFlightIdentity: string | null;
  readonly eventNumber: string | null;
  readonly eventName: string;
  readonly eventFamily: string;
  readonly game: string;
  readonly currency: string;
  readonly totalBuyInMinorUnits: string | null;
  readonly prizeContributionMinorUnits: string | null;
  readonly organizerFeeMinorUnits: string | null;
  readonly derivedAllInBuyInMinorUnits: string | null;
  readonly staffFeeBps: string | null;
  readonly staffFeeBasis: "not_stated" | null;
  readonly gtd: ScheduleGtdInput;
  readonly startingStack: string | null;
  readonly levelDurationMinutes: readonly string[];
  readonly registrationCloseLevel: string | null;
  readonly registrationCloseTime: string | null;
  readonly itmStatement: string | null;
  readonly playToStatement: string | null;
  readonly satelliteLinkage: string | null;
  readonly promotionNote: string | null;
  readonly floor: string | null;
  readonly sourceClaimIds: readonly string[];
}

export interface VietnamScheduleSupplyRelease {
  readonly releaseId: string;
  readonly contractVersion: typeof VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION;
  readonly releaseKind: "planned_schedule_supply";
  readonly releaseKey: "vietnam-schedule-supply-v1";
  readonly market: "vietnam";
  readonly country: "Vietnam";
  readonly scopeKind: "country";
  readonly sourceCutoff: string;
  readonly inclusionManifestId: string;
  readonly sourceIds: readonly string[];
  readonly sourceImageSha256s: readonly string[];
  readonly eventIds: readonly string[];
  readonly claimIds: readonly string[];
  readonly evidenceQuality: typeof SCHEDULE_EVIDENCE_QUALITY;
}

export interface ScheduleInclusionManifest {
  readonly inclusionManifestId: string;
  readonly contractVersion: typeof VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION;
  readonly sourceCutoff: string;
  readonly sources: readonly {
    readonly sourceId: string;
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly sourceByteLength: string;
  }[];
  readonly eventIds: readonly string[];
  readonly claimIds: readonly string[];
}

export interface ScheduleTemplateFingerprint {
  readonly fingerprintId: string;
  readonly eventId: string;
  readonly eventKey: string;
  readonly competitionKey: string;
  readonly sourceId: string;
  readonly structuralFeatures: {
    readonly eventFamily: string;
    readonly totalBuyInMinorUnits: string | null;
    readonly prizeContributionMinorUnits: string | null;
    readonly organizerFeeMinorUnits: string | null;
    readonly monetaryGtdMinorUnits: string | null;
    readonly requiredEntries: string | null;
    readonly startingStack: string | null;
    readonly levelDurationMinutes: readonly string[];
    readonly itmStatement: string | null;
    readonly playToStatement: string | null;
    readonly multiFlight: boolean;
    readonly satellitePattern: string | null;
  };
}

export type CollisionWindowKey =
  | "same_day"
  | "within_3_days"
  | "within_7_days"
  | "within_14_days"
  | "within_30_days";

export interface ScheduleCollisionReport {
  readonly collisionId: string;
  readonly window: CollisionWindowKey;
  readonly distanceDays: string;
  readonly sourceIds: readonly string[];
  readonly seriesNames: readonly string[];
  readonly venues: readonly string[];
  readonly dates: readonly string[];
  readonly monetaryGtdTotalsByCurrency: readonly MoneyTotal[];
  readonly combinedRequiredEntries: string;
  readonly calculableRequiredEntryEvents: string;
  readonly repeatedTemplateCount: string;
  readonly eventFamilyOverlap: readonly string[];
  readonly evidenceLimitations: readonly string[];
}

export interface MoneyTotal {
  readonly key: string;
  readonly currency: string;
  readonly scale: number;
  readonly totalMinorUnits: string;
}

export interface RequiredEntriesMetric {
  readonly competitionKey: string;
  readonly sourceId: string;
  readonly currency: string;
  readonly gtdMinorUnits: string;
  readonly prizeContributionMinorUnits: string;
  readonly requiredEntries: string;
  readonly sourceEventIds: readonly string[];
}

export interface RepeatedTemplateGroup {
  readonly fingerprintId: string;
  readonly eventIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly distinctSeriesCount: string;
}

export interface ScheduleSupplyArtifact {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly contractVersion: typeof VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION;
  readonly artifactType: "vietnam_schedule_supply";
  readonly releaseId: string;
  readonly sourceCutoff: string;
  readonly sourceInventory: readonly ScheduleEvidenceSource[];
  readonly eventCount: string;
  readonly claimCount: string;
  readonly events: readonly VietnamScheduleEvent[];
  readonly claims: readonly ScheduleEvidenceClaim[];
  readonly templateFingerprints: readonly ScheduleTemplateFingerprint[];
  readonly repeatedTemplateGroups: readonly RepeatedTemplateGroup[];
  readonly collisionReports: readonly ScheduleCollisionReport[];
  readonly monetaryGtdTotalsBySeries: readonly MoneyTotal[];
  readonly monetaryGtdTotalsByDate: readonly MoneyTotal[];
  readonly requiredEntriesByEvent: readonly RequiredEntriesMetric[];
  readonly combinedRequiredEntriesByDate: readonly {
    readonly date: string;
    readonly totalRequiredEntries: string;
    readonly calculableEventCount: string;
  }[];
  readonly eventCountsByBuyInBand: readonly {
    readonly band: string;
    readonly count: string;
  }[];
  readonly eventCountsByGtdBand: readonly {
    readonly band: string;
    readonly count: string;
  }[];
  readonly overlappingSeriesByWindow: readonly {
    readonly window: CollisionWindowKey;
    readonly distinctSeriesCount: string;
    readonly collisionGroupCount: string;
  }[];
  readonly missingFieldCoverage: readonly {
    readonly field: ScheduleFieldKey;
    readonly missingCount: string;
    readonly uncertainCount: string;
    readonly conflictingCount: string;
  }[];
  readonly limitations: readonly string[];
}

export interface ScheduleSupplyReceipt {
  readonly receiptId: string;
  readonly contractVersion: typeof VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION;
  readonly releaseId: string;
  readonly artifactId: string;
  readonly artifactContentHash: string;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
  readonly sourceImageReceipts: readonly {
    readonly sourceId: string;
    readonly sourcePath: string;
    readonly sourceSha256: string;
    readonly sourceByteLength: string;
  }[];
}

export interface VietnamScheduleSupplyBundle {
  readonly inclusionManifest: ScheduleInclusionManifest;
  readonly release: VietnamScheduleSupplyRelease;
  readonly artifact: ScheduleSupplyArtifact;
}

const FIELD_ORDER: readonly ScheduleFieldKey[] = [
  "market",
  "country",
  "city",
  "venue",
  "organizer",
  "series_name",
  "schedule_date",
  "local_start_time",
  "day_flight_identity",
  "event_number",
  "event_name",
  "event_family",
  "game",
  "currency",
  "total_buy_in",
  "prize_contribution",
  "organizer_fee",
  "staff_fee_bps",
  "gtd",
  "starting_stack",
  "level_duration",
  "registration_close_level",
  "registration_close_time",
  "itm_statement",
  "play_to_statement",
  "satellite_linkage",
  "promotion_note",
  "floor",
];

const COLLISION_WINDOWS: readonly { readonly key: CollisionWindowKey; readonly days: number }[] = [
  { key: "same_day", days: 0 },
  { key: "within_3_days", days: 3 },
  { key: "within_7_days", days: 7 },
  { key: "within_14_days", days: 14 },
  { key: "within_30_days", days: 30 },
];

function fail(message: string, code: string): never {
  throw new SeriesMarketValidationError(message, code);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function normalizeText(raw: string, label: string, maximumLength = 4096): string {
  const value = raw.normalize("NFC").trim();
  if (value === "" || value.length > maximumLength) fail(`${label} must be non-blank`, "INVALID_SCHEDULE_TEXT");
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) fail(`${label} contains a control character`, "INVALID_SCHEDULE_TEXT");
  }
  return value;
}

function normalizeKey(raw: string, label: string): string {
  const value = normalizeText(raw, label, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (value === "") fail(`${label} has no stable key characters`, "INVALID_SCHEDULE_KEY");
  return value;
}

function normalizeInteger(raw: string, label: string): string {
  const value = raw.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(value)) fail(`${label} must be a non-negative integer`, "INVALID_SCHEDULE_INTEGER");
  return BigInt(value).toString();
}

function normalizeCurrency(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) fail("currency must be a three-letter code", "INVALID_SCHEDULE_CURRENCY");
  return value;
}

function normalizeSha256(raw: string, label: string): string {
  const value = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) fail(`${label} must be a SHA-256 digest`, "INVALID_SCHEDULE_SHA256");
  return value;
}

function normalizeDate(raw: string): string {
  const value = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) fail("schedule date must be YYYY-MM-DD", "INVALID_SCHEDULE_DATE");
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (probe.toISOString().slice(0, 10) !== value) fail("schedule date is invalid", "INVALID_SCHEDULE_DATE");
  return value;
}

function normalizeTime(raw: string): string {
  const value = raw.trim();
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    fail("local time must be HH:MM", "INVALID_SCHEDULE_TIME");
  }
  return value;
}

function normalizeOptionalText(raw: string | null, label: string): string | null {
  return raw === null ? null : normalizeText(raw, label);
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  const normalized = values.map((value) => normalizeText(value, label, 512));
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) fail(`${label} contains duplicates`, "DUPLICATE_SCHEDULE_REFERENCE");
  return [...unique].sort(compareCanonicalStrings);
}

function sameStringSets(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeSource(source: ScheduleEvidenceSource): ScheduleEvidenceSource {
  const path = source.sourcePath.replace(/\\/g, "/").trim();
  if (!path.startsWith("docs/series/evidence/vietnam/inbox/") || path.includes("..") || /^[A-Za-z]:/.test(path)) {
    fail("source path must be repository-relative inside the Vietnam evidence inbox", "INVALID_SCHEDULE_SOURCE_PATH");
  }
  const displayedScheduleDates = source.displayedScheduleDates.map(normalizeDate);
  return deepFreeze({
    sourceId: normalizeKey(source.sourceId, "sourceId"),
    posterIdentity: source.posterIdentity,
    sourcePath: path,
    sourceSha256: normalizeSha256(source.sourceSha256, "sourceSha256"),
    sourceByteLength: normalizeInteger(source.sourceByteLength, "sourceByteLength"),
    widthPixels: normalizeInteger(source.widthPixels, "widthPixels"),
    heightPixels: normalizeInteger(source.heightPixels, "heightPixels"),
    organizer: normalizeText(source.organizer, "organizer"),
    venue: normalizeOptionalText(source.venue, "venue"),
    seriesName: normalizeText(source.seriesName, "seriesName"),
    city: normalizeOptionalText(source.city, "city"),
    country: "Vietnam",
    market: "vietnam",
    displayedScheduleDates: [...new Set(displayedScheduleDates)].sort(compareCanonicalStrings),
    evidenceQuality: SCHEDULE_EVIDENCE_QUALITY,
  });
}

function normalizeGtd(gtd: ScheduleGtdInput, fallbackCurrency: string): ScheduleGtdInput {
  if (gtd.type === "missing") return { type: "missing", reason: gtd.reason };
  if (gtd.type === "seats" || gtd.type === "tickets") {
    return { type: gtd.type, quantity: normalizeInteger(gtd.quantity, "gtd.quantity") };
  }
  const currency = normalizeCurrency(gtd.currency);
  if (currency !== fallbackCurrency) fail("GTD currency does not match event currency", "SCHEDULE_GTD_CURRENCY_MISMATCH");
  if (!Number.isInteger(gtd.scale) || gtd.scale < 0 || gtd.scale > 18) {
    fail("GTD scale is invalid", "INVALID_SCHEDULE_MONEY_SCALE");
  }
  return {
    type: "monetary",
    minorUnits: normalizeInteger(gtd.minorUnits, "gtd.minorUnits"),
    currency,
    scale: gtd.scale,
  };
}

function missingValue(seed: ScheduleSeedEvent, field: ScheduleFieldKey): ScheduleClaimValue {
  return {
    type: "missing",
    reason: seed.missingReasons?.[field] ?? "not_displayed",
  };
}

function fieldValue(
  source: ScheduleEvidenceSource,
  seed: ScheduleSeedEvent,
  field: ScheduleFieldKey,
  normalized: Omit<VietnamScheduleEvent, "eventId" | "sourceClaimIds">,
): ScheduleClaimValue {
  const text = (value: string | null): ScheduleClaimValue => value === null
    ? missingValue(seed, field)
    : { type: "text", value };
  const integer = (value: string | null): ScheduleClaimValue => value === null
    ? missingValue(seed, field)
    : { type: "integer", value };
  const money = (value: string | null): ScheduleClaimValue => value === null
    ? missingValue(seed, field)
    : { type: "money", minorUnits: value, currency: normalized.currency, scale: 0 };

  switch (field) {
    case "market": return { type: "text", value: "vietnam" };
    case "country": return { type: "text", value: "Vietnam" };
    case "city": return text(source.city);
    case "venue": return text(source.venue);
    case "organizer": return { type: "text", value: source.organizer };
    case "series_name": return { type: "text", value: source.seriesName };
    case "schedule_date": return { type: "local_date", value: normalized.scheduleDate };
    case "local_start_time": return { type: "local_time", value: normalized.localStartTime };
    case "day_flight_identity": return text(normalized.dayFlightIdentity);
    case "event_number": return text(normalized.eventNumber);
    case "event_name": return { type: "text", value: normalized.eventName };
    case "event_family": return { type: "text", value: normalized.eventFamily };
    case "game": return { type: "text", value: normalized.game };
    case "currency": return { type: "text", value: normalized.currency };
    case "total_buy_in": return money(normalized.totalBuyInMinorUnits);
    case "prize_contribution": return money(normalized.prizeContributionMinorUnits);
    case "organizer_fee": return money(normalized.organizerFeeMinorUnits);
    case "staff_fee_bps": return normalized.staffFeeBps === null
      ? missingValue(seed, field)
      : { type: "percent_bps", value: normalized.staffFeeBps };
    case "gtd":
      if (normalized.gtd.type === "missing") return { type: "missing", reason: normalized.gtd.reason };
      if (normalized.gtd.type === "seats" || normalized.gtd.type === "tickets") {
        return { type: normalized.gtd.type, quantity: normalized.gtd.quantity };
      }
      return {
        type: "money",
        minorUnits: normalized.gtd.minorUnits,
        currency: normalized.gtd.currency,
        scale: normalized.gtd.scale,
      };
    case "starting_stack": return integer(normalized.startingStack);
    case "level_duration": return normalized.levelDurationMinutes.length === 0
      ? missingValue(seed, field)
      : { type: "duration_sequence_minutes", values: normalized.levelDurationMinutes };
    case "registration_close_level": return integer(normalized.registrationCloseLevel);
    case "registration_close_time": return normalized.registrationCloseTime === null
      ? missingValue(seed, field)
      : { type: "local_time", value: normalized.registrationCloseTime };
    case "itm_statement": return text(normalized.itmStatement);
    case "play_to_statement": return text(normalized.playToStatement);
    case "satellite_linkage": return text(normalized.satelliteLinkage);
    case "promotion_note": return text(normalized.promotionNote);
    case "floor": return text(normalized.floor);
  }
}

function statusForField(
  seed: ScheduleSeedEvent,
  field: ScheduleFieldKey,
  value: ScheduleClaimValue,
): ScheduleExtractionStatus {
  if (seed.conflictingFields?.includes(field)) return "conflicting";
  if (value.type === "missing") return "missing";
  if (seed.uncertainFields?.includes(field)) return "uncertain";
  if (seed.ownerContextFields?.includes(field)) return "manual_verified_with_owner_context";
  return "manual_verified";
}

export async function createScheduleEvidenceClaim(input: Omit<ScheduleEvidenceClaim, "claimId" | "contractVersion">): Promise<ScheduleEvidenceClaim> {
  const content = {
    eventKey: normalizeKey(input.eventKey, "claim.eventKey"),
    sourceId: normalizeKey(input.sourceId, "claim.sourceId"),
    sourcePath: input.sourcePath.replace(/\\/g, "/").trim(),
    sourceSha256: normalizeSha256(input.sourceSha256, "claim.sourceSha256"),
    posterIdentity: input.posterIdentity,
    scheduleDate: normalizeDate(input.scheduleDate),
    visualRegion: normalizeText(input.visualRegion, "claim.visualRegion", 512),
    field: input.field,
    value: input.value,
    extractionStatus: input.extractionStatus,
    evidenceQuality: SCHEDULE_EVIDENCE_QUALITY,
  } as const;
  const claimHash = await canonicalHash(content);
  return deepFreeze({
    claimId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:claim:${claimHash}`,
    contractVersion: VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION,
    ...content,
  });
}

async function normalizeEvent(
  seed: ScheduleSeedEvent,
  source: ScheduleEvidenceSource,
): Promise<{ readonly event: VietnamScheduleEvent; readonly claims: readonly ScheduleEvidenceClaim[] }> {
  const currency = normalizeCurrency(seed.currency);
  const prizeContribution = seed.prizeContributionMinorUnits === null
    ? null
    : normalizeInteger(seed.prizeContributionMinorUnits, "prizeContributionMinorUnits");
  const organizerFee = seed.organizerFeeMinorUnits === null
    ? null
    : normalizeInteger(seed.organizerFeeMinorUnits, "organizerFeeMinorUnits");
  const totalBuyIn = seed.totalBuyInMinorUnits === null
    ? null
    : normalizeInteger(seed.totalBuyInMinorUnits, "totalBuyInMinorUnits");
  const derivedAllInBuyIn = prizeContribution !== null && organizerFee !== null
    ? (BigInt(prizeContribution) + BigInt(organizerFee)).toString()
    : null;
  const normalizedBase = {
    eventKey: normalizeKey(seed.eventKey, "eventKey"),
    competitionKey: normalizeKey(seed.competitionKey, "competitionKey"),
    sourceId: source.sourceId,
    posterIdentity: source.posterIdentity,
    market: "vietnam" as const,
    country: "Vietnam" as const,
    city: source.city,
    venue: source.venue,
    organizer: source.organizer,
    seriesName: source.seriesName,
    scheduleDate: normalizeDate(seed.scheduleDate),
    localStartTime: normalizeTime(seed.localStartTime),
    dayFlightIdentity: normalizeOptionalText(seed.dayFlightIdentity, "dayFlightIdentity"),
    eventNumber: normalizeOptionalText(seed.eventNumber, "eventNumber"),
    eventName: normalizeText(seed.eventName, "eventName"),
    eventFamily: normalizeKey(seed.eventFamily, "eventFamily"),
    game: normalizeText(seed.game, "game", 80).toUpperCase(),
    currency,
    totalBuyInMinorUnits: totalBuyIn,
    prizeContributionMinorUnits: prizeContribution,
    organizerFeeMinorUnits: organizerFee,
    derivedAllInBuyInMinorUnits: derivedAllInBuyIn,
    staffFeeBps: seed.staffFeeBps === null ? null : normalizeInteger(seed.staffFeeBps, "staffFeeBps"),
    staffFeeBasis: seed.staffFeeBps === null ? null : "not_stated" as const,
    gtd: normalizeGtd(seed.gtd, currency),
    startingStack: seed.startingStack === null ? null : normalizeInteger(seed.startingStack, "startingStack"),
    levelDurationMinutes: seed.levelDurationMinutes.map((value) => normalizeInteger(value, "levelDurationMinutes")),
    registrationCloseLevel: seed.registrationCloseLevel === null
      ? null
      : normalizeInteger(seed.registrationCloseLevel, "registrationCloseLevel"),
    registrationCloseTime: seed.registrationCloseTime === null
      ? null
      : normalizeTime(seed.registrationCloseTime),
    itmStatement: normalizeOptionalText(seed.itmStatement, "itmStatement"),
    playToStatement: normalizeOptionalText(seed.playToStatement, "playToStatement"),
    satelliteLinkage: normalizeOptionalText(seed.satelliteLinkage, "satelliteLinkage"),
    promotionNote: normalizeOptionalText(seed.promotionNote, "promotionNote"),
    floor: normalizeOptionalText(seed.floor, "floor"),
  };
  if (!source.displayedScheduleDates.includes(normalizedBase.scheduleDate)) {
    fail("event date is outside its poster inclusion manifest", "SCHEDULE_EVENT_DATE_OUTSIDE_SOURCE");
  }
  const fieldSets = [
    seed.uncertainFields ?? [],
    seed.ownerContextFields ?? [],
    seed.conflictingFields ?? [],
  ].flat();
  for (const field of fieldSets) {
    if (!FIELD_ORDER.includes(field)) fail("event field override is unsupported", "INVALID_SCHEDULE_FIELD_OVERRIDE");
  }
  const claims = await Promise.all(FIELD_ORDER.map(async (field) => {
    const value = fieldValue(source, seed, field, normalizedBase);
    return createScheduleEvidenceClaim({
      eventKey: normalizedBase.eventKey,
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      sourceSha256: source.sourceSha256,
      posterIdentity: source.posterIdentity,
      scheduleDate: normalizedBase.scheduleDate,
      visualRegion: seed.fieldRegions?.[field] ?? seed.visualRegion,
      field,
      value,
      extractionStatus: statusForField(seed, field, value),
      evidenceQuality: SCHEDULE_EVIDENCE_QUALITY,
    });
  }));
  const sortedClaims = [...claims].sort((left, right) => compareCanonicalStrings(left.claimId, right.claimId));
  const eventContent = {
    ...normalizedBase,
    sourceClaimIds: sortedClaims.map((claim) => claim.claimId),
  };
  const eventHash = await canonicalHash(eventContent);
  return deepFreeze({
    event: {
      eventId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:event:${eventHash}`,
      ...eventContent,
    },
    claims: sortedClaims,
  });
}

function daysBetween(left: string, right: string): number {
  return Math.abs(
    (Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) / 86_400_000,
  );
}

function exactRequiredEntries(gtdMinorUnits: string, prizeContributionMinorUnits: string): string {
  const gtd = BigInt(gtdMinorUnits);
  const contribution = BigInt(prizeContributionMinorUnits);
  if (contribution <= 0n) fail("prize contribution must be positive", "NON_POSITIVE_PRIZE_CONTRIBUTION");
  return ((gtd + contribution - 1n) / contribution).toString();
}

function normalizedCompetitionRows(events: readonly VietnamScheduleEvent[]): ReadonlyMap<string, readonly VietnamScheduleEvent[]> {
  const grouped = new Map<string, VietnamScheduleEvent[]>();
  for (const event of events) {
    const rows = grouped.get(event.competitionKey) ?? [];
    rows.push(event);
    grouped.set(event.competitionKey, rows);
  }
  for (const [key, rows] of grouped) {
    grouped.set(key, rows.sort((left, right) =>
      compareCanonicalStrings(`${left.scheduleDate}:${left.localStartTime}:${left.eventId}`, `${right.scheduleDate}:${right.localStartTime}:${right.eventId}`),
    ));
  }
  return grouped;
}

function monetaryCompetition(
  rows: readonly VietnamScheduleEvent[],
): { readonly gtd: Extract<ScheduleGtdInput, { readonly type: "monetary" }>; readonly rows: readonly VietnamScheduleEvent[] } | null {
  const monetaryRows = rows.filter((event): event is VietnamScheduleEvent & {
    readonly gtd: Extract<ScheduleGtdInput, { readonly type: "monetary" }>;
  } => event.gtd.type === "monetary");
  if (monetaryRows.length === 0) return null;
  const first = monetaryRows[0].gtd;
  for (const row of monetaryRows.slice(1)) {
    if (
      row.gtd.minorUnits !== first.minorUnits
      || row.gtd.currency !== first.currency
      || row.gtd.scale !== first.scale
    ) {
      fail("competition rows contain conflicting monetary GTD values", "CONFLICTING_COMPETITION_GTD");
    }
  }
  return { gtd: first, rows };
}

function addMoney(
  totals: Map<string, bigint>,
  keys: Map<string, { readonly key: string; readonly currency: string; readonly scale: number }>,
  key: string,
  currency: string,
  scale: number,
  minorUnits: string,
): void {
  const totalKey = `${key}:${currency}:${scale}`;
  totals.set(totalKey, (totals.get(totalKey) ?? 0n) + BigInt(minorUnits));
  keys.set(totalKey, { key, currency, scale });
}

function moneyTotals(
  totals: ReadonlyMap<string, bigint>,
  keys: ReadonlyMap<string, { readonly key: string; readonly currency: string; readonly scale: number }>,
): readonly MoneyTotal[] {
  return [...totals.entries()].map(([totalKey, total]) => ({
    ...keys.get(totalKey)!,
    totalMinorUnits: total.toString(),
  })).sort((left, right) =>
    compareCanonicalStrings(`${left.key}:${left.currency}:${left.scale}`, `${right.key}:${right.currency}:${right.scale}`),
  );
}

function normalizeItmSignature(statement: string | null): string | null {
  if (statement === null) return null;
  const match = /(\d+(?:\.\d+)?)\s*%\s*ITM/i.exec(statement);
  return match ? `${match[1]}%-itm` : statement.toLowerCase();
}

function normalizePlayToSignature(statement: string | null): string | null {
  if (statement === null) return null;
  const percent = /(\d+(?:\.\d+)?)\s*%/i.exec(statement);
  if (/final table/i.test(statement)) return "play-to-final-table";
  return percent ? `play-to-${percent[1]}%` : statement.toLowerCase();
}

async function templateFingerprints(
  events: readonly VietnamScheduleEvent[],
  competitionRows: ReadonlyMap<string, readonly VietnamScheduleEvent[]>,
  requiredByCompetition: ReadonlyMap<string, RequiredEntriesMetric>,
): Promise<readonly ScheduleTemplateFingerprint[]> {
  return Promise.all(events.map(async (event) => {
    const structuralFeatures = {
      eventFamily: event.eventFamily,
      totalBuyInMinorUnits: event.totalBuyInMinorUnits ?? event.derivedAllInBuyInMinorUnits,
      prizeContributionMinorUnits: event.prizeContributionMinorUnits,
      organizerFeeMinorUnits: event.organizerFeeMinorUnits,
      monetaryGtdMinorUnits: event.gtd.type === "monetary" ? event.gtd.minorUnits : null,
      requiredEntries: requiredByCompetition.get(event.competitionKey)?.requiredEntries ?? null,
      startingStack: event.startingStack,
      levelDurationMinutes: event.levelDurationMinutes,
      itmStatement: normalizeItmSignature(event.itmStatement),
      playToStatement: normalizePlayToSignature(event.playToStatement),
      multiFlight: (competitionRows.get(event.competitionKey)?.length ?? 0) > 1,
      satellitePattern: event.satelliteLinkage === null
        ? null
        : event.gtd.type === "seats" || event.gtd.type === "tickets"
          ? `${event.gtd.type}:${event.gtd.quantity}`
          : "linked-satellite",
    };
    const hash = await canonicalHash(structuralFeatures);
    return deepFreeze({
      fingerprintId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:template:${hash}`,
      eventId: event.eventId,
      eventKey: event.eventKey,
      competitionKey: event.competitionKey,
      sourceId: event.sourceId,
      structuralFeatures,
    });
  }));
}

function repeatedGroups(
  fingerprints: readonly ScheduleTemplateFingerprint[],
): readonly RepeatedTemplateGroup[] {
  const grouped = new Map<string, ScheduleTemplateFingerprint[]>();
  for (const fingerprint of fingerprints) {
    const rows = grouped.get(fingerprint.fingerprintId) ?? [];
    rows.push(fingerprint);
    grouped.set(fingerprint.fingerprintId, rows);
  }
  return [...grouped.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([fingerprintId, rows]) => ({
      fingerprintId,
      eventIds: [...new Set(rows.map((row) => row.eventId))].sort(compareCanonicalStrings),
      sourceIds: [...new Set(rows.map((row) => row.sourceId))].sort(compareCanonicalStrings),
      distinctSeriesCount: new Set(rows.map((row) => row.sourceId)).size.toString(),
    }))
    .sort((left, right) => compareCanonicalStrings(left.fingerprintId, right.fingerprintId));
}

function bandForBuyIn(minorUnits: string): string {
  const value = BigInt(minorUnits);
  if (value < 1_000_000n) return "vnd_lt_1m";
  if (value < 3_000_000n) return "vnd_1m_to_lt_3m";
  if (value < 10_000_000n) return "vnd_3m_to_lt_10m";
  if (value < 30_000_000n) return "vnd_10m_to_lt_30m";
  return "vnd_30m_plus";
}

function bandForGtd(minorUnits: string): string {
  const value = BigInt(minorUnits);
  if (value < 100_000_000n) return "vnd_lt_100m";
  if (value < 500_000_000n) return "vnd_100m_to_lt_500m";
  if (value < 1_000_000_000n) return "vnd_500m_to_lt_1b";
  if (value < 5_000_000_000n) return "vnd_1b_to_lt_5b";
  return "vnd_5b_plus";
}

function countedBands(values: readonly string[], mapper: (value: string) => string): readonly { readonly band: string; readonly count: string }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const band = mapper(value);
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([band, count]) => ({ band, count: count.toString() }))
    .sort((left, right) => compareCanonicalStrings(left.band, right.band));
}

async function collisionReports(
  sources: readonly ScheduleEvidenceSource[],
  events: readonly VietnamScheduleEvent[],
  fingerprints: readonly ScheduleTemplateFingerprint[],
  requiredMetrics: readonly RequiredEntriesMetric[],
  competitionRows: ReadonlyMap<string, readonly VietnamScheduleEvent[]>,
): Promise<readonly ScheduleCollisionReport[]> {
  const reports: ScheduleCollisionReport[] = [];
  const requiredByCompetition = new Map(requiredMetrics.map((metric) => [metric.competitionKey, metric] as const));
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const left = sources[leftIndex];
      const right = sources[rightIndex];
      const distance = Math.min(...left.displayedScheduleDates.flatMap((leftDate) =>
        right.displayedScheduleDates.map((rightDate) => daysBetween(leftDate, rightDate)),
      ));
      for (const window of COLLISION_WINDOWS.filter((candidate) => distance <= candidate.days)) {
        const involvedSourceIds = [left.sourceId, right.sourceId].sort(compareCanonicalStrings);
        const involvedEvents = events.filter((event) => involvedSourceIds.includes(event.sourceId));
        const involvedCompetitions = [...new Set(involvedEvents.map((event) => event.competitionKey))];
        const totals = new Map<string, bigint>();
        const totalKeys = new Map<string, { readonly key: string; readonly currency: string; readonly scale: number }>();
        for (const competitionKey of involvedCompetitions) {
          const monetary = monetaryCompetition(competitionRows.get(competitionKey) ?? []);
          if (monetary) addMoney(totals, totalKeys, "combined", monetary.gtd.currency, monetary.gtd.scale, monetary.gtd.minorUnits);
        }
        const involvedFingerprints = fingerprints.filter((row) => involvedSourceIds.includes(row.sourceId));
        const fingerprintSourceSets = new Map<string, Set<string>>();
        for (const row of involvedFingerprints) {
          const sourceSet = fingerprintSourceSets.get(row.fingerprintId) ?? new Set<string>();
          sourceSet.add(row.sourceId);
          fingerprintSourceSets.set(row.fingerprintId, sourceSet);
        }
        const sharedTemplateCount = [...fingerprintSourceSets.values()].filter((sourceSet) => sourceSet.size > 1).length;
        const leftFamilies = new Set(events.filter((event) => event.sourceId === left.sourceId).map((event) => event.eventFamily));
        const rightFamilies = new Set(events.filter((event) => event.sourceId === right.sourceId).map((event) => event.eventFamily));
        const required = involvedCompetitions
          .map((key) => requiredByCompetition.get(key))
          .filter((metric): metric is RequiredEntriesMetric => metric !== undefined);
        const content = {
          window: window.key,
          distanceDays: distance.toString(),
          sourceIds: involvedSourceIds,
          seriesNames: [left.seriesName, right.seriesName].sort(compareCanonicalStrings),
          venues: [left.venue, right.venue].filter((venue): venue is string => venue !== null).sort(compareCanonicalStrings),
          dates: [...new Set([...left.displayedScheduleDates, ...right.displayedScheduleDates])].sort(compareCanonicalStrings),
          monetaryGtdTotalsByCurrency: moneyTotals(totals, totalKeys),
          combinedRequiredEntries: required.reduce((sum, metric) => sum + BigInt(metric.requiredEntries), 0n).toString(),
          calculableRequiredEntryEvents: required.length.toString(),
          repeatedTemplateCount: sharedTemplateCount.toString(),
          eventFamilyOverlap: [...leftFamilies].filter((family) => rightFamilies.has(family)).sort(compareCanonicalStrings),
          evidenceLimitations: [
            "Announced schedule supply is not achieved entries, underlying demand, or player-pool overlap.",
            "All source images remain owner-provided public evidence with unverified status.",
            "Required entries exist only where monetary GTD and explicit prize contribution are both displayed.",
          ],
        };
        const hash = await canonicalHash(content);
        reports.push(deepFreeze({
          collisionId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:collision:${hash}`,
          ...content,
        }));
      }
    }
  }
  return reports.sort((left, right) =>
    compareCanonicalStrings(`${left.window}:${left.collisionId}`, `${right.window}:${right.collisionId}`),
  );
}

export async function createVietnamScheduleSupplyBundle(input: {
  readonly sourceCutoff: string;
  readonly sources: readonly ScheduleEvidenceSource[];
  readonly events: readonly ScheduleSeedEvent[];
}): Promise<VietnamScheduleSupplyBundle> {
  const sourceCutoff = normalizeInstant(input.sourceCutoff);
  const sources = input.sources.map(normalizeSource).sort((left, right) => compareCanonicalStrings(left.sourceId, right.sourceId));
  if (sources.length !== 3) fail("Vietnam Schedule Supply V1 requires exactly three source images", "SCHEDULE_SOURCE_COUNT_MISMATCH");
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    fail("source IDs must be unique", "DUPLICATE_SCHEDULE_SOURCE_ID");
  }
  if (new Set(sources.map((source) => source.sourceSha256)).size !== sources.length) {
    fail("source image hashes must be unique", "DUPLICATE_SCHEDULE_SOURCE_IMAGE");
  }
  const sourceById = new Map(sources.map((source) => [source.sourceId, source] as const));
  const eventKeys = input.events.map((event) => normalizeKey(event.eventKey, "eventKey"));
  if (new Set(eventKeys).size !== eventKeys.length) fail("event rows contain a duplicate key", "DUPLICATE_SCHEDULE_EVENT_ROW");
  const rowKeys = input.events.map((event) =>
    `${normalizeKey(event.sourceId, "event.sourceId")}:${normalizeDate(event.scheduleDate)}:${normalizeTime(event.localStartTime)}:${normalizeText(event.eventNumber ?? "-", "event.eventNumber")}:${normalizeText(event.eventName, "event.eventName")}`,
  );
  if (new Set(rowKeys).size !== rowKeys.length) fail("event rows contain a duplicate source row", "DUPLICATE_SCHEDULE_SOURCE_ROW");
  const normalizedRows = await Promise.all(input.events.map((event) => {
    const source = sourceById.get(normalizeKey(event.sourceId, "event.sourceId"));
    if (!source) fail("event references an unknown source", "UNKNOWN_SCHEDULE_SOURCE");
    return normalizeEvent(event, source);
  }));
  const events = normalizedRows.map((row) => row.event).sort((left, right) => compareCanonicalStrings(left.eventId, right.eventId));
  const claims = normalizedRows.flatMap((row) => row.claims).sort((left, right) => compareCanonicalStrings(left.claimId, right.claimId));
  if (new Set(claims.map((claim) => claim.claimId)).size !== claims.length) {
    fail("claim identities collided", "DUPLICATE_SCHEDULE_CLAIM");
  }
  if (claims.some((claim) => claim.evidenceQuality !== SCHEDULE_EVIDENCE_QUALITY)) {
    fail("schedule evidence quality cannot be upgraded in V1", "INVALID_SCHEDULE_EVIDENCE_QUALITY");
  }

  const inclusionContent = {
    sourceCutoff,
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      sourceSha256: source.sourceSha256,
      sourceByteLength: source.sourceByteLength,
    })),
    eventIds: events.map((event) => event.eventId),
    claimIds: claims.map((claim) => claim.claimId),
  };
  const inclusionHash = await canonicalHash(inclusionContent);
  const inclusionManifest = deepFreeze({
    inclusionManifestId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:inclusion:${inclusionHash}`,
    contractVersion: VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION,
    ...inclusionContent,
  });
  const releaseContent = {
    contractVersion: VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION,
    releaseKind: "planned_schedule_supply" as const,
    releaseKey: "vietnam-schedule-supply-v1" as const,
    market: "vietnam" as const,
    country: "Vietnam" as const,
    scopeKind: "country" as const,
    sourceCutoff,
    inclusionManifestId: inclusionManifest.inclusionManifestId,
    sourceIds: sources.map((source) => source.sourceId),
    sourceImageSha256s: sources.map((source) => source.sourceSha256).sort(compareCanonicalStrings),
    eventIds: events.map((event) => event.eventId),
    claimIds: claims.map((claim) => claim.claimId),
    evidenceQuality: SCHEDULE_EVIDENCE_QUALITY,
  };
  const releaseHash = await canonicalHash(releaseContent);
  const release = deepFreeze({
    releaseId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:release:${releaseHash}`,
    ...releaseContent,
  });

  const competitionRows = normalizedCompetitionRows(events);
  const requiredMetrics: RequiredEntriesMetric[] = [];
  const gtdSeriesTotals = new Map<string, bigint>();
  const gtdSeriesKeys = new Map<string, { readonly key: string; readonly currency: string; readonly scale: number }>();
  const gtdDateTotals = new Map<string, bigint>();
  const gtdDateKeys = new Map<string, { readonly key: string; readonly currency: string; readonly scale: number }>();
  for (const [competitionKey, rows] of competitionRows) {
    const monetary = monetaryCompetition(rows);
    if (!monetary) continue;
    const sourceId = rows[0].sourceId;
    const firstDate = rows.map((row) => row.scheduleDate).sort(compareCanonicalStrings)[0];
    addMoney(gtdSeriesTotals, gtdSeriesKeys, sourceId, monetary.gtd.currency, monetary.gtd.scale, monetary.gtd.minorUnits);
    addMoney(gtdDateTotals, gtdDateKeys, firstDate, monetary.gtd.currency, monetary.gtd.scale, monetary.gtd.minorUnits);
    const explicitContributions = [...new Set(rows
      .map((row) => row.prizeContributionMinorUnits)
      .filter((value): value is string => value !== null))];
    if (explicitContributions.length > 1) {
      fail("competition rows contain conflicting prize contributions", "CONFLICTING_COMPETITION_CONTRIBUTION");
    }
    if (explicitContributions.length === 1) {
      requiredMetrics.push({
        competitionKey,
        sourceId,
        currency: monetary.gtd.currency,
        gtdMinorUnits: monetary.gtd.minorUnits,
        prizeContributionMinorUnits: explicitContributions[0],
        requiredEntries: exactRequiredEntries(monetary.gtd.minorUnits, explicitContributions[0]),
        sourceEventIds: rows.map((row) => row.eventId).sort(compareCanonicalStrings),
      });
    }
  }
  requiredMetrics.sort((left, right) => compareCanonicalStrings(left.competitionKey, right.competitionKey));
  const requiredByCompetition = new Map(requiredMetrics.map((metric) => [metric.competitionKey, metric] as const));
  const fingerprints = [...await templateFingerprints(events, competitionRows, requiredByCompetition)]
    .sort((left, right) => compareCanonicalStrings(left.eventId, right.eventId));
  const repeatedTemplateGroups = repeatedGroups(fingerprints);
  const collisions = await collisionReports(sources, events, fingerprints, requiredMetrics, competitionRows);

  const requiredByDate = new Map<string, { total: bigint; competitions: number }>();
  for (const metric of requiredMetrics) {
    const rows = competitionRows.get(metric.competitionKey) ?? [];
    const date = rows.map((row) => row.scheduleDate).sort(compareCanonicalStrings)[0];
    const current = requiredByDate.get(date) ?? { total: 0n, competitions: 0 };
    requiredByDate.set(date, {
      total: current.total + BigInt(metric.requiredEntries),
      competitions: current.competitions + 1,
    });
  }
  const uniqueCompetitionRows = [...competitionRows.values()].map((rows) => rows[0]);
  const buyInValues = uniqueCompetitionRows
    .map((event) => event.totalBuyInMinorUnits ?? event.derivedAllInBuyInMinorUnits)
    .filter((value): value is string => value !== null);
  const gtdValues = [...competitionRows.values()]
    .map((rows) => monetaryCompetition(rows)?.gtd.minorUnits ?? null)
    .filter((value): value is string => value !== null);
  const missingFieldCoverage = FIELD_ORDER.map((field) => ({
    field,
    missingCount: claims.filter((claim) => claim.field === field && claim.extractionStatus === "missing").length.toString(),
    uncertainCount: claims.filter((claim) => claim.field === field && claim.extractionStatus === "uncertain").length.toString(),
    conflictingCount: claims.filter((claim) => claim.field === field && claim.extractionStatus === "conflicting").length.toString(),
  }));
  const artifactContent = {
    contractVersion: VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION,
    artifactType: "vietnam_schedule_supply" as const,
    releaseId: release.releaseId,
    sourceCutoff,
    sourceInventory: sources,
    eventCount: events.length.toString(),
    claimCount: claims.length.toString(),
    events,
    claims,
    templateFingerprints: fingerprints,
    repeatedTemplateGroups,
    collisionReports: collisions,
    monetaryGtdTotalsBySeries: moneyTotals(gtdSeriesTotals, gtdSeriesKeys),
    monetaryGtdTotalsByDate: moneyTotals(gtdDateTotals, gtdDateKeys),
    requiredEntriesByEvent: requiredMetrics,
    combinedRequiredEntriesByDate: [...requiredByDate.entries()]
      .map(([date, value]) => ({
        date,
        totalRequiredEntries: value.total.toString(),
        calculableEventCount: value.competitions.toString(),
      }))
      .sort((left, right) => compareCanonicalStrings(left.date, right.date)),
    eventCountsByBuyInBand: countedBands(buyInValues, bandForBuyIn),
    eventCountsByGtdBand: countedBands(gtdValues, bandForGtd),
    overlappingSeriesByWindow: COLLISION_WINDOWS.map((window) => {
      const matching = collisions.filter((collision) => collision.window === window.key);
      return {
        window: window.key,
        distinctSeriesCount: new Set(matching.flatMap((collision) => collision.sourceIds)).size.toString(),
        collisionGroupCount: matching.length.toString(),
      };
    }),
    missingFieldCoverage,
    limitations: [
      "Announced schedule supply is not achieved entries, underlying demand, turnout, or an outcome dataset.",
      "All claims remain owner-provided public image evidence with unverified status.",
      "Required entries are calculated only from explicit monetary GTD and explicit prize contribution using exact ceiling arithmetic.",
      "Repeated structural fingerprints describe template similarity and do not claim copying or plagiarism.",
      "Collision windows describe overlapping announced supply and do not prove player-pool overlap, dilution, or a cause-and-effect relationship.",
      "No FX conversion is performed and different currencies are never combined.",
      "Poster slices may cover only displayed days rather than each complete festival schedule.",
    ],
  };
  const contentHash = await canonicalHash(artifactContent);
  const artifact = deepFreeze({
    artifactId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:artifact:${contentHash}`,
    contentHash,
    ...artifactContent,
  });
  return deepFreeze({ inclusionManifest, release, artifact });
}

export async function createScheduleSupplyReceipt(input: {
  readonly release: VietnamScheduleSupplyRelease;
  readonly artifact: ScheduleSupplyArtifact;
  readonly artifactPath: string;
  readonly artifactFileSha256: string;
  readonly sources: readonly ScheduleEvidenceSource[];
}): Promise<ScheduleSupplyReceipt> {
  const artifactPath = input.artifactPath.replace(/\\/g, "/").trim();
  if (
    !artifactPath.startsWith("src/lib/series-market/datasets/vietnam/schedule-supply/v1/")
    || artifactPath.includes("..")
  ) {
    fail("artifact path is outside the Vietnam schedule release", "INVALID_SCHEDULE_ARTIFACT_PATH");
  }
  const artifactFileSha256 = normalizeSha256(input.artifactFileSha256, "artifactFileSha256");
  if (input.artifact.releaseId !== input.release.releaseId) {
    fail("artifact and release identities do not match", "SCHEDULE_RECEIPT_RELEASE_MISMATCH");
  }
  const sourceImageReceipts = input.sources.map(normalizeSource).map((source) => ({
    sourceId: source.sourceId,
    sourcePath: source.sourcePath,
    sourceSha256: source.sourceSha256,
    sourceByteLength: source.sourceByteLength,
  })).sort((left, right) => compareCanonicalStrings(left.sourceId, right.sourceId));
  if (!sameStringSets(
    sourceImageReceipts.map((source) => source.sourceSha256).sort(compareCanonicalStrings),
    input.release.sourceImageSha256s,
  )) {
    fail("receipt source hashes do not match the release", "SCHEDULE_RECEIPT_SOURCE_MISMATCH");
  }
  const content = {
    releaseId: input.release.releaseId,
    artifactId: input.artifact.artifactId,
    artifactContentHash: input.artifact.contentHash,
    artifactPath,
    artifactFileSha256,
    sourceImageReceipts,
  };
  const receiptHash = await canonicalHash(content);
  return deepFreeze({
    receiptId: `${VIETNAM_SCHEDULE_SUPPLY_NAMESPACE}:receipt:${receiptHash}`,
    contractVersion: VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION,
    ...content,
  });
}
