// ═══════════════════════════════════════════════════════════════════════════════
// Dealer Shift Planner V2 — weekly schedule → PNG ("xuất ảnh tuần")
// ═══════════════════════════════════════════════════════════════════════════════
// Owner request 2026-07-02: after the week is scheduled, export ONE image with
// the whole week as a grid (rows = shift windows, columns = Mon..Sun, cells =
// dealer names) "để thống kê nhìn cho dễ". Same light-theme pure-SVG → canvas
// approach as scheduleImage.ts (Telegram-friendly, no deps, canvas untainted).

import { svgToPngDataUrl } from "./scheduleImage";

export interface WeeklyImageCell {
  /** Dealer names in this template on this day. */
  names: string[];
}
export interface WeeklyImageRow {
  label: string; // "08–16"
  window: string; // "08:00 – 16:00"
  /** One cell per day, aligned with `days`. */
  cells: WeeklyImageCell[];
}
export interface WeeklyImageInput {
  title: string; // "Lịch dealer · Tuần 29/06 – 05/07"
  subtitle?: string; // "Hanoi Royal Poker · 68 ca · 544 giờ"
  /** Column headers, e.g. ["T2 29/06", ..., "CN 05/07"]. */
  days: string[];
  rows: WeeklyImageRow[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PAD = 24;
const HEADER_H = 64;
const LABEL_W = 96;
const DAY_W = 128;
const HEAD_ROW_H = 30;
const LINE_H = 17;
const CELL_PAD_Y = 8;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Build a light-theme weekly grid SVG. Pure — testable without a browser. */
export function buildWeeklyScheduleSvg(input: WeeklyImageInput): { svg: string; width: number; height: number } {
  const cols = input.days.length;
  const width = PAD * 2 + LABEL_W + DAY_W * cols;
  const blocks: string[] = [];
  let y = HEADER_H + PAD;

  // Column header row
  blocks.push(
    `<rect x="${PAD}" y="${y}" width="${LABEL_W + DAY_W * cols}" height="${HEAD_ROW_H}" fill="#eef2f7"/>` +
      `<text x="${PAD + 10}" y="${y + 20}" font-family="${FONT}" font-size="12" font-weight="700" fill="#0f172a">Ca</text>` +
      input.days
        .map(
          (d, i) =>
            `<text x="${PAD + LABEL_W + DAY_W * i + DAY_W / 2}" y="${y + 20}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#0f172a">${esc(d)}</text>`
        )
        .join("")
  );
  y += HEAD_ROW_H;

  const totals = new Array<number>(cols).fill(0);
  for (const row of input.rows) {
    const maxLines = Math.max(1, ...row.cells.map((c) => c.names.length));
    const rowH = CELL_PAD_Y * 2 + maxLines * LINE_H;
    blocks.push(
      `<rect x="${PAD}" y="${y}" width="${LABEL_W}" height="${rowH}" fill="#f8fafc"/>` +
        `<text x="${PAD + 10}" y="${y + 20}" font-family="${FONT}" font-size="13" font-weight="700" fill="#0f172a">${esc(row.label)}</text>` +
        `<text x="${PAD + 10}" y="${y + 36 <= y + rowH - 6 ? y + 36 : y + rowH - 6}" font-family="${FONT}" font-size="9.5" fill="#64748b">${esc(row.window)}</text>`
    );
    row.cells.forEach((cell, i) => {
      totals[i] += cell.names.length;
      const cx = PAD + LABEL_W + DAY_W * i;
      cell.names.forEach((n, li) => {
        blocks.push(
          `<text x="${cx + DAY_W / 2}" y="${y + CELL_PAD_Y + LINE_H * (li + 1) - 4}" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="#0f172a">${esc(n)}</text>`
        );
      });
      if (cell.names.length === 0) {
        blocks.push(
          `<text x="${cx + DAY_W / 2}" y="${y + CELL_PAD_Y + LINE_H - 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-style="italic" fill="#cbd5e1">—</text>`
        );
      }
      blocks.push(`<rect x="${cx}" y="${y}" width="${DAY_W}" height="${rowH}" fill="none" stroke="#e2e8f0"/>`);
    });
    blocks.push(`<rect x="${PAD}" y="${y}" width="${LABEL_W}" height="${rowH}" fill="none" stroke="#e2e8f0"/>`);
    y += rowH;
  }

  // Totals row
  blocks.push(
    `<rect x="${PAD}" y="${y}" width="${LABEL_W + DAY_W * cols}" height="${HEAD_ROW_H}" fill="#eef2f7"/>` +
      `<text x="${PAD + 10}" y="${y + 20}" font-family="${FONT}" font-size="12" font-weight="700" fill="#0f172a">Tổng</text>` +
      totals
        .map(
          (t, i) =>
            `<text x="${PAD + LABEL_W + DAY_W * i + DAY_W / 2}" y="${y + 20}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#334155">${t} ca</text>`
        )
        .join("")
  );
  y += HEAD_ROW_H;

  const height = y + PAD;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
    `<text x="${PAD}" y="${PAD + 22}" font-family="${FONT}" font-size="22" font-weight="800" fill="#0f172a">${esc(input.title)}</text>` +
    (input.subtitle
      ? `<text x="${PAD}" y="${PAD + 44}" font-family="${FONT}" font-size="13" fill="#64748b">${esc(input.subtitle)}</text>`
      : "") +
    blocks.join("") +
    `</svg>`;
  return { svg, width, height };
}

export async function buildWeeklySchedulePng(input: WeeklyImageInput): Promise<string> {
  const { svg, width, height } = buildWeeklyScheduleSvg(input);
  return svgToPngDataUrl(svg, width, height);
}
