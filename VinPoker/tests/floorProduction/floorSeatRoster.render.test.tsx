import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FloorSeatRoster } from "../../src/components/ops/shared/FloorSeatRoster";

afterEach(cleanup);

describe("FloorSeatRoster", () => {
  it("keeps all nine seats visible and exposes Empty as an intentional action", () => {
    const onSeatTap = vi.fn();
    const onEmptySeatTap = vi.fn();

    render(
      <FloorSeatRoster
        seats={[
          { seatNumber: 1, playerName: "Player A", chipsLabel: "30.000", entryNumber: 1 },
          { seatNumber: 9, playerName: "Player I", chipsLabel: "0", entryNumber: 2 },
        ]}
        onSeatTap={onSeatTap}
        onEmptySeatTap={onEmptySeatTap}
      />,
    );

    expect(screen.getAllByTestId(/floor-seat-row-/)).toHaveLength(9);
    expect(screen.getAllByText("Empty")).toHaveLength(7);

    fireEvent.click(screen.getByTestId("floor-seat-row-1"));
    fireEvent.click(screen.getByTestId("floor-seat-row-2"));
    expect(onSeatTap).toHaveBeenCalledWith(1);
    expect(onEmptySeatTap).toHaveBeenCalledWith(2);
  });

  it("disables every row when the server projection contains duplicate seats", () => {
    render(
      <FloorSeatRoster
        seats={[
          { seatNumber: 3, playerName: "First", chipsLabel: "10" },
          { seatNumber: 3, playerName: "Second", chipsLabel: "20" },
        ]}
        onSeatTap={() => {}}
        onEmptySeatTap={() => {}}
      />,
    );

    expect(screen.getByText(/Trùng dữ liệu ghế 3/)).toBeInTheDocument();
    for (const row of screen.getAllByTestId(/floor-seat-row-/)) {
      expect(row).toBeDisabled();
    }
  });
});
