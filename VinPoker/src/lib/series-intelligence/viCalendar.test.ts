import { describe, it, expect } from "vitest";
import { isHolidayWindow, isPaydayWindow } from "./viCalendar";

describe("isHolidayWindow", () => {
  it("flags Tết Nguyên Đán window (solar, per year)", () => {
    expect(isHolidayWindow("2026-02-17T19:00:00Z")).toBe(true); // Tết 2026 = Feb 17
    expect(isHolidayWindow("2025-01-29")).toBe(true); // Tết 2025 = Jan 29
    expect(isHolidayWindow("2026-03-10")).toBe(false); // well after Tết
  });

  it("flags fixed holidays every year: Tết dương, 30/4–1/5, 2/9", () => {
    expect(isHolidayWindow("2026-01-01")).toBe(true);
    expect(isHolidayWindow("2027-04-30")).toBe(true);
    expect(isHolidayWindow("2027-05-01")).toBe(true);
    expect(isHolidayWindow("2030-09-02")).toBe(true); // fixed works outside the Tết table years
  });

  it("New-Year window wraps the year boundary (Dec 31 – Jan 2)", () => {
    expect(isHolidayWindow("2025-12-31")).toBe(true);
    expect(isHolidayWindow("2026-01-02")).toBe(true);
    expect(isHolidayWindow("2026-01-05")).toBe(false);
  });

  it("unknown-year Tết is NOT guessed (only fixed holidays flagged)", () => {
    expect(isHolidayWindow("2035-02-10")).toBe(false); // no Tết row for 2035
  });

  it("ordinary weekday → false; invalid/empty → false; TZ-free (uses ISO prefix)", () => {
    expect(isHolidayWindow("2026-07-01")).toBe(false);
    expect(isHolidayWindow(null)).toBe(false);
    expect(isHolidayWindow("not-a-date")).toBe(false);
    // 23:00Z on a holiday still reads the calendar date from the ISO prefix, no TZ shift
    expect(isHolidayWindow("2026-09-02T23:00:00Z")).toBe(true);
  });
});

describe("isPaydayWindow", () => {
  it("true for days 1–10, false after", () => {
    expect(isPaydayWindow("2026-07-01")).toBe(true);
    expect(isPaydayWindow("2026-07-10T19:00:00Z")).toBe(true);
    expect(isPaydayWindow("2026-07-11")).toBe(false);
    expect(isPaydayWindow("2026-07-25")).toBe(false);
  });
  it("invalid/empty → false", () => {
    expect(isPaydayWindow(null)).toBe(false);
    expect(isPaydayWindow("bad")).toBe(false);
  });
});
