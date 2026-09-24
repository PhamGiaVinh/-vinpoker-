import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, expect, it } from "vitest";
import { FloorTableMapPanelV3 } from "@/components/cashier/tournament-live/FloorTableMapPanelV3";
import type { Tournament } from "@/types/tournament";

const fixture = vi.hoisted(() => ({
  longName: "CODEX_FLOOR_UAT_20260724114346_7ff93193_CASHIER",
  client: {
    enabled: true,
    getTournamentTableRoster: vi.fn(),
    getSeatableEntries: vi.fn(),
    getRestorableEntries: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => ({}) }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => fixture.client }));
vi.mock("@/components/ops/shared/FloorTableRosterIndex", () => ({
  FloorTableRosterIndex: ({ onOpen }: { onOpen: (id: string) => void }) =>
    <button onClick={() => onOpen("table-1")}>Mở Bàn 4</button>,
}));
vi.mock("@/components/ops/shared/FloorSeatRoster", () => ({
  FloorSeatRoster: ({ onSeatTap }: { onSeatTap: (seat: number) => void }) =>
    <button onClick={() => onSeatTap(1)}>Mở Ghế 1</button>,
}));
vi.mock("@/components/cashier/tournament-live/OpenTableDialog", () => ({ OpenTableDialog: () => null }));
vi.mock("@/components/cashier/tournament-live/FloorRedrawDialogV1", () => ({ FloorRedrawDialogV1: () => null }));

function setup() {
  fixture.client.getTournamentTableRoster.mockResolvedValue({ ok: true, data: [{
    tournamentId: "tour-1", tournamentTableId: "table-1", gameTableId: "physical-1",
    tableNumber: 4, tableName: "Bàn 4", tableSessionId: "session-1",
    sessionRevision: 3, controlMode: "manual", controlEpoch: 1,
    maxSeats: 9, tournamentTableStatus: "active", sessionClosedAt: null,
    activeDealerAssignmentId: null, seatLocks: [], seats: [{
      seatNumber: 1, entryId: "entry-1", playerId: "player-1",
      displayName: fixture.longName, entryNo: 1, chipCount: 30_000_000, isActive: true,
    }],
  }, {
    tournamentId: "tour-1", tournamentTableId: "table-2", gameTableId: "physical-2",
    tableNumber: 5, tableName: "Bàn 5", tableSessionId: "session-2",
    sessionRevision: 4, controlMode: "tracker", controlEpoch: 1,
    maxSeats: 9, tournamentTableStatus: "active", sessionClosedAt: null,
    activeDealerAssignmentId: null, seatLocks: [], seats: [],
  }] });
  fixture.client.getSeatableEntries.mockResolvedValue({ ok: true, data: [] });
  fixture.client.getRestorableEntries.mockResolvedValue({ ok: true, data: [] });
  render(<FloorTableMapPanelV3 tournament={{ id: "tour-1" } as Tournament} refreshTrigger={0} />);
}

describe("Floor roster mobile actions", () => {
  it("reveals destination controls only after Move is selected", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
    expect(screen.queryByLabelText("Bàn đích")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
    expect(screen.getByLabelText("Bàn đích")).toBeTruthy();
    expect(screen.getByLabelText("Ghế đích")).toBeTruthy();
  });

  it("keeps long names inside Vietnamese action dialogs", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Loại khỏi giải" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(fixture.longName).className).toContain("break-all");
    expect(dialog.className).toContain("operations-typography");
    expect(dialog.className).toContain("w-[calc(100vw-2rem)]");
    fireEvent.click(within(dialog).getByRole("button", { name: "Giữ người chơi" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Rời ghế" }));
    expect(within(screen.getByRole("alertdialog")).getByText(/giữ nguyên chip và trở về danh sách chờ/)).toBeTruthy();
  });
});
