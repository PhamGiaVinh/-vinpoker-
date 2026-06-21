import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatRegEndLabel,
  dayDateLabel,
  festivalDateRange,
  eventTypeLabel,
  SCHEDULE_EXCEL_COLUMNS,
  slugify,
  exportScheduleExcel,
} from "./scheduleExport";
import type { ScheduleEvent } from "./scheduleGenerator";
import { exportToExcel } from "../exportExcel";

vi.mock("../exportExcel", () => ({ exportToExcel: vi.fn() }));

function evt(over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    day: 1,
    slot: 0,
    name: "Main Event",
    eventClass: "Main",
    buy_in_prize: 20_000_000,
    fee_rake: 2_900_000,
    GTD: 17_000_000_000,
    sourceLabels: ["2-series", "APT-corrected"],
    startTime: "10:00",
    startingStack: 50_000,
    minutesPerLevel: 60,
    lateRegLevel: 12,
    regEndTime: "22:00",
    regEndLevel: 12,
    regEndNextDay: false,
    ...over,
  };
}

describe("formatRegEndLabel", () => {
  it("plain when same-day", () => expect(formatRegEndLabel(evt())).toBe("22:00"));
  it("marks (hôm sau) when next-day", () => expect(formatRegEndLabel(evt({ regEndTime: "01:00", regEndNextDay: true }))).toBe("01:00 (hôm sau)"));
});

describe("dayDateLabel", () => {
  it("plain when no startDate", () => expect(dayDateLabel(3)).toBe("Ngày 3"));
  it("plain when invalid startDate", () => expect(dayDateLabel(3, "not-a-date")).toBe("Ngày 3"));
  it("day 1 = startDate", () => expect(dayDateLabel(1, "2026-06-14")).toBe("Ngày 1 · 14/06/2026"));
  it("day 3 = startDate + 2", () => expect(dayDateLabel(3, "2026-06-14")).toBe("Ngày 3 · 16/06/2026"));
  it("rolls over a month boundary", () => expect(dayDateLabel(3, "2026-06-30")).toBe("Ngày 3 · 02/07/2026"));
});

describe("festivalDateRange", () => {
  it("null without a date", () => expect(festivalDateRange([1, 2, 3])).toBeNull());
  it("null on invalid date", () => expect(festivalDateRange([1, 2, 3], "nope")).toBeNull());
  it("spans min..max day", () => expect(festivalDateRange([1, 2, 5], "2026-06-14")).toBe("14/06 – 18/06/2026"));
});

describe("eventTypeLabel", () => {
  it("custom → Tự thêm", () => expect(eventTypeLabel(evt({ isCustom: true, sourceLabels: ["custom"] }))).toBe("Tự thêm"));
  it("generated → joined labels", () => expect(eventTypeLabel(evt())).toBe("2-series, APT-corrected"));
});

describe("SCHEDULE_EXCEL_COLUMNS", () => {
  it("maps core numerics + reg-end + type", () => {
    const e = evt({ day: 4, startTime: "11:30", GTD: 5_000_000, startingStack: 40_000, minutesPerLevel: 40, regEndLevel: 10, regEndTime: "01:00", regEndNextDay: true, isCustom: true, name: "Ladies", buy_in_prize: 1_000_000, fee_rake: 100_000 });
    const byHeader = Object.fromEntries(SCHEDULE_EXCEL_COLUMNS.map((c) => [c.header, c.get(e)]));
    expect(byHeader["Ngày"]).toBe(4);
    expect(byHeader["Giờ"]).toBe("11:30");
    expect(byHeader["Event"]).toBe("Ladies");
    expect(byHeader["Buy-in (prize)"]).toBe(1_000_000);
    expect(byHeader["Fee (rake)"]).toBe(100_000);
    expect(byHeader["GTD"]).toBe(5_000_000);
    expect(byHeader["Stack"]).toBe(40_000);
    expect(byHeader["Phút/level"]).toBe(40);
    expect(byHeader["Late-reg (lv)"]).toBe(10);
    expect(byHeader["Reg-end"]).toBe("01:00 (hôm sau)");
    expect(byHeader["Loại"]).toBe("Tự thêm");
  });
});

describe("slugify", () => {
  it("strips Vietnamese diacritics + spaces", () => expect(slugify("Giải Đấu Hè 2026")).toBe("giai-dau-he-2026"));
  it("falls back when empty after stripping", () => expect(slugify("!!!")).toBe("lich-festival"));
});

describe("exportScheduleExcel", () => {
  beforeEach(() => vi.clearAllMocks());
  it("no-op on empty events", () => {
    exportScheduleExcel([], { title: "X" });
    expect(exportToExcel).not.toHaveBeenCalled();
  });
  it("calls exportToExcel with slug + columns + sheet name", () => {
    exportScheduleExcel([evt()], { title: "Hè 2026" });
    expect(exportToExcel).toHaveBeenCalledTimes(1);
    const args = (exportToExcel as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(args[1]).toBe(SCHEDULE_EXCEL_COLUMNS);
    expect(args[2]).toBe("he-2026");
    expect(args[3]).toBe("Lịch");
  });
});
