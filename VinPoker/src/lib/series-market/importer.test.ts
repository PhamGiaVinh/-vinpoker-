import { describe, expect, it } from "vitest";
import {
  JEJU_IMPORT_HEADERS,
  JEJU_IMPORT_SCHEMA_VERSION,
  JEJU_MARKET_KEY,
  parseJejuImportCsv,
  parseJejuImportJson,
  resolveCurrentSourceRevisionTips,
  type JejuImportHeader,
} from "./importer";
import { resolveSourceClaims } from "./contracts";

const baseRow = (overrides: Partial<Record<JejuImportHeader, string>> = {}): Record<string, string> => ({
  schema_version: JEJU_IMPORT_SCHEMA_VERSION,
  market_key: JEJU_MARKET_KEY,
  entity_type: "event",
  festival_key: "apt-2026",
  event_key: "main",
  field: "entries",
  value_type: "integer",
  value: "120",
  missing_reason: "",
  unit: "",
  currency: "",
  scale: "",
  local_time_zone: "",
  local_time_precision: "",
  claim_kind: "observed",
  status: "official_confirmed",
  confidence: "high",
  source_document_key: "apt-2026-results",
  source_type: "official_result",
  source_url: "https://example.com/apt-2026-results",
  source_reference: "page-1",
  source_publisher: "APT",
  source_title: "APT Jeju 2026 results",
  source_revision_key: "retrieval-1",
  source_effective_at: "",
  retrieved_at: "2026-07-13T09:30:00Z",
  content_hash: "",
  observed_at: "2026-07-13T09:30:00Z",
  effective_at: "",
  extraction_method: "structured_import",
  raw_value: "120",
  supersedes_claim_id: "",
  source_supersedes_revision_id: "",
  notes: "",
  ...overrides,
});

const csvCell = (value: string): string => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const toCsv = (rows: readonly Record<string, string>[]): string => [
  JEJU_IMPORT_HEADERS.join(","),
  ...rows.map((row) => JEJU_IMPORT_HEADERS.map((header) => csvCell(row[header] ?? "")).join(",")),
].join("\r\n");

describe("canonical Jeju importer", () => {
  it("accepts a versioned CSV, creates deterministic entities and preserves missing values", async () => {
    const inputRows = [
      baseRow({ unit: "entries" }),
      baseRow({ field: "buy_in", value_type: "money", value: "001000000", currency: "vnd", scale: "0", unit: "VND", raw_value: "1,000,000 VND" }),
      baseRow({ entity_type: "festival", event_key: "", field: "festival_name", value_type: "text", value: "APT Jeju 2026", unit: "", raw_value: "APT Jeju 2026" }),
      baseRow({ entity_type: "event", field: "unique_entries", value_type: "missing", value: "", missing_reason: "not_disclosed", claim_kind: "missing", status: "unverified", confidence: "unknown", source_document_key: "", source_type: "", source_url: "", source_reference: "", source_publisher: "", source_title: "", source_revision_key: "", retrieved_at: "", raw_value: "" }),
    ];
    const result = await parseJejuImportCsv(`\uFEFF${toCsv(inputRows)}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.marketKey).toBe("jeju");
    expect(result.value.events).toHaveLength(1);
    expect(result.value.festivals).toHaveLength(1);
    expect(result.value.sourceDocuments).toHaveLength(1);
    expect(result.value.sourceRevisions).toHaveLength(1);
    expect(result.value.claims).toHaveLength(4);
    expect(result.value.claims.find((claim) => claim.field === "buy_in")?.value).toEqual({
      type: "money",
      minorUnits: "1000000",
      currency: "VND",
      scale: 0,
    });
    expect(result.value.claims.find((claim) => claim.field === "unique_entries")?.value).toEqual({
      type: "missing",
      reason: "not_disclosed",
    });
  });

  it("accepts the equivalent JSON envelope without changing the canonical result", async () => {
    const row = baseRow({ field: "event_name", value_type: "text", value: "Main Event", raw_value: "Main Event" });
    const csvResult = await parseJejuImportCsv(toCsv([row]));
    const jsonRow = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "schema_version" && key !== "market_key"));
    const jsonResult = await parseJejuImportJson({ schemaVersion: "v1", marketKey: "jeju", rows: [jsonRow] });
    expect(csvResult.ok).toBe(true);
    expect(jsonResult.ok).toBe(true);
    if (!csvResult.ok || !jsonResult.ok) return;
    expect(jsonResult.value.claims).toEqual(csvResult.value.claims);
    expect(jsonResult.value.events).toEqual(csvResult.value.events);
  });

  it("supports quoted commas, embedded newlines and CRLF without mutating source text", async () => {
    const row = baseRow({ field: "event_name", value_type: "text", value: "Main, Event\nDay 1", source_title: "Results, official", raw_value: "Main, Event\nDay 1" });
    const csv = toCsv([row]);
    const result = await parseJejuImportCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.claims[0].value).toEqual({ type: "text", value: "Main, Event\nDay 1" });
    expect(csv).toContain("Main, Event\nDay 1");
  });

  it("keeps equal-precedence source disagreement as a conflict", async () => {
    const result = await parseJejuImportCsv(toCsv([
      baseRow({ unit: "entries" }),
      baseRow({ unit: "entries", value: "125", raw_value: "125", source_document_key: "trusted-results", source_url: "https://example.com/trusted-results", source_publisher: "Trusted Results" }),
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.claims).toHaveLength(2);
      expect(result.value.conflicts).toHaveLength(1);
      expect(result.value.conflicts[0].field).toBe("entries");
    }
  });

  it("reports field-level errors for wrong market, missing lineage, PII and duplicate identities", async () => {
    const wrongMarket = await parseJejuImportCsv(toCsv([baseRow({ market_key: "las-vegas" })]));
    expect(wrongMarket).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "market_key", code: "UNSUPPORTED_MARKET" })] });

    const noLineage = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", source_document_key: "", source_type: "", source_url: "", source_revision_key: "", retrieved_at: "" })]));
    expect(noLineage).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "source_document_key", code: "SOURCE_MANIFEST_INCOMPLETE" })] });

    const pii = await parseJejuImportCsv(toCsv([baseRow({ field: "player_identifier" })]));
    expect(pii).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "field", code: "FORBIDDEN_PUBLIC_FIELD" })] });

    const duplicate = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries" }), baseRow({ unit: "entries" })]));
    expect(duplicate).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "value", code: "DUPLICATE_CLAIM_IDENTITY" })] });
  });

  it("uses a fail-closed public field registry instead of accepting arbitrary fields", async () => {
    const forbiddenFields = [
      "player_name",
      "phone",
      "email",
      "passport_number",
      "telegram_handle",
      "facebook_handle",
      "player_ref_hash",
      "app_user_id",
      "created_by",
      "club_id",
      "registration_payment",
      "bullet_history",
      "cashier_record",
      "private_decision",
      "actual_entries",
      "harmless_extension",
    ];
    const results = await Promise.all(forbiddenFields.map((field) => parseJejuImportCsv(toCsv([baseRow({ field, unit: "" })]))));
    for (const [index, result] of results.entries()) {
      expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "field" })] });
      expect(["FORBIDDEN_PUBLIC_FIELD", "UNKNOWN_PUBLIC_FIELD"]).toContain(result.ok ? null : result.errors[0].code);
      expect(forbiddenFields[index]).toBeTruthy();
    }

    const validFestival = await parseJejuImportCsv(toCsv([baseRow({
      entity_type: "festival",
      event_key: "",
      field: "festival_name",
      value_type: "text",
      value: "APT Jeju 2026",
      raw_value: "APT Jeju 2026",
      unit: "",
    })]));
    const validEvent = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries" })]));
    expect(validFestival.ok).toBe(true);
    expect(validEvent.ok).toBe(true);
  });

  it("validates field type, entity scope, units, numeric domains and explicit missing values", async () => {
    const cases = [
      [baseRow({ field: "entries", value_type: "text", unit: "" }), "FIELD_VALUE_TYPE_MISMATCH"],
      [baseRow({ field: "event_name", value_type: "money", value: "100", currency: "USD", scale: "0", unit: "USD" }), "FIELD_VALUE_TYPE_MISMATCH"],
      [baseRow({ field: "entries", value: "-1", unit: "entries" }), "NEGATIVE_VALUE_NOT_ALLOWED"],
      [baseRow({ field: "gtd", value_type: "money", value: "-1", currency: "USD", scale: "0", unit: "USD" }), "NEGATIVE_VALUE_NOT_ALLOWED"],
      [baseRow({ entity_type: "festival", event_key: "", field: "entries", unit: "entries" }), "FIELD_ENTITY_TYPE_MISMATCH"],
      [baseRow({ field: "festival_name", value_type: "text", unit: "" }), "FIELD_ENTITY_TYPE_MISMATCH"],
      [baseRow({ field: "entries", unit: "players" }), "INVALID_UNIT"],
      [baseRow({ field: "buy_in", value_type: "money", value: "100", currency: "USDX", scale: "0", unit: "USDX" }), "INVALID_CURRENCY"],
      [baseRow({ field: "staff_fee_rate", value_type: "decimal", value: "1.1", unit: "fraction" }), "RATE_OUT_OF_RANGE"],
      [baseRow({ entity_type: "festival", event_key: "", field: "start_date", value_type: "text", value: "2026-07-13", unit: "" }), "FIELD_VALUE_TYPE_MISMATCH"],
    ] as const;
    const results = await Promise.all(cases.map(([row]) => parseJejuImportCsv(toCsv([row]))));
    results.forEach((result, index) => {
      expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: cases[index][1] })] });
    });

    const missingMoney = await parseJejuImportCsv(toCsv([baseRow({
      field: "gtd",
      value_type: "missing",
      value: "",
      missing_reason: "not_disclosed",
      claim_kind: "missing",
      status: "unverified",
      confidence: "unknown",
      unit: "",
      currency: "",
      scale: "",
      raw_value: "",
    })]));
    expect(missingMoney.ok).toBe(true);
  });

  it("rejects malformed values, malformed CSV and JSON scalar coercion", async () => {
    const invalidMoney = await parseJejuImportCsv(toCsv([baseRow({ value_type: "money", currency: "USD", scale: "2", value: "12.5" })]));
    expect(invalidMoney).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "value", code: "INVALID_INTEGER" })] });

    const malformedCsv = await parseJejuImportCsv(`${JEJU_IMPORT_HEADERS.join(",")}\r\n${'"unterminated'}`);
    expect(malformedCsv).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CSV_UNCLOSED_QUOTE" })] });

    const invalidJson = await parseJejuImportJson({
      schemaVersion: "v1",
      marketKey: "jeju",
      rows: [{ ...Object.fromEntries(Object.entries(baseRow()).filter(([key]) => key !== "schema_version" && key !== "market_key")), value: 120 }],
    } as never);
    expect(invalidJson).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "value", code: "JSON_VALUE_MUST_BE_STRING" })] });
  });

  it("rejects malformed CSV row shapes and line endings without padding or truncating", async () => {
    const row = baseRow({ unit: "entries" });
    const extraCell = await parseJejuImportCsv(`${toCsv([row])},hidden`);
    expect(extraCell).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CSV_COLUMN_COUNT_MISMATCH" })] });

    const shortValues = JEJU_IMPORT_HEADERS.map((header) => row[header] ?? "").slice(0, -1);
    const shortRow = await parseJejuImportCsv(`${JEJU_IMPORT_HEADERS.join(",")}\r\n${shortValues.join(",")}`);
    expect(shortRow).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CSV_COLUMN_COUNT_MISMATCH" })] });

    const malformedLineEnd = await parseJejuImportCsv(toCsv([row]).replace(/\r\n/g, "\r"));
    expect(malformedLineEnd).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CSV_MALFORMED_LINE_END" })] });

    const quotedAfterClose = await parseJejuImportCsv(`${JEJU_IMPORT_HEADERS.join(",")}\r\n${JEJU_IMPORT_HEADERS.map((header) => header === "value" ? '"Main"suffix' : csvCell(row[header] ?? "")).join(",")}`);
    expect(quotedAfterClose).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CSV_AFTER_QUOTE" })] });
  });

  it("keeps JSON envelope ownership fail-closed", async () => {
    const row = Object.fromEntries(Object.entries(baseRow({ unit: "entries" })).filter(([key]) => key !== "schema_version" && key !== "market_key"));
    const extraEnvelope = await parseJejuImportJson({ schemaVersion: "v1", marketKey: "jeju", rows: [row], extra: true } as never);
    expect(extraEnvelope).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "UNKNOWN_JSON_ENVELOPE_FIELD", field: "extra" })] });

    const rowSchemaInjection = await parseJejuImportJson({
      schemaVersion: "v1",
      marketKey: "jeju",
      rows: [{ ...row, schema_version: "v1" }],
    } as never);
    expect(rowSchemaInjection).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "JSON_ROW_ENVELOPE_FIELD", field: "schema_version" })] });

    const rowMarketInjection = await parseJejuImportJson({
      schemaVersion: "v1",
      marketKey: "jeju",
      rows: [{ ...row, market_key: "las-vegas" }],
    } as never);
    expect(rowMarketInjection).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "JSON_ROW_ENVELOPE_FIELD", field: "market_key" })] });

    const unknownRowField = await parseJejuImportJson({
      schemaVersion: "v1",
      marketKey: "jeju",
      rows: [{ ...row, unregistered: "value" }],
    } as never);
    expect(unknownRowField).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "UNKNOWN_FIELD", field: "unregistered" })] });
  });

  it("rejects incomplete supersession and preserves input objects", async () => {
    const row = baseRow({ unit: "entries", supersedes_claim_id: "missing-claim" });
    const before = structuredClone(row);
    const result = await parseJejuImportCsv(toCsv([row]));
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "supersedes_claim_id", code: "SUPERSESSION_TARGET_MISSING" })] });
    expect(row).toEqual(before);
  });

  it("requires complete source manifests, compatible status, and normalized metadata", async () => {
    const sourceLessOfficial = await parseJejuImportCsv(toCsv([baseRow({
      field: "gtd",
      value_type: "missing",
      value: "",
      missing_reason: "not_found",
      claim_kind: "missing",
      status: "official_confirmed",
      confidence: "high",
      source_document_key: "",
      source_type: "",
      source_url: "",
      source_reference: "",
      source_publisher: "",
      source_title: "",
      source_revision_key: "",
      retrieved_at: "",
      unit: "",
      raw_value: "",
    })]));
    expect(sourceLessOfficial).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "SOURCELESS_MISSING_NOT_ALLOWED" })] });

    const sourcedMissing = await parseJejuImportCsv(toCsv([baseRow({
      field: "gtd",
      value_type: "missing",
      value: "",
      missing_reason: "not_found",
      claim_kind: "missing",
      status: "unverified",
      confidence: "unknown",
      source_reference: " page 1 ",
      unit: "",
      raw_value: "",
    })]));
    expect(sourcedMissing.ok).toBe(true);

    const noLocator = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", source_url: "", source_reference: "" })]));
    expect(noLocator).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "SOURCE_MANIFEST_INCOMPLETE" })] });

    const trustedOfficial = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", source_type: "trusted_report" })]));
    expect(trustedOfficial).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "OFFICIAL_STATUS_SOURCE_TYPE_MISMATCH" })] });

    const crossVerified = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", status: "cross_verified" })]));
    expect(crossVerified).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CROSS_VERIFIED_IMPORT_NOT_ALLOWED" })] });

    const rawValue = " 00120 ";
    const normalized = await parseJejuImportCsv(toCsv([baseRow({
      unit: " entries ",
      raw_value: rawValue,
      source_publisher: " APT\u0301 ",
      source_title: " Jeju results ",
      source_reference: " Page 1 ",
      notes: " curator note ",
    })]));
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.sourceDocuments[0].publisher).toBe("APT\u0301".normalize("NFC"));
      expect(normalized.value.sourceDocuments[0].title).toBe("Jeju results");
      expect(normalized.value.claims[0].rawValue).toBe(rawValue);
      expect(normalized.value.claims[0].unit).toBe("entries");
      expect(normalized.value.claims[0].notes).toBe("curator note");
    }
  });

  it("validates source revision supersession, cycles, scope, and deterministic tips", async () => {
    const firstRow = baseRow({ unit: "entries", source_revision_key: "revision-1" });
    const firstOnly = await parseJejuImportCsv(toCsv([firstRow]));
    expect(firstOnly.ok).toBe(true);
    if (!firstOnly.ok) return;
    const firstRevisionId = firstOnly.value.sourceRevisions[0].id;

    const secondRow = baseRow({
      unit: "entries",
      value: "121",
      raw_value: "121",
      source_revision_key: "revision-2",
      retrieved_at: "2026-07-14T09:30:00Z",
      source_supersedes_revision_id: firstRevisionId,
    });
    const superseded = await parseJejuImportCsv(toCsv([firstRow, secondRow]));
    expect(superseded.ok).toBe(true);
    if (superseded.ok) {
      expect(resolveCurrentSourceRevisionTips([...superseded.value.sourceRevisions]).map((revision) => revision.id)).toEqual([superseded.value.sourceRevisions.find((revision) => revision.revisionKey === "revision-2")?.id]);
    }

    const secondOnly = await parseJejuImportCsv(toCsv([{ ...secondRow, source_supersedes_revision_id: "" }]));
    expect(secondOnly.ok).toBe(true);
    if (!secondOnly.ok) return;
    const secondRevisionId = secondOnly.value.sourceRevisions[0].id;

    const self = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", source_revision_key: "revision-1", source_supersedes_revision_id: firstRevisionId })]));
    expect(self).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "SOURCE_REVISION_SELF_SUPERSESSION" })] });

    const cycle = await parseJejuImportCsv(toCsv([
      baseRow({ unit: "entries", source_revision_key: "revision-1", source_supersedes_revision_id: secondRevisionId }),
      baseRow({ unit: "entries", value: "121", raw_value: "121", source_revision_key: "revision-2", retrieved_at: "2026-07-14T09:30:00Z", source_supersedes_revision_id: firstRevisionId }),
    ]));
    expect(cycle).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "SOURCE_REVISION_CYCLE" })] });

    const otherDocument = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", source_document_key: "other-document", source_url: "https://example.com/other", source_revision_key: "revision-1" })]));
    expect(otherDocument.ok).toBe(true);
    if (!otherDocument.ok) return;
    const scope = await parseJejuImportCsv(toCsv([
      baseRow({ unit: "entries", source_revision_key: "revision-1" }),
      baseRow({ unit: "entries", source_document_key: "other-document", source_url: "https://example.com/other", source_revision_key: "revision-2", retrieved_at: "2026-07-14T09:30:00Z", source_supersedes_revision_id: firstRevisionId }),
    ]));
    expect(scope).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "SOURCE_REVISION_SCOPE_MISMATCH" })] });

    const missingTarget = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries", source_supersedes_revision_id: "series-market:v1:source-revision:missing" })]));
    expect(missingTarget).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "SOURCE_REVISION_TARGET_MISSING" })] });
    expect(otherDocument.value.sourceRevisions).toHaveLength(1);
  });

  it("keeps duplicate evidence, order-independent conflicts, precedence history, and superseded claims deterministic", async () => {
    const sameValue = await parseJejuImportCsv(toCsv([
      baseRow({ unit: "entries" }),
      baseRow({ unit: "entries", source_document_key: "second-results", source_url: "https://example.com/second-results", source_publisher: "Second Results" }),
    ]));
    expect(sameValue.ok).toBe(true);
    if (sameValue.ok) {
      expect(sameValue.value.claims).toHaveLength(2);
      expect(sameValue.value.conflicts).toHaveLength(0);
    }

    const conflictRows = [
      baseRow({ unit: "entries", status: "unverified", confidence: "medium", source_type: "trusted_report", source_document_key: "report-a", source_url: "https://example.com/report-a", source_publisher: "Report A" }),
      baseRow({ unit: "entries", value: "125", raw_value: "125", status: "unverified", confidence: "medium", source_type: "trusted_report", source_document_key: "report-b", source_url: "https://example.com/report-b", source_publisher: "Report B" }),
    ];
    const forward = await parseJejuImportCsv(toCsv(conflictRows));
    const reverse = await parseJejuImportCsv(toCsv([...conflictRows].reverse()));
    expect(forward.ok).toBe(true);
    expect(reverse.ok).toBe(true);
    if (forward.ok && reverse.ok) {
      expect(reverse.value.claims.map((claim) => claim.id)).toEqual(forward.value.claims.map((claim) => claim.id));
      expect(reverse.value.conflicts).toEqual(forward.value.conflicts);
    }

    const lowerPrecedence = baseRow({ unit: "entries", status: "unverified", confidence: "medium", source_type: "trusted_report", source_document_key: "lower-report", source_url: "https://example.com/lower-report", source_publisher: "Lower Report" });
    const higherPrecedence = baseRow({ unit: "entries", status: "official_confirmed", confidence: "high", source_type: "official_result", source_document_key: "higher-results", source_url: "https://example.com/higher-results", source_publisher: "Higher Results" });
    const precedence = await parseJejuImportCsv(toCsv([lowerPrecedence, higherPrecedence]));
    expect(precedence.ok).toBe(true);
    if (precedence.ok) {
      expect(precedence.value.claims).toHaveLength(2);
      const resolution = resolveSourceClaims(precedence.value.claims);
      expect(resolution.state).toBe("resolved");
      if (resolution.state === "resolved") expect(resolution.claim.status).toBe("official_confirmed");
    }

    const first = await parseJejuImportCsv(toCsv([baseRow({ unit: "entries" })]));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstClaimId = first.value.claims[0].id;
    const superseded = await parseJejuImportCsv(toCsv([
      baseRow({ unit: "entries" }),
      baseRow({ unit: "entries", value: "121", raw_value: "121", source_revision_key: "retrieval-2", retrieved_at: "2026-07-14T09:30:00Z", supersedes_claim_id: firstClaimId }),
    ]));
    expect(superseded.ok).toBe(true);
    if (superseded.ok) {
      expect(superseded.value.claims).toHaveLength(2);
      expect(superseded.value.claims.some((claim) => claim.id === firstClaimId)).toBe(true);
      const resolution = resolveSourceClaims(superseded.value.claims);
      expect(resolution.state).toBe("resolved");
      if (resolution.state === "resolved") expect(resolution.claim.value).toEqual({ type: "integer", value: "121" });
    }
  });
});
