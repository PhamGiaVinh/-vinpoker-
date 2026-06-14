import { describe, it, expect } from "vitest";
import { checkInWindow, computeCheckInState, shiftPhase } from "../checkInWindow";
import { shiftHours, isOvernightShift, isNight, weekSummary, buildWeekCells, weekDates } from "../selectors";
import type { DealerShiftView } from "@/types/dealerApp";

const START = "2026-06-15T11:00:00+07:00"; // Monday 11:00 VN

function mk(date: string, s: string, e: string, status: string): DealerShiftView {
  return {
    id: date,
    dealerId: "d",
    clubId: "c",
    workDate: date,
    scheduledStartAt: `${date}T${s}:00+07:00`,
    scheduledEndAt: `${date}T${e}:00+07:00`,
    role: "Dealer",
    status: status as DealerShiftView["status"],
  };
}

describe("checkInWindow", () => {
  it("is closed more than 30m before start", () => {
    const w = checkInWindow(START, "2026-06-15T10:00:00+07:00"); // 60m before
    expect(w.open).toBe(false);
    expect(w.isLate).toBe(false);
    expect(w.minutesUntilOpen).toBe(30);
  });
  it("opens exactly 30m before start", () => {
    const w = checkInWindow(START, "2026-06-15T10:30:00+07:00");
    expect(w.open).toBe(true);
    expect(w.isLate).toBe(false);
  });
  it("is open and on-time at the start", () => {
    const w = checkInWindow(START, "2026-06-15T11:00:00+07:00");
    expect(w.open).toBe(true);
    expect(w.isLate).toBe(false);
  });
  it("flags late after 10m past start", () => {
    const w = checkInWindow(START, "2026-06-15T11:11:00+07:00");
    expect(w.open).toBe(true);
    expect(w.isLate).toBe(true);
  });
});

describe("overnight shift 18:00→02:00 is wrap-safe (reuses time.ts)", () => {
  const shift = mk("2026-06-15", "18:00", "02:00", "confirmed");
  it("duration is 8h", () => {
    expect(shiftHours(shift)).toBe(8);
  });
  it("is overnight and night", () => {
    expect(isOvernightShift(shift)).toBe(true);
    expect(isNight(shift)).toBe(true);
  });
  it("window resolves correctly across local midnight", () => {
    const w = checkInWindow(shift.scheduledStartAt, "2026-06-16T01:00:00+07:00"); // 7h in
    expect(w.open).toBe(true);
    expect(w.isLate).toBe(true);
  });
});

describe("computeCheckInState lifecycle", () => {
  it("published → canConfirm only", () => {
    const s = computeCheckInState("published", START, "2026-06-15T11:00:00+07:00");
    expect(s.canConfirm).toBe(true);
    expect(s.canCheckIn).toBe(false);
  });
  it("confirmed in-window → canCheckIn", () => {
    const s = computeCheckInState("confirmed", START, "2026-06-15T10:45:00+07:00");
    expect(s.canCheckIn).toBe(true);
  });
  it("confirmed too early → cannot check in yet", () => {
    const s = computeCheckInState("confirmed", START, "2026-06-15T09:00:00+07:00");
    expect(s.canCheckIn).toBe(false);
    expect(s.minutesUntilOpen).toBeGreaterThan(0);
  });
  it("checked_in → canCheckOut", () => {
    const s = computeCheckInState("checked_in", START, "2026-06-15T12:00:00+07:00");
    expect(s.canCheckOut).toBe(true);
  });
  it("closed is terminal", () => {
    expect(shiftPhase("closed")).toBe("closed");
    const s = computeCheckInState("closed", START);
    expect(s.canConfirm).toBe(false);
    expect(s.canCheckOut).toBe(false);
  });
});

describe("week selectors (overlap-based, cross-midnight aware)", () => {
  const anchor = "2026-06-15"; // Monday
  const shifts = [
    mk("2026-06-16", "11:00", "19:00", "published"), // Tue day
    mk("2026-06-20", "18:00", "02:00", "confirmed"), // Sat overnight night
  ];
  it("weekDates returns Mon..Sun", () => {
    const d = weekDates(anchor);
    expect(d).toHaveLength(7);
    expect(d[0]).toBe("2026-06-15");
    expect(d[6]).toBe("2026-06-21");
  });
  it("buildWeekCells marks off / today / night", () => {
    const cells = buildWeekCells(shifts, weekDates(anchor), "2026-06-15");
    expect(cells[0].kind).toBe("off");
    expect(cells[0].isToday).toBe(true);
    expect(cells[1].kind).toBe("shift");
    expect(cells[5].isNight).toBe(true); // Sat 18–02
  });
  it("weekSummary totals overnight overlap correctly", () => {
    const sum = weekSummary(shifts, anchor);
    expect(sum.totalHours).toBe(16); // 8 + 8
    expect(sum.nightShifts).toBe(1);
    expect(sum.daysWorked).toBe(2);
  });
});
