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
  it("marks one canonical active assignment as covered and open-ended", () => {
    const current = assignment();
    const [row] = project({ canonicalAssignments: [current], activeRawData: [current] });
    expect(row.coverage).toBe("covered");
    expect(row.segments[0]).toMatchObject({ status: "active", dealerName: "Dealer A", startAt: new Date(nowMs).toISOString(), endAt: null, openEnded: true });
  });

  it("uses opened_at as the only gap evidence and keeps legacy gaps unknown", () => {
    const [known] = project({ tables: [table({ opened_at: "2026-08-28T11:40:00.000Z" })] });
    expect(known.gapStartedAt).toBe("2026-08-28T11:40:00.000Z");

    const [unknown] = project();
    expect(unknown.gapStartedAt).toBeNull();
    expect(unknown.segments[0]).toMatchObject({ status: "gap", endAt: null, openEnded: true });
  });

  it("surfaces two active assignments as a conflict", () => {
    const a = assignment();
    const b = assignment({ id: "assignment-2", attendance_id: "attendance-2", dealer_attendance: { current_state: "assigned", dealers: { full_name: "Dealer B" } } });
    const [row] = project({ canonicalAssignments: [a], activeRawData: [a, b] });
    expect(row.coverage).toBe("conflict");
    expect(row.segments[0].status).toBe("conflict");
    expect(row.conflicts.some((conflict) => conflict.code === "multiple_assignments")).toBe(true);
  });

  it("excludes inactive pool and maintenance tables unless there is opening evidence", () => {
    expect(project({ tables: [table({ status: "inactive" })] })).toEqual([]);
    expect(project({ tables: [table({ status: "maintenance" })] })).toEqual([]);
    const [scheduled] = project({ tables: [table({ status: "inactive", dealer_open_operation_id: "operation-1" })] });
    expect(scheduled).toMatchObject({ coverage: "scheduled", requiresCoverage: false });
  });

  it("does not let predicted-only data add an inactive table", () => {
    expect(project({ tables: [table({ status: "inactive" })], scheduleRows: [schedule({ status: "predicted" })] })).toEqual([]);
  });

  it("scheduled inactive uses a neutral pre-band instead of a gap", () => {
    const [row] = project({ tables: [table({ status: "inactive" })], scheduleRows: [schedule({ out_attendance_id: null })] });
    expect(row).toMatchObject({ coverage: "scheduled", tableState: "scheduled" });
    expect(row.segments[0]).toMatchObject({ status: "scheduled", label: "SẮP MỞ", dealerName: null });
  });

  it("creates adjacent bands only for a monotonic identity-continuous chain", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [
        schedule(),
        schedule({ id: "slot-2", slot_index: 1, out_attendance_id: "attendance-2", in_attendance_id: "attendance-3", in_dealer_name: "Dealer C", planned_relief_at: "2026-08-28T12:45:00.000Z", status: "executing" }),
      ],
    });
    expect(row.segments).toHaveLength(3);
    expect(row.segments.map((segment) => [segment.dealerName, segment.startAt, segment.endAt, segment.openEnded])).toEqual([
      ["Dealer A", "2026-08-28T12:00:00.000Z", "2026-08-28T12:30:00.000Z", false],
      ["Dealer B", "2026-08-28T12:30:00.000Z", "2026-08-28T12:45:00.000Z", false],
      ["Dealer C", "2026-08-28T12:45:00.000Z", null, true],
    ]);
  });

  it("past-due announced keeps current dealer", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ planned_relief_at: "2026-08-28T11:30:00.000Z" })],
    });
    expect(row.segments).toHaveLength(1);
    expect(row.segments[0]).toMatchObject({ dealerName: "Dealer A", endAt: null, openEnded: true });
    expect(row.markers).toMatchObject([{ label: "CHỐT QUÁ GIỜ", at: "2026-08-28T12:00:00.000Z" }]);
  });

  it("keeps the selected dealer on a past-due delayed-relief marker", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ is_shortage: true, planned_relief_at: "2026-08-28T11:30:00.000Z" })],
    });
    expect(row.coverage).toBe("covered");
    expect(row.markers[0]).toMatchObject({
      status: "delayed",
      label: "DỰ KIẾN TRỄ QUÁ GIỜ",
      dealerName: "Dealer B",
      at: "2026-08-28T12:00:00.000Z",
    });
  });

  it("slot0 out mismatch breaks chain", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ out_attendance_id: "attendance-other" })],
    });
    expect(row.segments).toHaveLength(1);
    expect(row.segments[0].dealerName).toBe("Dealer A");
    expect(row.markers[0].label).toBe("LỊCH KHÔNG KHỚP DEALER");
  });

  it("does not chain a stale slot0 with the same attendance but a different assignment", () => {
    const current = assignment({ id: "assignment-current" });
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ assignment_id: "assignment-old" })],
    });
    expect(row.segments).toHaveLength(1);
    expect(row.segments[0]).toMatchObject({ dealerName: "Dealer A", endAt: null, openEnded: true });
    expect(row.markers[0].label).toBe("LỊCH THUỘC ASSIGNMENT CŨ");
  });

  it("slot1 identity mismatch breaks chain", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [
        schedule(),
        schedule({ id: "slot-2", slot_index: 1, out_attendance_id: "attendance-other", in_attendance_id: "attendance-3", in_dealer_name: "Dealer C", planned_relief_at: "2026-08-28T12:45:00.000Z" }),
      ],
    });
    expect(row.segments.map((segment) => segment.dealerName)).toEqual(["Dealer A", "Dealer B"]);
    expect(row.segments[1]).toMatchObject({ endAt: null, openEnded: true });
    expect(row.markers[0].label).toBe("LỊCH KHÔNG KHỚP DEALER");
  });

  it("shortage renders shortage and never becomes an unnamed locked dealer", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ in_attendance_id: null, in_dealer_name: null, is_shortage: true })],
    });
    expect(row.coverage).toBe("covered");
    expect(row.segments[1]).toMatchObject({ status: "shortage", label: "THIẾU DEALER DỰ KIẾN", dealerName: null });
  });

  it("keeps a selected incoming dealer visible when the relief is delayed", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ is_shortage: true })],
    });
    expect(row.coverage).toBe("covered");
    expect(row.segments[1]).toMatchObject({ status: "delayed", label: "DỰ KIẾN TRỄ", dealerName: "Dealer B" });
  });

  it("continues the identity chain through a delayed selected incoming dealer", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [
        schedule({ is_shortage: true }),
        schedule({ id: "slot-2", assignment_id: null, slot_index: 1, out_attendance_id: "attendance-2", in_attendance_id: "attendance-3", in_dealer_name: "Dealer C", planned_relief_at: "2026-08-28T12:45:00.000Z" }),
      ],
    });
    expect(row.segments.map((segment) => [segment.dealerName, segment.status])).toEqual([
      ["Dealer A", "active"],
      ["Dealer B", "delayed"],
      ["Dealer C", "locked"],
    ]);
  });

  it("does not call a missing incoming dealer a shortage without is_shortage", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ in_attendance_id: null, in_dealer_name: null, is_shortage: false })],
    });
    expect(row.segments).toHaveLength(1);
    expect(row.markers[0]).toMatchObject({ status: "conflict", label: "LỊCH XUNG ĐỘT · THIẾU DEALER" });
  });

  it("missing middle boundary does not bridge", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [
        schedule(),
        schedule({ id: "slot-2", slot_index: 1, out_attendance_id: "attendance-2", in_attendance_id: "attendance-3", in_dealer_name: "Dealer C", planned_relief_at: null }),
        schedule({ id: "slot-3", slot_index: 2, out_attendance_id: "attendance-3", in_attendance_id: "attendance-4", in_dealer_name: "Dealer D", planned_relief_at: "2026-08-28T13:00:00.000Z" }),
      ],
    });
    expect(row.segments.map((segment) => segment.dealerName)).toEqual(["Dealer A", "Dealer B"]);
    expect(row.segments[1]).toMatchObject({ endAt: null, openEnded: true });
    expect(row.markers.map((marker) => marker.label)).toEqual(["LỊCH CHƯA CÓ GIỜ", "LỊCH KHÔNG LIÊN TỤC"]);
  });

  it("keeps a valid chain across sticky rows from different plan runs", () => {
    const current = assignment();
    const [row] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [
        schedule({ plan_run_id: "run-1" }),
        schedule({ id: "slot-2", slot_index: 1, out_attendance_id: "attendance-2", in_attendance_id: "attendance-3", in_dealer_name: "Dealer C", planned_relief_at: "2026-08-28T12:45:00.000Z", plan_run_id: "run-2" }),
      ],
    });
    expect(row.segments.map((segment) => segment.dealerName)).toEqual(["Dealer A", "Dealer B", "Dealer C"]);
  });

  it("keeps past executing and predicted rows as markers", () => {
    const current = assignment();
    const [executing] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ status: "executing", planned_relief_at: "2026-08-28T11:30:00.000Z" })],
    });
    expect(executing.markers[0].label).toBe("ĐANG THỰC HIỆN");

    const [predicted] = project({
      canonicalAssignments: [current],
      activeRawData: [current],
      scheduleRows: [schedule({ status: "predicted", planned_relief_at: "2026-08-28T11:30:00.000Z" })],
    });
    expect(predicted.markers[0].label).toBe("DỰ ĐOÁN QUÁ GIỜ");
  });
});
