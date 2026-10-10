import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloseTableDialog } from "@/components/cashier/tournament-live/CloseTableDialog";

const fixture = vi.hoisted(() => ({
  legacy: vi.fn(), roster: vi.fn(), close: vi.fn(), plan: vi.fn(), break: vi.fn(),
  success: vi.fn(), error: vi.fn(), client: { rpc: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: fixture.legacy } }));
vi.mock("@/integrations/supabase/SupabaseClientContext", () => ({ useSupabaseClient: () => fixture.client }));
vi.mock("sonner", () => ({ toast: { success: fixture.success, error: fixture.error } }));
vi.mock("@/lib/floorTableControlV3", () => ({ createFloorTableControlV3Client: () => ({
  enabled: true, redrawSeatLockEnabled: true, getTournamentTableRoster: fixture.roster,
  closeTournamentTable: fixture.close, planBreakTable: fixture.plan, breakTournamentTable: fixture.break,
}) }));
vi.mock("@/components/tournament/seat/SeatReceiptDialog", () => ({ SeatReceiptDialog: () => null }));

describe("close dialog canonical session routing", () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });
  it("refreshes revision and requires a new preview after a definitive stale rejection", async () => {
    const table = { tournamentId: "tour-1", tournamentTableId: "table-1", tableSessionId: "session-1",
      sessionRevision: 7, controlEpoch: 2, seats: [{ entryId: "entry-1" }] };
    fixture.roster.mockResolvedValueOnce({ ok: true, data: [table] })
      .mockResolvedValue({ ok: true, data: [{ ...table, sessionRevision: 8 }] });
    const plan = { planHash: "hash-7", complete: true, sourceTournamentTableId: "table-1",
      sourceTableNumber: 4, expectedRevision: 7, blockers: [], moves: [{ entryId: "entry-1",
        playerName: "TEST Player", sourceSeatNumber: 1, destinationTournamentTableId: "table-2",
        destinationTableNumber: 5, destinationSeatNumber: 2, transferMode: "immediate" }] };
    fixture.plan.mockResolvedValueOnce({ ok: true, data: plan })
      .mockResolvedValue({ ok: true, data: { ...plan, expectedRevision: 8, planHash: "hash-8" } });
    fixture.break.mockResolvedValueOnce({ ok: false, error: "STALE_STATE" })
      .mockResolvedValue({ ok: true, data: { ok: true, closed: true, break_pending: false,
        tournament_table_id: "table-1", table_session_id: "session-1", moved_count: 1, pending_count: 0,
        issued_tickets: [{ entry_id: "entry-1", player_name: "TEST Player", from_seat: 1,
          to_table_number: 5, to_seat_number: 2, receipt_code: "SERVER-8" }] } });
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={1} onDone={vi.fn()} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: "Xem kế hoạch chuyển" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Xem kế hoạch chuyển" }));
      fireEvent.click(await screen.findByRole("button", { name: "Xác nhận chuyển & đóng" }));
      await waitFor(() => expect(fixture.error).toHaveBeenCalled());
      const original = fixture.break.mock.calls[0][0];
      await waitFor(() => expect(screen.getByRole("button", { name: "Xem kế hoạch chuyển" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Xem kế hoạch chuyển" }));
      await waitFor(() => expect(fixture.plan).toHaveBeenLastCalledWith({ tournamentTableId: "table-1", expectedRevision: 8, drawMode: "redraw_balanced" }));
      expect(fixture.break).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển & đóng" }));
      await waitFor(() => expect(fixture.break).toHaveBeenCalledTimes(2));
      expect(fixture.break.mock.calls[1][0]).toMatchObject({ expectedRevision: 8, planHash: "hash-8" });
      expect(fixture.break.mock.calls[1][0].requestId).not.toBe(original.requestId);
      await waitFor(() => expect(sessionStorage.length).toBe(0));
    } finally { view.unmount(); }
  });
  it("shows incomplete-plan blockers and never commits them", async () => {
    fixture.roster.mockResolvedValue({ ok: true, data: [{ tournamentId: "tour-1", tournamentTableId: "table-1",
      tableSessionId: "session-1", sessionRevision: 7, controlEpoch: 2, seats: [{ entryId: null }] }] });
    fixture.plan.mockResolvedValue({ ok: true, data: { planHash: "hash-incomplete", complete: false,
      sourceTournamentTableId: "table-1", sourceTableNumber: 4, expectedRevision: 7, moves: [],
      blockers: [{ playerName: "TEST legacy", sourceSeatNumber: 1, reason: "missing_entry" }] } });
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={1} onDone={vi.fn()} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: "Xem kế hoạch chuyển" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Xem kế hoạch chuyển" }));
      expect(await screen.findByText(/TEST legacy · Ghế 1: Chưa gắn entry/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Xác nhận chuyển & đóng" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Xác nhận chuyển & đóng" }));
      expect(fixture.break).not.toHaveBeenCalled();
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it.each([false, true])("previews occupied canonical break and reports pending=%s without legacy writes", async (pending) => {
    fixture.roster.mockResolvedValue({ ok: true, data: [{ tournamentId: "tour-1", tournamentTableId: "table-1",
      tableSessionId: "session-1", sessionRevision: 7, controlEpoch: 2, seats: [{ entryId: "entry-1" }] }] });
    fixture.plan.mockResolvedValue({ ok: true, data: { planHash: "hash-1", complete: true,
      sourceTournamentTableId: "table-1", sourceTableNumber: 4, expectedRevision: 7, blockers: [],
      moves: [{ entryId: "entry-1", playerName: "TEST Player", sourceSeatNumber: 1,
        destinationTournamentTableId: "table-2", destinationTableNumber: 5, destinationSeatNumber: 2,
        transferMode: pending ? "after_current_hand" : "immediate" }] } });
    fixture.break.mockResolvedValue({ ok: true, data: { ok: true, closed: !pending, break_pending: pending,
      tournament_table_id: "table-1", table_session_id: "session-1", moved_count: pending ? 0 : 1,
      pending_count: pending ? 1 : 0, issued_tickets: pending ? [] : [{ entry_id: "entry-1",
        player_name: "TEST Player", from_seat: 1, to_table_number: 5, to_seat_number: 2, receipt_code: "SERVER-1" }] } });
    const done = vi.fn();
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={1} onDone={done} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: /Đóng bàn|Xem kế hoạch chuyển/ })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: /Đóng bàn|Xem kế hoạch chuyển/ }));
      await waitFor(() => expect(fixture.plan).toHaveBeenCalledWith({ tournamentTableId: "table-1", expectedRevision: 7, drawMode: "redraw_balanced" }));
      expect(fixture.break).not.toHaveBeenCalled();
      expect(fixture.legacy).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole("button", { name: "Xác nhận chuyển & đóng" }));
      await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
      expect(fixture.break).toHaveBeenCalledWith({ tournamentTableId: "table-1", expectedRevision: 7,
        requestId: expect.any(String), drawMode: "redraw_balanced", planHash: "hash-1" });
      if (pending) {
        expect(fixture.success).toHaveBeenCalledWith(expect.stringContaining("Bàn còn mở"));
        expect(screen.queryByRole("button", { name: "Phiếu" })).not.toBeInTheDocument();
        expect(screen.queryByText(/Bàn trống — đã đóng/)).not.toBeInTheDocument();
      } else expect(screen.getByRole("button", { name: "Phiếu" })).toBeInTheDocument();
    } finally { view.unmount(); }
  });
  it("retains the same frozen request after response loss and does not duplicate a double click", async () => {
    fixture.roster.mockResolvedValue({ ok: true, data: [{
      tournamentId: "tour-1", tournamentTableId: "table-1", tableSessionId: "session-1",
      sessionRevision: 7, controlEpoch: 2, seats: [],
    }] });
    let rejectClose!: (reason: Error) => void;
    fixture.close.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectClose = reject; }))
      .mockResolvedValueOnce({ ok: true, data: { ok: true, closed: true, tournament_table_id: "table-1", table_session_id: "session-1" } });
    const done = vi.fn();
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={0} onDone={done} />);
    try {
      const confirm = screen.getByRole("button", { name: "Đóng bàn" });
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      await waitFor(() => expect(fixture.close).toHaveBeenCalledTimes(1));
      const original = fixture.close.mock.calls[0][0];
      await act(async () => rejectClose(new Error("response lost")));
      await waitFor(() => expect(screen.getByRole("button", { name: "Đóng bàn" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
      await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
      expect(fixture.close.mock.calls[1][0]).toEqual(original);
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it.each([false, true])("recovers the same committed request after remount with no current source roster: occupied=%s", async (occupied) => {
    const table = { tournamentId: "tour-1", tournamentTableId: "table-1", tableSessionId: "session-1",
      sessionRevision: 7, controlEpoch: 2, seats: occupied ? [{ entryId: "entry-1" }] : [] };
    const plan = { planHash: "hash-7", complete: true, sourceTournamentTableId: "table-1",
      sourceTableNumber: 4, expectedRevision: 7, blockers: [], moves: [{ entryId: "entry-1",
        playerName: "TEST Player", sourceSeatNumber: 1, destinationTournamentTableId: "table-2",
        destinationTableNumber: 5, destinationSeatNumber: 2, transferMode: "immediate" }] };
    fixture.roster.mockResolvedValue({ ok: true, data: [table] });
    fixture.plan.mockResolvedValue({ ok: true, data: plan });
    const response = { ok: true, data: { ok: true, closed: true, break_pending: false,
      tournament_table_id: "table-1", table_session_id: "session-1", moved_count: occupied ? 1 : 0, pending_count: 0,
      issued_tickets: occupied ? [{ entry_id: "entry-1", player_name: "TEST Player", from_seat: 1,
        to_table_number: 5, to_seat_number: 2, receipt_code: "SERVER-7" }] : [] } };
    const mutation = occupied ? fixture.break : fixture.close;
    mutation.mockRejectedValueOnce(new Error("response lost after commit")).mockResolvedValueOnce(response);
    const done = vi.fn();
    const props = { open: true, onOpenChange: vi.fn(), tournamentId: "tour-1", actorId: "owner-a",
      tournamentName: "TEST", tournamentDate: null, tableTtId: "table-1", tableNumber: 4, occupiedCount: occupied ? 1 : 0, onDone: done };
    let view = render(<CloseTableDialog {...props} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: occupied ? "Xem kế hoạch chuyển" : "Đóng bàn" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: occupied ? "Xem kế hoạch chuyển" : "Đóng bàn" }));
      if (occupied) fireEvent.click(await screen.findByRole("button", { name: "Xác nhận chuyển & đóng" }));
      await waitFor(() => expect(fixture.error).toHaveBeenCalled());
      const original = mutation.mock.calls[0][0];
      view.unmount();
      fixture.roster.mockResolvedValue({ ok: true, data: [] });
      view = render(<CloseTableDialog {...props} />);
      const reconcile = await screen.findByRole("button", { name: "Đối chiếu yêu cầu đã lưu" });
      await waitFor(() => expect(reconcile).toBeEnabled());
      expect(mutation).toHaveBeenCalledTimes(1);
      fireEvent.click(reconcile);
      await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
      expect(mutation.mock.calls[1][0]).toEqual(original);
      expect(fixture.plan).toHaveBeenCalledTimes(occupied ? 1 : 0);
      expect(sessionStorage.length).toBe(0);
    } finally { view.unmount(); }
  });

  it("does not send a close when browser storage cannot retain its request", async () => {
    fixture.roster.mockResolvedValue({ ok: true, data: [{ tournamentId: "tour-1", tournamentTableId: "table-1",
      tableSessionId: "session-1", sessionRevision: 7, controlEpoch: 2, seats: [] }] });
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={0} onDone={vi.fn()} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: "Đóng bàn" })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("storage blocked");
      expect(fixture.close).not.toHaveBeenCalled();
    } finally { view.unmount(); storage.mockRestore(); }
  });
  it("keeps a corrupt stored request visible and blocks all new mutations", async () => {
    const key = `vp:floor-close-intent:v1:${encodeURIComponent("owner-a:tour-1:table-1")}`;
    sessionStorage.setItem(key, "{corrupt");
    fixture.roster.mockResolvedValue({ ok: true, data: [{ tournamentId: "tour-1", tournamentTableId: "table-1",
      tableSessionId: "session-1", sessionRevision: 7, controlEpoch: 2, seats: [] }] });
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={0} onDone={vi.fn()} />);
    try {
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Đóng bàn" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
      expect(fixture.close).not.toHaveBeenCalled();
      expect(fixture.break).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(key)).toBe("{corrupt");
    } finally { view.unmount(); }
  });
  it("does not let the old completion unlock a new actor's in-flight close", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    fixture.close.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    fixture.roster.mockResolvedValue({ ok: true, data: [{
      tournamentId: "tour-1", tournamentTableId: "table-1", tableSessionId: "session-1",
      sessionRevision: 7, controlEpoch: 2, seats: [],
    }] });
    const done = vi.fn();
    const props = { open: true, onOpenChange: vi.fn(), tournamentId: "tour-1", actorId: "owner-a",
      tournamentName: "TEST", tournamentDate: null, tableTtId: "table-1", tableNumber: 4, occupiedCount: 0, onDone: done };
    const view = render(<CloseTableDialog {...props} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: "Đóng bàn" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
      await waitFor(() => expect(resolvers).toHaveLength(1));
      view.rerender(<CloseTableDialog {...props} actorId="owner-b" />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Đóng bàn" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
      await waitFor(() => expect(resolvers).toHaveLength(2));
      const result = { ok: true, data: { ok: true, closed: true, tournament_table_id: "table-1", table_session_id: "session-1" } };
      await act(async () => resolvers[0](result));
      expect(screen.queryByRole("button", { name: "Đóng bàn" })).not.toBeInTheDocument();
      expect(screen.getByText("Đang bốc lại & đóng bàn…")).toBeInTheDocument();
      expect(done).not.toHaveBeenCalled();
      expect(fixture.success).not.toHaveBeenCalled();
      await act(async () => resolvers[1](result));
      await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    } finally { view.unmount(); }
  });
  it("ignores a late failure from another actor and leaves the new dialog usable", async () => {
    let rejectClose!: (reason: Error) => void;
    fixture.close.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectClose = reject; }));
    fixture.roster.mockResolvedValue({ ok: true, data: [{
      tournamentId: "tour-1", tournamentTableId: "table-1", tableSessionId: "session-1",
      sessionRevision: 7, controlEpoch: 2, seats: [],
    }] });
    const done = vi.fn();
    const props = { open: true, onOpenChange: vi.fn(), tournamentId: "tour-1", actorId: "owner-a",
      tournamentName: "TEST", tournamentDate: null, tableTtId: "table-1", tableNumber: 4, occupiedCount: 0, onDone: done };
    const view = render(<CloseTableDialog {...props} />);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: "Đóng bàn" })).not.toBeDisabled());
      fireEvent.click(screen.getByRole("button", { name: "Đóng bàn" }));
      await waitFor(() => expect(fixture.close).toHaveBeenCalledTimes(1));
      view.rerender(<CloseTableDialog {...props} actorId="owner-b" />);
      await act(async () => rejectClose(new Error("old request failed")));
      await waitFor(() => expect(screen.getByRole("button", { name: "Đóng bàn" })).not.toBeDisabled());
      expect(screen.queryByText(/old request failed/)).not.toBeInTheDocument();
      expect(fixture.error).not.toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it.each([
    { ok: false, error: "network_error" },
    { ok: true, data: [] },
  ])("does not send a close when current session context cannot be verified: %j", async (result) => {
    fixture.roster.mockResolvedValue(result);
    fixture.legacy.mockResolvedValue({ data: { ok: true, closed: true, moved: [] }, error: null });
    const done = vi.fn();
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={0} onDone={done} />);
    try {
      await screen.findByRole("alert");
      const confirm = screen.getByRole("button", { name: "Đóng bàn" });
      expect(confirm).toBeDisabled();
      fireEvent.click(confirm);
      expect(fixture.legacy).not.toHaveBeenCalled();
      expect(fixture.close).not.toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
  it("closes an empty current session using verified revision and request ID, never legacy RPC", async () => {
    fixture.legacy.mockResolvedValue({ data: { ok: true, closed: true, moved: [] }, error: null });
    fixture.roster.mockResolvedValue({ ok: true, data: [{
      tournamentId: "tour-1", tournamentTableId: "table-1", tableSessionId: "session-1",
      sessionRevision: 7, controlEpoch: 2, seats: [],
    }] });
    fixture.close.mockResolvedValue({ ok: true, data: {
      ok: true, closed: true, tournament_table_id: "table-1", table_session_id: "session-1",
    } });
    const done = vi.fn();
    const view = render(<CloseTableDialog open onOpenChange={vi.fn()} tournamentId="tour-1" actorId="owner-a"
      tournamentName="TEST" tournamentDate={null} tableTtId="table-1" tableNumber={4} occupiedCount={0} onDone={done} />);
    try {
      const confirm = screen.getByRole("button", { name: "Đóng bàn" });
      await waitFor(() => expect(confirm).not.toBeDisabled());
      fireEvent.click(confirm);
      await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
      expect(fixture.close).toHaveBeenCalledWith({ tournamentTableId: "table-1", expectedRevision: 7, requestId: expect.any(String) });
      expect(fixture.legacy).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });
});
