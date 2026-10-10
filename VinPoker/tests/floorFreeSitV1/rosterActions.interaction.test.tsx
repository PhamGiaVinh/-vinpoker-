import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, expect, it } from "vitest";
import { FloorTableMapPanelV3 } from "@/components/cashier/tournament-live/FloorTableMapPanelV3";
import type { Tournament } from "@/types/tournament";

const fixture = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
  longName: "CODEX_FLOOR_UAT_20260724114346_7ff93193_CASHIER",
  client: {
    enabled: true,
    getTournamentTableRoster: vi.fn(),
    getSeatableEntries: vi.fn(),
    getRestorableEntries: vi.fn(),
    getPendingTrackerMoves: vi.fn(),
    getTableControlModeRequest: vi.fn(),
    requestTableControlMode: vi.fn(),
    cancelTableControlModeRequest: vi.fn(),
    movePlayerSeat: vi.fn(),
    queueTrackerMove: vi.fn(),
    cancelPendingTrackerMove: vi.fn(),
    planBreakTable: vi.fn(),
    breakTournamentTable: vi.fn(),
    redrawSeatLockEnabled: true,
    deferredTrackerMoveEnabled: true,
  },
}));

vi.mock("sonner", () => ({ toast: { success: fixture.successToast, error: fixture.errorToast } }));

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

function setup(options: { pendingNetworkFailure?: boolean } = {}) {
  vi.clearAllMocks();
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
  fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: { request: null } });
  fixture.client.requestTableControlMode.mockResolvedValue({ ok: true, data: { outcome: "applied" } });
  fixture.client.cancelTableControlModeRequest.mockResolvedValue({ ok: true, data: {} });
  if (options.pendingNetworkFailure) fixture.client.getPendingTrackerMoves.mockRejectedValue(new Error("offline"));
  else fixture.client.getPendingTrackerMoves.mockResolvedValue({ ok: true, data: [] });
  fixture.client.planBreakTable.mockResolvedValue({ ok: true, data: {
    planHash: "plan-hash-1", complete: true,
    sourceTournamentTableId: "table-1", sourceTableNumber: 4, expectedRevision: 3,
    moves: [{
      entryId: "entry-1", playerName: fixture.longName, sourceSeatNumber: 1,
      destinationTournamentTableId: "table-2", destinationTableNumber: 5,
      destinationSeatNumber: 2, transferMode: "after_current_hand",
    }],
  } });
  fixture.client.breakTournamentTable.mockResolvedValue({ ok: true, data: { ok: true, break_pending: true } });
  return render(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={0} />);
}

describe("Floor roster mobile actions", () => {
  it.each(["pending", "closed", "wrong-session"])("validates a %s break receipt before announcing closure", async (outcome) => {
    const view = setup();
    try {
      fixture.client.breakTournamentTable.mockResolvedValue({ ok: true, data: {
        ok: true, tournament_table_id: "table-1",
        table_session_id: outcome === "wrong-session" ? "old-session" : "session-1",
        closed: outcome === "closed", break_pending: outcome !== "closed",
        moved_count: outcome === "closed" ? 1 : 0, pending_count: outcome === "closed" ? 0 : 1,
      } });
      fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
      fireEvent.click(screen.getByRole("button", { name: "Đóng & chuyển người" }));
      const confirm = await screen.findByRole("button", { name: "Xác nhận đóng & chuyển" });
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);
      await waitFor(() => expect(fixture.client.breakTournamentTable).toHaveBeenCalledTimes(1));
      if (outcome === "wrong-session") {
        await waitFor(() => expect(fixture.errorToast).toHaveBeenCalled());
        expect(screen.getByRole("button", { name: "Xác nhận đóng & chuyển" })).not.toBeDisabled();
        expect(fixture.successToast).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(fixture.successToast).toHaveBeenCalledWith(outcome === "pending"
          ? "Đã lưu yêu cầu chuyển người. Bàn còn mở đến khi các lượt chuyển hoàn tất."
          : "Đã đóng và chuyển người chơi."));
      }
    } finally { view.unmount(); }
  });

  it("ignores an earlier actor's delayed roster after the account changes", async () => {
    const view = setup();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
      await screen.findByText(/Revision 3 · epoch 1/);
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      let finishOld!: (value: typeof initial) => void;
      fixture.client.getTournamentTableRoster.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, sessionRevision: 11, controlEpoch: 4 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-b" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      await screen.findByText(/Revision 11 · epoch 4/);
      await act(async () => { finishOld(initial); });
      expect(screen.getByText(/Revision 11 · epoch 4/)).toBeTruthy();
      expect(screen.queryByText(/Revision 3 · epoch 1/)).toBeNull();
    } finally { view.unmount(); }
  });

  it("does not reload roster on repeated null mode polls without an observed pending request", async () => {
    let poll: (() => void) | undefined;
    const interval = vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      if (delay === 4000 && typeof callback === "function") poll = callback as () => void;
      return 123;
    });
    const view = setup();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
      await waitFor(() => expect(fixture.client.getTableControlModeRequest).toHaveBeenCalledTimes(1));
      await act(async () => { poll!(); });
      await act(async () => { poll!(); });
      expect(fixture.client.getTournamentTableRoster).toHaveBeenCalledTimes(1);
    } finally { view.unmount(); interval.mockRestore(); }
  });

  it("does not overwrite a newer roster with a delayed earlier refresh", async () => {
    const view = setup();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
      await screen.findByText(/Revision 3 · epoch 1/);
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      let finishOld!: (value: typeof initial) => void;
      fixture.client.getTournamentTableRoster.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, sessionRevision: 9, controlEpoch: 3 } : table,
      ) });
      view.rerender(<FloorTableMapPanelV3 actorId="owner-a" tournament={{ id: "tour-1" } as Tournament} refreshTrigger={2} />);
      await screen.findByText(/Revision 9 · epoch 3/);
      await act(async () => { finishOld(initial); });
      expect(screen.getByText(/Revision 9 · epoch 3/)).toBeTruthy();
      expect(screen.queryByText(/Revision 3 · epoch 1/)).toBeNull();
    } finally { view.unmount(); }
  });

  it.each(["open", "closed", "refresh-error"])("refreshes canonical roster at the hand boundary with picker %s", async (state) => {
    let poll: (() => void) | undefined;
    const interval = vi.spyOn(window, "setInterval").mockImplementation((callback, delay) => {
      if (delay === 4000 && typeof callback === "function") poll = callback as () => void;
      return 123;
    });
    const view = setup();
    try {
      fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: {
        request: { id: "mode-request-1", target_mode: "tracker", blockers: ["active_hand"] },
      } });
      fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      await waitFor(() => expect(fixture.client.getTournamentTableRoster).toHaveBeenCalledTimes(2));
      if (state === "closed") fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      const initial = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initial, data: initial.data.map(
        (table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, controlMode: "tracker", sessionRevision: 4, controlEpoch: 2 } : table,
      ) });
      fixture.client.getTableControlModeRequest.mockResolvedValue({ ok: true, data: { request: null } });
      if (state === "refresh-error") fixture.client.getTournamentTableRoster.mockRejectedValueOnce(new Error("offline"));
      expect(poll).toBeDefined();
      await act(async () => { poll!(); });
      if (state === "refresh-error") {
        await screen.findByText(/Không tải được danh sách bàn/);
        await act(async () => { poll!(); });
      }
      await screen.findByText(/Revision 4 · epoch 2/);
      expect(screen.getByRole("button", { name: /Live Tracker.*Đổi chế độ/ })).toBeTruthy();
    } finally {
      view.unmount();
      interval.mockRestore();
    }
  });

  it.each(["session", "actor"])("does not reuse another %s's unknown-outcome intent", async (scope) => {
    const view = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
    fireEvent.click(screen.getByTestId("floor-v3-mode-tracker"));
    fixture.client.requestTableControlMode.mockRejectedValueOnce(new Error("response lost"));
    fireEvent.click(screen.getByRole("button", { name: "Lưu chế độ" }));
    await screen.findByText(/Mất kết nối khi thao tác/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Lưu chế độ" })).not.toBeDisabled());
    const original = fixture.client.requestTableControlMode.mock.calls[0][0];
    if (scope === "session") {
      const roster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
      fixture.client.getTournamentTableRoster.mockResolvedValue({ ...roster,
        data: roster.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
          ? { ...table, tableSessionId: "session-reopened", sessionRevision: 9, controlEpoch: 3 } : table),
      });
    }
    view.rerender(<FloorTableMapPanelV3 actorId={scope === "actor" ? "owner-b" : "owner-a"}
      tournament={{ id: "tour-1" } as Tournament} refreshTrigger={1} />);
    if (scope === "session") {
      await screen.findByText(/Revision 9 · epoch 3/);
      fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
      fireEvent.click(screen.getByTestId("floor-v3-mode-tracker"));
    }
    fireEvent.click(screen.getByRole("button", { name: "Lưu chế độ" }));
    await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
    const retry = fixture.client.requestTableControlMode.mock.calls[1][0];
    expect(retry.requestId).not.toBe(original.requestId);
    if (scope === "session") expect(retry).toMatchObject({ tableSessionId: "session-reopened", expectedRevision: 9, expectedEpoch: 3 });
  });

  it.each(["network", "malformed", "backend"])("retains the exact retry intent after an ambiguous %s failure", async (failure) => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
    fireEvent.click(screen.getByTestId("floor-v3-mode-tracker"));
    const initialRoster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
    fixture.client.getTournamentTableRoster.mockResolvedValue({ ...initialRoster,
      data: initialRoster.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
        ? { ...table, sessionRevision: 8, controlEpoch: 2 } : table),
    });
    if (failure === "network") fixture.client.requestTableControlMode.mockRejectedValueOnce(new Error("response lost"));
    else fixture.client.requestTableControlMode.mockResolvedValueOnce({ ok: false,
      error: failure === "malformed" ? "V3_MUTATION_RESPONSE_MALFORMED" : "Failed to fetch" });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chế độ" }));
    await screen.findByText(/Revision 8 · epoch 2/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Lưu chế độ" })).not.toBeDisabled());
    const firstIntent = fixture.client.requestTableControlMode.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Lưu chế độ" }));
    await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
    expect(fixture.client.requestTableControlMode.mock.calls[1][0]).toEqual(firstIntent);
  });

  it("uses fresh fences for an explicit retry after a definitive stale rejection", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: /Manual Floor.*Đổi chế độ/ }));
    fireEvent.click(screen.getByTestId("floor-v3-mode-tracker"));
    const initialRoster = await fixture.client.getTournamentTableRoster.mock.results[0].value;
    fixture.client.getTournamentTableRoster.mockResolvedValue({
      ...initialRoster,
      data: initialRoster.data.map((table: { tournamentTableId: string }) => table.tournamentTableId === "table-1"
        ? { ...table, sessionRevision: 8, controlEpoch: 2 } : table),
    });
    fixture.client.requestTableControlMode.mockResolvedValueOnce({ ok: false, error: "STALE_STATE" });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chế độ" }));
    await screen.findByText("Dữ liệu bàn vừa thay đổi. Hãy tải lại trước khi thao tác lại.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Lưu chế độ" })).not.toBeDisabled());
    expect(screen.getByText(/Revision 8 · epoch 2/)).toBeTruthy();
    const firstIntent = fixture.client.requestTableControlMode.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Lưu chế độ" }));
    await waitFor(() => expect(fixture.client.requestTableControlMode).toHaveBeenCalledTimes(2));
    const secondIntent = fixture.client.requestTableControlMode.mock.calls[1][0];
    expect(secondIntent).toMatchObject({ expectedRevision: 8, expectedEpoch: 2, tableSessionId: "session-1", controlMode: "tracker" });
    expect(secondIntent.requestId).not.toBe(firstIntent.requestId);
  });

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

  it("queues a move into a running Tracker table and shows the reserved seat", async () => {
    setup();
    fixture.client.movePlayerSeat.mockResolvedValue({ ok: false, error: "destination_table_has_active_hand" });
    fixture.client.queueTrackerMove.mockResolvedValue({ ok: true, data: { queued: true, pending_move_id: "pending-1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Mở Ghế 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Chuyển người" }));
    fireEvent.change(screen.getByLabelText("Bàn đích"), { target: { value: "table-2" } });
    fireEvent.change(screen.getByLabelText("Ghế đích"), { target: { value: "2" } });
    fixture.client.getPendingTrackerMoves.mockResolvedValue({ ok: true, data: [{
      pendingMoveId: "pending-1", entryId: "entry-1", sourceTournamentTableId: "table-1",
      destinationTournamentTableId: "table-2", destinationSeatNumber: 2,
      status: "pending", resolutionReason: null, requestedAt: "2026-09-24T00:00:00Z",
    }] });
    fireEvent.click(screen.getByRole("button", { name: "Chuyển đến Bàn 5 · Ghế 2" }));
    await waitFor(() => expect(fixture.client.queueTrackerMove).toHaveBeenCalledWith(expect.objectContaining({
      entryId: "entry-1", toTournamentTableId: "table-2", toSeatNumber: 2,
    })));
    expect(fixture.client.movePlayerSeat).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Chờ hết ván · Bàn 5 · Ghế 2")).toBeTruthy();
  });

  it("keeps the roster usable when a secondary request fails", async () => {
    setup({ pendingNetworkFailure: true });
    expect(await screen.findByRole("button", { name: "Mở Bàn 4" })).toBeTruthy();
    expect(screen.getByText(/Danh sách bàn vẫn hiển thị/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mở Bàn 4" }));
    expect(screen.getByRole("button", { name: "Mở Ghế 1" })).toBeTruthy();
  });

  it("shows the server break plan before allowing a close", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Mở Bàn 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng & chuyển người" }));
    expect(await screen.findByText(/Bàn 5 · Ghế 2/)).toBeTruthy();
    expect(screen.getByText("Chuyển sau ván")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận đóng & chuyển" }));
    await waitFor(() => expect(fixture.client.breakTournamentTable).toHaveBeenCalledWith(expect.objectContaining({
      tournamentTableId: "table-1",
      planHash: "plan-hash-1",
    })));
  });
});
