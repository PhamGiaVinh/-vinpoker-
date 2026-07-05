// ═══════════════════════════════════════════════════════════════════════════════
// Bulk dealer import — read a spreadsheet (xlsx/xls/csv) into plain text for Gemini
// ═══════════════════════════════════════════════════════════════════════════════
// Owner wants "chỉ lấy tên" from messy Excel files. Strategy: parse the sheet
// client-side (reuse the on-demand `xlsx` pattern already in customPayoutImport.ts),
// drop obviously-PII / numeric-heavy cells (phone, CCCD/ID, dates, money — P1-1),
// then hand the remaining text to the Gemini edge fn which does the final
// name-only extraction. No network here; pure/testable except the File read.

/** P0-2 hard caps applied while dumping a spreadsheet to text. */
export const MAX_SPREADSHEET_ROWS = 5000;
export const MAX_DUMP_CHARS = 120_000;

export interface SpreadsheetDump {
  text: string;
  rowCount: number;
  /** true if the sheet was cut off by a row/char cap. */
  truncated: boolean;
}

/**
 * Keep a cell only if it looks like human text (a name), not PII/numbers.
 * Drops: phone numbers, 9–12 digit IDs (CCCD/CMND), dates, money — anything where
 * digits dominate. Keeps cells with ≥2 letters and more letters than digits.
 * Uses Unicode letter class so Vietnamese diacritics count as letters.
 */
export function isNameLikeCell(raw: unknown): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  const digits = (t.match(/\d/g) ?? []).length;
  if (letters < 2) return false; // "01", "123456789", "-" → out
  if (digits > letters) return false; // numeric-heavy (phone/id/money/date) → out
  return true;
}

/**
 * Pure: turn a 2-D grid of cells into a filtered, capped text dump.
 * One line per non-empty row; only name-like cells kept, joined by " | ".
 */
export function cellsToFilteredText(cells: unknown[][]): SpreadsheetDump {
  const lines: string[] = [];
  let truncated = false;
  let chars = 0;
  let rowCount = 0;

  for (const row of cells) {
    if (rowCount >= MAX_SPREADSHEET_ROWS) {
      truncated = true;
      break;
    }
    const kept = (Array.isArray(row) ? row : []).filter(isNameLikeCell).map((c) => String(c).trim());
    if (kept.length === 0) continue;
    const line = kept.join(" | ");
    if (chars + line.length + 1 > MAX_DUMP_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    chars += line.length + 1;
    rowCount++;
  }

  return { text: lines.join("\n"), rowCount, truncated };
}

/**
 * Read a browser File (.xlsx/.xls/.csv) → filtered text dump across ALL sheets.
 * Heavy parsers loaded on demand (same as customPayoutImport.ts) so they don't
 * bloat the main bundle. Throws only on a genuinely unreadable file.
 */
export async function spreadsheetFileToText(file: File): Promise<SpreadsheetDump> {
  const name = (file.name || "").toLowerCase();
  const isCsv = name.endsWith(".csv") || /csv|text\/plain/.test(file.type || "");

  let allCells: unknown[][] = [];
  if (isCsv) {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    allCells = parsed.data as unknown[][];
  } else {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
      allCells = allCells.concat(rows);
    }
  }

  return cellsToFilteredText(allCells);
}
