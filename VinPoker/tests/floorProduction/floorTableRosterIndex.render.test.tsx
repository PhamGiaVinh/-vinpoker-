import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FloorTableRosterIndex } from "../../src/components/ops/shared/FloorTableRosterIndex";

afterEach(cleanup);

describe("FloorTableRosterIndex", () => {
  it("replaces the old table glyph with a direct roster entry for every table", () => {
    const onOpen = vi.fn();

    render(
      <FloorTableRosterIndex
        onOpen={onOpen}
        tables={[
          {
            id: "table-2",
            tableNumber: 2,
            tableName: "Bàn 2",
            occupiedSeatNumbers: [1, 4, 9],
            maxSeats: 9,
            status: "running",
            controlMode: "manual",
          },
          {
            id: "table-30",
            tableNumber: 30,
            tableName: "Bàn 30",
            occupiedSeatNumbers: [],
            maxSeats: 9,
            status: "open",
            controlMode: "tracker",
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId("floor-table-roster-card")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Bàn 2, 3\/9 ghế, Manual Floor/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bàn 30, 0\/9 ghế, Live Tracker/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Bàn 30/i }));
    expect(onOpen).toHaveBeenCalledWith("table-30");
  });
});
