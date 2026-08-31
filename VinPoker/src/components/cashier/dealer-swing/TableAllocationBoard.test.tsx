import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DealerAssignment, GameTableRow } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";
import TableAllocationBoard from "./TableAllocationBoard";

const nowMs = Date.parse("2026-08-28T12:00:00.000Z");

const table: GameTableRow = {
  id: "table-1",
  club_id: "club-1",
  shift_id: null,
  status: "active",
  table_name: "Bàn 1",
  opened_at: null,
  dealer_open_operation_id: null,
};

const current: DealerAssignment = {
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
  game_tables: { id: "table-1", table_name: "Bàn 1", table_type: "cash", status: "active" },
  dealer_attendance: { current_state: "assigned", dealers: { full_name: "Dealer A" } },
};

const next: RotationScheduleRow = {
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
};

describe("TableAllocationBoard", () => {
  it("shows a stable loading state before table data is available", () => {
    render(
      <TableAllocationBoard
        tables={[]}
        canonicalAssignments={[]}
        activeRawData={[]}
        scheduleRows={[]}
        selectedTour={null}
        nowMs={nowMs}
        loading
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Đang tải bảng theo bàn")).toBeInTheDocument();
  });

  it("renders adjacent proportional bands and a visible open edge", () => {
    render(
      <TableAllocationBoard
        tables={[table]}
        canonicalAssignments={[current]}
        activeRawData={[current]}
        scheduleRows={[next]}
        selectedTour={null}
        nowMs={nowMs}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    const currentBand = screen.getByTitle(/Dealer A/);
    const nextBand = screen.getByTitle(/Dealer B/);
    expect(currentBand).toHaveStyle({ left: "0px", width: "240px" });
    expect(nextBand).toHaveStyle({ left: "240px", width: "480px" });
    expect(nextBand.className).toContain("table-allocation-open-edge");
  });

  it("keeps Times New Roman local to the allocation board and preserves tooltips", () => {
    render(
      <TableAllocationBoard
        tables={[table]}
        canonicalAssignments={[current]}
        activeRawData={[current]}
        scheduleRows={[]}
        selectedTour={null}
        nowMs={nowMs}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("BẢNG THEO BÀN").closest("div")?.parentElement).toHaveClass("font-table-allocation");
    expect(screen.getByTitle(/Dealer A/)).toHaveAttribute("aria-label", expect.stringContaining("Dealer A"));
  });

  it("renders untimed markers in a separate rail instead of anchoring them at NOW", () => {
    render(
      <TableAllocationBoard
        tables={[table]}
        canonicalAssignments={[current]}
        activeRawData={[current]}
        scheduleRows={[{ ...next, planned_relief_at: null }]}
        selectedTour={null}
        nowMs={nowMs}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId("untimed-marker-rail")).toHaveTextContent("LỊCH CHƯA CÓ GIỜ");
    expect(screen.getByTitle(/LỊCH CHƯA CÓ GIỜ/)).not.toHaveStyle({ left: "0px" });
  });

  it("does not clamp out-of-window markers, while an overdue marker stays visible at NOW", () => {
    const { rerender } = render(
      <TableAllocationBoard
        tables={[table]}
        canonicalAssignments={[current]}
        activeRawData={[current]}
        scheduleRows={[{ ...next, out_attendance_id: "attendance-other", planned_relief_at: "2026-08-28T14:00:00.000Z" }]}
        selectedTour={null}
        nowMs={nowMs}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByTitle(/LỊCH KHÔNG KHỚP DEALER/)).not.toBeInTheDocument();

    rerender(
      <TableAllocationBoard
        tables={[table]}
        canonicalAssignments={[current]}
        activeRawData={[current]}
        scheduleRows={[{ ...next, planned_relief_at: "2026-08-28T11:30:00.000Z" }]}
        selectedTour={null}
        nowMs={nowMs}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTitle(/CHỐT QUÁ GIỜ/)).toHaveStyle({ left: "0px" });
  });

  it("keeps the error visible and retries through the supplied parent flow", () => {
    const onRetry = vi.fn();
    render(
      <TableAllocationBoard
        tables={[table]}
        canonicalAssignments={[]}
        activeRawData={[]}
        scheduleRows={[]}
        selectedTour={null}
        nowMs={nowMs}
        loading={false}
        error="rotation unavailable"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("rotation unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Bàn 1")).toBeInTheDocument();
  });
});
