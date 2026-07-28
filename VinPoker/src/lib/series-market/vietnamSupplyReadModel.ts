import { sha256Hex } from "../series-intelligence/provenanceHash";
import { SeriesMarketValidationError } from "./normalization";
import {
  SCHEDULE_EVIDENCE_QUALITY,
  VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION,
  type CollisionWindowKey,
  type D1ACorrectionRecord,
  type MoneyTotal,
  type ScheduleEvidenceClaim,
  type ScheduleFieldKey,
  type ScheduleGtdInput,
  type ScheduleSupplyArtifact,
  type ScheduleSupplyReceipt,
  type ScheduleTemplateFingerprint,
  type VietnamScheduleEvent,
  type VietnamScheduleSupplyRelease,
} from "./vietnamScheduleSupply";

export const VIETNAM_SUPPLY_CURRENT_RELEASE_ID =
  "series-market:v1:vietnam-schedule-supply:v1:release:c0f5e97aeb8b58bca4f52325cca2e17b4c27bbdb2bdca3e5f908f6ae946a5651" as const;
export const VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID =
  "series-market:v1:vietnam-schedule-supply:v1:artifact:30fecbeb69d184a614febbcff87ef925fe6fb1d2f4d1a1822c2a8d9403f5e995" as const;
export const VIETNAM_SUPPLY_CURRENT_RECEIPT_ID =
  "series-market:v1:vietnam-schedule-supply:v1:receipt:1a513eca0724db4ea8cff0ddcef74dcf056045ce5af1a167c2668b327a879b5c" as const;
export const VIETNAM_SUPPLY_CURRENT_CORRECTION_ID =
  "series-market:v1:vietnam-schedule-supply:v1:correction:9b172417ff4f80738e818c4f31269520957392c174949d32c0cfe3e19ed27d16" as const;
export const VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256 =
  "6517f858e80cb439d3b15375859df2b5b51d3e7c8a2bc7f96ffef4b3fe2f1706" as const;
export const VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID =
  "series-market:v1:vietnam-schedule-supply:v1:release:dbd23425e5318a23e07779e2a448120a6c361b16149c90c0ef9481ca816ac150" as const;

const WINDOW_ORDER: readonly CollisionWindowKey[] = [
  "same_day",
  "within_3_days",
  "within_7_days",
  "within_14_days",
  "within_30_days",
];

const WINDOW_LABELS: Readonly<Record<CollisionWindowKey, string>> = {
  same_day: "Cùng ngày",
  within_3_days: "Trong 3 ngày",
  within_7_days: "Trong 7 ngày",
  within_14_days: "Trong 14 ngày",
  within_30_days: "Trong 30 ngày",
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "center-p-jul-17-2026": "Center-P",
  "grand-loyal-jul-29-2026": "Grand Loyal",
  "rpt-sep-11-12-2026": "RPT",
};

const FORBIDDEN_OUTCOME_KEYS = new Set([
  "actualEntries",
  "observedEntries",
  "observedTurnout",
  "playerDemand",
  "uniquePlayers",
  "reentries",
]);

const PARTIAL_MATCH_FIELDS = [
  "eventFamily",
  "totalBuyInMinorUnits",
  "monetaryGtdMinorUnits",
  "startingStack",
  "multiFlight",
] as const;

export type VietnamSupplyIntegrityState = "current" | "corrected";
export type VietnamSupplyGtdKind = ScheduleGtdInput["type"];
export type VietnamSupplyEventRole = "satellite" | "main" | "side";
export type VietnamSupplyRequiredState = "calculable" | "unavailable";

export interface VietnamSupplyMoney {
  readonly minorUnits: string;
  readonly currency: string;
  readonly scale: number;
  readonly displayValue: string;
  readonly exactValue: string;
}

export interface VietnamSupplyClaimReadModel {
  readonly claimId: string;
  readonly field: ScheduleFieldKey;
  readonly displayValue: string;
  readonly extractionStatus: ScheduleEvidenceClaim["extractionStatus"];
  readonly evidenceQuality: typeof SCHEDULE_EVIDENCE_QUALITY;
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
  readonly visualRegion: string;
}

export interface VietnamSupplyRequiredEntriesReadModel {
  readonly state: VietnamSupplyRequiredState;
  readonly displayValue: string;
  readonly exactValue: string | null;
  readonly reason: string | null;
  readonly competitionKey: string;
}

export interface VietnamSupplyEventReadModel {
  readonly eventId: string;
  readonly eventKey: string;
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly seriesName: string;
  readonly organizer: string;
  readonly venue: string | null;
  readonly scheduleDate: string;
  readonly localStartTime: string;
  readonly eventNumber: string | null;
  readonly eventName: string;
  readonly eventFamily: string;
  readonly role: VietnamSupplyEventRole;
  readonly game: string;
  readonly totalBuyIn: VietnamSupplyMoney | null;
  readonly prizeContribution: VietnamSupplyMoney | null;
  readonly organizerFee: VietnamSupplyMoney | null;
  readonly buyInDisplay: string;
  readonly gtdKind: VietnamSupplyGtdKind;
  readonly gtdDisplay: string;
  readonly gtdMoney: VietnamSupplyMoney | null;
  readonly startingStack: string | null;
  readonly levelDurationDisplay: string;
  readonly registrationCloseDisplay: string;
  readonly itmStatement: string | null;
  readonly satelliteLinkage: string | null;
  readonly requiredEntries: VietnamSupplyRequiredEntriesReadModel;
  readonly missingClaimCount: number;
  readonly uncertainClaimCount: number;
  readonly conflictingClaimCount: number;
  readonly claims: readonly VietnamSupplyClaimReadModel[];
  readonly evidenceQuality: typeof SCHEDULE_EVIDENCE_QUALITY;
}

export interface VietnamSupplySeriesSummary {
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly organizer: string;
  readonly venue: string | null;
  readonly seriesName: string;
  readonly displayedScheduleDates: readonly string[];
  readonly eventCount: number;
  readonly claimCount: number;
  readonly missingClaimCount: number;
  readonly announcedGtd: VietnamSupplyMoney | null;
  readonly calculableRequiredEntries: string | null;
  readonly calculableRequiredMetricCount: number;
  readonly requiredEntriesReason: string | null;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}

export interface VietnamSupplyCollisionGroup {
  readonly collisionId: string;
  readonly distanceDays: string;
  readonly sourceIds: readonly string[];
  readonly sourceLabels: readonly string[];
  readonly seriesNames: readonly string[];
  readonly dates: readonly string[];
  readonly announcedGtdTotals: readonly VietnamSupplyMoney[];
  readonly combinedRequiredEntries: string;
  readonly calculableRequiredEntryEvents: string;
  readonly repeatedTemplateCount: string;
  readonly eventFamilyOverlap: readonly string[];
  readonly evidenceLimitations: readonly string[];
}

export interface VietnamSupplyCollisionWindow {
  readonly key: CollisionWindowKey;
  readonly label: string;
  readonly state: "available" | "empty";
  readonly groupCount: number;
  readonly groups: readonly VietnamSupplyCollisionGroup[];
}

export interface VietnamSupplyTemplateGroup {
  readonly groupId: string;
  readonly matchKind: "exact" | "partial";
  readonly title: string;
  readonly eventIds: readonly string[];
  readonly eventLabels: readonly string[];
  readonly sourceLabels: readonly string[];
  readonly matchedFields: readonly string[];
  readonly requiredEntriesState: "available" | "partially_unavailable";
  readonly basis: string;
}

export interface VietnamSupplyCorrectionReadModel {
  readonly correctionId: string;
  readonly correctedAt: string;
  readonly affectedEventKey: string;
  readonly affectedField: "prize_contribution";
  readonly oldValue: VietnamSupplyMoney;
  readonly newValue: VietnamSupplyMoney;
  readonly correctedReleaseId: string;
  readonly supersededReleaseId: string;
  readonly status: D1ACorrectionRecord["status"];
}

export interface VietnamSupplyReadModel {
  readonly integrityState: VietnamSupplyIntegrityState;
  readonly releaseId: typeof VIETNAM_SUPPLY_CURRENT_RELEASE_ID;
  readonly releaseShortId: string;
  readonly artifactId: typeof VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID;
  readonly receiptId: typeof VIETNAM_SUPPLY_CURRENT_RECEIPT_ID;
  readonly correctionId: typeof VIETNAM_SUPPLY_CURRENT_CORRECTION_ID;
  readonly artifactFileSha256: typeof VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256;
  readonly sourceCutoff: string;
  readonly evidenceQuality: typeof SCHEDULE_EVIDENCE_QUALITY;
  readonly overview: {
    readonly seriesCount: number;
    readonly eventCount: number;
    readonly sourceCount: number;
    readonly claimCount: number;
    readonly missingClaimCount: number;
    readonly uncertainClaimCount: number;
    readonly conflictingClaimCount: number;
    readonly announcedGtdTotals: readonly VietnamSupplyMoney[];
    readonly calculableRequiredEntries: string;
    readonly calculableRequiredMetricCount: number;
    readonly unavailableRequiredEventCount: number;
  };
  readonly series: readonly VietnamSupplySeriesSummary[];
  readonly collisionWindows: readonly VietnamSupplyCollisionWindow[];
  readonly templates: readonly VietnamSupplyTemplateGroup[];
  readonly events: readonly VietnamSupplyEventReadModel[];
  readonly limitations: readonly string[];
  readonly correction: VietnamSupplyCorrectionReadModel;
}

export interface VietnamSupplyEventFilters {
  readonly search: string;
  readonly sourceId: string;
  readonly scheduleDate: string;
  readonly eventFamily: string;
  readonly gtdKind: "all" | VietnamSupplyGtdKind;
  readonly monetaryState: "all" | "explicit_split" | "total_only" | "missing";
  readonly requiredState: "all" | VietnamSupplyRequiredState;
  readonly role: "all" | VietnamSupplyEventRole;
  readonly missingState: "all" | "has_missing" | "complete";
}

export const EMPTY_VIETNAM_SUPPLY_FILTERS: VietnamSupplyEventFilters = Object.freeze({
  search: "",
  sourceId: "all",
  scheduleDate: "all",
  eventFamily: "all",
  gtdKind: "all",
  monetaryState: "all",
  requiredState: "all",
  role: "all",
  missingState: "all",
});

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

function parseInteger(value: string, label: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) fail(`${label} must be a canonical non-negative integer`, "VIETNAM_SUPPLY_INTEGER_INVALID");
  return BigInt(value);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains duplicate identities`, "VIETNAM_SUPPLY_DUPLICATE_IDENTITY");
}

function assertSameSet(left: readonly string[], right: readonly string[], label: string): void {
  assertUnique(left, `${label} left`);
  assertUnique(right, `${label} right`);
  const a = [...left].sort();
  const b = [...right].sort();
  if (a.length !== b.length || a.some((value, index) => value !== b[index])) {
    fail(`${label} does not match`, "VIETNAM_SUPPLY_IDENTITY_SET_MISMATCH");
  }
}

function asArtifact(rawArtifact: string): ScheduleSupplyArtifact {
  try {
    return JSON.parse(rawArtifact) as ScheduleSupplyArtifact;
  } catch {
    fail("Vietnam supply artifact is not valid JSON", "VIETNAM_SUPPLY_ARTIFACT_INVALID_JSON");
  }
}

function walkKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_OUTCOME_KEYS.has(key)) {
      fail(`outcome key ${key} is forbidden in schedule supply`, "VIETNAM_SUPPLY_OUTCOME_KEY_FORBIDDEN");
    }
    walkKeys(nested);
  }
}

function formatInteger(value: string): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(
    parseInteger(value, "display integer"),
  );
}

function money(minorUnits: string, currency: string, scale: number): VietnamSupplyMoney {
  const exact = parseInteger(minorUnits, "money minor units");
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) {
    fail("money scale is outside the supported range", "VIETNAM_SUPPLY_MONEY_SCALE_INVALID");
  }
  const divisor = 10n ** BigInt(scale);
  const whole = exact / divisor;
  const fraction = exact % divisor;
  const formattedWhole = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(whole);
  const suffix = scale === 0 ? "" : `,${fraction.toString().padStart(scale, "0")}`;
  const symbol = currency === "VND" ? " ₫" : ` ${currency}`;
  return deepFreeze({
    minorUnits,
    currency,
    scale,
    displayValue: `${formattedWhole}${suffix}${symbol}`,
    exactValue: `${minorUnits} ${currency} minor units (scale ${scale})`,
  });
}

function moneyFromTotal(total: MoneyTotal): VietnamSupplyMoney {
  return money(total.totalMinorUnits, total.currency, total.scale);
}

function claimDisplay(claim: ScheduleEvidenceClaim): string {
  const value = claim.value;
  switch (value.type) {
    case "text":
    case "integer":
    case "local_date":
    case "local_time":
      return value.value;
    case "money":
      return money(value.minorUnits, value.currency, value.scale).displayValue;
    case "percent_bps":
      return `${formatInteger(value.value)} bps`;
    case "duration_sequence_minutes":
      return value.values.map((item) => `${item}m`).join(" / ");
    case "seats":
      return `${value.quantity} seats`;
    case "tickets":
      return `${value.quantity} tickets`;
    case "missing":
      return `Missing (${value.reason})`;
  }
}

function gtdDisplay(gtd: ScheduleGtdInput): { display: string; money: VietnamSupplyMoney | null } {
  if (gtd.type === "monetary") {
    const value = money(gtd.minorUnits, gtd.currency, gtd.scale);
    return { display: value.displayValue, money: value };
  }
  if (gtd.type === "seats") return { display: `${gtd.quantity} seats`, money: null };
  if (gtd.type === "tickets") return { display: `${gtd.quantity} tickets`, money: null };
  return { display: `Missing (${gtd.reason})`, money: null };
}

function eventRole(event: VietnamScheduleEvent): VietnamSupplyEventRole {
  if (event.eventFamily === "satellite") return "satellite";
  if (/(?:main|kick-off)/i.test(event.eventFamily)) return "main";
  return "side";
}

function sourceLabel(sourceId: string): string {
  return SOURCE_LABELS[sourceId] ?? sourceId;
}

function requiredUnavailableReason(event: VietnamScheduleEvent): string {
  if (event.gtd.type !== "monetary") {
    return event.gtd.type === "missing"
      ? "Monetary GTD is missing."
      : "GTD is expressed as seats or tickets, not money.";
  }
  if (event.prizeContributionMinorUnits === null) {
    return "Prize contribution per entry is not explicitly split on the poster.";
  }
  return "No released required-entry metric is linked to this event.";
}

function validateCurrentGraph(
  release: VietnamScheduleSupplyRelease,
  artifact: ScheduleSupplyArtifact,
  receipt: ScheduleSupplyReceipt,
  correction: D1ACorrectionRecord,
): void {
  if (
    release.contractVersion !== VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION
    || artifact.contractVersion !== VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION
    || receipt.contractVersion !== VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION
    || correction.contractVersion !== VIETNAM_SCHEDULE_SUPPLY_CONTRACT_VERSION
  ) {
    fail("Vietnam supply contract version mismatch", "VIETNAM_SUPPLY_CONTRACT_VERSION_MISMATCH");
  }
  if (release.releaseId === VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID) {
    fail("superseded Vietnam supply release is not renderable", "VIETNAM_SUPPLY_RELEASE_SUPERSEDED");
  }
  if (
    release.releaseId !== VIETNAM_SUPPLY_CURRENT_RELEASE_ID
    || artifact.artifactId !== VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID
    || receipt.receiptId !== VIETNAM_SUPPLY_CURRENT_RECEIPT_ID
    || correction.correctionId !== VIETNAM_SUPPLY_CURRENT_CORRECTION_ID
  ) {
    fail("Vietnam supply identity does not match the corrected release", "VIETNAM_SUPPLY_CURRENT_IDENTITY_MISMATCH");
  }
  if (
    artifact.releaseId !== release.releaseId
    || receipt.releaseId !== release.releaseId
    || receipt.artifactId !== artifact.artifactId
    || receipt.artifactContentHash !== artifact.contentHash
    || correction.corrected.releaseId !== release.releaseId
    || correction.corrected.artifactId !== artifact.artifactId
    || correction.corrected.receiptId !== receipt.receiptId
    || correction.corrected.artifactFileSha256 !== receipt.artifactFileSha256
  ) {
    fail("Vietnam supply release, artifact, receipt, and correction do not link", "VIETNAM_SUPPLY_GRAPH_LINK_MISMATCH");
  }
  if (
    correction.status !== "superseded_by_corrected_release"
    || correction.superseded.releaseId !== VIETNAM_SUPPLY_SUPERSEDED_RELEASE_ID
  ) {
    fail("Vietnam supply correction lineage is invalid", "VIETNAM_SUPPLY_CORRECTION_LINEAGE_INVALID");
  }
  if (
    release.market !== "vietnam"
    || release.country !== "Vietnam"
    || release.scopeKind !== "country"
    || release.releaseKind !== "planned_schedule_supply"
    || release.evidenceQuality !== SCHEDULE_EVIDENCE_QUALITY
  ) {
    fail("Vietnam supply release scope or evidence quality is invalid", "VIETNAM_SUPPLY_RELEASE_SCOPE_INVALID");
  }
  if (
    artifact.artifactType !== "vietnam_schedule_supply"
    || artifact.sourceCutoff !== release.sourceCutoff
    || artifact.contentHash !== VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID.split(":").at(-1)
  ) {
    fail("Vietnam supply artifact metadata is invalid", "VIETNAM_SUPPLY_ARTIFACT_METADATA_INVALID");
  }
  if (
    receipt.artifactFileSha256 !== VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256
    || correction.corrected.artifactFileSha256 !== VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256
  ) {
    fail("Vietnam supply file receipt is not current", "VIETNAM_SUPPLY_FILE_RECEIPT_INVALID");
  }
}

function validateArtifactContents(
  release: VietnamScheduleSupplyRelease,
  artifact: ScheduleSupplyArtifact,
  receipt: ScheduleSupplyReceipt,
  correction: D1ACorrectionRecord,
): void {
  walkKeys(artifact);
  if (parseInteger(artifact.eventCount, "artifact event count") !== BigInt(artifact.events.length)) {
    fail("artifact event count does not match rows", "VIETNAM_SUPPLY_EVENT_COUNT_MISMATCH");
  }
  if (parseInteger(artifact.claimCount, "artifact claim count") !== BigInt(artifact.claims.length)) {
    fail("artifact claim count does not match rows", "VIETNAM_SUPPLY_CLAIM_COUNT_MISMATCH");
  }
  const eventIds = artifact.events.map((event) => event.eventId);
  const claimIds = artifact.claims.map((claim) => claim.claimId);
  assertSameSet(release.eventIds, eventIds, "release event IDs");
  assertSameSet(release.claimIds, claimIds, "release claim IDs");
  assertSameSet(release.sourceIds, artifact.sourceInventory.map((source) => source.sourceId), "release source IDs");
  assertSameSet(
    release.sourceImageSha256s,
    artifact.sourceInventory.map((source) => source.sourceSha256),
    "release source hashes",
  );

  const sourceById = new Map(artifact.sourceInventory.map((source) => [source.sourceId, source]));
  const claimById = new Map(artifact.claims.map((claim) => [claim.claimId, claim]));
  for (const source of artifact.sourceInventory) {
    if (source.evidenceQuality !== SCHEDULE_EVIDENCE_QUALITY) {
      fail("source evidence was upgraded without a new release", "VIETNAM_SUPPLY_EVIDENCE_UPGRADE_FORBIDDEN");
    }
    const sourceReceipt = receipt.sourceImageReceipts.find((item) => item.sourceId === source.sourceId);
    if (
      !sourceReceipt
      || sourceReceipt.sourcePath !== source.sourcePath
      || sourceReceipt.sourceSha256 !== source.sourceSha256
      || sourceReceipt.sourceByteLength !== source.sourceByteLength
    ) {
      fail("source receipt does not match source inventory", "VIETNAM_SUPPLY_SOURCE_RECEIPT_MISMATCH");
    }
  }
  if (receipt.sourceImageReceipts.length !== artifact.sourceInventory.length) {
    fail("source receipt cardinality does not match inventory", "VIETNAM_SUPPLY_SOURCE_RECEIPT_CARDINALITY");
  }

  for (const claim of artifact.claims) {
    const source = sourceById.get(claim.sourceId);
    if (
      !source
      || claim.sourcePath !== source.sourcePath
      || claim.sourceSha256 !== source.sourceSha256
      || claim.posterIdentity !== source.posterIdentity
      || claim.evidenceQuality !== SCHEDULE_EVIDENCE_QUALITY
    ) {
      fail("claim provenance does not match source inventory", "VIETNAM_SUPPLY_CLAIM_PROVENANCE_MISMATCH");
    }
  }
  for (const event of artifact.events) {
    if (!sourceById.has(event.sourceId)) {
      fail("event references an unknown source", "VIETNAM_SUPPLY_EVENT_SOURCE_UNKNOWN");
    }
    assertUnique(event.sourceClaimIds, `event ${event.eventId} claim IDs`);
    for (const claimId of event.sourceClaimIds) {
      const claim = claimById.get(claimId);
      if (!claim || claim.eventKey !== event.eventKey || claim.sourceId !== event.sourceId) {
        fail("event claim linkage is invalid", "VIETNAM_SUPPLY_EVENT_CLAIM_LINK_INVALID");
      }
    }
  }

  if (correction.rowAudits.length !== artifact.events.length) {
    fail("correction audit does not cover every event", "VIETNAM_SUPPLY_CORRECTION_AUDIT_INCOMPLETE");
  }
  if (correction.rowAudits.some((row) => row.unresolvedFields.length > 0)) {
    fail("correction audit contains unresolved fields", "VIETNAM_SUPPLY_CORRECTION_UNRESOLVED");
  }
  const affected = correction.affectedClaims[0];
  if (
    correction.affectedClaims.length !== 1
    || !affected
    || affected.field !== "prize_contribution"
    || !claimById.has(affected.correctedClaimId)
    || claimById.has(affected.supersededClaimId)
  ) {
    fail("correction claim lineage is invalid", "VIETNAM_SUPPLY_CORRECTION_CLAIM_INVALID");
  }
}

function buildClaims(
  claims: readonly ScheduleEvidenceClaim[],
): readonly VietnamSupplyClaimReadModel[] {
  return claims
    .map((claim) => deepFreeze({
      claimId: claim.claimId,
      field: claim.field,
      displayValue: claimDisplay(claim),
      extractionStatus: claim.extractionStatus,
      evidenceQuality: claim.evidenceQuality,
      sourceId: claim.sourceId,
      sourcePath: claim.sourcePath,
      sourceSha256: claim.sourceSha256,
      visualRegion: claim.visualRegion,
    }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

function buildEvents(artifact: ScheduleSupplyArtifact): readonly VietnamSupplyEventReadModel[] {
  return artifact.events
    .map((event) => {
      const eventClaims = artifact.claims.filter(
        (claim) => claim.eventKey === event.eventKey && claim.sourceId === event.sourceId,
      );
      const requiredMatches = artifact.requiredEntriesByEvent.filter((metric) =>
        metric.sourceEventIds.includes(event.eventId),
      );
      if (requiredMatches.length > 1) {
        fail("event links to multiple required-entry metrics", "VIETNAM_SUPPLY_REQUIRED_METRIC_CARDINALITY");
      }
      const requiredMetric = requiredMatches[0];
      const requiredEntries: VietnamSupplyRequiredEntriesReadModel = requiredMetric
        ? {
            state: "calculable",
            displayValue: formatInteger(requiredMetric.requiredEntries),
            exactValue: requiredMetric.requiredEntries,
            reason: null,
            competitionKey: requiredMetric.competitionKey,
          }
        : {
            state: "unavailable",
            displayValue: "Unavailable",
            exactValue: null,
            reason: requiredUnavailableReason(event),
            competitionKey: event.competitionKey,
          };
      const totalBuyIn = event.totalBuyInMinorUnits === null
        ? null
        : money(event.totalBuyInMinorUnits, event.currency, 0);
      const prizeContribution = event.prizeContributionMinorUnits === null
        ? null
        : money(event.prizeContributionMinorUnits, event.currency, 0);
      const organizerFee = event.organizerFeeMinorUnits === null
        ? null
        : money(event.organizerFeeMinorUnits, event.currency, 0);
      const gtd = gtdDisplay(event.gtd);
      const buyInDisplay = prizeContribution && organizerFee
        ? `${prizeContribution.displayValue} + ${organizerFee.displayValue}`
        : totalBuyIn
          ? `${totalBuyIn.displayValue} total`
          : "Missing";
      return deepFreeze({
        eventId: event.eventId,
        eventKey: event.eventKey,
        sourceId: event.sourceId,
        sourceLabel: sourceLabel(event.sourceId),
        seriesName: event.seriesName,
        organizer: event.organizer,
        venue: event.venue,
        scheduleDate: event.scheduleDate,
        localStartTime: event.localStartTime,
        eventNumber: event.eventNumber,
        eventName: event.eventName,
        eventFamily: event.eventFamily,
        role: eventRole(event),
        game: event.game,
        totalBuyIn,
        prizeContribution,
        organizerFee,
        buyInDisplay,
        gtdKind: event.gtd.type,
        gtdDisplay: gtd.display,
        gtdMoney: gtd.money,
        startingStack: event.startingStack,
        levelDurationDisplay: event.levelDurationMinutes.map((item) => `${item}m`).join(" / "),
        registrationCloseDisplay: event.registrationCloseLevel && event.registrationCloseTime
          ? `Level ${event.registrationCloseLevel} · ${event.registrationCloseTime}`
          : event.registrationCloseLevel
            ? `Level ${event.registrationCloseLevel}`
            : event.registrationCloseTime ?? "Missing",
        itmStatement: event.itmStatement,
        satelliteLinkage: event.satelliteLinkage,
        requiredEntries,
        missingClaimCount: eventClaims.filter((claim) => claim.extractionStatus === "missing").length,
        uncertainClaimCount: eventClaims.filter((claim) => claim.extractionStatus === "uncertain").length,
        conflictingClaimCount: eventClaims.filter((claim) => claim.extractionStatus === "conflicting").length,
        claims: buildClaims(eventClaims),
        evidenceQuality: SCHEDULE_EVIDENCE_QUALITY,
      });
    })
    .sort((left, right) =>
      left.scheduleDate.localeCompare(right.scheduleDate)
      || left.localStartTime.localeCompare(right.localStartTime)
      || left.eventName.localeCompare(right.eventName)
    );
}

function buildSeries(
  artifact: ScheduleSupplyArtifact,
): readonly VietnamSupplySeriesSummary[] {
  return artifact.sourceInventory.map((source) => {
    const events = artifact.events.filter((event) => event.sourceId === source.sourceId);
    const claims = artifact.claims.filter((claim) => claim.sourceId === source.sourceId);
    const requiredMetrics = artifact.requiredEntriesByEvent.filter(
      (metric) => metric.sourceId === source.sourceId,
    );
    const requiredTotal = requiredMetrics.reduce(
      (total, metric) => total + parseInteger(metric.requiredEntries, "series required entries"),
      0n,
    );
    const gtdTotal = artifact.monetaryGtdTotalsBySeries.find((total) => total.key === source.sourceId);
    return deepFreeze({
      sourceId: source.sourceId,
      sourceLabel: sourceLabel(source.sourceId),
      organizer: source.organizer,
      venue: source.venue,
      seriesName: source.seriesName,
      displayedScheduleDates: [...source.displayedScheduleDates],
      eventCount: events.length,
      claimCount: claims.length,
      missingClaimCount: claims.filter((claim) => claim.extractionStatus === "missing").length,
      announcedGtd: gtdTotal ? moneyFromTotal(gtdTotal) : null,
      calculableRequiredEntries: requiredMetrics.length > 0 ? requiredTotal.toString() : null,
      calculableRequiredMetricCount: requiredMetrics.length,
      requiredEntriesReason: requiredMetrics.length > 0
        ? null
        : "Unavailable: the poster does not explicitly split prize contribution per entry.",
      sourcePath: source.sourcePath,
      sourceSha256: source.sourceSha256,
    });
  });
}

function buildCollisions(
  artifact: ScheduleSupplyArtifact,
): readonly VietnamSupplyCollisionWindow[] {
  return WINDOW_ORDER.map((key) => {
    const metadata = artifact.overlappingSeriesByWindow.find((item) => item.window === key);
    const reports = artifact.collisionReports.filter((report) => report.window === key);
    const expectedCount = metadata
      ? parseInteger(metadata.collisionGroupCount, `${key} collision count`)
      : 0n;
    if (expectedCount !== BigInt(reports.length)) {
      fail("collision report count does not match window metadata", "VIETNAM_SUPPLY_COLLISION_COUNT_MISMATCH");
    }
    const groups = reports.map((report) => deepFreeze({
      collisionId: report.collisionId,
      distanceDays: report.distanceDays,
      sourceIds: [...report.sourceIds],
      sourceLabels: report.sourceIds.map(sourceLabel),
      seriesNames: [...report.seriesNames],
      dates: [...report.dates],
      announcedGtdTotals: report.monetaryGtdTotalsByCurrency.map(moneyFromTotal),
      combinedRequiredEntries: report.combinedRequiredEntries,
      calculableRequiredEntryEvents: report.calculableRequiredEntryEvents,
      repeatedTemplateCount: report.repeatedTemplateCount,
      eventFamilyOverlap: [...report.eventFamilyOverlap],
      evidenceLimitations: [...report.evidenceLimitations],
    }));
    return deepFreeze({
      key,
      label: WINDOW_LABELS[key],
      state: groups.length > 0 ? "available" : "empty",
      groupCount: groups.length,
      groups,
    });
  });
}

function displayTemplateField(field: typeof PARTIAL_MATCH_FIELDS[number]): string {
  const labels: Readonly<Record<typeof PARTIAL_MATCH_FIELDS[number], string>> = {
    eventFamily: "Event family",
    totalBuyInMinorUnits: "Total buy-in",
    monetaryGtdMinorUnits: "Monetary GTD",
    startingStack: "Starting stack",
    multiFlight: "Multi-flight",
  };
  return labels[field];
}

function sameFeature(
  left: ScheduleTemplateFingerprint["structuralFeatures"],
  right: ScheduleTemplateFingerprint["structuralFeatures"],
  key: typeof PARTIAL_MATCH_FIELDS[number],
): boolean {
  return left[key] !== null && JSON.stringify(left[key]) === JSON.stringify(right[key]);
}

function eventLabel(event: VietnamScheduleEvent): string {
  return `${sourceLabel(event.sourceId)} · ${event.scheduleDate} ${event.localStartTime} · ${event.eventName}`;
}

function buildTemplates(artifact: ScheduleSupplyArtifact): readonly VietnamSupplyTemplateGroup[] {
  const eventById = new Map(artifact.events.map((event) => [event.eventId, event]));
  const fingerprintById = new Map(
    artifact.templateFingerprints.map((fingerprint) => [fingerprint.fingerprintId, fingerprint]),
  );
  const exact = artifact.repeatedTemplateGroups
    .filter((group) => parseInteger(group.distinctSeriesCount, "template series count") > 1n)
    .map((group) => {
      const events = group.eventIds.map((eventId) => eventById.get(eventId));
      if (events.some((event) => !event)) {
        fail("template group references an unknown event", "VIETNAM_SUPPLY_TEMPLATE_EVENT_UNKNOWN");
      }
      const fingerprint = fingerprintById.get(group.fingerprintId);
      if (!fingerprint) {
        fail("template group references an unknown fingerprint", "VIETNAM_SUPPLY_TEMPLATE_FINGERPRINT_UNKNOWN");
      }
      const matchedFields = Object.entries(fingerprint.structuralFeatures)
        .filter(([, value]) => value !== null)
        .map(([key]) => key);
      return deepFreeze({
        groupId: group.fingerprintId,
        matchKind: "exact" as const,
        title: "Exact cross-series template",
        eventIds: [...group.eventIds],
        eventLabels: events.map((event) => eventLabel(event!)),
        sourceLabels: group.sourceIds.map(sourceLabel),
        matchedFields,
        requiredEntriesState: "available" as const,
        basis: "Exact equality of the committed structural fingerprint.",
      });
    });

  const baseGroup = artifact.repeatedTemplateGroups.find(
    (group) => parseInteger(group.distinctSeriesCount, "template series count") > 1n,
  );
  const baseFingerprint = baseGroup ? fingerprintById.get(baseGroup.fingerprintId) : undefined;
  const partialCandidates = baseFingerprint
    ? artifact.templateFingerprints.filter((candidate) => {
        if (candidate.sourceId !== "rpt-sep-11-12-2026") return false;
        if (candidate.fingerprintId === baseFingerprint.fingerprintId) return false;
        const matched = PARTIAL_MATCH_FIELDS.filter((key) =>
          sameFeature(candidate.structuralFeatures, baseFingerprint.structuralFeatures, key)
        );
        return matched.length >= 4;
      })
    : [];
  if (partialCandidates.length === 0) return exact;

  const commonFields = PARTIAL_MATCH_FIELDS.filter((key) =>
    partialCandidates.every((candidate) =>
      sameFeature(candidate.structuralFeatures, baseFingerprint!.structuralFeatures, key)
    )
  );
  const partialEvents = partialCandidates.map((candidate) => eventById.get(candidate.eventId));
  if (partialEvents.some((event) => !event)) {
    fail("partial template references an unknown event", "VIETNAM_SUPPLY_PARTIAL_TEMPLATE_EVENT_UNKNOWN");
  }
  const partial: VietnamSupplyTemplateGroup = deepFreeze({
    groupId: `${baseFingerprint!.fingerprintId}:rpt-partial`,
    matchKind: "partial",
    title: "Partial structural similarity · RPT opener",
    eventIds: partialCandidates.map((candidate) => candidate.eventId),
    eventLabels: partialEvents.map((event) => eventLabel(event!)),
    sourceLabels: ["RPT"],
    matchedFields: commonFields.map(displayTemplateField),
    requiredEntriesState: "partially_unavailable",
    basis: "Descriptive equality over named fields in committed template fingerprints; not an exact template match.",
  });
  return [...exact, partial];
}

function buildCorrection(correction: D1ACorrectionRecord): VietnamSupplyCorrectionReadModel {
  return deepFreeze({
    correctionId: correction.correctionId,
    correctedAt: correction.correctedAt,
    affectedEventKey: correction.affectedEventKey,
    affectedField: correction.affectedClaims[0]!.field,
    oldValue: money(correction.oldValue.minorUnits, correction.oldValue.currency, correction.oldValue.scale),
    newValue: money(correction.newValue.minorUnits, correction.newValue.currency, correction.newValue.scale),
    correctedReleaseId: correction.corrected.releaseId,
    supersededReleaseId: correction.superseded.releaseId,
    status: correction.status,
  });
}

export async function createVietnamSupplyReadModel(input: {
  readonly rawArtifact: string;
  readonly release: unknown;
  readonly receipt: unknown;
  readonly correction: unknown;
}): Promise<VietnamSupplyReadModel> {
  const artifactFileSha256 = await sha256Hex(input.rawArtifact);
  if (artifactFileSha256 !== VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256) {
    fail("Vietnam supply artifact exact-byte hash does not match", "VIETNAM_SUPPLY_ARTIFACT_FILE_HASH_MISMATCH");
  }
  const artifact = asArtifact(input.rawArtifact);
  const release = input.release as VietnamScheduleSupplyRelease;
  const receipt = input.receipt as ScheduleSupplyReceipt;
  const correction = input.correction as D1ACorrectionRecord;
  validateCurrentGraph(release, artifact, receipt, correction);
  validateArtifactContents(release, artifact, receipt, correction);

  const events = buildEvents(artifact);
  const series = buildSeries(artifact);
  const announcedGtdByCurrency = new Map<string, { scale: number; total: bigint }>();
  for (const item of artifact.monetaryGtdTotalsBySeries) {
    const key = `${item.currency}:${item.scale}`;
    const current = announcedGtdByCurrency.get(key) ?? { scale: item.scale, total: 0n };
    current.total += parseInteger(item.totalMinorUnits, "announced GTD");
    announcedGtdByCurrency.set(key, current);
  }
  const announcedGtdTotals = [...announcedGtdByCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => money(value.total.toString(), key.split(":")[0]!, value.scale));
  const calculableRequiredEntries = artifact.requiredEntriesByEvent.reduce(
    (total, metric) => total + parseInteger(metric.requiredEntries, "required entries"),
    0n,
  );
  const missingClaimCount = artifact.claims.filter((claim) => claim.extractionStatus === "missing").length;
  const uncertainClaimCount = artifact.claims.filter((claim) => claim.extractionStatus === "uncertain").length;
  const conflictingClaimCount = artifact.claims.filter((claim) => claim.extractionStatus === "conflicting").length;

  return deepFreeze({
    integrityState: "corrected",
    releaseId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID,
    releaseShortId: VIETNAM_SUPPLY_CURRENT_RELEASE_ID.slice(-12),
    artifactId: VIETNAM_SUPPLY_CURRENT_ARTIFACT_ID,
    receiptId: VIETNAM_SUPPLY_CURRENT_RECEIPT_ID,
    correctionId: VIETNAM_SUPPLY_CURRENT_CORRECTION_ID,
    artifactFileSha256: VIETNAM_SUPPLY_ARTIFACT_FILE_SHA256,
    sourceCutoff: release.sourceCutoff,
    evidenceQuality: SCHEDULE_EVIDENCE_QUALITY,
    overview: {
      seriesCount: artifact.sourceInventory.length,
      eventCount: artifact.events.length,
      sourceCount: artifact.sourceInventory.length,
      claimCount: artifact.claims.length,
      missingClaimCount,
      uncertainClaimCount,
      conflictingClaimCount,
      announcedGtdTotals,
      calculableRequiredEntries: calculableRequiredEntries.toString(),
      calculableRequiredMetricCount: artifact.requiredEntriesByEvent.length,
      unavailableRequiredEventCount: events.filter(
        (event) => event.requiredEntries.state === "unavailable",
      ).length,
    },
    series,
    collisionWindows: buildCollisions(artifact),
    templates: buildTemplates(artifact),
    events,
    limitations: [
      ...artifact.limitations,
      "This surface describes announced schedule supply. It does not measure turnout, unique players, re-entry, player demand, or capacity.",
      "Demand-capacity comparison and player-flow intelligence are unavailable in this public release.",
      "Partial structural similarity is a descriptive field comparison, not evidence of copying or common authorship.",
    ],
    correction: buildCorrection(correction),
  });
}

function monetaryState(event: VietnamSupplyEventReadModel): VietnamSupplyEventFilters["monetaryState"] {
  if (event.prizeContribution && event.organizerFee) return "explicit_split";
  if (event.totalBuyIn) return "total_only";
  return "missing";
}

export function filterVietnamSupplyEvents(
  events: readonly VietnamSupplyEventReadModel[],
  filters: VietnamSupplyEventFilters,
): readonly VietnamSupplyEventReadModel[] {
  const query = filters.search.trim().toLocaleLowerCase("vi");
  return events.filter((event) => {
    if (
      query
      && ![
        event.eventName,
        event.seriesName,
        event.sourceLabel,
        event.eventFamily,
        event.venue ?? "",
        event.scheduleDate,
      ].some((value) => value.toLocaleLowerCase("vi").includes(query))
    ) return false;
    if (filters.sourceId !== "all" && event.sourceId !== filters.sourceId) return false;
    if (filters.scheduleDate !== "all" && event.scheduleDate !== filters.scheduleDate) return false;
    if (filters.eventFamily !== "all" && event.eventFamily !== filters.eventFamily) return false;
    if (filters.gtdKind !== "all" && event.gtdKind !== filters.gtdKind) return false;
    if (filters.monetaryState !== "all" && monetaryState(event) !== filters.monetaryState) return false;
    if (filters.requiredState !== "all" && event.requiredEntries.state !== filters.requiredState) return false;
    if (filters.role !== "all" && event.role !== filters.role) return false;
    if (
      filters.missingState === "has_missing"
      && event.missingClaimCount === 0
    ) return false;
    if (
      filters.missingState === "complete"
      && event.missingClaimCount > 0
    ) return false;
    return true;
  });
}
