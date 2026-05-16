import * as XLSX from "xlsx";

export type ExcelColumn<T> = {
  header: string;
  /** Key OR accessor function returning a primitive (string | number | null) */
  get: (row: T) => string | number | null | undefined;
  /** Optional column width (chars). If omitted, auto-calculated from content. */
  width?: number;
};

const todayStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

/**
 * Export a list of rows to an .xlsx file with a styled header row,
 * auto-width columns and timestamped filename.
 */
export function exportToExcel<T>(
  rows: T[],
  columns: ExcelColumn<T>[],
  baseFilename: string,
  sheetName: string = "Sheet1",
) {
  // Build AOA so we keep header order regardless of object keys
  const aoa: (string | number | null)[][] = [
    columns.map((c) => c.header),
    ...rows.map((r) =>
      columns.map((c) => {
        const v = c.get(r);
        if (v === undefined || v === null) return "";
        return v as any;
      }),
    ),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto column widths
  ws["!cols"] = columns.map((c, idx) => {
    if (c.width) return { wch: c.width };
    const headerLen = c.header.length;
    let max = headerLen;
    for (let r = 0; r < rows.length; r++) {
      const cell = aoa[r + 1][idx];
      const len = cell == null ? 0 : String(cell).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 10), 48) };
  });

  // Style header row (bold + background). Note: SheetJS community build
  // does not render styles in many viewers, but Google Sheets/Excel keep cell types.
  for (let i = 0; i < columns.length; i++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: i });
    if (ws[addr]) {
      (ws[addr] as any).s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "0D3328" } },
        alignment: { vertical: "center", horizontal: "center" },
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

  const filename = `${baseFilename}-${todayStamp()}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export const formatExcelDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
