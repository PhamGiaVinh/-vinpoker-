// CUSTOM payout import — parse a club's payout sheet (CSV / Excel) into the CUSTOM builder rows.
// The file may list PERCENTAGES (Σ≈100) or MONEY amounts per rank; we auto-detect and always
// emit basis-point-exact percentages (Σ = 100% = 10000bp) so the CUSTOM backend accepts them.
//
// The heavy CSV/XLSX parsers are DYNAMIC-imported inside parseFileToCustomRows so they (a) never
// bloat the main bundle and (b) keep the pure logic below dependency-free + fast to unit-test.

export interface ImportedCustomRows {
  /** position 1..N + percent (e.g. 60 = 60%); guaranteed Σ percent_bp = 10000 (after rank-1 residual). */
  rows: { position: number; percent: number }[];
  /** how the file was read: as percentages, or money amounts converted to %. */
  mode: "percent" | "amount";
  /** human-readable Vietnamese notes the UI can surface (detected mode, normalisation, caveats). */
  warnings: string[];
}

/**
 * Parse one messy numeric token into a number (or null). Tolerates %, đ/VND, spaces, and BOTH
 * Vietnamese (1.234.567,89) and English (1,234,567.89) grouping. Heuristic: the LAST of `.`/`,`
 * is the decimal separator when both appear; a lone separator with a non-3-digit tail is a decimal,
 * otherwise it's a thousands group that gets stripped.
 */
export function parseNumberToken(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[%\s ]/g, "").replace(/vn[dđ]|đ/gi, "");
  s = s.replace(/[^0-9.,-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return null;
  const hasDot = s.includes("."), hasComma = s.includes(",");
  if (hasDot && hasComma) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", "."); // VN: , is decimal
    else s = s.replace(/,/g, ""); // EN: , is thousands
  } else if (hasComma) {
    const p = s.split(",");
    s = (p.length === 2 && p[1].length !== 3) ? p[0] + "." + p[1] : s.replace(/,/g, "");
  } else if (hasDot) {
    const p = s.split(".");
    if (!(p.length === 2 && p[1].length !== 3)) s = s.replace(/\./g, ""); // thousands → strip
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a 2-D grid of cells (rows of strings/numbers, as papaparse/xlsx produce) into CUSTOM rows.
 * Pure + deterministic. Throws Error("FILE_NO_NUMBERS" | "FILE_SUM_ZERO" | "FILE_EMPTY") on bad input.
 */
export function parseCellsToCustomRows(cells: unknown[][]): ImportedCustomRows {
  const warnings: string[] = [];
  if (!Array.isArray(cells) || cells.length === 0) throw new Error("FILE_EMPTY");

  // Keep only rows with ≥1 numeric cell (drops header/blank/label rows automatically).
  const numRows = cells
    .map((row) => (Array.isArray(row) ? row : [row]).map(parseNumberToken))
    .map((parsed, i) => ({ parsed, nums: parsed.map((v, c) => ({ c, v })).filter((x) => x.v != null) as { c: number; v: number }[], i }))
    .filter((r) => r.nums.length > 0);
  if (numRows.length === 0) throw new Error("FILE_NO_NUMBERS");
  if (numRows.length < cells.length) warnings.push("Đã bỏ qua dòng tiêu đề/không phải số.");

  // Which columns carry numbers, and is one of them a position column (small distinct ints 1..~N)?
  const colSet = new Set<number>();
  numRows.forEach((r) => r.nums.forEach((x) => colSet.add(x.c)));
  const cols = [...colSet].sort((a, b) => a - b);
  let posCol: number | null = null;
  let valCol: number;
  if (cols.length >= 2) {
    for (const c of cols) {
      const vals = numRows.map((r) => r.nums.find((x) => x.c === c)?.v).filter((v): v is number => v != null);
      const looksLikePos = vals.length === numRows.length
        && vals.every((v) => Number.isInteger(v) && v >= 1 && v <= numRows.length * 2)
        && new Set(vals).size === vals.length;
      if (looksLikePos) { posCol = c; break; }
    }
    valCol = cols.filter((c) => c !== posCol).pop() ?? cols[cols.length - 1];
    if (valCol === posCol) posCol = null;
  } else {
    valCol = cols[0];
  }

  // Build {position, value}, ordered by the position column when present, else by row order.
  const entries = numRows
    .map((r, idx) => ({
      position: posCol != null ? (r.nums.find((x) => x.c === posCol)?.v ?? idx + 1) : idx + 1,
      value: r.nums.find((x) => x.c === valCol)?.v ?? 0,
    }))
    .sort((a, b) => a.position - b.position);

  let values = entries.map((e) => e.value);
  // Drop a trailing "total" row (value ≈ sum of the rows above it) — common in exported sheets.
  if (values.length >= 3) {
    const head = values.slice(0, -1).reduce((s, v) => s + v, 0);
    const last = values[values.length - 1];
    if (head > 0 && Math.abs(last - head) / head < 0.02) { values = values.slice(0, -1); warnings.push("Đã bỏ dòng tổng cộng ở cuối."); }
  }

  const sum = values.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) throw new Error("FILE_SUM_ZERO");
  if (values.length > 1000) throw new Error("FILE_TOO_MANY_ROWS");

  const maxV = Math.max(...values);
  const mode: "percent" | "amount" = maxV <= 100 && Math.abs(sum - 100) <= 1 ? "percent" : "amount";
  let bp: number[];
  if (mode === "percent") { bp = values.map((v) => Math.round(v * 100)); warnings.push("Đọc theo phần trăm (%)."); }
  else { bp = values.map((v) => Math.floor((v / sum) * 10000)); warnings.push("Đọc theo số tiền — đã tự quy ra %."); }

  const resid = 10000 - bp.reduce((s, v) => s + v, 0);
  if (resid !== 0 && bp.length > 0) { bp[0] += resid; warnings.push("Đã chuẩn hoá để Σ = 100%."); }
  if (bp.some((v) => v <= 0)) warnings.push("Cảnh báo: có hạng = 0% — hãy kiểm tra lại file.");
  for (let i = 1; i < bp.length; i++) if (bp[i] > bp[i - 1]) { warnings.push("Cảnh báo: % không giảm dần theo hạng — hãy kiểm tra/sửa lại."); break; }

  return { rows: bp.map((v, i) => ({ position: i + 1, percent: v / 100 })), mode, warnings };
}

/** Read a File (CSV or XLSX/XLS) into CUSTOM rows. Heavy parsers loaded on demand. */
export async function parseFileToCustomRows(file: File): Promise<ImportedCustomRows> {
  const name = (file.name || "").toLowerCase();
  const isCsv = name.endsWith(".csv") || /csv|text\/plain/.test(file.type || "");
  let cells: unknown[][];
  if (isCsv) {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
    cells = parsed.data as unknown[][];
  } else {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    cells = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][];
  }
  return parseCellsToCustomRows(cells);
}
