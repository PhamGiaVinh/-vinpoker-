import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameTableRow } from "@/hooks/useDealerSwing";
import TableAllocationBoard from "./TableAllocationBoard";

const table: GameTableRow = {
  id: "table-1",
  club_id: "club-1",
  shift_id: null,
  status: "active",
  table_name: "Bàn 1",
  opened_at: null,
  dealer_open_operation_id: null,
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
        nowMs={Date.parse("2026-08-28T12:00:00.000Z")}
        loading
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Đang tải bảng theo bàn")).toBeInTheDocument();
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
        nowMs={Date.parse("2026-08-28T12:00:00.000Z")}
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
