import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Loader2, Plus, RadioTower, RefreshCw, RotateCcw, UserRoundX, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FloorSeatRoster } from "@/components/ops/shared/FloorSeatRoster";
import { FloorTableRosterIndex } from "@/components/ops/shared/FloorTableRosterIndex";
import { FloorTableModePicker } from "@/components/ops/shared/FloorTableModePicker";
import { formatStack } from "@/lib/format";
import {
  createFloorTableControlV3Client,
  type FloorRestorableEntry,
  type FloorTableControlV3Rpc,
  type FloorTableRosterSeat,
  type FloorSeatableEntry,
  type FloorTournamentTableRoster,
} from "@/lib/floorTableControlV3";
import type { Tournament } from "@/types/tournament";
import { OpenTableDialog } from "./OpenTableDialog";

type Mutation = () => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;

function v3ErrorMessage(error: string): string {
  switch (error) {
    case "STALE_STATE": return "Dữ liệu bàn vừa thay đổi. Hãy tải lại trước khi thao tác lại.";
    case "table_has_active_hand":
    case "player_in_active_hand": return "Bàn đang có ván chạy nên thao tác này đã bị chặn.";
    case "seat_occupied": return "Ghế này vừa được sử dụng. Hãy tải lại.";
    case "insufficient_capacity": return "Không đủ ghế trống để đóng và chuyển người.";
    case "player_has_chips": return "Bàn Live Tracker chỉ cho phép loại khi chip bằng 0.";
    case "STALE_TRACKER_CONTEXT": return "Phiên Live Tracker đã đổi. Không thể dùng trạng thái cũ.";
    case "FLOOR_TABLE_CONTROL_V3_DISABLED": return "Table Control V3 chưa được mở cho môi trường này.";
    default: return `Thao tác không thành công (${error}).`;
  }
}

/**
 * V3-only Floor map.  It never reads a legacy table_id or invokes an Edge
 * writer: all data and mutations pass through the fixed typed V3 adapter.
 */
export function FloorTableMapPanelV3({
  tournament,
  refreshTrigger,
}: {
  tournament: Tournament;
  refreshTrigger: number;
}) {
  const supabase = useSupabaseClient();
  const v3 = useMemo(() => createFloorTableControlV3Client(
    ((name, args) => (supabase.rpc as unknown as FloorTableControlV3Rpc)(name, args)),
  ), [supabase]);
  const [tables, setTables] = useState<FloorTournamentTableRoster[]>([]);
  const [seatableEntries, setSeatableEntries] = useState<FloorSeatableEntry[]>([]);
  const [restorableEntries, setRestorableEntries] = useState<FloorRestorableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [openTable, setOpenTable] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number | null>(null);
  const [entryId, setEntryId] = useState("");
  const [restoreEntryId, setRestoreEntryId] = useState("");
  const [moveDestinationId, setMoveDestinationId] = useState("");
  const [moveSeatNumber, setMoveSeatNumber] = useState<number | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [nextMode, setNextMode] = useState<"manual" | "tracker">("manual");

  const selectedTable = useMemo(
    () => tables.find((table) => table.tournamentTableId === selectedTableId) ?? null,
    [selectedTableId, tables],
  );
  const selectedSeat = useMemo(
    () => selectedTable?.seats.find((seat) => seat.seatNumber === selectedSeatNumber) ?? null,
    [selectedSeatNumber, selectedTable],
  );
  const emptySeatNumbers = useMemo(() => {
    if (!selectedTable) return [] as number[];
    const occupied = new Set(selectedTable.seats.map((seat) => seat.seatNumber));
    return Array.from({ length: 9 }, (_, index) => index + 1).filter((seat) => !occupied.has(seat));
  }, [selectedTable]);
  const moveDestination = useMemo(
    () => tables.find((table) => table.tournamentTableId === moveDestinationId) ?? null,
    [moveDestinationId, tables],
  );
  const destinationSeatNumbers = useMemo(() => {
    if (!moveDestination) return [] as number[];
    const occupied = new Set(moveDestination.seats.map((seat) => seat.seatNumber));
    return Array.from({ length: 9 }, (_, index) => index + 1).filter((seat) => !occupied.has(seat));
  }, [moveDestination]);

  const load = useCallback(async () => {
    if (!v3.enabled) return;
    setLoading(true);
    const [roster, entries, restorable] = await Promise.all([
      v3.getTournamentTableRoster(tournament.id),
      v3.getSeatableEntries(tournament.id),
      v3.getRestorableEntries(tournament.id),
    ]);
    if (roster.ok === false || entries.ok === false || restorable.ok === false) {
      setTables([]);
      setSeatableEntries([]);
      setRestorableEntries([]);
      const failure = roster.ok === false
        ? roster.error
        : entries.ok === false
          ? entries.error
          : restorable.ok === false
            ? restorable.error
            : "V3_STATE_LOAD_FAILED";
      const message = `Không tải được state V3: ${v3ErrorMessage(failure)}`;
      setLoadError(message);
      toast.error(message);
    } else {
      setTables(roster.data);
      setSeatableEntries(entries.data);
      setRestorableEntries(restorable.data);
      setLoadError(null);
    }
    setLoading(false);
  }, [tournament.id, v3]);

  useEffect(() => { void load(); }, [load, refreshTrigger]);

  useEffect(() => {
    if (!selectedTable) return;
    const current = selectedSeatNumber;
    if (current != null && (selectedTable.seats.some((seat) => seat.seatNumber === current) || emptySeatNumbers.includes(current))) return;
    setSelectedSeatNumber(null);
  }, [emptySeatNumbers, selectedSeatNumber, selectedTable]);

  const selectedTableSessionId = selectedTable?.tableSessionId ?? null;
  const selectedTableControlMode = selectedTable?.controlMode ?? null;

  useEffect(() => {
    if (!selectedTableControlMode) return;
    setNextMode(selectedTableControlMode);
    setModeOpen(false);
  }, [selectedTableSessionId, selectedTableControlMode]);

  useEffect(() => {
    if (!moveDestination) return;
    setMoveSeatNumber(destinationSeatNumbers[0] ?? null);
  }, [destinationSeatNumbers, moveDestination]);

  const run = async (successMessage: string, mutation: Mutation) => {
    if (busy) return;
    setBusy(true);
    const result = await mutation();
    if (result.ok === false) {
      const message = v3ErrorMessage(result.error);
      setOperationError(message);
      toast.error(message);
      await load();
    } else {
      setOperationError(null);
      toast.success(successMessage);
      await load();
    }
    setBusy(false);
  };

  const selectedRosterSeats = useMemo(() => selectedTable?.seats.map((seat) => ({
    seatNumber: seat.seatNumber,
    playerName: seat.displayName,
    chipsLabel: formatStack(seat.chipCount),
    entryNumber: seat.entryNo,
  })) ?? [], [selectedTable]);

  const tableIndex = useMemo(() => tables.map((table) => ({
    id: table.tournamentTableId,
    tableNumber: table.tableNumber,
    tableName: table.tableName,
    occupiedSeatNumbers: table.seats.map((seat) => seat.seatNumber),
    maxSeats: 9,
    status: table.seats.length > 0 ? "running" as const : "open" as const,
    controlMode: table.controlMode,
  })), [tables]);

  const seatAction = (seat: FloorTableRosterSeat | undefined) => {
    if (!seat || !selectedTable) return null;
    return (
      <section className="space-y-3 rounded-2xl border border-border bg-card/55 p-3" aria-label="Thao tác người chơi">
        <div>
          <p className="text-sm font-semibold text-foreground">{seat.displayName}</p>
          <p className="text-xs text-muted-foreground">Ghế {seat.seatNumber} · Entry {seat.entryNo} · {formatStack(seat.chipCount)} chip</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Chuyển tới bàn
            <select className="h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={moveDestinationId} onChange={(event) => setMoveDestinationId(event.target.value)}>
              <option value="">Chọn bàn đích</option>
              {tables.filter((table) => table.tournamentTableId !== selectedTable.tournamentTableId).map((table) => (
                <option key={table.tournamentTableId} value={table.tournamentTableId}>Bàn {table.tableNumber} · {table.seats.length}/9</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Ghế đích
            <select className="h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={moveSeatNumber ?? ""} onChange={(event) => setMoveSeatNumber(Number(event.target.value))} disabled={!moveDestination}>
              <option value="">Chọn ghế</option>
              {destinationSeatNumbers.map((seatNumber) => <option key={seatNumber} value={seatNumber}>Ghế {seatNumber}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button data-ops-action="floor.player.move" className="min-h-11" disabled={busy || !moveDestination || moveSeatNumber == null} onClick={() => void run("Đã chuyển người chơi.", () => v3.movePlayerSeat({
            entryId: seat.entryId,
            toTournamentTableId: moveDestination!.tournamentTableId,
            toSeatNumber: moveSeatNumber!,
            expectedSourceRevision: selectedTable.sessionRevision,
            expectedDestinationRevision: moveDestination!.sessionRevision,
            requestId: crypto.randomUUID(),
          }))}>
            <ArrowRightLeft className="mr-2 h-4 w-4" /> Chuyển ghế
          </Button>
          <Button data-ops-action="floor.player.bust" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void run("Đã loại người chơi khỏi giải.", () => v3.bustPlayer({
            entryId: seat.entryId,
            expectedRevision: selectedTable.sessionRevision,
            expectedControlEpoch: selectedTable.controlEpoch,
            expectedChipCount: seat.chipCount,
            requestId: crypto.randomUUID(),
            reason: "floor_v3_operator_bust",
          }))}>
            <UserRoundX className="mr-2 h-4 w-4" /> Loại khỏi giải
          </Button>
        </div>
      </section>
    );
  };

  if (!v3.enabled) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Floor Table Control V3 chưa được mở cho môi trường này.
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-3 sm:p-4" data-testid="floor-table-map-v3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs text-primary">V3</span> Kho bàn & roster</h2>
          <p className="mt-1 text-xs text-muted-foreground">State chỉ đọc từ session/assignment V3; không dùng mixed legacy table ID.</p>
        </div>
        <div className="flex gap-2">
          <Button data-ops-action="floor.tables.refresh" size="sm" variant="outline" className="min-h-11" disabled={loading || busy} onClick={() => void load()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</Button>
          <Button data-ops-action="floor.tables.open_table_dialog" size="sm" className="min-h-11" disabled={busy} onClick={() => setOpenTable(true)}><Plus className="mr-2 h-4 w-4" /> Mở bàn</Button>
        </div>
      </div>

      {loadError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{loadError}</p>}
      {operationError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{operationError}</p>}

      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Đang tải roster V3…</div>
      ) : tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Chưa có bàn V3 active. Chọn “Mở bàn” để lấy bàn vật lý còn trống.</div>
      ) : (
        <FloorTableRosterIndex tables={tableIndex} onOpen={(tableId) => { setSelectedTableId(tableId); setSelectedSeatNumber(null); }} />
      )}

      <p className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/90">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        Live Tracker đang giữ an toàn cho tới khi runtime Edge chuyển đủ fencing tuple V3. Trong Preview này Floor V3 chỉ mở Manual; không fallback sang writer cũ.
      </p>

      <OpenTableDialog open={openTable} onOpenChange={setOpenTable} tournamentId={tournament.id} onDone={() => void load()} />

      <Sheet open={selectedTable !== null} onOpenChange={(open) => { if (!open) setSelectedTableId(null); }}>
        <SheetContent side="right" className="operations-typography h-[100dvh] w-full overflow-y-auto overscroll-contain pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-xl">
          {selectedTable && (
            <>
              <SheetHeader>
                <SheetTitle>Bàn {selectedTable.tableNumber} · {selectedTable.seats.length}/9</SheetTitle>
                <button
                  type="button"
                  data-ops-action="floor.tables.open_v3_control_mode"
                  className="inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-expanded={modeOpen}
                  aria-controls="floor-v3-mode-panel"
                  onClick={() => setModeOpen((open) => !open)}
                >
                  {selectedTable.controlMode === "tracker" ? <RadioTower className="h-4 w-4 text-sky-300" /> : <UsersRound className="h-4 w-4 text-emerald-300" />}
                  {selectedTable.controlMode === "tracker" ? "Live Tracker" : "Manual Floor"}
                  <span className="text-muted-foreground">· Đổi chế độ</span>
                </button>
                <p className="text-xs text-muted-foreground">Revision {selectedTable.sessionRevision} · epoch {selectedTable.controlEpoch}</p>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                {modeOpen && (
                  <section id="floor-v3-mode-panel" className="space-y-3 rounded-xl border border-border bg-card/55 p-3" aria-label="Đổi chế độ bàn">
                    <FloorTableModePicker value={nextMode} onChange={setNextMode} disabled={busy} testIdPrefix="floor-v3-mode" />
                    <Button
                      data-ops-action="floor.tables.save_v3_control_mode"
                      className="min-h-11 w-full"
                      disabled={busy || nextMode === selectedTable.controlMode}
                      onClick={() => void run("Đã đổi chế độ bàn.", async () => {
                        const result = await v3.setTableControlMode({
                          tournamentTableId: selectedTable.tournamentTableId,
                          controlMode: nextMode,
                          expectedRevision: selectedTable.sessionRevision,
                          requestId: crypto.randomUUID(),
                        });
                        if (result.ok) setModeOpen(false);
                        return result;
                      })}
                    >
                      Lưu chế độ
                    </Button>
                    <p className="text-[11px] leading-4 text-muted-foreground">Chỉ đổi được khi bàn trống và không có hand đang chạy. Đổi chế độ sẽ tăng epoch để chặn yêu cầu Tracker cũ.</p>
                  </section>
                )}

                <div className="space-y-4">
                  {selectedSeat ? seatAction(selectedSeat) : selectedSeatNumber != null && (
                    <section className="space-y-3 rounded-xl border border-border bg-card/55 p-3">
                      <p className="text-sm font-semibold">Ghế {selectedSeatNumber} đang trống</p>
                      <label className="grid gap-1 text-xs text-muted-foreground">
                        Entry hợp lệ chưa có ghế
                        <select className="h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={entryId} onChange={(event) => setEntryId(event.target.value)}>
                          <option value="">Chọn người chơi đã đăng ký</option>
                          {seatableEntries.map((entry) => <option key={entry.entryId} value={entry.entryId}>{entry.displayName} · Entry {entry.entryNo}</option>)}
                        </select>
                      </label>
                      <Button data-ops-action="floor.tables.add_player" className="min-h-11 w-full" disabled={busy || !entryId} onClick={() => void run("Đã thêm người vào ghế.", () => v3.assignEntryToSeat({
                        entryId,
                        tournamentTableId: selectedTable.tournamentTableId,
                        seatNumber: selectedSeatNumber,
                        expectedRevision: selectedTable.sessionRevision,
                        requestId: crypto.randomUUID(),
                      }))}><Plus className="mr-2 h-4 w-4" /> Thêm người</Button>
                    </section>
                  )}
                </div>

                <FloorSeatRoster
                  seats={selectedRosterSeats}
                  onSeatTap={(seatNumber) => setSelectedSeatNumber(seatNumber)}
                  onEmptySeatTap={(seatNumber) => setSelectedSeatNumber(seatNumber)}
                />

                {emptySeatNumbers.length > 0 && restorableEntries.length > 0 && (
                  <section className="space-y-3 rounded-2xl border border-border bg-card/55 p-3">
                    <div><p className="text-sm font-semibold">Khôi phục người đã loại</p><p className="text-xs text-muted-foreground">Chỉ restore vào ghế trống của session đang active.</p></div>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      Người chơi đã loại
                      <select className="h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={restoreEntryId} onChange={(event) => setRestoreEntryId(event.target.value)}>
                        <option value="">Chọn người chơi</option>
                        {restorableEntries.map((entry) => <option key={entry.entryId} value={entry.entryId}>{entry.displayName} · Entry {entry.entryNo}</option>)}
                      </select>
                    </label>
                    <Button data-ops-action="floor.players.restore" variant="outline" className="min-h-11 w-full" disabled={busy || !restoreEntryId || selectedSeatNumber == null || !emptySeatNumbers.includes(selectedSeatNumber)} onClick={() => void run("Đã khôi phục người chơi.", () => v3.restoreBustedPlayer({
                      entryId: restoreEntryId,
                      toTournamentTableId: selectedTable.tournamentTableId,
                      toSeatNumber: selectedSeatNumber!,
                      expectedRevision: selectedTable.sessionRevision,
                      expectedControlEpoch: selectedTable.controlEpoch,
                      requestId: crypto.randomUUID(),
                    }))}><RotateCcw className="mr-2 h-4 w-4" /> Khôi phục vào ghế đã chọn</Button>
                  </section>
                )}

                <section className="grid gap-2 sm:grid-cols-2">
                  <Button data-ops-action="floor.tables.close_table" variant="outline" className="min-h-11" disabled={busy || selectedTable.seats.length !== 0} onClick={() => void run("Đã đóng bàn và giải phóng bàn vật lý.", () => v3.closeTournamentTable({
                    tournamentTableId: selectedTable.tournamentTableId,
                    expectedRevision: selectedTable.sessionRevision,
                    requestId: crypto.randomUUID(),
                  }))}>Đóng bàn trống</Button>
                  <Button data-ops-action="floor.tables.break_v3" variant="outline" className="min-h-11" disabled={busy || selectedTable.seats.length === 0} onClick={() => void run("Đã đóng và chuyển người chơi.", () => v3.breakTournamentTable({
                    tournamentTableId: selectedTable.tournamentTableId,
                    expectedRevision: selectedTable.sessionRevision,
                    requestId: crypto.randomUUID(),
                    drawMode: "fill_lowest_table",
                  }))}>Đóng & chuyển người</Button>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
