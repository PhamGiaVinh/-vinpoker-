import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Loader2, LockKeyhole, Plus, RadioTower, RefreshCw, RotateCcw, Shuffle, UnlockKeyhole, UserRoundMinus, UserRoundX, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FloorEntryPicker, type FloorEntrySelection } from "@/components/ops/shared/FloorEntryPicker";
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
import { FloorRedrawDialogV1 } from "./FloorRedrawDialogV1";
import { FEATURES } from "@/lib/featureFlags";

type Mutation = () => Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }>;
type PendingTableAction = "close" | "break";

function v3ErrorMessage(error: string): string {
  switch (error) {
    case "STALE_STATE": return "Dữ liệu bàn vừa thay đổi. Hãy tải lại trước khi thao tác lại.";
    case "table_has_active_hand":
    case "player_in_active_hand": return "Bàn đang có ván chạy nên thao tác này đã bị chặn.";
    case "seat_occupied": return "Ghế này vừa được sử dụng. Hãy tải lại.";
    case "seat_locked": return "Ghế này đang khóa. Hãy mở khóa trước khi xếp người.";
    case "insufficient_capacity": return "Không đủ ghế trống để đóng và chuyển người.";
    case "redraw_required_for_capacity_or_locks": return "Giải đang dùng bàn 8-max hoặc có ghế khóa. Hãy dùng Redraw để server giữ đúng sức chứa và ghế khóa.";
    case "player_has_chips": return "Bàn Live Tracker chỉ cho phép loại khi chip bằng 0.";
    case "tracker_chip_state_mismatch": return "Chip trên Floor và Live Tracker chưa khớp. Hãy tải lại trước khi loại người chơi.";
    case "table_has_active_seats": return "Bàn vẫn còn người chơi. Hãy dùng “Đóng & chuyển người”.";
    case "no_destination_table":
    case "no_table_available": return "Chưa có bàn đích đủ ghế để chuyển toàn bộ người chơi.";
    case "entry_not_found": return "Không tìm thấy entry này trong giải. Hãy tải lại danh sách người chơi.";
    case "entry_not_active": return "Entry này không còn ở trạng thái có thể thao tác.";
    case "entry_not_free_sittable": return "Entry thủ công này chưa có đường xếp lại an toàn từ Waiting nên Free Sit đã bị chặn.";
    case "entry_already_seated": return "Người chơi này đã có ghế ở một bàn khác.";
    case "entry_not_seated":
    case "no_active_v3_seat": return "Người chơi không còn ở ghế này. Hãy tải lại roster.";
    case "table_not_found": return "Không tìm thấy bàn trong giải này.";
    case "table_not_empty": return "Bàn vẫn còn người chơi. Hãy dùng “Đóng & chuyển người”.";
    case "table_session_not_active":
    case "table_session_mismatch": return "Phiên bàn đã đóng hoặc được mở lại. Hãy tải lại trước khi thao tác.";
    case "destination_table_has_active_hand": return "Bàn đích đang có ván chạy nên chưa thể chuyển người.";
    case "no_active_v3_tables": return "Giải chưa có bàn đích đang hoạt động.";
    case "tournament_not_open": return "Giải chưa mở hoặc đã kết thúc nên thao tác bị chặn.";
    case "actor_not_allowed": return "Tài khoản này không có quyền thao tác giải hoặc CLB này.";
    case "game_table_scope_mismatch": return "Bàn vật lý không thuộc cùng CLB với giải.";
    case "invalid_request": return "Yêu cầu thiếu thông tin hợp lệ. Hãy đóng màn hình và thử lại.";
    case "IDEMPOTENCY_CONFLICT": return "Yêu cầu này đã được dùng cho một thao tác khác. Hãy thử lại.";
    case "STALE_TRACKER_CONTEXT": return "Phiên Live Tracker đã đổi. Không thể dùng trạng thái cũ.";
    case "FLOOR_TABLE_CONTROL_V3_DISABLED": return "Table Control V3 chưa được mở cho môi trường này.";
    case "FLOOR_REDRAW_SEAT_LOCK_V1_DISABLED": return "Khóa ghế và redraw 8/9-max chưa được mở cho môi trường này.";
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
  const [entrySelection, setEntrySelection] = useState<FloorEntrySelection | null>(null);
  const [moveDestinationId, setMoveDestinationId] = useState("");
  const [moveSeatNumber, setMoveSeatNumber] = useState<number | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [nextMode, setNextMode] = useState<"manual" | "tracker">("manual");
  const [pendingBustSeat, setPendingBustSeat] = useState<FloorTableRosterSeat | null>(null);
  const [pendingFreeSitSeat, setPendingFreeSitSeat] = useState<FloorTableRosterSeat | null>(null);
  const [pendingTableAction, setPendingTableAction] = useState<PendingTableAction | null>(null);
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [lockReason, setLockReason] = useState("Giữ ghế cho vận hành");

  const selectedTable = useMemo(
    () => tables.find((table) => table.tournamentTableId === selectedTableId) ?? null,
    [selectedTableId, tables],
  );
  const selectedSeat = useMemo(
    () => selectedTable?.seats.find((seat) => seat.seatNumber === selectedSeatNumber) ?? null,
    [selectedSeatNumber, selectedTable],
  );
  const selectedSeatLock = useMemo(
    () => selectedTable?.seatLocks.find((lock) => lock.seatNumber === selectedSeatNumber) ?? null,
    [selectedSeatNumber, selectedTable],
  );
  const emptySeatNumbers = useMemo(() => {
    if (!selectedTable) return [] as number[];
    const occupied = new Set(selectedTable.seats.map((seat) => seat.seatNumber));
    const locked = new Set(selectedTable.seatLocks.map((seatLock) => seatLock.seatNumber));
    return Array.from({ length: selectedTable.maxSeats }, (_, index) => index + 1)
      .filter((seat) => !occupied.has(seat) && !locked.has(seat));
  }, [selectedTable]);
  const moveDestination = useMemo(
    () => tables.find((table) => table.tournamentTableId === moveDestinationId) ?? null,
    [moveDestinationId, tables],
  );
  const destinationSeatNumbers = useMemo(() => {
    if (!moveDestination) return [] as number[];
    const occupied = new Set(moveDestination.seats.map((seat) => seat.seatNumber));
    const locked = new Set(moveDestination.seatLocks.map((seatLock) => seatLock.seatNumber));
    return Array.from({ length: moveDestination.maxSeats }, (_, index) => index + 1)
      .filter((seat) => !occupied.has(seat) && !locked.has(seat));
  }, [moveDestination]);

  const load = useCallback(async () => {
    if (!v3.enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
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
        const message = `Không tải được dữ liệu bàn: ${v3ErrorMessage(failure)}`;
        setLoadError(message);
        toast.error(message);
      } else {
        setTables(roster.data);
        setSeatableEntries(entries.data);
        setRestorableEntries(restorable.data);
        setLoadError(null);
      }
    } catch {
      setTables([]);
      setSeatableEntries([]);
      setRestorableEntries([]);
      const message = "Không thể kết nối để tải dữ liệu bàn. Hãy kiểm tra mạng và thử lại.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [tournament.id, v3]);

  useEffect(() => { void load(); }, [load, refreshTrigger]);

  useEffect(() => {
    if (!selectedTable) return;
    const current = selectedSeatNumber;
    if (current != null && (selectedTable.seats.some((seat) => seat.seatNumber === current) || emptySeatNumbers.includes(current))) return;
    setSelectedSeatNumber(null);
  }, [emptySeatNumbers, selectedSeatNumber, selectedTable]);

  useEffect(() => {
    setEntrySelection(null);
    setMoveDestinationId("");
    setMoveSeatNumber(null);
    setPendingBustSeat(null);
    setPendingFreeSitSeat(null);
    setPendingTableAction(null);
    setLockReason("Giữ ghế cho vận hành");
  }, [selectedSeatNumber, selectedTableId]);

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

  const run = async (successMessage: string, mutation: Mutation): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await mutation();
      if (result.ok === false) {
        const message = v3ErrorMessage(result.error);
        setOperationError(message);
        toast.error(message);
        await load();
        return false;
      }
      setOperationError(null);
      toast.success(successMessage);
      await load();
      return true;
    } catch {
      const message = "Mất kết nối khi thao tác. Chưa xác nhận thay đổi; hãy tải lại để kiểm tra trạng thái bàn.";
      setOperationError(message);
      toast.error(message);
      await load();
      return false;
    } finally {
      setBusy(false);
    }
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
    maxSeats: table.maxSeats,
    status: table.seats.length > 0 ? "running" as const : "open" as const,
    controlMode: table.controlMode,
  })), [tables]);

  const seatAction = (seat: FloorTableRosterSeat | undefined) => {
    if (!seat || !selectedTable) return null;
    const trackerChipBlocked = selectedTable.controlMode === "tracker" && seat.chipCount !== 0;
    return (
      <section className="space-y-3 rounded-2xl border border-border bg-card/55 p-3" aria-label="Thao tác người chơi">
        <div>
          <p className="text-sm font-semibold text-foreground">{seat.displayName}</p>
          <p className="text-xs text-muted-foreground">Ghế {seat.seatNumber} · Entry {seat.entryNo} · {formatStack(seat.chipCount)} chip</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Chuyển tới bàn
            <select className="h-12 rounded-md border border-input bg-background px-2 text-base text-foreground" value={moveDestinationId} onChange={(event) => setMoveDestinationId(event.target.value)}>
              <option value="">Chọn bàn đích</option>
              {tables.filter((table) => table.tournamentTableId !== selectedTable.tournamentTableId).map((table) => (
                <option key={table.tournamentTableId} value={table.tournamentTableId}>Bàn {table.tableNumber} · {table.seats.length}/{table.maxSeats}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Ghế đích
            <select className="h-12 rounded-md border border-input bg-background px-2 text-base text-foreground" value={moveSeatNumber ?? ""} onChange={(event) => setMoveSeatNumber(Number(event.target.value))} disabled={!moveDestination}>
              <option value="">Chọn ghế</option>
              {destinationSeatNumbers.map((seatNumber) => <option key={seatNumber} value={seatNumber}>Ghế {seatNumber}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Button data-ops-action="floor.player.move" className="min-h-12" disabled={busy || !moveDestination || moveSeatNumber == null} onClick={() => void run("Đã chuyển người chơi.", () => v3.movePlayerSeat({
            entryId: seat.entryId,
            toTournamentTableId: moveDestination!.tournamentTableId,
            toSeatNumber: moveSeatNumber!,
            expectedSourceRevision: selectedTable.sessionRevision,
            expectedDestinationRevision: moveDestination!.sessionRevision,
            requestId: crypto.randomUUID(),
          }))}>
            <ArrowRightLeft className="mr-2 h-4 w-4" /> Chuyển ghế
          </Button>
          {FEATURES.floorFreeSitV1 && (
            <Button data-ops-action="floor.player.open_free_sit" variant="outline" className="min-h-12" disabled={busy} onClick={() => setPendingFreeSitSeat(seat)}>
              <UserRoundMinus className="mr-2 h-4 w-4" /> Free Sit
            </Button>
          )}
          <Button data-ops-action="floor.player.open_bust" variant="destructive" className="min-h-12" disabled={busy || trackerChipBlocked} onClick={() => setPendingBustSeat(seat)}>
            <UserRoundX className="mr-2 h-4 w-4" /> Loại khỏi giải
          </Button>
        </div>
        {trackerChipBlocked && (
          <p className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs leading-5 text-amber-100/90">
            Live Tracker chỉ cho loại khi chip đã về 0. Hãy hoàn tất chip ở Tracker rồi tải lại.
          </p>
        )}
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
          <h2 className="text-base font-semibold">Bàn đang sử dụng</h2>
          <p className="mt-1 text-xs text-muted-foreground">Mỗi bàn hiển thị một phiên đang hoạt động của giải này.</p>
        </div>
        <div className="flex gap-2">
          <Button data-ops-action="floor.tables.refresh" size="sm" variant="outline" className="min-h-12" disabled={loading || busy} onClick={() => void load()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Làm mới</Button>
          <Button data-ops-action="floor.tables.open_table_dialog" size="sm" className="min-h-12" disabled={busy} onClick={() => setOpenTable(true)}><Plus className="mr-2 h-4 w-4" /> Mở bàn</Button>
          {FEATURES.floorRedrawSeatLockV1 && (
            <Button data-ops-action="floor.redraw.open" size="sm" variant="outline" className="min-h-12" disabled={busy || tables.length === 0} onClick={() => setRedrawOpen(true)}><Shuffle className="mr-2 h-4 w-4" /> Redraw</Button>
          )}
        </div>
      </div>

      {loadError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{loadError}</p>}
      {operationError && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{operationError}</p>}

      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Đang tải roster V3…</div>
      ) : tables.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Chưa có bàn đang hoạt động. Chọn “Mở bàn” để lấy một bàn vật lý còn trống.</div>
      ) : (
        <FloorTableRosterIndex tables={tableIndex} onOpen={(tableId) => { setSelectedTableId(tableId); setSelectedSeatNumber(null); }} />
      )}

      <p className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/90">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        Live Tracker chỉ nhận thao tác khi đúng phiên bàn hiện tại. Floor không tự chuyển sang writer cũ nếu phiên đã thay đổi.
      </p>

      <OpenTableDialog open={openTable} onOpenChange={setOpenTable} tournamentId={tournament.id} onDone={() => void load()} />
      {FEATURES.floorRedrawSeatLockV1 && (
        <FloorRedrawDialogV1
          open={redrawOpen}
          onOpenChange={setRedrawOpen}
          tournamentId={tournament.id}
          tables={tables}
          client={v3}
          onApplied={load}
        />
      )}

      <Sheet open={selectedTable !== null} onOpenChange={(open) => { if (!open) setSelectedTableId(null); }}>
        <SheetContent
          side="right"
          closeLabel="Đóng danh sách bàn"
          closeButtonClassName="top-0"
          className="operations-typography h-[100dvh] w-full overflow-y-auto overscroll-contain pl-[max(1rem,calc(env(safe-area-inset-left)+0.5rem))] pr-[max(1rem,calc(env(safe-area-inset-right)+0.5rem))] pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-w-xl sm:p-6"
        >
          {selectedTable && (
            <>
              <SheetHeader className="pr-14 text-left">
                <SheetTitle>Bàn {selectedTable.tableNumber} · {selectedTable.seats.length}/{selectedTable.maxSeats}</SheetTitle>
                <button
                  type="button"
                  data-ops-action="floor.tables.open_v3_control_mode"
                  className="inline-flex min-h-12 w-fit items-center gap-2 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-expanded={modeOpen}
                  aria-controls="floor-v3-mode-panel"
                  onClick={() => setModeOpen((open) => !open)}
                >
                  {selectedTable.controlMode === "tracker" ? <RadioTower className="h-4 w-4 text-sky-300" /> : <UsersRound className="h-4 w-4 text-emerald-300" />}
                  {selectedTable.controlMode === "tracker" ? "Live Tracker" : "Manual Floor"}
                  <span className="text-muted-foreground">· Đổi chế độ</span>
                </button>
                <details className="w-fit text-left text-xs text-muted-foreground">
                  <summary className="min-h-12 cursor-pointer content-center rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Thông tin phiên bàn</summary>
                  <p className="font-mono">Revision {selectedTable.sessionRevision} · epoch {selectedTable.controlEpoch}</p>
                </details>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                {modeOpen && (
                  <section id="floor-v3-mode-panel" className="space-y-3 rounded-xl border border-border bg-card/55 p-3" aria-label="Đổi chế độ bàn">
                    <FloorTableModePicker value={nextMode} onChange={setNextMode} disabled={busy} testIdPrefix="floor-v3-mode" />
                    <Button
                      data-ops-action="floor.tables.save_v3_control_mode"
                      className="min-h-12 w-full"
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
                  {selectedSeat ? seatAction(selectedSeat) : selectedSeatNumber != null && selectedSeatLock ? (
                    <section className="space-y-3 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3">
                      <div className="flex items-start gap-2">
                        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-amber-100">Ghế {selectedSeatNumber} đang khóa</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{selectedSeatLock.reason}</p>
                        </div>
                      </div>
                      <Button
                        data-ops-action="floor.seat.unlock"
                        variant="outline"
                        className="min-h-12 w-full"
                        disabled={busy}
                        onClick={() => void run("Đã mở khóa ghế.", () => v3.setSeatLock({
                          tournamentTableId: selectedTable.tournamentTableId,
                          seatNumber: selectedSeatNumber,
                          locked: false,
                          reason: "operator_unlock",
                          expectedRevision: selectedTable.sessionRevision,
                          requestId: crypto.randomUUID(),
                        }))}
                      >
                        <UnlockKeyhole className="mr-2 h-4 w-4" /> Mở khóa ghế
                      </Button>
                    </section>
                  ) : selectedSeatNumber != null && (
                    <section className="space-y-3 rounded-xl border border-border bg-card/55 p-3">
                      <p className="text-sm font-semibold">Ghế {selectedSeatNumber} đang trống</p>
                      <p className="text-xs text-muted-foreground">Danh sách chỉ gồm entry hợp lệ của giải. Chọn “Đã loại” để khôi phục.</p>
                      <FloorEntryPicker
                        seatableEntries={seatableEntries}
                        restorableEntries={restorableEntries}
                        value={entrySelection}
                        onChange={setEntrySelection}
                      />
                      {FEATURES.floorRedrawSeatLockV1 && (
                        <div className="space-y-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
                          <label className="grid gap-1 text-xs text-muted-foreground">
                            Lý do khóa ghế
                            <input
                              value={lockReason}
                              maxLength={200}
                              onChange={(event) => setLockReason(event.target.value)}
                              className="h-12 rounded-xl border border-white/10 bg-background px-3 text-base text-foreground"
                            />
                          </label>
                          <Button
                            data-ops-action="floor.seat.lock"
                            variant="outline"
                            className="min-h-12 w-full border-amber-400/30 text-amber-200"
                            disabled={busy || lockReason.trim().length < 2}
                            onClick={() => void run("Đã khóa ghế.", () => v3.setSeatLock({
                              tournamentTableId: selectedTable.tournamentTableId,
                              seatNumber: selectedSeatNumber,
                              locked: true,
                              reason: lockReason.trim(),
                              expectedRevision: selectedTable.sessionRevision,
                              requestId: crypto.randomUUID(),
                            }))}
                          >
                            <LockKeyhole className="mr-2 h-4 w-4" /> Khóa ghế này
                          </Button>
                        </div>
                      )}
                      {entrySelection?.kind === "restore" ? (
                        <Button
                          data-ops-action="floor.players.restore"
                          className="min-h-12 w-full"
                          disabled={busy}
                          onClick={() => void run("Đã khôi phục người chơi vào ghế.", () => v3.restoreBustedPlayer({
                            entryId: entrySelection.entryId,
                            toTournamentTableId: selectedTable.tournamentTableId,
                            toSeatNumber: selectedSeatNumber,
                            expectedRevision: selectedTable.sessionRevision,
                            expectedControlEpoch: selectedTable.controlEpoch,
                            requestId: crypto.randomUUID(),
                          })).then((ok) => { if (ok) setEntrySelection(null); })}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" /> Khôi phục vào ghế này
                        </Button>
                      ) : (
                        <Button
                          data-ops-action="floor.tables.add_player"
                          className="min-h-12 w-full"
                          disabled={busy || !entrySelection}
                          onClick={() => {
                            if (!entrySelection) return;
                            void run("Đã thêm người vào ghế.", () => v3.assignEntryToSeat({
                              entryId: entrySelection.entryId,
                              tournamentTableId: selectedTable.tournamentTableId,
                              seatNumber: selectedSeatNumber,
                              expectedRevision: selectedTable.sessionRevision,
                              requestId: crypto.randomUUID(),
                            })).then((ok) => { if (ok) setEntrySelection(null); });
                          }}
                        >
                          <Plus className="mr-2 h-4 w-4" /> Thêm vào ghế này
                        </Button>
                      )}
                    </section>
                  )}
                </div>

                <FloorSeatRoster
                  seats={selectedRosterSeats}
                  maxSeats={selectedTable.maxSeats}
                  seatLocks={selectedTable.seatLocks}
                  onSeatTap={(seatNumber) => setSelectedSeatNumber(seatNumber)}
                  onEmptySeatTap={(seatNumber) => setSelectedSeatNumber(seatNumber)}
                  onLockedSeatTap={FEATURES.floorRedrawSeatLockV1 ? (seatNumber) => setSelectedSeatNumber(seatNumber) : undefined}
                />

                <section className="grid gap-2 sm:grid-cols-2">
                  <Button data-ops-action="floor.tables.open_close_table" variant="outline" className="min-h-12" disabled={busy || selectedTable.seats.length !== 0} onClick={() => setPendingTableAction("close")}>Đóng bàn trống</Button>
                  <Button data-ops-action="floor.tables.open_break_v3" variant="outline" className="min-h-12" disabled={busy || selectedTable.seats.length === 0} onClick={() => setPendingTableAction("break")}>Đóng & chuyển người</Button>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={pendingFreeSitSeat !== null} onOpenChange={(open) => { if (!open) setPendingFreeSitSeat(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Move player to Waiting?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <p>The player stays in the tournament. Their current stack is preserved, this seat becomes available, and the player returns to Waiting for a later seat assignment.</p>
                {selectedTable && pendingFreeSitSeat && (
                  <dl className="rounded-xl border border-border bg-card/55 p-3 text-sm text-foreground">
                    <div className="flex justify-between gap-3"><dt>Player</dt><dd className="min-w-0 truncate font-semibold">{pendingFreeSitSeat.displayName}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Current seat</dt><dd>Table {selectedTable.tableNumber} · Seat {pendingFreeSitSeat.seatNumber}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Entry</dt><dd>{pendingFreeSitSeat.entryNo}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Stack preserved</dt><dd>{formatStack(pendingFreeSitSeat.chipCount)}</dd></div>
                  </dl>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-ops-action="floor.player.cancel_free_sit" className="min-h-12">Keep Seat</AlertDialogCancel>
            <AlertDialogAction
              data-ops-action="floor.player.free_sit"
              className="min-h-12"
              disabled={busy || !selectedTable || !pendingFreeSitSeat}
              onClick={async (event) => {
                event.preventDefault();
                if (!selectedTable || !pendingFreeSitSeat) return;
                const seat = pendingFreeSitSeat;
                const ok = await run("Player moved to Waiting with stack preserved.", () => v3.freeSitPlayer({
                  entryId: seat.entryId,
                  expectedRevision: selectedTable.sessionRevision,
                  expectedControlEpoch: selectedTable.controlEpoch,
                  expectedChipCount: seat.chipCount,
                  requestId: crypto.randomUUID(),
                  reason: "floor_v3_operator_free_sit",
                }));
                if (ok) setPendingFreeSitSeat(null);
              }}
            >
              Confirm Free Sit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingBustSeat !== null} onOpenChange={(open) => { if (!open) setPendingBustSeat(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Loại người chơi khỏi giải?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left">
                <p>Thao tác này gỡ người chơi khỏi ghế và ghi nhận họ đã bị loại. Không thực hiện payout.</p>
                {selectedTable && pendingBustSeat && (
                  <dl className="rounded-xl border border-border bg-card/55 p-3 text-sm text-foreground">
                    <div className="flex justify-between gap-3"><dt>Người chơi</dt><dd className="min-w-0 truncate font-semibold">{pendingBustSeat.displayName}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Vị trí</dt><dd>Bàn {selectedTable.tableNumber} · Ghế {pendingBustSeat.seatNumber}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Entry</dt><dd>{pendingBustSeat.entryNo}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Chip hiện tại</dt><dd>{formatStack(pendingBustSeat.chipCount)}</dd></div>
                    <div className="mt-1 flex justify-between gap-3"><dt>Chế độ</dt><dd>{selectedTable.controlMode === "tracker" ? "Live Tracker" : "Manual Floor"}</dd></div>
                  </dl>
                )}
                {selectedTable?.controlMode === "manual" && (pendingBustSeat?.chipCount ?? 0) > 0 && (
                  <p className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-amber-100/90">Manual Floor cho phép loại khi còn chip, nhưng hệ thống sẽ ghi audit cảnh báo.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-ops-action="floor.player.cancel_bust" className="min-h-12">Giữ người chơi</AlertDialogCancel>
            <AlertDialogAction
              data-ops-action="floor.player.bust"
              className="min-h-12 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || !selectedTable || !pendingBustSeat}
              onClick={async (event) => {
                event.preventDefault();
                if (!selectedTable || !pendingBustSeat) return;
                const seat = pendingBustSeat;
                const ok = await run("Đã loại người chơi khỏi giải.", () => v3.bustPlayer({
                  entryId: seat.entryId,
                  expectedRevision: selectedTable.sessionRevision,
                  expectedControlEpoch: selectedTable.controlEpoch,
                  expectedChipCount: seat.chipCount,
                  requestId: crypto.randomUUID(),
                  reason: "floor_v3_operator_bust",
                }));
                if (ok) setPendingBustSeat(null);
              }}
            >
              Xác nhận loại
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingTableAction !== null} onOpenChange={(open) => { if (!open) setPendingTableAction(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingTableAction === "break" ? "Đóng và chuyển toàn bộ người chơi?" : "Đóng bàn trống?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTableAction === "break"
                ? "Server sẽ kiểm tra sức chứa, chuyển người, kết thúc phân công dealer và đóng phiên bàn trong một giao dịch. Nếu không đủ ghế, không có thay đổi nào được ghi."
                : "Server sẽ kiểm tra lại bàn không còn người và không có ván đang chạy trước khi đóng phiên bàn."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-ops-action="floor.tables.cancel_close_table" className="min-h-12">Huỷ</AlertDialogCancel>
            {pendingTableAction === "break" ? (
              <AlertDialogAction
                data-ops-action="floor.tables.break_v3"
                className="min-h-12"
                disabled={busy || !selectedTable}
                 onClick={async (event) => {
                   event.preventDefault();
                   if (!selectedTable) return;
                   const ok = await run("Đã đóng và chuyển người chơi.", () => v3.breakTournamentTable({
                     tournamentTableId: selectedTable.tournamentTableId,
                     expectedRevision: selectedTable.sessionRevision,
                     requestId: crypto.randomUUID(),
                     drawMode: "fill_lowest_table",
                   }));
                   if (ok) setPendingTableAction(null);
                 }}
              >
                Xác nhận đóng & chuyển
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                data-ops-action="floor.tables.close_table"
                className="min-h-12"
                disabled={busy || !selectedTable}
                 onClick={async (event) => {
                   event.preventDefault();
                   if (!selectedTable) return;
                   const ok = await run("Đã đóng bàn và giải phóng bàn vật lý.", () => v3.closeTournamentTable({
                     tournamentTableId: selectedTable.tournamentTableId,
                     expectedRevision: selectedTable.sessionRevision,
                     requestId: crypto.randomUUID(),
                   }));
                   if (ok) setPendingTableAction(null);
                 }}
              >
                Xác nhận đóng bàn
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
