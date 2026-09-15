import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RealtimeTablesGrid } from "./RealtimeTablesGrid";
import type { PublicTableSnapshot } from "./publicSnapshotTypes";

vi.mock("../PokerVisuals", () => ({ PokerCard: ({ card }: { card: string }) => <span>{card}</span> }));
const makeTable = (id: string): PublicTableSnapshot => ({
  tableId: id, tableSessionId: `session-${id}`, name: `Bàn ${id}`, handId: `hand-${id}`,
  handNumber: 1, buttonSeat: 1, street: "flop", board: ["AS", "KH", "2C"], pot: 1000,
  bigBlind: 200, smallBlind: 100, trackerState: "live", players: [{ entryId: `entry-${id}`,
    playerId: `player-${id}`, entryNumber: 1, seatNumber: 1, name: `Player ${id}`, avatarUrl: null, stack: 2000 }],
  latestAction: { playerId: `player-${id}`, entryNumber: 1, actionType: "call", amount: 200 },
});

describe("simultaneous public tables", () => {
  it("updates each table's board, pot and action independently, keeping history scoped", () => {
    const tables = [makeTable("2"), makeTable("5")];
    const props = { tables, catalog: tables.map(t => ({ tableId: t.tableId, name: t.name, playerCount: 1, searchPlayers: [] })),
      onVisibleTableIds: vi.fn(), onView: vi.fn(), onHistory: vi.fn() };
    const { rerender } = render(<RealtimeTablesGrid {...props} />);
    const table2 = within(screen.getByRole("article", { name: "Bàn 2" }));
    const table5 = within(screen.getByRole("article", { name: "Bàn 5" }));
    rerender(<RealtimeTablesGrid {...props} tables={[{ ...tables[0], board: ["AS", "KH", "2C", "TD"], pot: 1500,
      latestAction: { ...tables[0].latestAction!, actionType: "bet", amount: 500 } }, tables[1]]} />);
    expect(table2.getByText("TD")).toBeInTheDocument();
    expect(table2.getByText("POT 7.5 BB")).toBeInTheDocument();
    expect(table2.getByText(/bet 2.5 BB/)).toBeInTheDocument();
    expect(table5.queryByText("TD")).not.toBeInTheDocument();
    expect(table5.getByText("POT 5 BB")).toBeInTheDocument();
    table2.getByRole("button", { name: "Lịch sử" }).click();
    expect(props.onHistory).toHaveBeenCalledWith("2");
    expect(props.onVisibleTableIds).toHaveBeenCalledWith(["2", "5"]);
  });
});
