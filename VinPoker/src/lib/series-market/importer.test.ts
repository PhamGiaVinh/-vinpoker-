import { describe, expect, it } from "vitest";
import {
  JEJU_IMPORT_HEADERS,
  JEJU_IMPORT_SCHEMA_VERSION,
  JEJU_MARKET_KEY,
  parseJejuImportCsv,
  parseJejuImportJson,
  type JejuImportHeader,
} from "./importer";

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
  unit: "entries",
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
      baseRow(),
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
      baseRow(),
      baseRow({ value: "125", raw_value: "125", source_document_key: "trusted-results", source_url: "https://example.com/trusted-results", source_publisher: "Trusted Results" }),
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

    const noLineage = await parseJejuImportCsv(toCsv([baseRow({ source_document_key: "", source_type: "", source_url: "", source_revision_key: "", retrieved_at: "" })]));
    expect(noLineage).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "source_document_key", code: "SOURCE_MANIFEST_INCOMPLETE" })] });

    const pii = await parseJejuImportCsv(toCsv([baseRow({ field: "player_identifier" })]));
    expect(pii).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "field", code: "FORBIDDEN_PUBLIC_FIELD" })] });

    const duplicate = await parseJejuImportCsv(toCsv([baseRow(), baseRow()]));
    expect(duplicate).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "value", code: "DUPLICATE_CLAIM_IDENTITY" })] });
  });

  it("rejects malformed values, malformed CSV and JSON scalar coercion", async () => {
    const invalidMoney = await parseJejuImportCsv(toCsv([baseRow({ value_type: "money", currency: "USD", scale: "2", value: "12.5" })]));
    expect(invalidMoney).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "value", code: "INVALID_INTEGER" })] });

    const malformedCsv = await parseJejuImportCsv(`${JEJU_IMPORT_HEADERS.join(",")}\r\n${'"unterminated'}`);
    expect(malformedCsv).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "CSV_UNCLOSED_QUOTE" })] });

    const invalidJson = await parseJejuImportJson({
      schemaVersion: "v1",
      marketKey: "jeju",
      rows: [{ ...baseRow(), value: 120 }],
    } as never);
    expect(invalidJson).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "value", code: "JSON_VALUE_MUST_BE_STRING" })] });
  });

  it("rejects incomplete supersession and preserves input objects", async () => {
    const row = baseRow({ supersedes_claim_id: "missing-claim" });
    const before = structuredClone(row);
    const result = await parseJejuImportCsv(toCsv([row]));
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ field: "supersedes_claim_id", code: "SUPERSESSION_TARGET_MISSING" })] });
    expect(row).toEqual(before);
  });
});
