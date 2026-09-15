import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FloorEntryPicker } from "../../src/components/ops/shared/FloorEntryPicker";

afterEach(cleanup);

const seatable = [
  {
    entryId: "entry-a",
    playerId: "player-a",
    entryNo: 1,
    displayName: "Nguyễn Văn Tên Rất Dài",
    currentStack: 30_000,
    registrationId: "registration-a",
  },
  {
    entryId: "entry-b",
    playerId: "player-b",
    entryNo: 22,
    displayName: "Tom Dwan",
    currentStack: 15_000,
    registrationId: "registration-b",
  },
];

const restorable = [
  {
    entryId: "entry-c",
    playerId: "player-c",
    entryNo: 3,
    displayName: "Phil Ivey",
    currentStack: 0,
  },
];

describe("FloorEntryPicker", () => {
  it("shows a scrollable entry list before typing and selects by entry id", () => {
    const onChange = vi.fn();
    render(
      <FloorEntryPicker
        seatableEntries={seatable}
        restorableEntries={restorable}
        value={null}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Nguyễn Văn Tên Rất Dài")).toBeInTheDocument();
    expect(screen.getByText("Tom Dwan")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("floor-entry-seat-entry-b"));
    expect(onChange).toHaveBeenCalledWith({ kind: "seat", entryId: "entry-b" });
  });

  it("filters by entry number and keeps busted players in a separate restore group", () => {
    const onChange = vi.fn();
    render(
      <FloorEntryPicker
        seatableEntries={seatable}
        restorableEntries={restorable}
        value={null}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm theo tên hoặc số entry" }), { target: { value: "22" } });
    expect(screen.getByText("Tom Dwan")).toBeInTheDocument();
    expect(screen.queryByText("Nguyễn Văn Tên Rất Dài")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Đã loại 1/ }));
    expect(screen.getByText("Phil Ivey")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("floor-entry-restore-entry-c"));
    expect(onChange).toHaveBeenCalledWith({ kind: "restore", entryId: "entry-c" });
  });
});
