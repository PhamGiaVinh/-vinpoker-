import {
  degrees,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
} from "https://esm.sh/pdf-lib@1.17.1?target=denonext";
import * as fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1?target=denonext";
import { PAYROLL_PDF_RENDER_VERSION, resolvePayrollBrand } from "./brand.ts";
import type {
  JsonRecord,
  PayrollPdfFonts,
  PayrollPdfRenderOptions,
  PayrollStatementLine,
  PayrollStatementSnapshot,
  RenderedPayrollPdf,
} from "./types.ts";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;
const GREEN = rgb(0.075, 0.42, 0.23);
const GREEN_DARK = rgb(0.035, 0.23, 0.12);
const GREEN_LIGHT = rgb(0.91, 0.96, 0.92);
const BORDER = rgb(0.78, 0.8, 0.79);
const TEXT = rgb(0.08, 0.09, 0.09);
const MUTED = rgb(0.35, 0.37, 0.36);
const WHITE = rgb(1, 1, 1);

export async function loadPayrollPdfFonts(): Promise<PayrollPdfFonts> {
  const regular = new URL("./assets/LiberationSans-Regular.ttf", import.meta.url);
  const bold = new URL("./assets/LiberationSans-Bold.ttf", import.meta.url);
  return { regular: await Deno.readFile(regular), bold: await Deno.readFile(bold) };
}

export async function renderPayrollStatementPdf(
  statement: PayrollStatementSnapshot,
  options: PayrollPdfRenderOptions,
): Promise<RenderedPayrollPdf> {
  assertRenderableStatement(statement);
  const fonts = options.fonts ?? await loadPayrollPdfFonts();
  if (!fonts.regular.length || !fonts.bold.length) throw new Error("PAYROLL_PDF_FONT_ASSET_UNAVAILABLE");

  const document = await PDFDocument.create();
  type FontkitAdapter = Parameters<PDFDocument["registerFontkit"]>[0];
  const fontkitAdapter = (fontkit as unknown as { default: FontkitAdapter }).default;
  document.registerFontkit(fontkitAdapter);
  document.setTitle("Phieu luong");
  document.setAuthor("VinPoker Payroll");
  document.setCreator(`VinPoker ${PAYROLL_PDF_RENDER_VERSION}`);
  document.setProducer("VinPoker Payroll");
  document.setCreationDate(new Date(0));
  document.setModificationDate(new Date(0));
  document.setLanguage("vi-VN");

  const regular = await document.embedFont(fonts.regular, { subset: false });
  const bold = await document.embedFont(fonts.bold, { subset: false });
  const brand = resolvePayrollBrand(statement.club_snapshot);
  const page = document.addPage([A4_WIDTH, A4_HEIGHT]);

  drawPageHeader(page, regular, bold, statement, brand, options.mode === "preview");
  let y = 684;
  y = drawIdentityGrid(page, regular, bold, statement, y);
  y = drawSectionTitle(page, bold, "I. Thông tin nhân sự", y - 18);
  y = drawMetricCards(page, regular, bold, statement, y - 10);
  y = drawSectionTitle(page, bold, "II. Thu nhập", y - 20);
  y = drawIncomeTable(page, regular, bold, statement.lines, y - 10);

  const splitY = y - 24;
  drawSectionTitle(page, bold, "III. Phân đoạn đơn giá", splitY);
  drawRateSegments(page, regular, bold, statement, splitY - 16);
  drawSectionTitle(page, bold, "IV. Giảm trừ", splitY);
  drawDeductionsTable(page, regular, bold, statement.lines, splitY - 16);

  drawNetAmount(page, regular, bold, statement, 125);
  drawFooter(page, regular, statement);
  if (options.mode === "preview") drawPreviewWatermark(page, regular);

  const bytes = await document.save({ useObjectStreams: false, addDefaultPage: false });
  return {
    bytes,
    statementId: statement.id,
    statementHash: statement.statement_hash,
    renderVersion: PAYROLL_PDF_RENDER_VERSION,
    mode: options.mode,
  };
}

function assertRenderableStatement(statement: PayrollStatementSnapshot): void {
  if (!isUuid(statement.id) || !isUuid(statement.club_id) || !isUuid(statement.dealer_id)) {
    throw new Error("PAYROLL_PDF_INVALID_STATEMENT_IDENTITY");
  }
  if (!["full_time_period", "part_time_settlement"].includes(statement.statement_kind)) {
    throw new Error("PAYROLL_PDF_INVALID_STATEMENT_KIND");
  }
  if (["voided", "replaced"].includes(statement.state)) throw new Error("PAYROLL_PDF_STATEMENT_NOT_RENDERABLE");
  if (!isHex64(statement.statement_hash) || !isHex64(statement.source_fingerprint)) {
    throw new Error("PAYROLL_PDF_INVALID_SNAPSHOT_HASH");
  }
  if (readString(statement.club_snapshot.club_id) !== statement.club_id) {
    throw new Error("PAYROLL_PDF_CLUB_SNAPSHOT_MISMATCH");
  }
  if (readString(statement.dealer_snapshot.dealer_id) !== statement.dealer_id) {
    throw new Error("PAYROLL_PDF_DEALER_SNAPSHOT_MISMATCH");
  }
  if (!readString(statement.club_snapshot.club_name) || !readString(statement.dealer_snapshot.full_name)) {
    throw new Error("PAYROLL_PDF_REQUIRED_SNAPSHOT_NAME_MISSING");
  }
  resolvePayrollBrand(statement.club_snapshot);
}

function drawPageHeader(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  statement: PayrollStatementSnapshot,
  brand: { displayName: string },
  preview: boolean,
): void {
  drawVinPokerLogo(page, regular, bold, brand.displayName);
  const status = preview ? "CHƯA CHỐT" : "Phiếu đã chốt";
  const statusWidth = bold.widthOfTextAtSize(status, 10) + 30;
  page.drawRectangle({
    x: A4_WIDTH - MARGIN - statusWidth,
    y: 778,
    width: statusWidth,
    height: 24,
    borderColor: GREEN,
    borderWidth: 1,
    color: preview ? rgb(1, 0.97, 0.87) : WHITE,
  });
  page.drawCircle({ x: A4_WIDTH - MARGIN - statusWidth + 14, y: 790, size: 7, color: GREEN });
  page.drawText(preview ? "!" : "✓", {
    x: A4_WIDTH - MARGIN - statusWidth + 11.5,
    y: 786,
    size: 9,
    font: bold,
    color: WHITE,
  });
  page.drawText(status, {
    x: A4_WIDTH - MARGIN - statusWidth + 26,
    y: 785,
    size: 10,
    font: bold,
    color: GREEN_DARK,
  });

  drawCentered(page, "PHIẾU LƯƠNG", bold, 25, A4_WIDTH / 2, 742, TEXT);
  const period = periodLabel(statement);
  drawCentered(page, period, regular, 16, A4_WIDTH / 2, 714, TEXT);
  page.drawLine({ start: { x: 206, y: 698 }, end: { x: 389, y: 698 }, thickness: 2, color: GREEN });
}

function drawVinPokerLogo(page: PDFPage, regular: PDFFont, bold: PDFFont, displayName: string): void {
  const x = MARGIN;
  const y = 774;
  page.drawCircle({ x: x + 10, y: y + 16, size: 8, color: GREEN_DARK });
  page.drawCircle({ x: x + 24, y: y + 16, size: 8, color: GREEN_DARK });
  page.drawSvgPath(
    `M ${x + 3} ${y + 17} C ${x + 7} ${y + 34}, ${x + 27} ${y + 34}, ${x + 31} ${y + 17} L ${x + 17} ${y - 1} Z`,
    { color: GREEN_DARK },
  );
  page.drawLine({ start: { x: x + 17, y: y + 2 }, end: { x: x + 17, y: y - 9 }, thickness: 3, color: GREEN_DARK });
  page.drawText(displayName, { x: x + 42, y: y + 5, size: 19, font: bold, color: GREEN_DARK });
}

function drawIdentityGrid(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  statement: PayrollStatementSnapshot,
  y: number,
): number {
  const dealer = statement.dealer_snapshot;
  const club = statement.club_snapshot;
  const left = [
    ["Họ và tên", readString(dealer.full_name)],
    ["Bộ phận", readString(dealer.department) || "Dealer"],
    ["Chức danh", readString(dealer.job_title) || "Dealer"],
    ["Mã phiếu", statement.id],
  ] as const;
  const right = [
    ["STK", readString(dealer.bank_account_number)],
    ["Ngân hàng", readString(dealer.bank_name)],
    ["Ngày vào làm", readString(dealer.hire_date)],
    ["Loại hợp đồng", employmentLabel(readString(dealer.employment_type))],
  ] as const;
  page.drawText(`CLB: ${safeText(readString(club.club_name), 80)}`, { x: MARGIN, y: y + 12, size: 10, font: regular, color: MUTED });
  drawIdentityColumn(page, regular, bold, left, MARGIN, y - 10);
  drawIdentityColumn(page, regular, bold, right, 315, y - 10);
  return y - 92;
}

function drawIdentityColumn(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  rows: readonly (readonly [string, string])[],
  x: number,
  y: number,
): void {
  rows.forEach(([label, value], index) => {
    const rowY = y - index * 19;
    page.drawCircle({ x: x + 4, y: rowY + 4, size: 2.5, color: GREEN });
    page.drawText(`${label}:`, { x: x + 14, y: rowY, size: 10, font: bold, color: TEXT });
    page.drawText(safeText(value || "—", 42), { x: x + 104, y: rowY, size: 10, font: regular, color: TEXT });
  });
}

function drawSectionTitle(page: PDFPage, bold: PDFFont, label: string, y: number): number {
  page.drawText(label, { x: MARGIN, y, size: 13, font: bold, color: GREEN_DARK });
  page.drawLine({ start: { x: MARGIN, y: y - 7 }, end: { x: A4_WIDTH - MARGIN, y: y - 7 }, thickness: 1, color: GREEN });
  return y - 13;
}

function drawMetricCards(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  statement: PayrollStatementSnapshot,
  y: number,
): number {
  const metrics = metricValues(statement);
  const width = (A4_WIDTH - MARGIN * 2) / 4;
  page.drawRectangle({ x: MARGIN, y: y - 58, width: A4_WIDTH - MARGIN * 2, height: 58, borderColor: BORDER, borderWidth: 0.8, color: WHITE });
  metrics.forEach(([label, value], index) => {
    const x = MARGIN + width * index;
    if (index > 0) page.drawLine({ start: { x, y: y - 52 }, end: { x, y: y - 6 }, thickness: 0.8, color: BORDER });
    drawCentered(page, label, regular, 8, x + width / 2, y - 19, MUTED);
    drawCentered(page, value, bold, 11, x + width / 2, y - 41, TEXT);
  });
  return y - 62;
}

function drawIncomeTable(page: PDFPage, regular: PDFFont, bold: PDFFont, lines: PayrollStatementLine[], y: number): number {
  const income = lines.filter((line) => line.line_type !== "deduction" && line.line_type !== "rate_segment");
  return drawTable(page, regular, bold, ["STT", "Khoản mục", "Cách tính", "Số lượng", "Đơn giá (đ)", "Thành tiền (đ)"], income.map((line, index) => [
    String(index + 1),
    lineLabel(line),
    lineMethod(line),
    formatQuantity(line.quantity, line.unit),
    formatVnd(line.unit_rate_vnd),
    formatVnd(line.amount_vnd),
  ]), y, [34, 110, 108, 78, 86, 99]);
}

function drawRateSegments(page: PDFPage, regular: PDFFont, bold: PDFFont, statement: PayrollStatementSnapshot, y: number): void {
  const rateLines = statement.lines.filter((line) => line.line_type === "rate_segment");
  const rows = rateLines.map((line, index) => {
    const source = line.source_snapshot ?? {};
    return [
      String(index + 1),
      rateRange(source),
      formatVnd(line.unit_rate_vnd),
      formatQuantity(line.quantity, line.unit),
    ];
  });
  drawTable(page, regular, bold, ["STT", "Khoảng thời gian hiệu lực", "Đơn giá (đ/giờ)", "Giờ công"], rows, y, [34, 132, 86, 78], MARGIN);
}

function drawDeductionsTable(page: PDFPage, regular: PDFFont, bold: PDFFont, lines: PayrollStatementLine[], y: number): void {
  const deductions = lines.filter((line) => line.line_type === "deduction");
  const rows = deductions.map((line, index) => [String(index + 1), lineLabel(line), formatVnd(Math.abs(numberValue(line.amount_vnd))) ]);
  const x = 365;
  const widths = [34, 110, 85];
  const bottom = drawTable(page, regular, bold, ["STT", "Khoản mục", "Số tiền (đ)"], rows, y, widths, x);
  const total = deductions.reduce((sum, line) => sum + Math.abs(numberValue(line.amount_vnd)), 0);
  page.drawRectangle({ x, y: bottom - 22, width: widths.reduce((sum, value) => sum + value, 0), height: 22, color: GREEN_LIGHT, borderColor: BORDER, borderWidth: 0.5 });
  page.drawText("TỔNG GIẢM TRỪ", { x: x + 42, y: bottom - 15, size: 8, font: bold, color: GREEN_DARK });
  page.drawText(formatVnd(total), { x: x + 168, y: bottom - 15, size: 8, font: bold, color: GREEN_DARK });
}

function drawTable(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  headers: string[],
  rows: string[][],
  y: number,
  widths: number[],
  x = MARGIN,
): number {
  if (rows.length > 12) throw new Error("PAYROLL_PDF_TOO_MANY_LINES");
  const total = widths.reduce((sum, value) => sum + value, 0);
  const headerHeight = 22;
  page.drawRectangle({ x, y: y - headerHeight, width: total, height: headerHeight, color: GREEN_DARK });
  let cursor = x;
  headers.forEach((header, index) => {
    drawCentered(page, header, bold, 8, cursor + widths[index] / 2, y - 15, WHITE);
    cursor += widths[index];
  });
  let rowY = y - headerHeight;
  rows.slice(0, 12).forEach((row) => {
    rowY -= 20;
    page.drawRectangle({ x, y: rowY, width: total, height: 20, borderColor: BORDER, borderWidth: 0.45, color: WHITE });
    let cellX = x;
    row.forEach((value, index) => {
      if (index > 0) page.drawLine({ start: { x: cellX, y: rowY }, end: { x: cellX, y: rowY + 20 }, thickness: 0.45, color: BORDER });
      page.drawText(safeText(value || "—", Math.max(8, Math.floor(widths[index] / 4.7))), {
        x: cellX + 4,
        y: rowY + 6,
        size: 7.3,
        font: regular,
        color: TEXT,
      });
      cellX += widths[index];
    });
  });
  const totalAmount = rows.reduce((sum, row) => sum + numberValue(row[row.length - 1]?.replace(/\./g, "")), 0);
  if (headers.includes("Thành tiền (đ)")) {
    rowY -= 22;
    page.drawRectangle({ x, y: rowY, width: total, height: 22, color: GREEN_LIGHT, borderColor: BORDER, borderWidth: 0.5 });
    page.drawText("TỔNG THU NHẬP", { x: x + total - 220, y: rowY + 7, size: 8.5, font: bold, color: GREEN_DARK });
    page.drawText(formatVnd(totalAmount), { x: x + total - 75, y: rowY + 7, size: 8.5, font: bold, color: GREEN_DARK });
  }
  return rowY - 4;
}

function drawNetAmount(page: PDFPage, regular: PDFFont, bold: PDFFont, statement: PayrollStatementSnapshot, y: number): void {
  page.drawRectangle({ x: MARGIN, y, width: A4_WIDTH - MARGIN * 2, height: 58, borderColor: GREEN, borderWidth: 1, color: WHITE });
  page.drawText("THỰC LĨNH:", { x: MARGIN + 16, y: y + 20, size: 16, font: bold, color: TEXT });
  page.drawText(`${formatVnd(statement.net_amount_vnd)} đ`, { x: MARGIN + 135, y: y + 17, size: 24, font: bold, color: GREEN_DARK });
  page.drawText("Số tiền theo snapshot server đã chốt", { x: A4_WIDTH - 230, y: y + 22, size: 8.5, font: regular, color: MUTED });
}

function drawFooter(page: PDFPage, regular: PDFFont, statement: PayrollStatementSnapshot): void {
  const finalized = statement.finalized_at ? formatDate(statement.finalized_at) : "—";
  page.drawText(`Ngày chốt: ${finalized}`, { x: MARGIN, y: 48, size: 8, font: regular, color: MUTED });
  page.drawText(`Mã hash: ${statement.statement_hash}`, { x: 175, y: 48, size: 7, font: regular, color: MUTED });
  page.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: A4_WIDTH - MARGIN, y: 38 }, thickness: 0.8, color: GREEN });
}

function drawPreviewWatermark(page: PDFPage, regular: PDFFont): void {
  page.drawText("CHƯA CHỐT", { x: 180, y: 360, size: 38, font: regular, color: rgb(0.75, 0.52, 0.1), rotate: degrees(35), opacity: 0.18 });
}

function metricValues(statement: PayrollStatementSnapshot): [string, string][] {
  const source = statement.source_snapshot;
  const payroll = asRecord(source.dealer_payroll) ?? source;
  const regularHours = readNumber(payroll.regular_hours) ?? sumLineQuantity(statement.lines.filter((line) => line.line_code === "regular_pay"));
  const overtimeHours = readNumber(payroll.ot_hours) ?? sumLineQuantity(statement.lines.filter((line) => line.line_code === "ot_pay"));
  const days = readNumber(payroll.work_days) ?? readNumber(payroll.days) ?? sumLineQuantity(statement.lines.filter((line) => line.unit === "ngay"));
  const rate = readNumber(payroll.hourly_rate_vnd) ?? readNumber(statement.financial_snapshot.hourly_rate_vnd_snapshot);
  return [
    ["Ngày công chuẩn", days == null ? "—" : `${formatQuantity(days, "ngày")}`],
    ["Tổng giờ công", regularHours == null ? "—" : `${formatQuantity(regularHours, "giờ")}`],
    ["Tổng giờ OT", overtimeHours == null ? "—" : `${formatQuantity(overtimeHours, "giờ")}`],
    ["Đơn giá cơ bản", rate == null ? "—" : `${formatVnd(rate)} đ/giờ`],
  ];
}

function periodLabel(statement: PayrollStatementSnapshot): string {
  const source = statement.source_snapshot;
  const period = asRecord(source.payroll_period) ?? asRecord(source.period);
  const month = readNumber(period?.month);
  const year = readNumber(period?.year);
  if (month && year) return `Tháng ${String(month).padStart(2, "0")}/${year}`;
  const start = readString(source.covered_from) || readString(source.cutoff_at) || statement.cutoff_at;
  return start ? `Kỳ chốt ${formatDate(start)}` : "Kỳ lương đã chốt";
}

function rateRange(source: JsonRecord): string {
  const start = readString(source.segment_start) || readString(source.effective_from) || "—";
  const end = readString(source.segment_end) || readString(source.effective_to) || "—";
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function lineLabel(line: PayrollStatementLine): string {
  const labels: Record<string, string> = {
    base_salary: "Lương cơ bản",
    regular_pay: "Giờ thường",
    ot_pay: "Tăng ca",
    adjustments: "Điều chỉnh",
    bhxh: "BHXH",
    bhyt: "BHYT",
    bhtn: "BHTN",
    pit: "Thuế TNCN",
    pt_rate_segment: "Lương theo đơn giá hiệu lực",
  };
  return labels[line.line_code] ?? safeText(line.label, 42);
}

function lineMethod(line: PayrollStatementLine): string {
  if (line.line_type === "rate_segment" || line.line_code === "regular_pay") return "Theo snapshot";
  return safeText(line.unit ?? "Theo quy định", 24);
}

function employmentLabel(value: string): string {
  if (value === "part_time") return "Bán thời gian";
  if (value === "full_time") return "Chính thức";
  return value;
}

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, centerX: number, y: number, color = TEXT): void {
  page.drawText(text, { x: centerX - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });
}

function formatVnd(value: number | string | null | undefined): string {
  const number = numberValue(value);
  if (!Number.isFinite(number)) return "—";
  return Math.trunc(number).toLocaleString("vi-VN");
}

function formatQuantity(value: number | string | null | undefined, unit: string | null | undefined): string {
  const number = numberValue(value);
  if (!Number.isFinite(number)) return "—";
  const formatted = number.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function readNumber(value: unknown): number | null {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function sumLineQuantity(lines: PayrollStatementLine[]): number | null {
  if (!lines.length) return null;
  return lines.reduce((sum, line) => sum + (readNumber(line.quantity) ?? 0), 0);
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value, 16);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

function safeText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
