import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRE_ASSIGN_STALE_WINDOW_MS,
  DEFAULT_MIN_BREAK_MINUTES,
  ZOMBIE_LOCK_WINDOW_MS,
  derivePreAssignStatus,
  isOnBreakStillCooling,
  pickPreferredAssignment,
  sortPass3Candidates,
} from "../dealerSwingState";

const NOW = Date.parse("2026-06-10T01:00:00.000Z");

const isoFromNow = (offsetMinutes: number) =>
  new Date(NOW + offsetMinutes * 60_000).toISOString();

const makeAssignment = (overrides: Partial<any> = {}) => ({
  id: "assign-1",
  table_id: "table-1",
  assigned_at: isoFromNow(-20),
  released_at: null,
  swing_processed_at: null,
  updated_at: isoFromNow(-1),
  last_swing_attempted_at: null,
  swing_in_progress: false,
  version: 1,
  status: "assigned",
  swing_due_at: isoFromNow(10),
  pre_assigned_attendance_id: null,
  pre_assigned_at: null,
  overtime_started_at: null,
  ...overrides,
});

describe("dealerSwingState", () => {
  it("derives pre-assign status across valid, in-progress, stale, expired, and none", () => {
    expect(derivePreAssignStatus(makeAssignment(), NOW)).toBe("none");
    expect(derivePreAssignStatus(makeAssignment({
      pre_assigned_attendance_id: "att-1",
      pre_assigned_at: isoFromNow(-5),
    }), NOW)).toBe("valid");
    expect(derivePreAssignStatus(makeAssignment({
      pre_assigned_attendance_id: "att-1",
      swing_in_progress: true,
      updated_at: isoFromNow(-1),
      last_swing_attempted_at: isoFromNow(-1),
    }), NOW)).toBe("in_progress");
    expect(derivePreAssignStatus(makeAssignment({
      pre_assigned_attendance_id: "att-1",
      pre_assigned_at: isoFromNow(-(DEFAULT_PRE_ASSIGN_STALE_WINDOW_MS / 60_000 + 1)),
    }), NOW)).toBe("stale");
    expect(derivePreAssignStatus(makeAssignment({
      pre_assigned_attendance_id: "att-1",
      released_at: isoFromNow(-1),
      pre_assigned_at: isoFromNow(-5),
    }), NOW)).toBe("expired");
    expect(derivePreAssignStatus(makeAssignment({
      pre_assigned_attendance_id: "att-1",
      swing_in_progress: true,
      updated_at: isoFromNow(-(ZOMBIE_LOCK_WINDOW_MS / 60_000 + 1)),
      last_swing_attempted_at: isoFromNow(-(ZOMBIE_LOCK_WINDOW_MS / 60_000 + 1)),
    }), NOW)).toBe("expired");
  });

  it("sorts pass-3 candidates as pre-assigned due, plain overdue, then OT", () => {
    const rows = sortPass3Candidates([
      makeAssignment({
        id: "plain-overdue",
        table_id: "T-2",
        swing_due_at: isoFromNow(-5),
      }),
      makeAssignment({
        id: "preassigned-due",
        table_id: "T-1",
        pre_assigned_attendance_id: "att-1",
        pre_assigned_at: isoFromNow(-2),
        swing_due_at: isoFromNow(-10),
      }),
      makeAssignment({
        id: "ot-row",
        table_id: "T-3",
        overtime_started_at: isoFromNow(-3),
        swing_due_at: isoFromNow(-1),
      }),
    ],);

    expect(rows.map((row) => row.id)).toEqual(["preassigned-due", "plain-overdue", "ot-row"]);
  });

  it("prefers a fresh in-progress row but does not let a stale shadow row dominate", () => {
    const freshInProgress = makeAssignment({
      id: "fresh",
      table_id: "T-1",
      pre_assigned_attendance_id: "att-1",
      swing_in_progress: true,
      updated_at: isoFromNow(-1),
      last_swing_attempted_at: isoFromNow(-1),
    });
    const staleShadow = makeAssignment({
      id: "stale",
      table_id: "T-1",
      pre_assigned_attendance_id: "att-1",
      swing_in_progress: true,
      updated_at: isoFromNow(-5),
      last_swing_attempted_at: isoFromNow(-5),
      version: 2,
    });
    const newerPlain = makeAssignment({
      id: "newer",
      table_id: "T-1",
      pre_assigned_attendance_id: null,
      updated_at: isoFromNow(-0.5),
      version: 3,
    });

    expect(pickPreferredAssignment(staleShadow, freshInProgress, NOW).id).toBe("fresh");
    expect(pickPreferredAssignment(staleShadow, newerPlain, NOW).id).toBe("newer");
  });

  it("treats an active break as cooling until the configured minimum break minutes elapse", () => {
    expect(isOnBreakStillCooling(isoFromNow(-5), NOW, DEFAULT_MIN_BREAK_MINUTES)).toBe(true);
    expect(isOnBreakStillCooling(isoFromNow(-10), NOW, DEFAULT_MIN_BREAK_MINUTES)).toBe(false);
    expect(isOnBreakStillCooling(null, NOW, DEFAULT_MIN_BREAK_MINUTES)).toBe(false);
  });
});
