import Papa from "papaparse";
import {
  SERIES_MARKET_CONTRACT_VERSION,
  type ClaimKind,
  type ClaimStatus,
  type ClaimValue,
  type EvidenceConfidence,
  type SourceDocumentType,
  type SourceClaim,
} from "./contracts";
import {
  JEJU_IMPORT_HEADERS,
  JEJU_IMPORT_SCHEMA_VERSION,
  JEJU_MARKET_KEY,
  parseJejuImportJson,
  type JejuImportDataset,
  type JejuImportJsonDocument,
} from "./importer";
import {
  normalizeCurrency,
  normalizeIntegerString,
  normalizeLocalDate,
  normalizeTextValue,
  SeriesMarketValidationError,
} from "./normalization";

export const JEJU_SEED_RAW_COLUMNS = [
  "festival",
  "tour",
  "venue",
  "date",
  "event_no",
  "event_name",
  "event_type",
  "game",
  "is_flagship",
  "currency",
  "buy_in_local",
  "buy_in_prize_local",
  "buy_in_fee_local",
  "gtd_local",
  "entries",
  "buy_in_usd",
  "fee_pct",
  "value_ratio",
  "ln_entries",
] as const;

export type JejuSeedRawColumn = (typeof JEJU_SEED_RAW_COLUMNS)[number];
export type JejuSeedRawRow = Readonly<Record<JejuSeedRawColumn, string>>;

export interface JejuSeedSourceManifest {
  readonly schemaVersion: typeof JEJU_IMPORT_SCHEMA_VERSION;
  readonly marketKey: typeof JEJU_MARKET_KEY;
  readonly originalFilename: string;
  readonly rawPath: string;
  readonly rawSha256: string;
  readonly byteSize: number;
  readonly rowCount: number;
  readonly originalColumns: readonly string[];
  readonly sourceDocumentKey: string;
  readonly sourceRevisionKey: string;
  readonly retrievedAt: string;
  readonly sourceType: SourceDocumentType;
  readonly claimKind: "reported";
  readonly status: "unverified";
  readonly confidence: "unknown";
  readonly canonicalUrl: null;
  readonly sourceReference: string;
  readonly sourcePublisher: string;
  readonly sourceTitle: string;
  readonly evidenceCaveat: string;
}

export const JEJU_FESTIVAL_KEY_BY_NAME: Readonly<Record<string, string>> = {
  "APT Jeju 2025 (Sept)": "apt-jeju-2025-sept",
  "APT Jeju Classic 2026": "apt-jeju-classic-2026",
  "RDPT Jeju II 2025": "rdpt-jeju-ii-2025",
  "Triton One 2025": "triton-one-jeju-2025",
  "Triton SHRS Jeju II 2025": "triton-shrs-jeju-ii-2025",
};

export const JEJU_OMITTED_LEGACY_COLUMNS: Readonly<Record<string, string>> = {
  buy_in_usd: "No exchange-rate source, date, or conversion method is present.",
  fee_pct: "The denominator convention is not defined for a DerivedMetric.",
  value_ratio: "The method and denominator are not sufficiently defined.",
  ln_entries: "This is a model transformation, not a public market fact.",
};

const missingReasons = { type: "missing", reason: "unknown" } as const;
const compareStrings = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function fail(message: string, code: string): never {
  throw new SeriesMarketValidationError(message, code);
}

function normalizedText(raw: string, label: string): string {
  const value = raw.normalize("NFC").trim();
  if (value === "") fail(`${label} must not be blank`, "RAW_REQUIRED_FIELD");
  return value;
}

function canonicalRawValue(values: readonly string[]): string {
  return [...values].sort((a, b) => {
    const normalized = compareStrings(a.normalize("NFC"), b.normalize("NFC"));
    return normalized !== 0 ? normalized : compareStrings(a, b);
  })[0] ?? "";
}

export function normalizeSeedMoneyString(raw: string, label = "money"): string {
  const value = raw.trim();
  if (!/^\d+(?:\.0+)?$/.test(value)) {
    fail(`${label} must be an unsigned integer or an integer-valued decimal`, "INVALID_SEED_MONEY");
  }
  const whole = value.split(".", 1)[0].replace(/^0+(?=\d)/, "") || "0";
  return whole;
}

function moneyValue(raw: string, currency: string, label: string): ClaimValue {
  if (raw.trim() === "") return missingReasons;
  return {
    type: "money",
    minorUnits: normalizeSeedMoneyString(raw, label),
    currency: normalizeCurrency(currency),
    scale: 0,
  };
}

function textValue(raw: string, label: string): ClaimValue {
  const value = normalizedText(raw, label);
  return normalizeTextValue(value);
}

function integerValue(raw: string, label: string): ClaimValue {
  return { type: "integer", value: normalizeIntegerString(normalizedText(raw, label)) };
}

function localDateValue(raw: string): ClaimValue {
  return normalizeLocalDate(normalizedText(raw, "date"));
}

function booleanValue(raw: string): ClaimValue {
  const value = normalizedText(raw, "is_flagship");
  if (value === "Y") return { type: "boolean", value: true };
  if (value === "N") return { type: "boolean", value: false };
  fail("is_flagship must be Y or N", "INVALID_SEED_BOOLEAN");
}

function parseRawRows(rawCsv: string): readonly JejuSeedRawRow[] {
  const parsed = Papa.parse<Record<string, string>>(rawCsv, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length > 0) {
    fail(`raw seed CSV is malformed: ${parsed.errors[0].message}`, "RAW_CSV_INVALID");
  }
  const headers = parsed.meta.fields ?? [];
  if (headers.length !== JEJU_SEED_RAW_COLUMNS.length || headers.some((header, index) => header !== JEJU_SEED_RAW_COLUMNS[index])) {
    fail("raw seed CSV columns do not match the committed schema", "RAW_COLUMNS_MISMATCH");
  }
  return parsed.data.map((record, index) => {
    const extraKeys = Object.keys(record).filter((key) => !(JEJU_SEED_RAW_COLUMNS as readonly string[]).includes(key));
    if (extraKeys.length > 0) fail(`raw row ${index + 2} contains an unsupported column`, "RAW_EXTRA_COLUMN");
    const row = {} as Record<JejuSeedRawColumn, string>;
    for (const column of JEJU_SEED_RAW_COLUMNS) {
      const value = record[column];
      if (typeof value !== "string") fail(`raw row ${index + 2} column ${column} must be a string`, "RAW_VALUE_NOT_STRING");
      row[column] = value;
    }
    return row;
  });
}

function validateManifest(manifest: JejuSeedSourceManifest): void {
  if (manifest.schemaVersion !== JEJU_IMPORT_SCHEMA_VERSION || manifest.marketKey !== JEJU_MARKET_KEY) {
    fail("source manifest version or market is unsupported", "SOURCE_MANIFEST_VERSION_MISMATCH");
  }
  if (manifest.sourceType !== "other_public" || manifest.claimKind !== "reported" || manifest.status !== "unverified" || manifest.confidence !== "unknown") {
    fail("Jeju seed evidence classification is not fail-closed", "SOURCE_MANIFEST_CLASSIFICATION_INVALID");
  }
  if (manifest.canonicalUrl !== null || manifest.sourceReference.trim() === "") {
    fail("Jeju seed must use a non-URL source reference", "SOURCE_MANIFEST_REFERENCE_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.rawSha256)) fail("rawSha256 must be a lowercase SHA-256 digest", "SOURCE_MANIFEST_HASH_INVALID");
  if (manifest.rowCount <= 0 || manifest.byteSize <= 0) fail("source manifest dimensions must be positive", "SOURCE_MANIFEST_DIMENSIONS_INVALID");
  if (manifest.originalColumns.join("\u0000") !== JEJU_SEED_RAW_COLUMNS.join("\u0000")) fail("source manifest columns are not exact", "SOURCE_MANIFEST_COLUMNS_INVALID");
}

function valueFields(value: ClaimValue): Record<string, string> {
  if (value.type === "missing") {
    return { value_type: "missing", value: "", missing_reason: value.reason, unit: "", currency: "", scale: "" };
  }
  if (value.type === "money") {
    return { value_type: "money", value: value.minorUnits, missing_reason: "", unit: value.currency, currency: value.currency, scale: String(value.scale) };
  }
  if (value.type === "boolean") return { value_type: "boolean", value: String(value.value), missing_reason: "", unit: "", currency: "", scale: "" };
  if (value.type === "partial_local_datetime") {
    return { value_type: value.type, value: value.local, missing_reason: "", unit: "", currency: "", scale: "" };
  }
  return { value_type: value.type, value: value.value, missing_reason: "", unit: "", currency: "", scale: "" };
}

function makeImportRow(input: {
  readonly entityType: "festival" | "event";
  readonly festivalKey: string;
  readonly eventKey: string;
  readonly field: string;
  readonly value: ClaimValue;
  readonly rawValue: string;
  readonly manifest: JejuSeedSourceManifest;
}): Readonly<Record<string, string>> {
  const fields = valueFields(input.value);
  if (input.value.type !== "missing" && input.field === "entries") fields.unit = "entries";
  const row: Record<string, string> = {
    schema_version: JEJU_IMPORT_SCHEMA_VERSION,
    market_key: JEJU_MARKET_KEY,
    entity_type: input.entityType,
    festival_key: input.festivalKey,
    event_key: input.eventKey,
    field: input.field,
    ...fields,
    local_time_zone: "",
    local_time_precision: "",
    claim_kind: input.value.type === "missing" ? "missing" : "reported",
    status: "unverified",
    confidence: "unknown",
    source_document_key: input.manifest.sourceDocumentKey,
    source_type: input.manifest.sourceType,
    source_url: "",
    source_reference: input.manifest.sourceReference,
    source_publisher: input.manifest.sourcePublisher,
    source_title: input.manifest.sourceTitle,
    source_revision_key: input.manifest.sourceRevisionKey,
    source_effective_at: "",
    retrieved_at: input.manifest.retrievedAt,
    content_hash: input.manifest.rawSha256,
    observed_at: input.manifest.retrievedAt,
    effective_at: "",
    extraction_method: "structured_import",
    raw_value: input.rawValue,
    supersedes_claim_id: "",
    source_supersedes_revision_id: "",
    notes: "",
  };
  for (const header of JEJU_IMPORT_HEADERS) if (!(header in row)) row[header] = "";
  return row;
}

function assertFestivalConsistency(rows: readonly JejuSeedRawRow[], festivalName: string): void {
  const tourValues = new Set(rows.map((row) => normalizedText(row.tour, "tour")));
  const venueValues = new Set(rows.map((row) => normalizedText(row.venue, "venue")));
  if (tourValues.size !== 1 || venueValues.size !== 1) {
    fail(`festival ${festivalName} has conflicting tour or venue metadata`, "FESTIVAL_METADATA_CONFLICT");
  }
}

function sortImportRows(rows: readonly Readonly<Record<string, string>>[]): readonly Readonly<Record<string, string>>[] {
  return [...rows].sort((a, b) => {
    const left = [a.entity_type, a.festival_key, a.event_key, a.field, a.value_type, a.value].join("\u0000");
    const right = [b.entity_type, b.festival_key, b.event_key, b.field, b.value_type, b.value].join("\u0000");
    return compareStrings(left, right);
  });
}

export function buildJejuImportDocument(rawCsv: string, manifest: JejuSeedSourceManifest): JejuImportJsonDocument {
  validateManifest(manifest);
  const rawRows = parseRawRows(rawCsv);
  if (rawRows.length !== manifest.rowCount) fail("raw row count does not match source manifest", "RAW_ROW_COUNT_MISMATCH");

  const groups = new Map<string, JejuSeedRawRow[]>();
  const eventKeys = new Set<string>();
  for (const row of rawRows) {
    const sourceFestivalName = normalizedText(row.festival, "festival");
    const festivalKey = JEJU_FESTIVAL_KEY_BY_NAME[sourceFestivalName];
    if (!festivalKey) fail(`festival is not explicitly mapped: ${sourceFestivalName}`, "FESTIVAL_MAPPING_MISSING");
    const group = groups.get(festivalKey) ?? [];
    group.push(row);
    groups.set(festivalKey, group);
    const eventNo = normalizeIntegerString(normalizedText(row.event_no, "event_no"));
    const eventKey = `${festivalKey}:event-${eventNo}`;
    if (eventKeys.has(eventKey)) fail(`duplicate event identity: ${eventKey}`, "EVENT_IDENTITY_COLLISION");
    eventKeys.add(eventKey);
  }

  const outputRows: Readonly<Record<string, string>>[] = [];
  for (const [festivalKey, rows] of [...groups.entries()].sort(([a], [b]) => compareStrings(a, b))) {
    const sourceFestivalName = normalizedText(rows[0].festival, "festival");
    assertFestivalConsistency(rows, sourceFestivalName);
    const sourceFields: readonly [string, string][] = [
      ["festival_name", "festival"],
      ["tour", "tour"],
      ["venue", "venue"],
    ];
    for (const [field, sourceColumn] of sourceFields) {
      const rawValue = canonicalRawValue(rows.map((row) => row[sourceColumn as JejuSeedRawColumn]));
      outputRows.push(makeImportRow({
        entityType: "festival",
        festivalKey,
        eventKey: "",
        field,
        value: textValue(rawValue, field),
        rawValue,
        manifest,
      }));
    }
  }

  const sortedRawRows = [...rawRows].sort((a, b) => {
    const left = `${JEJU_FESTIVAL_KEY_BY_NAME[normalizedText(a.festival, "festival")]}\u0000${normalizeIntegerString(a.event_no)}`;
    const right = `${JEJU_FESTIVAL_KEY_BY_NAME[normalizedText(b.festival, "festival")]}\u0000${normalizeIntegerString(b.event_no)}`;
    return compareStrings(left, right);
  });
  for (const row of sortedRawRows) {
    const festivalKey = JEJU_FESTIVAL_KEY_BY_NAME[normalizedText(row.festival, "festival")];
    const eventNo = normalizeIntegerString(normalizedText(row.event_no, "event_no"));
    const eventKey = `event-${eventNo}`;
    const mapped: readonly [string, ClaimValue, string][] = [
      ["event_date", localDateValue(row.date), row.date],
      ["event_no", integerValue(row.event_no, "event_no"), row.event_no],
      ["event_name", textValue(row.event_name, "event_name"), row.event_name],
      ["event_type", textValue(row.event_type, "event_type"), row.event_type],
      ["game", textValue(row.game, "game"), row.game],
      ["is_flagship", booleanValue(row.is_flagship), row.is_flagship],
      ["buy_in", moneyValue(row.buy_in_local, row.currency, "buy_in_local"), row.buy_in_local],
      ["buy_in_prize", moneyValue(row.buy_in_prize_local, row.currency, "buy_in_prize_local"), row.buy_in_prize_local],
      ["organizer_fee", moneyValue(row.buy_in_fee_local, row.currency, "buy_in_fee_local"), row.buy_in_fee_local],
      ["gtd", moneyValue(row.gtd_local, row.currency, "gtd_local"), row.gtd_local],
      ["entries", integerValue(row.entries, "entries"), row.entries],
    ];
    for (const [field, value, rawValue] of mapped) {
      outputRows.push(makeImportRow({ entityType: "event", festivalKey, eventKey, field, value, rawValue, manifest }));
    }
  }

  return {
    schemaVersion: JEJU_IMPORT_SCHEMA_VERSION,
    marketKey: JEJU_MARKET_KEY,
    rows: sortImportRows(outputRows).map((row) => {
      const { schema_version: _schemaVersion, market_key: _marketKey, ...envelopeFreeRow } = row;
      return envelopeFreeRow;
    }),
  };
}

export async function importJejuSeed(rawCsv: string, manifest: JejuSeedSourceManifest): Promise<{ readonly document: JejuImportJsonDocument; readonly dataset: JejuImportDataset }> {
  const document = buildJejuImportDocument(rawCsv, manifest);
  const result = await parseJejuImportJson(document);
  if (!result.ok) fail(`generated Jeju import failed validation: ${result.errors.map((error) => error.message).join("; ")}`, "GENERATED_IMPORT_INVALID");
  return { document, dataset: result.value };
}

export interface JejuDataQualityReport {
  readonly rawInputSha256: string;
  readonly inputBytes: number;
  readonly inputRows: number;
  readonly inputColumns: readonly string[];
  readonly festivals: number;
  readonly events: number;
  readonly entities: number;
  readonly claims: number;
  readonly nonMissingClaims: number;
  readonly missingClaims: number;
  readonly sourceDocuments: number;
  readonly sourceRevisions: number;
  readonly conflicts: number;
  readonly tours: readonly string[];
  readonly currencies: readonly string[];
  readonly eventDateMin: string;
  readonly eventDateMax: string;
  readonly nonNullCountByField: Readonly<Record<string, number>>;
  readonly missingCountByField: Readonly<Record<string, number>>;
  readonly omittedLegacyColumns: Readonly<Record<string, string>>;
  readonly evidenceStatusDistribution: Readonly<Record<string, number>>;
  readonly confidenceDistribution: Readonly<Record<string, number>>;
  readonly importerSchemaVersion: typeof JEJU_IMPORT_SCHEMA_VERSION;
  readonly contractsVersion: typeof SERIES_MARKET_CONTRACT_VERSION;
  readonly releaseId: string;
  readonly sourceCutoff: string;
  readonly statements: readonly string[];
}

export function buildJejuDataQualityReport(
  dataset: JejuImportDataset,
  manifest: JejuSeedSourceManifest,
  releaseId: string,
): JejuDataQualityReport {
  const allClaims = [...dataset.claims];
  const nonNullCountByField: Record<string, number> = {};
  const missingCountByField: Record<string, number> = {};
  const status: Record<string, number> = {};
  const confidence: Record<string, number> = {};
  const tours = new Set<string>();
  const currencies = new Set<string>();
  const eventDates: string[] = [];
  for (const claim of allClaims) {
    const target = claim.value.type === "missing" ? missingCountByField : nonNullCountByField;
    target[claim.field] = (target[claim.field] ?? 0) + 1;
    status[claim.status] = (status[claim.status] ?? 0) + 1;
    confidence[claim.confidence] = (confidence[claim.confidence] ?? 0) + 1;
    if (claim.field === "tour" && claim.value.type === "text") tours.add(claim.value.value);
    if (claim.value.type === "money") currencies.add(claim.value.currency);
    if (claim.field === "event_date" && claim.value.type === "local_date") eventDates.push(claim.value.value);
  }
  const sortedDates = eventDates.sort(compareStrings);
  return {
    rawInputSha256: manifest.rawSha256,
    inputBytes: manifest.byteSize,
    inputRows: manifest.rowCount,
    inputColumns: [...manifest.originalColumns],
    festivals: dataset.festivals.length,
    events: dataset.events.length,
    entities: dataset.festivals.length + dataset.events.length,
    claims: allClaims.length,
    nonMissingClaims: allClaims.filter((claim) => claim.value.type !== "missing").length,
    missingClaims: allClaims.filter((claim) => claim.value.type === "missing").length,
    sourceDocuments: dataset.sourceDocuments.length,
    sourceRevisions: dataset.sourceRevisions.length,
    conflicts: dataset.conflicts.length,
    tours: [...tours].sort(compareStrings),
    currencies: [...currencies].sort(compareStrings),
    eventDateMin: sortedDates[0] ?? "",
    eventDateMax: sortedDates.at(-1) ?? "",
    nonNullCountByField: Object.fromEntries(Object.entries(nonNullCountByField).sort(([a], [b]) => compareStrings(a, b))),
    missingCountByField: Object.fromEntries(Object.entries(missingCountByField).sort(([a], [b]) => compareStrings(a, b))),
    omittedLegacyColumns: JEJU_OMITTED_LEGACY_COLUMNS,
    evidenceStatusDistribution: Object.fromEntries(Object.entries(status).sort(([a], [b]) => compareStrings(a, b))),
    confidenceDistribution: Object.fromEntries(Object.entries(confidence).sort(([a], [b]) => compareStrings(a, b))),
    importerSchemaVersion: JEJU_IMPORT_SCHEMA_VERSION,
    contractsVersion: SERIES_MARKET_CONTRACT_VERSION,
    releaseId,
    sourceCutoff: manifest.retrievedAt,
    statements: [
      "This is an unverified public seed dataset.",
      "Row-level official URLs are unavailable.",
      "Public facts should later be upgraded through source-backed superseding claims.",
      "This release is suitable for importer and descriptive research testing.",
      "This release is not sufficient for official market claims or production forecasting.",
    ],
  };
}

export function countClaimsByField(claims: readonly SourceClaim[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const claim of claims) counts[claim.field] = (counts[claim.field] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareStrings(a, b)));
}
