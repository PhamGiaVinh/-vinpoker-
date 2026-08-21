import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TrackerRacetrack } from "@/components/tracker/TrackerRacetrack";

afterEach(cleanup);

describe("Tracker analytics seat sub-control", () => {
  it("opens analytics without changing the acting seat", () => {
    const onSeatTap = vi.fn();
    const onAnalyticsTap = vi.fn();
    render(
      <TrackerRacetrack
        seats={[{ playerId: "player-a", seatNumber: 1, name: "Player A", stack: 20_000 }]}
        actingSeatNumber={null}
        boardCards={[]}
        pot={0}
        bigBlind={200}
        rich
        onSeatTap={onSeatTap}
        onAnalyticsTap={onAnalyticsTap}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mở phân tích vận hành của Player A" }));
    expect(onAnalyticsTap).toHaveBeenCalledTimes(1);
    expect(onAnalyticsTap).toHaveBeenCalledWith(expect.objectContaining({ playerId: "player-a", seatNumber: 1 }));
    expect(onSeatTap).not.toHaveBeenCalled();
  });
});
