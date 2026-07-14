import {
  resolveSourceClaims,
  SERIES_MARKET_CONTRACT_VERSION,
  type ClaimValue,
  type DatasetRelease,
  type EvidenceConfidence,
  type MarketEvent,
  type SourceClaim,
  type SourceDocument,
  type SourceDocumentType,
  type SourceRevision,
} from "./contracts";
import { validateJejuDatasetRelease } from "./datasetRelease";
import {
  JEJU_IMPORT_SCHEMA_VERSION,
  JEJU_MARKET_KEY,
  parseJejuImportJson,
  type JejuImportDataset,
  type JejuImportJsonDocument,
} from "./importer";
import { compareCanonicalStrings, SeriesMarketValidationError } from "./normalization";

export const VERIFIED_JEJU_RELEASE_ID =
  "series-market:v1:release:jeju:20ba969d8df146c54a47354700a36d94f81ddb51f0eca4824dafda07c907e203";

export const VERIFIED_JEJU_COUNTS = {
  festivals: 5,
  events: 87,
  entities: 92,
  claims: 972,
  nonMissingClaims: 794,
  missingClaims: 178,
  sourceDocuments: 1,
  sourceRevisions: 1,
  conflicts: 0,
} as const;

const FESTIVAL_FIELDS = ["festival_name", "tour", "venue"] as const;
const EVENT_FIELDS = [
  "event_date",
  "event_no",
  "event_name",
  "event_type",
  "game",
  "is_flagship",
  "buy_in",
  "buy_in_prize",
  "organizer_fee",
  "gtd",
  "entries",
] as const;

export type VerifiedFestivalFieldKey = (typeof FESTIVAL_FIELDS)[number];
export type VerifiedEventFieldKey = (typeof EVENT_FIELDS)[number];
export type VerifiedFieldKey = VerifiedFestivalFieldKey | VerifiedEventFieldKey;
export type EvidenceState = "resolved" | "missing" | "conflict";

export interface EvidenceDetail {
  readonly claimId: string;
  readonly kind: SourceClaim["kind"];
  readonly status: SourceClaim["status"];
  readonly confidence: EvidenceConfidence;
  readonly normalizedValue: ClaimValue;
  readonly rawValue: string | null;
  readonly unit: string | null;
  readonly sourceRevisionId: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentType: SourceDocumentType;
  readonly sourceReference: string | null;
  readonly sourceUrl: string | null;
  readonly observedAt: string;
  readonly retrievedAt: string;
  readonly missingReason: string | null;
  readonly supersedesClaimId: string | null;
}

export interface VerifiedField {
  readonly key: VerifiedFieldKey;
  readonly label: string;
  readonly state: EvidenceState;
  readonly value: ClaimValue | null;
  readonly displayValue: string;
  readonly activeClaimIds: readonly string[];
  readonly evidence: readonly EvidenceDetail[];
}

export interface VerifiedFestivalRow {
  readonly id: string;
  readonly festivalKey: string;
  readonly name: string;
  readonly tour: string;
  readonly venue: string;
  readonly eventCount: number;
  readonly missingFieldCount: number;
  readonly fields: Readonly<Record<VerifiedFestivalFieldKey, VerifiedField>>;
}

export interface VerifiedEventRow {
  readonly id: string;
  readonly eventKey: string;
  readonly festivalId: string;
  readonly festivalKey: string;
  readonly festivalName: string;
  readonly tour: string;
  readonly venue: string;
  readonly eventNumber: string;
  readonly eventDate: string;
  readonly eventName: string;
  readonly eventType: string;
  readonly game: string;
  readonly currency: string | null;
  readonly flagship: boolean | null;
  readonly missingFieldCount: number;
  readonly conflictFieldCount: number;
  readonly searchIndex: string;
  readonly fields: Readonly<Record<VerifiedEventFieldKey, VerifiedField>>;
}

export interface VerifiedMarketFilterOptions {
  readonly festivals: readonly { readonly key: string; readonly label: string }[];
  readonly tours: readonly string[];
  readonly eventTypes: readonly string[];
  readonly games: readonly string[];
  readonly currencies: readonly string[];
}

export interface MarketFilterState {
  readonly search: string;
  readonly festival: string;
  readonly tour: string;
  readonly eventType: string;
  readonly game: string;
  readonly currency: string;
  readonly flagship: "all" | "yes" | "no";
  readonly evidenceState: "all" | EvidenceState;
}

export const EMPTY_MARKET_FILTERS: MarketFilterState = {
  search: "",
  festival: "all",
  tour: "all",
  eventType: "all",
  game: "all",
  currency: "all",
  flagship: "all",
  evidenceState: "all",
};

export interface VerifiedMarketQuality {
  readonly claims: number;
  readonly nonMissingClaims: number;
  readonly missingClaims: number;
  readonly missingCountByField: Readonly<Record<string, number>>;
  readonly conflicts: number;
  readonly currencies: readonly string[];
  readonly eventDateMin: string;
  readonly eventDateMax: string;
  readonly omittedLegacyColumns: Readonly<Record<string, string>>;
  readonly statements: readonly string[];
}

export interface VerifiedMarketReadModel {
  readonly marketKey: typeof JEJU_MARKET_KEY;
  readonly schemaVersion: typeof JEJU_IMPORT_SCHEMA_VERSION;
  readonly contractVersion: typeof SERIES_MARKET_CONTRACT_VERSION;
  readonly releaseId: string;
  readonly releaseShortId: string;
  readonly sourceCutoff: string;
  readonly sourceDocument: SourceDocument;
  readonly sourceRevision: SourceRevision;
  readonly evidenceCaveat: string;
  readonly festivals: readonly VerifiedFestivalRow[];
  readonly events: readonly VerifiedEventRow[];
  readonly claimCount: number;
  readonly filterOptions: VerifiedMarketFilterOptions;
  readonly quality: VerifiedMarketQuality;
}

export interface VerifiedMarketArtifacts {
  readonly canonicalImport: unknown;
  readonly release: unknown;
  readonly sourceManifest: unknown;
  readonly dataQuality: unknown;
}

interface EvidenceContext {
  readonly revisions: ReadonlyMap<string, SourceRevision>;
  readonly documents: ReadonlyMap<string, SourceDocument>;
}

export class VerifiedMarketIntegrityError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "VerifiedMarketIntegrityError";
  }
}

const FIELD_LABELS: Readonly<Record<VerifiedFieldKey, string>> = {
  festival_name: "Festival",
  tour: "Tour",
  venue: "Venue",
  event_date: "Event date",
  event_no: "Event number",
  event_name: "Event name",
  event_type: "Event type",
  game: "Game",
  is_flagship: "Flagship",
  buy_in: "Buy-in",
  buy_in_prize: "Prize contribution",
  organizer_fee: "Organizer fee",
  gtd: "GTD",
  entries: "Entries",
};

function fail(message: string, code: string): never {
  throw new VerifiedMarketIntegrityError(message, code);
}

function cloneArtifact<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid`, "ARTIFACT_SHAPE_INVALID");
  return value as Record<string, unknown>;
}

function exactString(value: unknown, expected: string, label: string): void {
  if (value !== expected) fail(`${label} does not match the locked release`, "ARTIFACT_VALUE_MISMATCH");
}

function exactCount(value: unknown, expected: number, label: string): void {
  if (value !== expected) fail(`${label} does not match the locked release`, "ARTIFACT_COUNT_MISMATCH");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

function groupDigits(digits: string): string {
  let output = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) output += ",";
    output += digits[index];
  }
  return output;
}

export function formatIntegerString(value: string): string {
  if (!/^-?(?:0|[1-9]\d*)$/.test(value)) fail("integer display value is not canonical", "FORMAT_INTEGER_INVALID");
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  return `${negative ? "-" : ""}${groupDigits(digits)}`;
}

export function formatMoneyValue(value: Extract<ClaimValue, { type: "money" }>): string {
  const { minorUnits, currency, scale } = value;
  if (!/^-?(?:0|[1-9]\d*)$/.test(minorUnits)) fail("money minor units are not canonical", "FORMAT_MONEY_INVALID");
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) fail("money scale is invalid", "FORMAT_MONEY_SCALE_INVALID");
  const negative = minorUnits.startsWith("-");
  const unsigned = negative ? minorUnits.slice(1) : minorUnits;
  const padded = scale === 0 ? unsigned : unsigned.padStart(scale + 1, "0");
  const whole = scale === 0 ? padded : padded.slice(0, -scale);
  const fraction = scale === 0 ? "" : `.${padded.slice(-scale)}`;
  return `${currency} ${negative ? "-" : ""}${groupDigits(whole)}${fraction}`;
}

export function formatClaimValue(value: ClaimValue | null): string {
  if (value === null || value.type === "missing") return "Missing";
  switch (value.type) {
    case "text": return value.value;
    case "boolean": return value.value ? "Yes" : "No";
    case "integer": return formatIntegerString(value.value);
    case "decimal": {
      const [whole, fraction] = value.value.split(".");
      return fraction === undefined ? formatIntegerString(whole) : `${formatIntegerString(whole)}.${fraction}`;
    }
    case "money": return formatMoneyValue(value);
    case "local_date": return value.value;
    case "partial_local_datetime": return `${value.local} ${value.timeZone}`;
    case "instant": return value.value;
  }
}

function evidenceDetail(claim: SourceClaim, context: EvidenceContext): EvidenceDetail {
  if (claim.sourceRevisionId === null) fail("release claim has no source revision", "CLAIM_LINEAGE_MISSING");
  const revision = context.revisions.get(claim.sourceRevisionId);
  if (!revision) fail("release claim references an unknown source revision", "CLAIM_REVISION_UNKNOWN");
  const document = context.documents.get(revision.sourceDocumentId);
  if (!document) fail("release revision references an unknown source document", "CLAIM_DOCUMENT_UNKNOWN");
  return {
    claimId: claim.id,
    kind: claim.kind,
    status: claim.status,
    confidence: claim.confidence,
    normalizedValue: claim.value,
    rawValue: claim.rawValue,
    unit: claim.unit,
    sourceRevisionId: revision.id,
    sourceDocumentId: document.id,
    sourceDocumentType: document.sourceType,
    sourceReference: document.sourceReference,
    sourceUrl: document.canonicalUrl,
    observedAt: claim.observedAt,
    retrievedAt: revision.retrievedAt,
    missingReason: claim.value.type === "missing" ? claim.value.reason : null,
    supersedesClaimId: claim.supersedesClaimId,
  };
}

export function buildVerifiedField(
  key: VerifiedFieldKey,
  claims: readonly SourceClaim[],
  revisions: readonly SourceRevision[],
  documents: readonly SourceDocument[],
): VerifiedField {
  const context: EvidenceContext = {
    revisions: new Map(revisions.map((revision) => [revision.id, revision])),
    documents: new Map(documents.map((document) => [document.id, document])),
  };
  const resolution = resolveSourceClaims(claims);
  const evidence = [...claims]
    .sort((a, b) => compareCanonicalStrings(a.id, b.id))
    .map((claim) => evidenceDetail(claim, context));
  if (resolution.state === "conflict") {
    return {
      key,
      label: FIELD_LABELS[key],
      state: "conflict",
      value: null,
      displayValue: "Conflict",
      activeClaimIds: resolution.claims.map((claim) => claim.id).sort(compareCanonicalStrings),
      evidence,
    };
  }
  const selected = resolution.claim;
  return {
    key,
    label: FIELD_LABELS[key],
    state: resolution.state,
    value: selected?.value ?? null,
    displayValue: formatClaimValue(selected?.value ?? null),
    activeClaimIds: selected ? [selected.id] : [],
    evidence,
  };
}

function claimsByEntity(dataset: JejuImportDataset): ReadonlyMap<string, ReadonlyMap<string, readonly SourceClaim[]>> {
  const outer = new Map<string, Map<string, SourceClaim[]>>();
  for (const claim of dataset.claims) {
    const fields = outer.get(claim.entityId) ?? new Map<string, SourceClaim[]>();
    const claims = fields.get(claim.field) ?? [];
    claims.push(claim);
    fields.set(claim.field, claims);
    outer.set(claim.entityId, fields);
  }
  return outer;
}

function textValue(field: VerifiedField): string {
  return field.state === "resolved" && field.value?.type === "text" ? field.value.value : "";
}

function integerValue(field: VerifiedField): string {
  return field.state === "resolved" && field.value?.type === "integer" ? field.value.value : "";
}

function localDateValue(field: VerifiedField): string {
  return field.state === "resolved" && field.value?.type === "local_date" ? field.value.value : "";
}

function booleanValue(field: VerifiedField): boolean | null {
  return field.state === "resolved" && field.value?.type === "boolean" ? field.value.value : null;
}

function currencyValue(field: VerifiedField): string | null {
  return field.state === "resolved" && field.value?.type === "money" ? field.value.currency : null;
}

function compareIntegerStrings(left: string, right: string): number {
  if (left === right) return 0;
  if (left === "") return 1;
  if (right === "") return -1;
  if (left.length !== right.length) return left.length - right.length;
  return compareCanonicalStrings(left, right);
}

export function normalizeMarketSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

function eventComparator(left: VerifiedEventRow, right: VerifiedEventRow): number {
  return compareCanonicalStrings(left.eventDate, right.eventDate)
    || compareCanonicalStrings(left.festivalKey, right.festivalKey)
    || compareIntegerStrings(left.eventNumber, right.eventNumber)
    || compareCanonicalStrings(left.id, right.id);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value !== ""))].sort(compareCanonicalStrings);
}

function asQuality(value: unknown): VerifiedMarketQuality {
  const quality = record(value, "data-quality.json");
  exactCount(quality.claims, VERIFIED_JEJU_COUNTS.claims, "quality claims");
  exactCount(quality.nonMissingClaims, VERIFIED_JEJU_COUNTS.nonMissingClaims, "quality non-missing claims");
  exactCount(quality.missingClaims, VERIFIED_JEJU_COUNTS.missingClaims, "quality missing claims");
  exactCount(quality.conflicts, VERIFIED_JEJU_COUNTS.conflicts, "quality conflicts");
  const missing = record(quality.missingCountByField, "quality missingCountByField");
  exactCount(missing.buy_in_prize, 49, "missing buy_in_prize");
  exactCount(missing.organizer_fee, 49, "missing organizer_fee");
  exactCount(missing.gtd, 80, "missing gtd");
  if (!Array.isArray(quality.currencies) || quality.currencies.join(",") !== "KRW,USD") {
    fail("quality currencies do not match the locked release", "QUALITY_CURRENCY_MISMATCH");
  }
  const omitted = record(quality.omittedLegacyColumns, "quality omittedLegacyColumns");
  const statements = quality.statements;
  if (!Array.isArray(statements) || statements.some((item) => typeof item !== "string")) {
    fail("quality statements are invalid", "QUALITY_STATEMENTS_INVALID");
  }
  if (typeof quality.eventDateMin !== "string" || typeof quality.eventDateMax !== "string") {
    fail("quality date range is invalid", "QUALITY_DATE_RANGE_INVALID");
  }
  return {
    claims: quality.claims as number,
    nonMissingClaims: quality.nonMissingClaims as number,
    missingClaims: quality.missingClaims as number,
    missingCountByField: cloneArtifact<Record<string, number>>(missing),
    conflicts: quality.conflicts as number,
    currencies: [...quality.currencies] as string[],
    eventDateMin: quality.eventDateMin,
    eventDateMax: quality.eventDateMax,
    omittedLegacyColumns: cloneArtifact<Record<string, string>>(omitted),
    statements: [...statements] as string[],
  };
}

function buildRows(dataset: JejuImportDataset): {
  festivals: readonly VerifiedFestivalRow[];
  events: readonly VerifiedEventRow[];
} {
  const grouped = claimsByEntity(dataset);
  const festivalBase = dataset.festivals.map((festival) => {
    const byField = grouped.get(festival.id) ?? new Map();
    const fields = Object.fromEntries(FESTIVAL_FIELDS.map((key) => [
      key,
      buildVerifiedField(key, byField.get(key) ?? [], dataset.sourceRevisions, dataset.sourceDocuments),
    ])) as unknown as Record<VerifiedFestivalFieldKey, VerifiedField>;
    return { festival, fields };
  });
  const festivalById = new Map(festivalBase.map((item) => [item.festival.id, item]));

  const events = dataset.events.map((event: MarketEvent) => {
    const byField = grouped.get(event.id) ?? new Map();
    const fields = Object.fromEntries(EVENT_FIELDS.map((key) => [
      key,
      buildVerifiedField(key, byField.get(key) ?? [], dataset.sourceRevisions, dataset.sourceDocuments),
    ])) as unknown as Record<VerifiedEventFieldKey, VerifiedField>;
    const parent = festivalById.get(event.festivalId);
    if (!parent) fail("event references an unknown festival", "EVENT_FESTIVAL_UNKNOWN");
    const row: VerifiedEventRow = {
      id: event.id,
      eventKey: event.eventKey,
      festivalId: event.festivalId,
      festivalKey: event.festivalKey,
      festivalName: textValue(parent.fields.festival_name),
      tour: textValue(parent.fields.tour),
      venue: textValue(parent.fields.venue),
      eventNumber: integerValue(fields.event_no),
      eventDate: localDateValue(fields.event_date),
      eventName: textValue(fields.event_name),
      eventType: textValue(fields.event_type),
      game: textValue(fields.game),
      currency: currencyValue(fields.buy_in),
      flagship: booleanValue(fields.is_flagship),
      missingFieldCount: EVENT_FIELDS.filter((key) => fields[key].state === "missing").length,
      conflictFieldCount: EVENT_FIELDS.filter((key) => fields[key].state === "conflict").length,
      searchIndex: "",
      fields,
    };
    return {
      ...row,
      searchIndex: normalizeMarketSearch([
        row.festivalName,
        row.festivalKey,
        row.tour,
        row.venue,
        ...EVENT_FIELDS.map((key) => row.fields[key].displayValue),
      ].join(" ")),
    };
  }).sort(eventComparator);

  const eventsByFestival = new Map<string, VerifiedEventRow[]>();
  for (const event of events) {
    const rows = eventsByFestival.get(event.festivalId) ?? [];
    rows.push(event);
    eventsByFestival.set(event.festivalId, rows);
  }
  const festivals = festivalBase.map(({ festival, fields }) => {
    const festivalEvents = eventsByFestival.get(festival.id) ?? [];
    return {
      id: festival.id,
      festivalKey: festival.festivalKey,
      name: textValue(fields.festival_name),
      tour: textValue(fields.tour),
      venue: textValue(fields.venue),
      eventCount: festivalEvents.length,
      missingFieldCount: FESTIVAL_FIELDS.filter((key) => fields[key].state === "missing").length
        + festivalEvents.reduce((sum, event) => sum + event.missingFieldCount, 0),
      fields,
    };
  }).sort((a, b) => compareCanonicalStrings(a.festivalKey, b.festivalKey));
  return { festivals, events };
}

export function filterVerifiedEvents(
  events: readonly VerifiedEventRow[],
  filters: MarketFilterState,
): readonly VerifiedEventRow[] {
  const query = normalizeMarketSearch(filters.search);
  return events.filter((event) => {
    if (query !== "" && !event.searchIndex.includes(query)) return false;
    if (filters.festival !== "all" && event.festivalKey !== filters.festival) return false;
    if (filters.tour !== "all" && event.tour !== filters.tour) return false;
    if (filters.eventType !== "all" && event.eventType !== filters.eventType) return false;
    if (filters.game !== "all" && event.game !== filters.game) return false;
    if (filters.currency !== "all" && event.currency !== filters.currency) return false;
    if (filters.flagship === "yes" && event.flagship !== true) return false;
    if (filters.flagship === "no" && event.flagship !== false) return false;
    const evidenceState: EvidenceState = event.conflictFieldCount > 0
      ? "conflict"
      : event.missingFieldCount > 0
        ? "missing"
        : "resolved";
    if (filters.evidenceState !== "all" && evidenceState !== filters.evidenceState) return false;
    return true;
  });
}

export async function createVerifiedJejuReadModel(
  artifacts: VerifiedMarketArtifacts,
): Promise<VerifiedMarketReadModel> {
  const release = cloneArtifact<DatasetRelease>(artifacts.release);
  const releaseRecord = record(release, "release.json");
  exactString(releaseRecord.id, VERIFIED_JEJU_RELEASE_ID, "release ID");
  const canonical = cloneArtifact<JejuImportJsonDocument>(artifacts.canonicalImport);
  const parsed = await parseJejuImportJson(canonical);
  if (!parsed.ok) fail(`canonical import rejected: ${parsed.errors[0]?.code ?? "unknown"}`, "CANONICAL_IMPORT_INVALID");
  const dataset = parsed.value;
  const manifest = record(cloneArtifact(artifacts.sourceManifest), "source-manifest.json");
  const qualityRecord = record(cloneArtifact(artifacts.dataQuality), "data-quality.json");
  const quality = asQuality(qualityRecord);

  exactString(canonical.schemaVersion, JEJU_IMPORT_SCHEMA_VERSION, "canonical schema version");
  exactString(canonical.marketKey, JEJU_MARKET_KEY, "canonical market key");
  exactString(release.contractVersion, SERIES_MARKET_CONTRACT_VERSION, "release contract version");
  exactString(release.marketKey, JEJU_MARKET_KEY, "release market key");
  exactString(release.id, VERIFIED_JEJU_RELEASE_ID, "release ID");
  exactString(manifest.schemaVersion, JEJU_IMPORT_SCHEMA_VERSION, "manifest schema version");
  exactString(manifest.marketKey, JEJU_MARKET_KEY, "manifest market key");
  exactString(qualityRecord.releaseId, VERIFIED_JEJU_RELEASE_ID, "quality release ID");
  exactString(release.sourceCutoff, manifest.retrievedAt as string, "source cutoff");
  exactString(qualityRecord.sourceCutoff, release.sourceCutoff, "quality source cutoff");
  exactCount(dataset.festivals.length, VERIFIED_JEJU_COUNTS.festivals, "festival count");
  exactCount(dataset.events.length, VERIFIED_JEJU_COUNTS.events, "event count");
  exactCount(dataset.festivals.length + dataset.events.length, VERIFIED_JEJU_COUNTS.entities, "entity count");
  exactCount(dataset.claims.length, VERIFIED_JEJU_COUNTS.claims, "claim count");
  exactCount(dataset.sourceDocuments.length, VERIFIED_JEJU_COUNTS.sourceDocuments, "source document count");
  exactCount(dataset.sourceRevisions.length, VERIFIED_JEJU_COUNTS.sourceRevisions, "source revision count");
  exactCount(dataset.conflicts.length, VERIFIED_JEJU_COUNTS.conflicts, "conflict count");
  exactCount(manifest.rowCount, VERIFIED_JEJU_COUNTS.events, "manifest row count");
  if (release.sourceRevisionIds.length !== 1 || release.sourceRevisionIds[0] !== dataset.sourceRevisions[0]?.id) {
    fail("release source revision does not match the imported dataset", "SOURCE_REVISION_MISMATCH");
  }
  if (dataset.claims.some((claim) => claim.sourceRevisionId !== dataset.sourceRevisions[0]?.id)) {
    fail("every seed claim must retain the committed source revision", "CLAIM_LINEAGE_MISMATCH");
  }
  try {
    await validateJejuDatasetRelease(dataset, release);
  } catch (error) {
    const code = error instanceof SeriesMarketValidationError ? error.code : "RELEASE_VALIDATION_FAILED";
    fail(`release validation failed: ${code}`, code);
  }

  const { festivals, events } = buildRows(dataset);
  const sourceDocument = dataset.sourceDocuments[0];
  const sourceRevision = dataset.sourceRevisions[0];
  if (!sourceDocument || !sourceRevision) fail("release source metadata is missing", "SOURCE_METADATA_MISSING");
  const evidenceCaveat = manifest.evidenceCaveat;
  if (typeof evidenceCaveat !== "string" || evidenceCaveat.trim() === "") {
    fail("manifest evidence caveat is missing", "EVIDENCE_CAVEAT_MISSING");
  }
  const releaseHash = release.id.split(":").at(-1) ?? release.id;
  const model: VerifiedMarketReadModel = {
    marketKey: JEJU_MARKET_KEY,
    schemaVersion: JEJU_IMPORT_SCHEMA_VERSION,
    contractVersion: SERIES_MARKET_CONTRACT_VERSION,
    releaseId: release.id,
    releaseShortId: releaseHash.slice(0, 12),
    sourceCutoff: release.sourceCutoff,
    sourceDocument,
    sourceRevision,
    evidenceCaveat,
    festivals,
    events,
    claimCount: dataset.claims.length,
    filterOptions: {
      festivals: festivals.map((festival) => ({ key: festival.festivalKey, label: festival.name })),
      tours: uniqueSorted(festivals.map((festival) => festival.tour)),
      eventTypes: uniqueSorted(events.map((event) => event.eventType)),
      games: uniqueSorted(events.map((event) => event.game)),
      currencies: uniqueSorted(events.flatMap((event) => event.currency ? [event.currency] : [])),
    },
    quality,
  };
  return deepFreeze(model);
}
