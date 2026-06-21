// Series Intelligence — Forward layer PR2b: schedule export shaping (PURE-ish, client-only).
//
// Turns a generated/edited DRAFT schedule (PATCH B / PR2a) into export shapes: small pure label helpers the
// PNG poster reuses, plus the Excel column map fed to the SHARED exportToExcel helper. No DB, no Supabase. The
// only side effect is exportScheduleExcel → xlsx.writeFile (a browser download); everything else is pure and
// deterministic (date math is driven only by the owner-supplied startDate, never an ambient `new Date()`).

import { addDays, format, parseISO, isValid } from "date-fns";
import { exportToExcel, type ExcelColumn } from "../exportExcel";
import type { ScheduleEvent } from "./scheduleGenerator";

export interface SchedulePosterHeader {
  title?: string;
  subtitle?: string;
  venue?: string;
  startDate?: string; // "YYYY-MM-DD" (owner-typed) → maps Ngày 1 to this calendar date
  footer?: string;
}

/** Reg-end label with an unambiguous next-day marker (PR2a's engine flag — never string-inferred). Pure. */
export function formatRegEndLabel(e: Pick<ScheduleEvent, "regEndTime" | "regEndNextDay">): string {
  return e.regEndNextDay ? `${e.regEndTime} (hôm sau)` : e.regEndTime;
}

/** "Ngày {day}" or "Ngày {day} · dd/MM/yyyy" when a valid startDate is given. Deterministic (date-fns calendar add). */
export function dayDateLabel(day: number, startDate?: string): string {
  const base = `Ngày ${day}`;
  if (!startDate) return base;
  const parsed = parseISO(startDate);
  if (!isValid(parsed)) return base;
  return `${base} · ${format(addDays(parsed, Math.max(0, Math.floor(day) - 1)), "dd/MM/yyyy")}`;
}

/** "dd/MM – dd/MM/yyyy" festival date range from the day numbers + startDate, or null when no/invalid date. Pure. */
export function festivalDateRange(days: number[], startDate?: string): string | null {
  if (!startDate || days.length === 0) return null;
  const parsed = parseISO(startDate);
  if (!isValid(parsed)) return null;
  const lo = Math.min(...days);
  const hi = Math.max(...days);
  return `${format(addDays(parsed, lo - 1), "dd/MM")} – ${format(addDays(parsed, hi - 1), "dd/MM/yyyy")}`;
}

/** Source-type cell: owner-added events → "Tự thêm"; otherwise the joined source labels. Pure. */
export function eventTypeLabel(e: Pick<ScheduleEvent, "isCustom" | "sourceLabels">): string {
  return e.isCustom ? "Tự thêm" : e.sourceLabels.join(", ");
}

/** Excel columns for a schedule export (header order is preserved by exportToExcel's AOA builder). */
export const SCHEDULE_EXCEL_COLUMNS: ExcelColumn<ScheduleEvent>[] = [
  { header: "Ngày", get: (e) => e.day, width: 6 },
  { header: "Giờ", get: (e) => e.startTime, width: 7 },
  { header: "Event", get: (e) => e.name, width: 28 },
  { header: "Buy-in (prize)", get: (e) => e.buy_in_prize, width: 14 },
  { header: "Fee (rake)", get: (e) => e.fee_rake, width: 12 },
  { header: "GTD", get: (e) => e.GTD, width: 16 },
  { header: "Stack", get: (e) => e.startingStack, width: 9 },
  { header: "Phút/level", get: (e) => e.minutesPerLevel, width: 9 },
  { header: "Late-reg (lv)", get: (e) => e.regEndLevel, width: 11 },
  { header: "Reg-end", get: (e) => formatRegEndLabel(e), width: 14 },
  { header: "Loại", get: (e) => eventTypeLabel(e), width: 22 },
];

/** ASCII-safe filename slug (Vietnamese diacritics stripped, spaces→-, lowercased, bounded). Pure. */
export function slugify(s: string): string {
  const stripped = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .replace(/đ/g, "d") // đ
    .replace(/Đ/g, "D"); // Đ
  const out = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out || "lich-festival";
}

/** Export the schedule to an .xlsx workbook (reuses the shared, tested helper). No-op on empty input. */
export function exportScheduleExcel(events: ScheduleEvent[], header: SchedulePosterHeader): void {
  if (!events.length) return;
  exportToExcel(events, SCHEDULE_EXCEL_COLUMNS, slugify(header.title?.trim() || "lich-festival"), "Lịch");
}
