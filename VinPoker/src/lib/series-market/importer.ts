import { canonicalize } from "../series-intelligence/provenanceHash";
import {
  resolveSourceClaims,
  SERIES_MARKET_CONTRACT_VERSION,
  validateClaimSupersession,
  validateSourceClaim,
  type ClaimKind,
  type ClaimStatus,
  type ClaimValue,
  type EvidenceConfidence,
  type ExtractionMethod,
  type MarketEvent,
  type MarketEntityType,
  type MarketFestival,
  type SourceDocument,
  type SourceDocumentType,
  type SourceRevision,
  type SourceClaim,
} from "./contracts";
import {
  SeriesMarketValidationError,
  normalizeClaimValue,
  normalizeCurrency,
  normalizeInstant,
  normalizeIntegerString,
  normalizePartialLocalDateTime,
  normalizeStableKey,
} from "./normalization";
import {
  createMarketEventId,
  createMarketFestivalId,
  createSourceClaimId,
  createSourceDocumentId,
  createSourceRevisionId,
} from "./identity";

export const JEJU_IMPORT_SCHEMA_VERSION = "v1" as const;
export const JEJU_MARKET_KEY = "jeju" as const;

export const JEJU_IMPORT_HEADERS = [
  "schema_version",
  "market_key",
  "entity_type",
  "festival_key",
  "event_key",
  "field",
  "value_type",
  "value",
  "missing_reason",
  "unit",
  "currency",
  "scale",
  "local_time_zone",
  "local_time_precision",
  "claim_kind",
  "status",
  "confidence",
  "source_document_key",
  "source_type",
  "source_url",
  "source_reference",
  "source_publisher",
  "source_title",
  "source_revision_key",
  "source_effective_at",
  "retrieved_at",
  "content_hash",
  "observed_at",
  "effective_at",
  "extraction_method",
  "raw_value",
  "supersedes_claim_id",
  "source_supersedes_revision_id",
  "notes",
] as const;

export type JejuImportHeader = (typeof JEJU_IMPORT_HEADERS)[number];
export type JejuImportRow = Readonly<Record<JejuImportHeader, string>>;

export interface JejuImportJsonDocument {
  readonly schemaVersion: typeof JEJU_IMPORT_SCHEMA_VERSION;
  readonly marketKey: typeof JEJU_MARKET_KEY;
  readonly rows: readonly Readonly<Record<string, string | null>>[];
}

export interface ImportFieldError {
  readonly row: number | null;
  readonly field: string | null;
  readonly code: string;
  readonly message: string;
}

export interface JejuImportConflict {
  readonly entityId: string;
  readonly entityType: "festival" | "event";
  readonly field: string;
  readonly claimIds: readonly string[];
}

export interface JejuImportDataset {
  readonly schemaVersion: typeof JEJU_IMPORT_SCHEMA_VERSION;
  readonly marketKey: typeof JEJU_MARKET_KEY;
  readonly festivals: readonly MarketFestival[];
  readonly events: readonly MarketEvent[];
  readonly sourceDocuments: readonly SourceDocument[];
  readonly sourceRevisions: readonly SourceRevision[];
  readonly claims: readonly SourceClaim[];
  readonly conflicts: readonly JejuImportConflict[];
}

export type JejuImportValidationResult =
  | { readonly ok: true; readonly value: JejuImportDataset; readonly errors: readonly []; readonly warnings: readonly [] }
  | { readonly ok: false; readonly value: null; readonly errors: readonly ImportFieldError[]; readonly warnings: readonly [] };

class ImportRowError extends Error {
  constructor(
    readonly field: string,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportRowError";
  }
}

const SOURCE_TYPES = new Set<SourceDocumentType>([
  "official_schedule",
  "official_result",
  "official_structure",
  "official_poster",
  "organizer_or_venue",
  "trusted_results_database",
  "trusted_report",
  "other_public",
]);
const CLAIM_KINDS = new Set<ClaimKind>(["observed", "reported", "missing"]);
const CLAIM_STATUSES = new Set<ClaimStatus>([
  "official_confirmed",
  "cross_verified",
  "unverified",
  "conflicting",
  "stale",
  "rejected",
]);
const CONFIDENCES = new Set<EvidenceConfidence>(["high", "medium", "low", "unknown"]);
const EXTRACTION_METHODS = new Set<ExtractionMethod>(["manual_curated", "structured_import", "document_parse"]);
const VALUE_TYPES = new Set<ClaimValue["type"]>([
  "text",
  "boolean",
  "integer",
  "decimal",
  "money",
  "local_date",
  "partial_local_datetime",
  "instant",
  "missing",
]);
const MISSING_REASONS = new Set(["not_disclosed", "not_found", "not_applicable", "unknown"]);
const PII_FIELD_TOKENS = [
  "phone",
  "email",
  "playeridentifier",
  "accountidentifier",
  "payment",
  "cashier",
  "wallet",
  "bullethistory",
  "privateregistrationpace",
  "clubfinance",
] as const;

type JejuNonMissingValueType = Exclude<ClaimValue["type"], "missing">;
type JejuUnitRule =
  | { readonly kind: "forbidden" }
  | { readonly kind: "exact"; readonly value: string }
  | { readonly kind: "currency" };

export interface JejuPublicFieldSpec {
  readonly entityType: MarketEntityType;
  readonly valueType: JejuNonMissingValueType;
  readonly missingAllowed: boolean;
  readonly nonNegative: boolean;
  readonly unitRule: JejuUnitRule;
  readonly currencyRequired: boolean;
  readonly sourceKind: "source_fact" | "reserved_derived_metric";
  readonly rateDomain?: "fraction_0_to_1";
}

const textField = (entityType: MarketEntityType): JejuPublicFieldSpec => ({
  entityType,
  valueType: "text",
  missingAllowed: true,
  nonNegative: false,
  unitRule: { kind: "forbidden" },
  currencyRequired: false,
  sourceKind: "source_fact",
});

const integerField = (entityType: MarketEntityType, unitRule: JejuUnitRule = { kind: "forbidden" }): JejuPublicFieldSpec => ({
  entityType,
  valueType: "integer",
  missingAllowed: true,
  nonNegative: true,
  unitRule,
  currencyRequired: false,
  sourceKind: "source_fact",
});

const moneyField = (entityType: MarketEntityType): JejuPublicFieldSpec => ({
  entityType,
  valueType: "money",
  missingAllowed: true,
  nonNegative: true,
  unitRule: { kind: "currency" },
  currencyRequired: true,
  sourceKind: "source_fact",
});

const localDateField = (entityType: MarketEntityType): JejuPublicFieldSpec => ({
  entityType,
  valueType: "local_date",
  missingAllowed: true,
  nonNegative: false,
  unitRule: { kind: "forbidden" },
  currencyRequired: false,
  sourceKind: "source_fact",
});

const partialLocalDateTimeField = (entityType: MarketEntityType): JejuPublicFieldSpec => ({
  entityType,
  valueType: "partial_local_datetime",
  missingAllowed: true,
  nonNegative: false,
  unitRule: { kind: "forbidden" },
  currencyRequired: false,
  sourceKind: "source_fact",
});

const booleanField = (entityType: MarketEntityType): JejuPublicFieldSpec => ({
  entityType,
  valueType: "boolean",
  missingAllowed: true,
  nonNegative: false,
  unitRule: { kind: "forbidden" },
  currencyRequired: false,
  sourceKind: "source_fact",
});

const rateField = (entityType: MarketEntityType): JejuPublicFieldSpec => ({
  entityType,
  valueType: "decimal",
  missingAllowed: true,
  nonNegative: true,
  unitRule: { kind: "exact", value: "fraction" },
  currencyRequired: false,
  sourceKind: "source_fact",
  rateDomain: "fraction_0_to_1",
});

/** Versioned public allowlist. Schema v1 deliberately has no extension-field escape hatch. */
export const JEJU_PUBLIC_FIELD_REGISTRY: Readonly<Record<string, JejuPublicFieldSpec>> = {
  festival_name: textField("festival"),
  tour: textField("festival"),
  edition: integerField("festival"),
  venue: textField("festival"),
  start_date: localDateField("festival"),
  end_date: localDateField("festival"),
  advertised_event_count: integerField("festival", { kind: "exact", value: "events" }),
  total_gtd: moneyField("festival"),
  series_entries: integerField("festival", { kind: "exact", value: "entries" }),
  series_prize_pool: moneyField("festival"),
  event_no: integerField("event"),
  event_name: textField("event"),
  event_type: textField("event"),
  game: textField("event"),
  format: textField("event"),
  scheduled_start: partialLocalDateTimeField("event"),
  buy_in: moneyField("event"),
  buy_in_prize: moneyField("event"),
  organizer_fee: moneyField("event"),
  staff_fee_amount: moneyField("event"),
  staff_fee_rate: rateField("event"),
  gtd: moneyField("event"),
  entries: integerField("event", { kind: "exact", value: "entries" }),
  unique_entries: integerField("event", { kind: "exact", value: "entries" }),
  reentries: integerField("event", { kind: "exact", value: "entries" }),
  prize_pool: moneyField("event"),
  itm_count: integerField("event", { kind: "exact", value: "players" }),
  starting_stack: integerField("event", { kind: "exact", value: "chips" }),
  level_duration_pre_close: integerField("event", { kind: "exact", value: "seconds" }),
  level_duration_post_close: integerField("event", { kind: "exact", value: "seconds" }),
  late_reg_level: integerField("event", { kind: "exact", value: "levels" }),
  flight_count: integerField("event", { kind: "exact", value: "flights" }),
  is_flagship: booleanField("event"),
};

const SOURCE_METADATA_FIELDS = [
  "source_type",
  "source_url",
  "source_reference",
  "source_publisher",
  "source_title",
  "source_revision_key",
  "source_effective_at",
  "retrieved_at",
  "content_hash",
  "source_supersedes_revision_id",
] as const;
const OFFICIAL_SOURCE_TYPES = new Set<SourceDocumentType>([
  "official_schedule",
  "official_result",
  "official_structure",
  "official_poster",
  "organizer_or_venue",
]);
const JSON_ENVELOPE_KEYS = new Set(["schemaVersion", "marketKey", "rows"]);
const JSON_ROW_HEADERS = JEJU_IMPORT_HEADERS.filter((header) => header !== "schema_version" && header !== "market_key");

const empty = (value: string | undefined): boolean => value === undefined || value.trim() === "";
const nullableText = (value: string): string | null => (value.trim() === "" ? null : value.trim());
const normalizeMetadata = (value: string | null): string | null => {
  if (value === null) return null;
  const normalized = value.normalize("NFC").trim();
  return normalized === "" ? null : normalized;
};
const nullableRawValue = (value: string | undefined): string | null => {
  if (value === undefined || value.trim() === "") return null;
  return value;
};

function fail(field: string, code: string, message: string): never {
  throw new ImportRowError(field, code, message);
}

function readRequired(row: Record<string, string>, field: JejuImportHeader): string {
  const value = row[field] ?? "";
  if (value.trim() === "") fail(field, "REQUIRED_FIELD", `${field} is required`);
  return value.trim();
}

function readOptional(row: Record<string, string>, field: JejuImportHeader): string | null {
  return nullableText(row[field] ?? "");
}

function parseEnum<T extends string>(value: string, values: ReadonlySet<T>, field: JejuImportHeader): T {
  if (!values.has(value as T)) fail(field, "INVALID_ENUM", `${field} is not supported`);
  return value as T;
}

function normalizeFieldName(raw: string): string {
  try {
    return normalizeStableKey(raw, "field");
  } catch (error) {
    if (error instanceof SeriesMarketValidationError) fail("field", error.code, error.message);
    throw error;
  }
}

function validatePublicFieldName(field: string, entityType: MarketEntityType): JejuPublicFieldSpec {
  const compact = field.replace(/[^a-z0-9]/g, "");
  if (PII_FIELD_TOKENS.some((token) => compact.includes(token))) {
    fail("field", "FORBIDDEN_PUBLIC_FIELD", "public market imports cannot contain PII or private-operator fields");
  }
  const spec = JEJU_PUBLIC_FIELD_REGISTRY[field];
  if (!spec) fail("field", "UNKNOWN_PUBLIC_FIELD", `${field} is not registered in public Jeju schema v1`);
  if (spec.entityType !== entityType) {
    fail("field", "FIELD_ENTITY_TYPE_MISMATCH", `${field} is only allowed on ${spec.entityType} entities`);
  }
  if (spec.sourceKind !== "source_fact") {
    fail("field", "RESERVED_DERIVED_FIELD", `${field} is reserved for a later derived metric`);
  }
  return spec;
}

function normalizeUrl(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return url.toString();
  } catch {
    fail("source_url", "INVALID_SOURCE_URL", "source_url must be an http(s) URL");
  }
}

function normalizeContentHash(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) fail("content_hash", "INVALID_CONTENT_HASH", "content_hash must be SHA-256 hex");
  return value;
}

function parseScale(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) fail("scale", "INVALID_MONEY_SCALE", "money scale must be an integer");
  const scale = Number(raw);
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 18) {
    fail("scale", "INVALID_MONEY_SCALE", "money scale must be between 0 and 18");
  }
  return scale;
}

function parseClaimValue(row: Record<string, string>): ClaimValue {
  const valueType = parseEnum(readRequired(row, "value_type"), VALUE_TYPES, "value_type");
  const raw = row.value ?? "";
  const missingReason = readOptional(row, "missing_reason");
  try {
    if (valueType !== "missing" && missingReason !== null) {
      fail("missing_reason", "UNEXPECTED_MISSING_REASON", "missing_reason is only allowed for missing values");
    }
    switch (valueType) {
      case "text":
        if (empty(raw)) fail("value", "REQUIRED_FIELD", "text value is required");
        return normalizeClaimValue({ type: "text", value: raw });
      case "boolean":
        if (raw !== "true" && raw !== "false") fail("value", "INVALID_BOOLEAN", "boolean value must be true or false");
        return { type: "boolean", value: raw === "true" };
      case "integer":
        return { type: "integer", value: normalizeIntegerString(readRequired(row, "value")) };
      case "decimal":
        return normalizeClaimValue({ type: "decimal", value: readRequired(row, "value") });
      case "money":
        return normalizeClaimValue({
          type: "money",
          minorUnits: readRequired(row, "value"),
          currency: normalizeCurrency(readRequired(row, "currency")),
          scale: parseScale(row.scale ?? ""),
        });
      case "local_date":
        return normalizeClaimValue({ type: "local_date", value: readRequired(row, "value") });
      case "partial_local_datetime":
        return normalizePartialLocalDateTime({
          local: readRequired(row, "value"),
          timeZone: readRequired(row, "local_time_zone"),
          precision: parseEnum(readRequired(row, "local_time_precision"), new Set(["minute", "second"]), "local_time_precision"),
        });
      case "instant":
        return normalizeClaimValue({ type: "instant", value: readRequired(row, "value") });
      case "missing":
        if (!MISSING_REASONS.has(missingReason ?? "")) {
          fail("missing_reason", "INVALID_MISSING_REASON", "missing_reason is required for a missing value");
        }
        if (!empty(raw)) fail("value", "MISSING_VALUE_HAS_CONTENT", "missing values must leave value empty");
        return { type: "missing", reason: missingReason as "not_disclosed" | "not_found" | "not_applicable" | "unknown" };
    }
  } catch (error) {
    if (error instanceof ImportRowError) throw error;
    if (error instanceof SeriesMarketValidationError) fail("value", error.code, error.message);
    throw error;
  }
}

interface ParsedFieldSemantics {
  readonly unit: string | null;
}

function validateFieldSemantics(
  spec: JejuPublicFieldSpec,
  value: ClaimValue,
  row: Record<string, string>,
): ParsedFieldSemantics {
  const unit = normalizeMetadata(readOptional(row, "unit"));
  const currency = normalizeMetadata(readOptional(row, "currency"));
  const scale = readOptional(row, "scale");
  const timeZone = readOptional(row, "local_time_zone");
  const timePrecision = readOptional(row, "local_time_precision");

  if (value.type === "missing") {
    if (!spec.missingAllowed) fail("value_type", "MISSING_VALUE_NOT_ALLOWED", "this public field cannot be explicitly missing");
    if (unit !== null || currency !== null || scale !== null || timeZone !== null || timePrecision !== null) {
      fail("value", "MISSING_VALUE_HAS_METADATA", "missing values cannot carry unit, currency, scale, or time metadata");
    }
    return { unit: null };
  }

  if (value.type !== spec.valueType) {
    fail("value_type", "FIELD_VALUE_TYPE_MISMATCH", `field requires value_type ${spec.valueType}`);
  }
  if (spec.currencyRequired && value.type !== "money") {
    fail("currency", "CURRENCY_REQUIRED", "this field requires a money value");
  }
  if (value.type !== "money" && currency !== null) {
    fail("currency", "UNEXPECTED_CURRENCY", "currency is only allowed for money values");
  }
  if (value.type !== "money" && scale !== null) {
    fail("scale", "UNEXPECTED_SCALE", "scale is only allowed for money values");
  }
  if (value.type !== "partial_local_datetime" && (timeZone !== null || timePrecision !== null)) {
    fail("local_time_zone", "UNEXPECTED_LOCAL_TIME_METADATA", "local time metadata is only allowed for partial local date/time values");
  }

  let normalizedUnit = unit;
  if (spec.unitRule.kind === "forbidden" && unit !== null) {
    fail("unit", "UNEXPECTED_UNIT", "this field does not accept a unit");
  }
  if (spec.unitRule.kind === "exact") {
    if (unit !== spec.unitRule.value) fail("unit", "INVALID_UNIT", `unit must be ${spec.unitRule.value}`);
  }
  if (spec.unitRule.kind === "currency") {
    if (value.type !== "money") fail("unit", "INVALID_UNIT", "currency units require a money value");
    if (unit !== null) {
      const normalizedUnitCurrency = normalizeCurrency(unit);
      if (normalizedUnitCurrency !== value.currency) fail("unit", "INCOMPATIBLE_UNIT", "money unit must match currency");
      normalizedUnit = normalizedUnitCurrency;
    }
  }

  if (spec.nonNegative && (value.type === "integer" || value.type === "decimal" || value.type === "money")) {
    const numeric = value.type === "money" ? value.minorUnits : value.value;
    if (numeric.startsWith("-")) fail("value", "NEGATIVE_VALUE_NOT_ALLOWED", "this public field cannot be negative");
  }
  if (spec.rateDomain === "fraction_0_to_1" && value.type === "decimal") {
    if (value.value !== "0" && !value.value.startsWith("0.") && value.value !== "1") {
      fail("value", "RATE_OUT_OF_RANGE", "fraction rates must be between 0 and 1");
    }
  }
  return { unit: normalizedUnit };
}

function parseCsv(input: string): { readonly headers: string[]; readonly rows: string[][]; readonly errors: ImportFieldError[] } {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  const errors: ImportFieldError[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quoteClosed = false;

  const finishRow = (): void => {
    if (row.length === 0 && field === "") return;
    rows.push([...row, field]);
    row = [];
    field = "";
    quoteClosed = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else if (character === "\r" && text[index + 1] !== "\n") {
        errors.push({ row: rows.length + 1, field: null, code: "CSV_MALFORMED_LINE_END", message: "CSV may only use CRLF or LF line endings" });
        field += character;
      } else {
        field += character;
      }
      continue;
    }
    if (quoteClosed) {
      if (character === ",") {
        row.push(field);
        field = "";
        quoteClosed = false;
      } else if (character === "\n") {
        finishRow();
      } else if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
        finishRow();
      } else if (character === "\r") {
        errors.push({ row: rows.length + 1, field: null, code: "CSV_MALFORMED_LINE_END", message: "CSV may only use CRLF or LF line endings" });
        quoteClosed = false;
        field += character;
      } else {
        errors.push({ row: rows.length + 1, field: null, code: "CSV_AFTER_QUOTE", message: "unexpected content after a quoted CSV field" });
        quoteClosed = false;
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      inQuotes = true;
    } else if (character === '"') {
      errors.push({ row: rows.length + 1, field: null, code: "CSV_UNEXPECTED_QUOTE", message: "quoted CSV fields must begin with a quote" });
      field += character;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r" && text[index + 1] === "\n") {
      index += 1;
      finishRow();
    } else if (character === "\r") {
      errors.push({ row: rows.length + 1, field: null, code: "CSV_MALFORMED_LINE_END", message: "CSV may only use CRLF or LF line endings" });
      field += character;
    } else {
      field += character;
    }
  }
  if (inQuotes) errors.push({ row: rows.length + 2, field: null, code: "CSV_UNCLOSED_QUOTE", message: "CSV contains an unclosed quoted field" });
  else finishRow();

  const headers = rows.shift() ?? [];
  return { headers, rows, errors };
}

function emptyResult(errors: readonly ImportFieldError[]): JejuImportValidationResult {
  return { ok: false, value: null, errors, warnings: [] };
}

function same<T>(a: T, b: T): boolean {
  return canonicalize(a) === canonicalize(b);
}

function compareIds(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Validate and deterministically expose all current source-revision tips. */
export function resolveCurrentSourceRevisionTips(revisions: readonly SourceRevision[]): readonly SourceRevision[] {
  const byId = new Map<string, SourceRevision>();
  for (const revision of revisions) {
    const prior = byId.get(revision.id);
    if (prior && !same(prior, revision)) {
      throw new SeriesMarketValidationError("source revision identity has conflicting metadata", "SOURCE_REVISION_CONFLICT");
    }
    byId.set(revision.id, revision);
  }

  const supersededIds = new Set<string>();
  for (const revision of byId.values()) {
    const targetId = revision.supersedesSourceRevisionId;
    if (targetId === null) continue;
    if (targetId === revision.id) {
      throw new SeriesMarketValidationError("source revision cannot supersede itself", "SOURCE_REVISION_SELF_SUPERSESSION");
    }
    const target = byId.get(targetId);
    if (!target) {
      throw new SeriesMarketValidationError(`superseded source revision is missing: ${targetId}`, "SOURCE_REVISION_TARGET_MISSING");
    }
    if (target.sourceDocumentId !== revision.sourceDocumentId) {
      throw new SeriesMarketValidationError("source revision supersession must remain within one document", "SOURCE_REVISION_SCOPE_MISMATCH");
    }
    supersededIds.add(targetId);
  }

  for (const revision of byId.values()) {
    const visited = new Set<string>();
    let currentId: string | null = revision.id;
    while (currentId !== null) {
      if (visited.has(currentId)) {
        throw new SeriesMarketValidationError("source revision supersession cycle detected", "SOURCE_REVISION_CYCLE");
      }
      visited.add(currentId);
      currentId = byId.get(currentId)?.supersedesSourceRevisionId ?? null;
    }
  }

  return [...byId.values()].filter((revision) => !supersededIds.has(revision.id)).sort(compareIds);
}

export async function validateJejuImportRows(rows: readonly Record<string, string>[]): Promise<JejuImportValidationResult> {
  const errors: ImportFieldError[] = [];
  const festivals = new Map<string, MarketFestival>();
  const events = new Map<string, MarketEvent>();
  const sourceDocuments = new Map<string, SourceDocument>();
  const sourceRevisions = new Map<string, SourceRevision>();
  const claims: SourceClaim[] = [];
  const claimIds = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const row = rows[index];
    try {
      if (readRequired(row, "schema_version") !== JEJU_IMPORT_SCHEMA_VERSION) {
        fail("schema_version", "UNSUPPORTED_SCHEMA_VERSION", "only schema_version v1 is supported");
      }
      if (readRequired(row, "market_key") !== JEJU_MARKET_KEY) {
        fail("market_key", "UNSUPPORTED_MARKET", "this importer only accepts market_key jeju");
      }
      const entityType = parseEnum(readRequired(row, "entity_type"), new Set(["festival", "event"]), "entity_type");
      const festivalKey = normalizeStableKey(readRequired(row, "festival_key"), "festival_key");
      const eventKey = entityType === "event" ? normalizeStableKey(readRequired(row, "event_key"), "event_key") : null;
      if (entityType === "festival" && !empty(row.event_key)) {
        fail("event_key", "UNEXPECTED_FIELD", "festival claims must leave event_key empty");
      }
      const field = normalizeFieldName(readRequired(row, "field"));
      const fieldSpec = validatePublicFieldName(field, entityType);
      const claimKind = parseEnum(readRequired(row, "claim_kind"), CLAIM_KINDS, "claim_kind");
      const value = parseClaimValue(row);
      if (claimKind === "missing" && value.type !== "missing") fail("claim_kind", "CLAIM_VALUE_MISMATCH", "missing claims require value_type missing");
      if (claimKind !== "missing" && value.type === "missing") fail("claim_kind", "CLAIM_VALUE_MISMATCH", "observed/reported claims cannot use a missing value");
      const fieldSemantics = validateFieldSemantics(fieldSpec, value, row);
      const status = parseEnum(readRequired(row, "status"), CLAIM_STATUSES, "status");
      if (status === "cross_verified") fail("status", "CROSS_VERIFIED_IMPORT_NOT_ALLOWED", "cross_verified requires independent release-time verification");
      const confidence = parseEnum(readRequired(row, "confidence"), CONFIDENCES, "confidence");
      const extractionMethod = parseEnum(readRequired(row, "extraction_method"), EXTRACTION_METHODS, "extraction_method");
      const observedAt = normalizeInstant(readRequired(row, "observed_at"));
      const effectiveAt = readOptional(row, "effective_at");
      const normalizedEffectiveAt = effectiveAt === null ? null : normalizeInstant(effectiveAt);
      const festivalId = await createMarketFestivalId({ marketKey: JEJU_MARKET_KEY, festivalKey });
      festivals.set(festivalId, { id: festivalId, contractVersion: SERIES_MARKET_CONTRACT_VERSION, entityType: "festival", marketKey: JEJU_MARKET_KEY, festivalKey });
      let entityId = festivalId;
      if (entityType === "event" && eventKey !== null) {
        entityId = await createMarketEventId({ marketKey: JEJU_MARKET_KEY, festivalKey, eventKey });
        events.set(entityId, {
          id: entityId,
          contractVersion: SERIES_MARKET_CONTRACT_VERSION,
          entityType: "event",
          marketKey: JEJU_MARKET_KEY,
          festivalKey,
          eventKey,
          festivalId,
        });
      }

      const sourceDocumentKey = readOptional(row, "source_document_key");
      const hasSourceDetail = SOURCE_METADATA_FIELDS.some((key) => !empty(row[key]));
      let sourceRevisionId: string | null = null;
      if (sourceDocumentKey === null) {
        if (hasSourceDetail) fail("source_document_key", "SOURCE_MANIFEST_INCOMPLETE", "source metadata requires source_document_key for every claim kind");
        if (claimKind !== "missing" || status !== "unverified" || confidence !== "unknown") {
          fail("source_document_key", "SOURCELESS_MISSING_NOT_ALLOWED", "only an unverified, unknown-confidence missing claim may be source-less");
        }
      } else {
        const sourceType = parseEnum(readRequired(row, "source_type"), SOURCE_TYPES, "source_type");
        const revisionKey = normalizeStableKey(readRequired(row, "source_revision_key"), "source_revision_key");
        const retrievedAt = normalizeInstant(readRequired(row, "retrieved_at"));
        const contentHash = normalizeContentHash(readOptional(row, "content_hash"));
        const sourceEffectiveAtRaw = readOptional(row, "source_effective_at");
        const sourceEffectiveAt = sourceEffectiveAtRaw === null ? null : normalizeInstant(sourceEffectiveAtRaw);
        const sourceUrl = normalizeUrl(readOptional(row, "source_url"));
        const sourceReference = normalizeMetadata(readOptional(row, "source_reference"));
        if (sourceUrl === null && sourceReference === null) {
          fail("source_url", "SOURCE_MANIFEST_INCOMPLETE", "a source manifest requires source_url or source_reference");
        }
        if (status === "official_confirmed" && !OFFICIAL_SOURCE_TYPES.has(sourceType)) {
          fail("status", "OFFICIAL_STATUS_SOURCE_TYPE_MISMATCH", "official_confirmed requires an official or organizer/venue source");
        }
        const normalizedDocumentKey = normalizeStableKey(sourceDocumentKey, "source_document_key");
        const documentId = await createSourceDocumentId({ documentKey: normalizedDocumentKey, sourceType });
        const document: SourceDocument = {
          id: documentId,
          contractVersion: SERIES_MARKET_CONTRACT_VERSION,
          documentKey: normalizedDocumentKey,
          sourceType,
          canonicalUrl: sourceUrl,
          sourceReference,
          publisher: normalizeMetadata(readOptional(row, "source_publisher")),
          title: normalizeMetadata(readOptional(row, "source_title")),
        };
        const priorDocument = sourceDocuments.get(document.documentKey);
        if (priorDocument && !same(priorDocument, document)) fail("source_document_key", "SOURCE_DOCUMENT_CONFLICT", "one source_document_key has conflicting metadata");
        sourceDocuments.set(document.documentKey, document);
        sourceRevisionId = await createSourceRevisionId({ sourceDocumentId: documentId, revisionKey, retrievedAt, contentHash });
        const revision: SourceRevision = {
          id: sourceRevisionId,
          contractVersion: SERIES_MARKET_CONTRACT_VERSION,
          sourceDocumentId: documentId,
          revisionKey,
          retrievedAt,
          effectiveAt: sourceEffectiveAt,
          contentHash,
          supersedesSourceRevisionId: readOptional(row, "source_supersedes_revision_id"),
        };
        const revisionKeyForMap = `${documentId}:${revisionKey}`;
        const priorRevision = sourceRevisions.get(revisionKeyForMap);
        if (priorRevision && !same(priorRevision, revision)) fail("source_revision_key", "SOURCE_REVISION_CONFLICT", "one source revision has conflicting metadata");
        sourceRevisions.set(revisionKeyForMap, revision);
      }
      if (claimKind !== "missing" && sourceRevisionId === null) fail("source_revision_key", "SOURCE_LINEAGE_REQUIRED", "observed/reported claims require source revision lineage");
      const claim: SourceClaim = {
        id: await createSourceClaimId({ entityId, field, value, sourceRevisionId, effectiveAt: normalizedEffectiveAt }),
        contractVersion: SERIES_MARKET_CONTRACT_VERSION,
        entityType,
        entityId,
        field,
        kind: claimKind,
        status,
        confidence,
        value,
        rawValue: nullableRawValue(row.raw_value),
        unit: fieldSemantics.unit,
        sourceRevisionId,
        observedAt,
        effectiveAt: normalizedEffectiveAt,
        extractionMethod,
        supersedesClaimId: readOptional(row, "supersedes_claim_id"),
        notes: normalizeMetadata(readOptional(row, "notes")),
      };
      validateSourceClaim(claim);
      if (claimIds.has(claim.id)) fail("value", "DUPLICATE_CLAIM_IDENTITY", "duplicate semantic claim identity in import");
      claimIds.add(claim.id);
      claims.push(claim);
    } catch (error) {
      if (error instanceof ImportRowError) {
        errors.push({ row: rowNumber, field: error.field, code: error.code, message: error.message });
      } else if (error instanceof SeriesMarketValidationError) {
        errors.push({ row: rowNumber, field: null, code: error.code, message: error.message });
      } else {
        errors.push({ row: rowNumber, field: null, code: "IMPORT_ROW_INVALID", message: error instanceof Error ? error.message : "invalid import row" });
      }
    }
  }

  if (sourceRevisions.size > 0) {
    try {
      resolveCurrentSourceRevisionTips([...sourceRevisions.values()]);
    } catch (error) {
      errors.push({
        row: null,
        field: "source_supersedes_revision_id",
        code: error instanceof SeriesMarketValidationError ? error.code : "SOURCE_REVISION_SUPERSESSION_INVALID",
        message: error instanceof Error ? error.message : "invalid source revision supersession",
      });
    }
  }
  if (claims.length > 0) {
    try {
      validateClaimSupersession(claims);
    } catch (error) {
      errors.push({ row: null, field: "supersedes_claim_id", code: error instanceof SeriesMarketValidationError ? error.code : "SUPERSESSION_INVALID", message: error instanceof Error ? error.message : "invalid claim supersession" });
    }
  }
  if (errors.length > 0) return emptyResult(errors);

  const groups = new Map<string, SourceClaim[]>();
  for (const claim of claims) {
    const key = `${claim.entityType}:${claim.entityId}:${claim.field}`;
    const group = groups.get(key) ?? [];
    group.push(claim);
    groups.set(key, group);
  }
  const conflicts: JejuImportConflict[] = [];
  for (const group of groups.values()) {
    const resolution = resolveSourceClaims(group);
    if (resolution.state === "conflict") {
      const first = group[0];
      conflicts.push({
        entityId: first.entityId,
        entityType: first.entityType,
        field: first.field,
        claimIds: resolution.claims.map((claim) => claim.id).sort(),
      });
    }
  }

  return {
    ok: true,
    errors: [],
    warnings: [],
    value: {
      schemaVersion: JEJU_IMPORT_SCHEMA_VERSION,
      marketKey: JEJU_MARKET_KEY,
      festivals: [...festivals.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      events: [...events.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      sourceDocuments: [...sourceDocuments.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      sourceRevisions: [...sourceRevisions.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      claims: [...claims].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      conflicts: conflicts.sort((a, b) => `${a.entityId}:${a.field}` < `${b.entityId}:${b.field}` ? -1 : 1),
    },
  };
}

export async function parseJejuImportCsv(input: string): Promise<JejuImportValidationResult> {
  const parsed = parseCsv(input);
  if (parsed.errors.length > 0) return emptyResult(parsed.errors);
  if (parsed.headers.length !== JEJU_IMPORT_HEADERS.length || parsed.headers.some((header, index) => header !== JEJU_IMPORT_HEADERS[index])) {
    return emptyResult([{ row: 1, field: null, code: "INVALID_HEADER", message: `CSV header must exactly match ${JEJU_IMPORT_HEADERS.join(",")}` }]);
  }
  const malformedRows = parsed.rows
    .map((values, index) => ({ values, row: index + 2 }))
    .filter(({ values }) => values.length !== JEJU_IMPORT_HEADERS.length)
    .map(({ values, row }) => ({
      row,
      field: null,
      code: "CSV_COLUMN_COUNT_MISMATCH",
      message: `CSV row must contain exactly ${JEJU_IMPORT_HEADERS.length} cells, received ${values.length}`,
    }));
  if (malformedRows.length > 0) return emptyResult(malformedRows);
  const rows = parsed.rows.map((values) => Object.fromEntries(JEJU_IMPORT_HEADERS.map((header, index) => [header, values[index] ?? ""])) as Record<string, string>);
  return validateJejuImportRows(rows);
}

export async function parseJejuImportJson(input: string | JejuImportJsonDocument): Promise<JejuImportValidationResult> {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input) as unknown;
    } catch (error) {
      return emptyResult([{ row: null, field: null, code: "INVALID_JSON", message: error instanceof Error ? error.message : "invalid JSON" }]);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyResult([{ row: null, field: null, code: "INVALID_JSON_DOCUMENT", message: "JSON import must be an object" }]);
  }
  const document = parsed as Record<string, unknown>;
  const unknownEnvelopeKeys = Object.keys(document).filter((key) => !JSON_ENVELOPE_KEYS.has(key));
  if (unknownEnvelopeKeys.length > 0) {
    return emptyResult([{ row: null, field: unknownEnvelopeKeys[0], code: "UNKNOWN_JSON_ENVELOPE_FIELD", message: `unknown JSON envelope field ${unknownEnvelopeKeys[0]}` }]);
  }
  if (document.schemaVersion !== JEJU_IMPORT_SCHEMA_VERSION) {
    return emptyResult([{ row: null, field: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION", message: "only schemaVersion v1 is supported" }]);
  }
  if (document.marketKey !== JEJU_MARKET_KEY) {
    return emptyResult([{ row: null, field: "marketKey", code: "UNSUPPORTED_MARKET", message: "only marketKey jeju is supported" }]);
  }
  if (!Array.isArray(document.rows)) {
    return emptyResult([{ row: null, field: "rows", code: "ROWS_REQUIRED", message: "JSON import rows must be an array" }]);
  }
  const rows: Record<string, string>[] = [];
  const errors: ImportFieldError[] = [];
  for (let index = 0; index < document.rows.length; index += 1) {
    const raw = document.rows[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push({ row: index + 2, field: null, code: "INVALID_JSON_ROW", message: "each JSON row must be an object" });
      continue;
    }
    const record = raw as Record<string, unknown>;
    const rowEnvelopeKeys = ["schema_version", "market_key"].filter((key) => Object.prototype.hasOwnProperty.call(record, key));
    if (rowEnvelopeKeys.length > 0) {
      errors.push({ row: index + 2, field: rowEnvelopeKeys[0], code: "JSON_ROW_ENVELOPE_FIELD", message: `${rowEnvelopeKeys[0]} is owned by the JSON envelope` });
      continue;
    }
    const unknownKeys = Object.keys(record).filter((key) => !JSON_ROW_HEADERS.includes(key as typeof JSON_ROW_HEADERS[number]));
    if (unknownKeys.length > 0) {
      errors.push({ row: index + 2, field: unknownKeys[0], code: "UNKNOWN_FIELD", message: `unknown JSON field ${unknownKeys[0]}` });
      continue;
    }
    const row: Record<string, string> = {};
    row.schema_version = JEJU_IMPORT_SCHEMA_VERSION;
    row.market_key = JEJU_MARKET_KEY;
    for (const header of JSON_ROW_HEADERS) {
      const value = record[header];
      if (value !== undefined && value !== null && typeof value !== "string") {
        errors.push({ row: index + 2, field: header, code: "JSON_VALUE_MUST_BE_STRING", message: `${header} must be a string or null` });
      }
      row[header] = typeof value === "string" ? value : "";
    }
    rows.push(row);
  }
  if (errors.length > 0) return emptyResult(errors);
  return validateJejuImportRows(rows);
}
