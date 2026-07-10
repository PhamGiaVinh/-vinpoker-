// Series Intelligence — CSV import (client-side, read-only, PURE).
//
// Parses a user-uploaded CSV of test/what-if events into the SAME `SeriesEvent[]` the live
// native path produces, so the WHOLE BI pipeline (economics / readiness / risk / scenario /
// GTD overlay) runs on it unchanged. The parser is honest: a missing or unreadable cell is
// left null and reported (never fabricated), exactly like the native adapter's `missingFields`.
//
// SAFETY: this never touches the database. The parsed events live only in the browser session
// (source: 'csv'); nothing is uploaded, written, or persisted. Money/entry values are read,
// never computed here.

import type { SeriesEvent } from "./nativeData";

/** Documented columns the dashboard understands (header names, case-insensitive). */
export const CSV_REQUIRED_COLUMNS = [
  "event_name",
  "event_date",
  "buy_in",
  "fee",
  "gtd",
  "prize_pool_actual",
  "total_entries",
  "unique_entries",
  "reentries",
] as const;

/** Optional columns: event_id (internal reference), service_fee (reported, never summed), capacity (TP6). */
export const CSV_OPTIONAL_COLUMNS = ["event_id", "service_fee", "service_fee_amount", "capacity"] as const;

export interface CsvParseError {
  row: number; // 1-based data row number (header excluded); 0 = file-level
  column?: string;
  message: string;
}

export interface CsvParseResult {
  events: SeriesEvent[];
  errors: CsvParseError[];
  totalRows: number; // data rows seen (excludes header + blank lines)
}

/** A ready-to-edit sample CSV (header + 3 example rows), used by the "Tải mẫu CSV" button. */
export const SAMPLE_CSV_TEXT = [
  CSV_REQUIRED_COLUMNS.join(","),
  "Sunday Major,2026-06-15,1000000,100000,300000000,250000000,300,220,80",
  "Friday Highroller,2026-06-20,5000000,500000,1000000000,,120,100,20",
  "Daily Deepstack,2026-06-21,500000,50000,,,90,90,0",
  "",
].join("\n");

/**
 * Parse a VND-style integer. '.' / ',' / spaces are treated as thousands separators (VND has no
 * cents in this domain), so "1.000.000" and "1,000,000" → 1000000. Empty → null. Unreadable → null.
 */
export function parseVnNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim();
  if (cleaned === "") return null;
  const digits = cleaned.replace(/[^\d-]/g, ""); // keep only digits + leading minus
  if (digits === "" || digits === "-") return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a date to `yyyy-mm-dd`. Accepts ISO (`yyyy-mm-dd...`) and `dd/mm/yyyy` / `dd-mm-yyyy`.
 * Validates ranges without constructing a Date (deterministic, timezone-free). Empty/invalid → null.
 */
export function parseEventDate(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return inRange(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, "0");
    const mm = dmy[2].padStart(2, "0");
    return inRange(dmy[3], mm, dd) ? `${dmy[3]}-${mm}-${dd}` : null;
  }
  return null;
}

function inRange(yyyy: string, mm: string, dd: string): boolean {
  const y = Number(yyyy);
  const mo = Number(mm);
  const d = Number(dd);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999;
}

/**
 * RFC4180-ish tokenizer: handles quoted fields, escaped quotes (""), embedded commas/newlines,
 * a leading BOM, and CRLF or LF line endings. Returns rows of raw string fields.
 */
function tokenizeCsv(text: string): string[][] {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // strip BOM

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let started = false; // any char on the current logical row?

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      started = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
      started = true;
    } else if (c === "\r") {
      // swallow CR (CRLF handled by the LF branch)
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      started = false;
    } else {
      field += c;
      started = true;
    }
  }
  if (started || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A header cell → its canonical column key (lowercased, trimmed, spaces→underscore). */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Parse CSV text → SeriesEvent[] + per-row errors. Honest mapping:
 *  - A documented column absent from the header ⇒ that field is null (reported missing) for all rows.
 *  - A present-but-unreadable numeric/date cell ⇒ null + a recorded error (never guessed).
 *  - Fully blank lines are skipped. event_id defaults to `csv-<n>` when not supplied.
 */
export function parseSeriesCsv(text: string): CsvParseResult {
  const errors: CsvParseError[] = [];
  const rows = tokenizeCsv(text).filter((r) => r.some((c) => c.trim() !== "")); // drop blank lines

  if (rows.length === 0) {
    return { events: [], errors: [{ row: 0, message: "File rỗng — không có dòng nào." }], totalRows: 0 };
  }

  const header = rows[0].map(normalizeHeader);
  const index: Record<string, number> = {};
  header.forEach((h, i) => {
    if (!(h in index)) index[h] = i; // first wins on duplicate headers
  });

  const known = new Set<string>([...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS]);
  const recognized = header.filter((h) => known.has(h));
  if (recognized.length === 0) {
    return {
      events: [],
      errors: [{ row: 0, message: "Không nhận diện được cột nào hợp lệ. Hãy tải mẫu CSV để xem đúng định dạng." }],
      totalRows: 0,
    };
  }

  const cellAt = (cells: string[], col: string): string | undefined => {
    const i = index[col];
    return i === undefined ? undefined : cells[i];
  };
  const num = (cells: string[], col: string, rowNo: number): number | null => {
    const raw = cellAt(cells, col);
    if (raw === undefined) return null; // column not in file → missing (not an error)
    const parsed = parseVnNumber(raw);
    if (raw.trim() !== "" && parsed === null) {
      errors.push({ row: rowNo, column: col, message: `Không đọc được số: "${raw.trim()}"` });
    }
    return parsed;
  };

  const events: SeriesEvent[] = [];
  const dataRows = rows.slice(1);

  dataRows.forEach((cells, di) => {
    const rowNo = di + 1; // 1-based data row

    const rawName = cellAt(cells, "event_name");
    const event_name = rawName && rawName.trim() !== "" ? rawName.trim() : null;

    const rawDate = cellAt(cells, "event_date");
    const event_date = parseEventDate(rawDate);
    if (rawDate !== undefined && rawDate.trim() !== "" && event_date === null) {
      errors.push({ row: rowNo, column: "event_date", message: `Ngày không hợp lệ: "${rawDate.trim()}"` });
    }

    const buy_in = num(cells, "buy_in", rowNo);
    const fee = num(cells, "fee", rowNo);
    const serviceFeeAmount = num(cells, "service_fee", rowNo) ?? num(cells, "service_fee_amount", rowNo);
    const gtd = num(cells, "gtd", rowNo);
    const prize_pool_actual = num(cells, "prize_pool_actual", rowNo);
    const total_entries = num(cells, "total_entries", rowNo);
    const unique_entries = num(cells, "unique_entries", rowNo);
    const reentries = num(cells, "reentries", rowNo);
    const capacity = num(cells, "capacity", rowNo); // TP6 — optional; absent ⇒ null (no censoring effect)

    const rawId = cellAt(cells, "event_id");
    const event_id = rawId && rawId.trim() !== "" ? rawId.trim() : `csv-${rowNo}`;

    const missingFields: string[] = [];
    const need = (field: string, value: unknown): void => {
      if (value === null || value === undefined) missingFields.push(field);
    };
    need("event_name", event_name);
    need("event_date", event_date);
    need("buy_in", buy_in);
    need("fee", fee);
    need("prize_pool_actual", prize_pool_actual);
    need("total_entries", total_entries);
    need("unique_entries", unique_entries);
    need("reentries", reentries);
    if (gtd === null) missingFields.push("gtd");

    events.push({
      event_id,
      event_name,
      event_date,
      buy_in,
      fee,
      serviceFeeAmount,
      gtd,
      prize_pool_actual,
      total_entries,
      unique_entries,
      reentries,
      capacity,
      source: "csv",
      clubId: "csv-test",
      missingFields,
    });
  });

  return { events, errors, totalRows: dataRows.length };
}
