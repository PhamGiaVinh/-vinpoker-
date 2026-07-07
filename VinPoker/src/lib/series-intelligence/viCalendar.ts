// Series Intelligence — Vietnamese calendar features (PURE, deterministic, TZ-free). Poker turnout moves
// with holidays (people travel/gather) and paydays (money in pocket). Rather than pull a lunar-calendar
// library, we hard-code the STATIC holiday windows 2024–2028 (incl. Tết's solar dates), and derive
// payday from the day-of-month. Comparison is string-based on the ISO date's "YYYY-MM-DD" prefix, so it
// never shifts with timezone. These are Known-Rule calendar facts fed as forecast features (TP2).

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Extract the calendar "YYYY-MM-DD" from an ISO string without any timezone conversion. null if invalid. */
function calDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = ISO_DATE_RE.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Major Vietnamese holiday windows as inclusive [start, end] calendar ranges (solar). Tết Nguyên Đán's
 * solar date shifts each year, so its window is listed per year (2024–2028); fixed-date holidays use a
 * small ±window. Dates outside 2024–2028 fall back to the fixed-date holidays only (Tết unknown → not
 * flagged, honest). Extend this table as new years are known — NO lunar computation here.
 */
const HOLIDAY_WINDOWS: ReadonlyArray<readonly [string, string]> = [
  // Tết Nguyên Đán (lunar new year) — solar window −2…+5 days around day 1.
  ["2024-02-08", "2024-02-15"],
  ["2025-01-27", "2025-02-03"],
  ["2026-02-15", "2026-02-22"],
  ["2027-02-04", "2027-02-11"],
  ["2028-01-24", "2028-01-31"],
  // Giỗ Tổ Hùng Vương (10/3 âm lịch) — solar per year, ±1 day.
  ["2024-04-17", "2024-04-19"],
  ["2025-04-06", "2025-04-08"],
  ["2026-04-25", "2026-04-27"],
  ["2027-04-14", "2027-04-16"],
  ["2028-04-03", "2028-04-05"],
];

/** Fixed-date holiday windows repeated every year (month-day ranges): Tết dương, 30/4–1/5, Quốc khánh 2/9. */
const FIXED_MONTHDAY_WINDOWS: ReadonlyArray<readonly [string, string]> = [
  ["12-31", "01-02"], // New Year (wraps year boundary — handled specially)
  ["04-28", "05-02"], // Giải phóng + Quốc tế lao động (long weekend)
  ["09-01", "09-03"], // Quốc khánh
];

/**
 * True when the date falls in a major VN holiday window (Tết, Hùng King, 30/4–1/5, 2/9, Tết dương).
 * Deterministic + TZ-free. Unknown-year Tết is simply not flagged (never guessed).
 */
export function isHolidayWindow(iso: string | null): boolean {
  const d = calDate(iso);
  if (!d) return false;
  for (const [s, e] of HOLIDAY_WINDOWS) if (d >= s && d <= e) return true;
  const md = d.slice(5); // "MM-DD"
  for (const [s, e] of FIXED_MONTHDAY_WINDOWS) {
    if (s <= e ? md >= s && md <= e : md >= s || md <= e) return true; // wrap for 12-31…01-02
  }
  return false;
}

/** True in the payday window (1st–10th of the month) — the review's "ngày lương" signal. TZ-free. */
export function isPaydayWindow(iso: string | null): boolean {
  const d = calDate(iso);
  if (!d) return false;
  const day = Number(d.slice(8, 10));
  return day >= 1 && day <= 10;
}
