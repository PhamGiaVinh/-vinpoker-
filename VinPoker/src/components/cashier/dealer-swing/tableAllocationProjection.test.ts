import { describe, expect, it } from "vitest";
import type { DealerAssignment, GameTableRow } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";
import { buildTableAllocationRows } from "./tableAllocationProjection";

const nowMs = Date.parse("2026-08-28T12:00:00.000Z");

function table(overrides: Partial<GameTableRow> = {}): GameTableRow {
  return {
    id: "table-1",
    club_id: "club-1",
    shift_id: null,
    status: "active",
    table_name: "Bàn 2",
    opened_at: null,
    dealer_open_operation_id: null,
    ...overrides,
  };
}

function assignment(overrides: Partial<DealerAssignment> = {}): DealerAssignment {
  return {
    id: "assignment-1",
    attendance_id: "attendance-1",
    table_id: "table-1",
    assigned_at: "2026-08-28T11:00:00.000Z",
    released_at: null,
    status: "assigned",
    version: 1,
    updated_at: "2026-08-28T11:00:00.000Z",
    last_swing_attempted_at: null,
    swing_in_progress: false,
    swing_processed_at: null,
    swing_due_at: null,
    pre_assigned_attendance_id: null,
    pre_assigned_at: null,
    overtime_started_at: null,
    pre_assign_status: "none",
    game_tables: { id: "table-1", table_name: "Bàn 2", table_type: "cash", status: "active" },
    dealer_attendance: { current_state: "assigned", dealers: { full_name: "Dealer A" } },
    ...overrides,
  };
}

function schedule(overrides: Partial<RotationScheduleRow> = {}): RotationScheduleRow {
  return {
    id: "slot-1",
    club_id: "club-1",
    table_id: "table-1",
    assignment_id: "assignment-1",
    slot_index: 0,
    out_attendance_id: "attendance-1",
    in_attendance_id: "attendance-2",
    planned_relief_at: "2026-08-28T12:30:00.000Z",
    announce_at: null,
    status: "announced",
    is_shortage: false,
    is_emergency: false,
    plan_run_id: null,
    solver_version: null,
    score: null,
    reason: null,
    version: 1,
    created_at: "2026-08-28T11:00:00.000Z",
    updated_at: "2026-08-28T11:00:00.000Z",
    in_dealer_name: "Dealer B",
    in_dealer_tier: "A",
    ...overrides,
  };
}

function project(overrides: Partial<Parameters<typeof buildTableAllocationRows>[0]> = {}) {
  return buildTableAllocationRows({
    tables: [table()],
    canonicalAssignments: [],
    activeRawData: [],
    scheduleRows: [],
    nowMs,
    ...overrides,
  });
}

describe("buildTableAllocationRows", () => {
  it("marks one canonical active assignment as covered", () => {
    const current = assignment();
    const [row] = project({ canonicalAssignments: [current], activeRawData: [current] });
    expect(row.coverage).toBe("covered");
    expect(row.segments[0]).toMatchObject({ status: "active", dealerName: "Dealer A" });
    expect(row.segments[0].startAt).toBe(new Date(nowMs).toISOString());
  });

  it("uses opened_at as the only V1 gap evidence", () => {
    const [row] = project({ tables: [table({ opened_at: "2026-08-28T11:40:00.000Z" })] });
    expect(row.coverage).toBe("gap");
    expect(row.gapStartedAt).toBe("2026-08-28T11:40:00.000Z");
  });

  it("keeps a gap timestamp unknown without current-session evidence", () => {
    const [row] = project();
    expect(row.coverage).toBe("gap");
    expect(row.gapStartedAt).toBeNull();
    expect(row.segments[0]).toMatchObject({ status: "gap", startAt: null });
  });

  it("surfaces two active assignments as a conflict", () => {
    const a = assignment();
    const b = assignment({ id: "assignment-2", attendance_id: "attendance-2", dealer_attendance: { current_state: "assigned", dealers: { full_name: "Dealer B" } } });
    const [row] = project({ canonicalAssignments: [a], activeRawData: [a, b] });
    expect(row.coverage).toBe("conflict");
    expect(row.conflicts.some((conflict) => conflict.code === "multiple_assignments")).toBe(true);
  });

  it("excludes inactive pool and maintenance tables unless a canonical opening signal exists", () => {
    expect(project({ tables: [table({ status: "inactive" })] })).toEqual([]);
    expect(project({ tables: [table({ status: "maintenance" })] })).toEqual([]);
    const [scheduled] = project({ tables: [table({ status: "inactive", dealer_open_operation_id: "operation-1" })] });
    expect(scheduled.coverage).toBe("scheduled");
    expect(scheduled.requiresCoverage).toBe(false);
  });

  it("does not let predicted-only data add an inactive table", () => {
    expect(project({ tables: [table({ status: "inactive" })], scheduleRows: [schedule({ status: "predicted" })] })).toEqual([]);
  });

  it("adds an inactive table only for an announced or executing slot inside the forward window", () => {
    const [announced] = project({ tables: [table({ status: "inactive" })], scheduleRows: [schedule()] });
    expect(announced).toMatchObject({ coverage: "scheduled", requiresCoverage: false });

    expect(project({
      tables: [table({ status: "inactive" })],
      scheduleRows: [schedule({ planned_relief_at: "2026-08-28T13:31:00.000Z" })],
    })).toEqual([]);
  });

  it("labels announced and executing slots without turning predictions into coverage", () => {
    const [row] = project({
      scheduleRows: [
        schedule(),
        schedule({ id: "slot-2", slot_index: 1, status: "executing", planned_relief_at: "2026-08-28T12:45:00.000Z" }),
        schedule({ id: "slot-3", slot_index: 2, status: "predicted", planned_relief_at: "2026-08-28T13:00:00.000Z" }),
      ],
    });
    expect(row.coverage).toBe("gap");
    expect(row.segments.map((segment) => segment.label)).toEqual(expect.arrayContaining(["CHỐT", "ĐANG THỰC HIỆN ĐỔI DEALER", "DỰ ĐOÁN"]));
  });

  it("keeps a schedule without a time as a marker record, not a fake duration", () => {
    const [row] = project({ scheduleRows: [schedule({ planned_relief_at: null })] });
    expect(row.unplacedSlots).toHaveLength(1);
    expect(row.unplacedSlots[0].startAt).toBeNull();
  });
});
