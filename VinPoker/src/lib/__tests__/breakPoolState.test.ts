import { describe, expect, it } from "vitest";
import {
  BREAK_SOON_WARNING_MINUTES,
  buildBreakPoolEntries,
  getBreakTiming,
  getBreakVisualState,
} from "../breakPoolState";

const NOW = Date.parse("2026-06-10T02:00:00.000Z");

const isoFromNow = (offsetMinutes: number) =>
  new Date(NOW + offsetMinutes * 60_000).toISOString();

describe("breakPoolState", () => {
  it("merges regular and meal breaks and sorts them FIFO by break start", () => {
    const entries = buildBreakPoolEntries({
      nowMs: NOW,
      defaultBreakMinutesByClubId: { clubA: 10 },
      dealers: [
        {
          attendanceId: "att-1",
          dealerId: "dealer-1",
          clubId: "clubA",
          fullName: "Dealer Meal",
          telegramUsername: "meal",
          tier: "A",
          checkInTime: isoFromNow(-120),
          currentState: "on_break",
        },
        {
          attendanceId: "att-2",
          dealerId: "dealer-2",
          clubId: "clubA",
          fullName: "Dealer Regular",
          telegramUsername: "regular",
          tier: "C",
          checkInTime: isoFromNow(-90),
          currentState: "on_break",
        },
      ],
      regularAssignments: [
        {
          assignmentId: "assign-2",
          attendanceId: "att-2",
          releasedAt: isoFromNow(-8),
          tableName: "Ban 11",
        },
      ],
      regularBreaks: [
        {
          id: "break-2",
          assignmentId: "assign-2",
          breakStart: isoFromNow(-8),
          expectedDurationMinutes: 10,
          reason: "manual",
        },
      ],
      mealBreaks: [
        {
          id: "meal-1",
          attendanceId: "att-1",
          breakStart: isoFromNow(-15),
          totalDurationMinutes: 30,
          baseDurationMinutes: 15,
          bonusMinutes: 15,
        },
      ],
    });

    expect(entries.map((entry) => entry.attendanceId)).toEqual(["att-1", "att-2"]);
    expect(entries[0].breakType).toBe("meal");
    expect(entries[1].tableName).toBe("Ban 11");
  });

  it("falls back to released_at when a regular break row is missing", () => {
    const [entry] = buildBreakPoolEntries({
      nowMs: NOW,
      defaultBreakMinutesByClubId: { clubA: 12 },
      dealers: [
        {
          attendanceId: "att-3",
          dealerId: "dealer-3",
          clubId: "clubA",
          fullName: "Fallback Dealer",
          telegramUsername: null,
          tier: "B",
          checkInTime: isoFromNow(-40),
          currentState: "on_break",
        },
      ],
      regularAssignments: [
        {
          assignmentId: "assign-3",
          attendanceId: "att-3",
          releasedAt: isoFromNow(-6),
          tableName: "Ban 18",
        },
      ],
      regularBreaks: [],
      mealBreaks: [],
    });

    expect(entry.isFallback).toBe(true);
    expect(entry.breakStartAt).toBe(isoFromNow(-6));
    expect(entry.durationMinutes).toBe(12);
  });

  it("renders attendance-backed regular breaks without assignment history", () => {
    const [entry] = buildBreakPoolEntries({
      nowMs: NOW,
      defaultBreakMinutesByClubId: { clubA: 10 },
      dealers: [
        {
          attendanceId: "att-5",
          dealerId: "dealer-5",
          clubId: "clubA",
          fullName: "Pool Break Dealer",
          telegramUsername: null,
          tier: "B",
          checkInTime: isoFromNow(-70),
          currentState: "on_break",
        },
      ],
      regularAssignments: [],
      regularBreaks: [
        {
          id: "break-5",
          assignmentId: null,
          attendanceId: "att-5",
          breakStart: isoFromNow(-4),
          expectedDurationMinutes: 14,
          reason: "manual_available",
        },
      ],
      mealBreaks: [],
    });

    expect(entry.id).toBe("regular:break-5");
    expect(entry.isFallback).toBe(false);
    expect(entry.tableName).toBeNull();
    expect(entry.durationMinutes).toBe(14);
  });

  it("marks entries as soon or overdue from remaining break time", () => {
    const [entry] = buildBreakPoolEntries({
      nowMs: NOW,
      dealers: [
        {
          attendanceId: "att-4",
          dealerId: "dealer-4",
          clubId: "clubA",
          fullName: "Soon Dealer",
          telegramUsername: null,
          tier: "C",
          checkInTime: isoFromNow(-30),
          currentState: "on_break",
        },
      ],
      regularAssignments: [
        {
          assignmentId: "assign-4",
          attendanceId: "att-4",
          releasedAt: isoFromNow(-8),
          tableName: "Ban 22",
        },
      ],
      regularBreaks: [
        {
          id: "break-4",
          assignmentId: "assign-4",
          breakStart: isoFromNow(-8),
          expectedDurationMinutes: 9,
          reason: "manual",
        },
      ],
      mealBreaks: [],
    });

    expect(getBreakVisualState(entry, NOW, BREAK_SOON_WARNING_MINUTES)).toBe("soon");
    expect(getBreakTiming(entry, NOW).remainingMinutes).toBe(1);
    expect(getBreakVisualState(entry, NOW + 2 * 60_000, BREAK_SOON_WARNING_MINUTES)).toBe("overdue");
  });
});
