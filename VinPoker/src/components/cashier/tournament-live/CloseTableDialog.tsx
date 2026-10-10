import { useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { createFloorTableControlV3Client, type FloorBreakPlan, type FloorTableControlV3Rpc, type FloorTournamentTableRoster } from "@/lib/floorTableControlV3";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Lock, Loader2, AlertTriangle, CheckCircle2, Printer } from "lucide-react";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { closeTableErrorMessage, parseCanonicalBreakTickets, parseCanonicalCloseResult, type CloseTableMove } from "./closeTableResponse";
import { readPendingFloorClose, savePendingFloorClose, clearPendingFloorClose, type PendingFloorClose } from "@/lib/floorPendingCloseIntent";

type DrawMode = "redraw_balanced" | "fill_lowest_table";

/**
 * "Đóng bàn" — break a table. Re-draws ONLY this table's players into empty seats
 * at other tables through a canonical server preview and fenced commit.
 * Deferred moves keep the source open until the server safely applies them.
 * Each moved player gets a new seat ticket to reprint.
 */
export function CloseTableDialog({
  open, onOpenChange, tournamentId, actorId, tournamentName, tournamentDate,
  tableTtId, tableNumber, occupiedCount, unlinkedActiveSeatCount = 0, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  actorId: string | null;
  tournamentName: string;
  tournamentDate: string | null;
  tableTtId: string;
  tableNumber: number | null;
  occupiedCount: number;
  /** UX guard only. The RPC repeats this check under row locks. */
  unlinkedActiveSeatCount?: number;
  onDone: () => void;
}) {
  const scopedSupabase = useSupabaseClient();
  const canonical = useMemo(() => createFloorTableControlV3Client(
    (async (name, args) => scopedSupabase.rpc(name as never, args as never)) as FloorTableControlV3Rpc,
  ), [scopedSupabase]);
  const [context, setContext] = useState<FloorTournamentTableRoster | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const scope = `${actorId ?? ""}:${tournamentId}:${tableTtId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const closeAttempt = useRef<PendingFloorClose | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [preview, setPreview] = useState<FloorBreakPlan | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const busyRef = useRef(false);
  const activeRun = useRef<object | null>(null);
  const uiScope = useRef(scope);
  const [drawMode, setDrawMode] = useState<DrawMode>("redraw_balanced");
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [moves, setMoves] = useState<CloseTableMove[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (uiScope.current !== scope || !open || !actorId) {
      uiScope.current = scope;
      activeRun.current = null;
      busyRef.current = false;
      setBusy(false);
      setPhase("confirm");
      setMoves([]);
      setPreview(null);
      setPendingCount(0);
      setErrorMessage(null);
      setReceiptOpen(false);
    }
    setContext(null);
    if (closeAttempt.current?.scope !== scope) closeAttempt.current = null;
    if (!open || !actorId) {
      setContextLoading(false);
      return;
    }
    setRecoveryBlocked(false);
    try {
      closeAttempt.current = readPendingFloorClose(scope) ?? closeAttempt.current;
      if (closeAttempt.current && (closeAttempt.current.tournamentId !== tournamentId
        || closeAttempt.current.tournamentTableId !== tableTtId)) throw new Error("Yêu cầu đã lưu không thuộc bàn này.");
      setRecovered(!!closeAttempt.current);
      if (closeAttempt.current) {
        setDrawMode(closeAttempt.current.drawMode);
        setPreview(closeAttempt.current.plan ?? null);
      }
    } catch (cause) {
      setRecoveryBlocked(true);
      setContextLoading(false);
      setErrorMessage(cause instanceof Error ? cause.message : "Không đọc được yêu cầu đóng bàn đã lưu.");
      return;
    }
    setContextLoading(true);
    setErrorMessage(closeAttempt.current ? "Chưa xác minh kết quả yêu cầu trước. Chỉ đối chiếu đúng mã và payload đã lưu, không tạo lượt mới." : null);
    void canonical.getTournamentTableRoster(tournamentId).then((result) => {
      if (cancelled || currentScope.current !== scope) return;
      const table = result.ok === true ? result.data.find((row) => row.tournamentId === tournamentId && row.tournamentTableId === tableTtId) : null;
      setContext(table ?? null);
      if (!table && !closeAttempt.current) setErrorMessage(result.ok === false
        ? closeTableErrorMessage(null, result.error) : "Không xác minh được phiên bàn đang mở. Hãy tải lại sơ đồ bàn.");
    }).catch(() => {
      if (!cancelled && currentScope.current === scope) setErrorMessage("Không tải được phiên bàn. Chưa gửi thao tác đóng bàn.");
    }).finally(() => {
      if (!cancelled && currentScope.current === scope) setContextLoading(false);
    });
    return () => {
      cancelled = true;
      activeRun.current = null;
    };
  }, [open, actorId, canonical, scope, tournamentId, tableTtId]);

  const run = async () => {
    if (busyRef.current || recoveryBlocked || !actorId || contextLoading
      || (!context && closeAttempt.current?.scope !== scope)) return;
    if (unlinkedActiveSeatCount > 0 && !closeAttempt.current) {
      setErrorMessage(`Không thể đóng bàn khi còn ${unlinkedActiveSeatCount} ghế đang chơi chưa gắn entry. Hãy sửa dữ liệu ghế trước.`);
      return;
    }
    busyRef.current = true;
    const operation = {};
    activeRun.current = operation;
    const isCurrent = () => activeRun.current === operation && currentScope.current === scope;
    const refreshAfterDenial = async (code: string) => {
      if (!["STALE_STATE", "STALE_BREAK_PLAN", "actor_not_allowed", "insufficient_capacity",
        "table_has_active_hand", "table_session_not_active", "table_session_mismatch", "table_state_changed",
        "table_not_empty", "table_not_found", "table_already_closed", "tournament_not_open", "unauthorized"].includes(code)) return;
      if (closeAttempt.current) clearPendingFloorClose(closeAttempt.current);
      closeAttempt.current = null;
      setRecovered(false);
      setPreview(null);
      setContext(null);
      setContextLoading(true);
      try {
        const fresh = await canonical.getTournamentTableRoster(tournamentId);
        if (!isCurrent()) return;
        setContext(fresh.ok === true ? fresh.data.find((table) => table.tournamentId === tournamentId
          && table.tournamentTableId === tableTtId) ?? null : null);
      } catch {
        // The mutation was definitively denied. A failed read never revives old
        // authority or silently resends it; the next intent needs fresh context.
      } finally {
        if (isCurrent()) setContextLoading(false);
      }
    };
    setBusy(true);
    setPhase("running");
    setErrorMessage(null);
    try {
      if (!closeAttempt.current && context && context.seats.length > 0 && !preview) {
        const response = await canonical.planBreakTable({ tournamentTableId: context.tournamentTableId,
          expectedRevision: context.sessionRevision, drawMode });
        if (!isCurrent()) return;
        if (response.ok === false) throw new Error(closeTableErrorMessage(null, response.error));
        const plan = response.data;
        if (plan.sourceTournamentTableId !== context.tournamentTableId
          || plan.expectedRevision !== context.sessionRevision
          || plan.moves.length + plan.blockers.length !== context.seats.length) {
          throw new Error("Kế hoạch không khớp phiên bàn hiện tại. Hãy tải lại.");
        }
        setPreview(plan);
        setPhase("confirm");
        return;
      }
      if (closeAttempt.current ? closeAttempt.current.activeSeatCount === 0 : context?.seats.length === 0) {
        const attempt = closeAttempt.current ?? { scope, tournamentId, tournamentTableId: context!.tournamentTableId,
          tableSessionId: context!.tableSessionId, expectedRevision: context!.sessionRevision,
          controlEpoch: context!.controlEpoch, activeSeatCount: 0, requestId: crypto.randomUUID(), drawMode };
        savePendingFloorClose(attempt);
        closeAttempt.current = attempt;
        const response = await canonical.closeTournamentTable({
          tournamentTableId: attempt.tournamentTableId,
          expectedRevision: attempt.expectedRevision,
          requestId: attempt.requestId,
        });
        if (!isCurrent()) return;
        if (response.ok === false) {
          await refreshAfterDenial(response.error);
          if (!isCurrent()) return;
          throw new Error(closeTableErrorMessage(null, response.error));
        }
        const result = parseCanonicalCloseResult(response.data, {
          tournamentTableId: attempt.tournamentTableId,
          tableSessionId: attempt.tableSessionId, activeSeatCount: 0,
        });
        if (result.kind === "error") {
          await refreshAfterDenial(result.code);
          if (!isCurrent()) return;
          throw new Error(closeTableErrorMessage(null, result.code));
        }
        if (result.kind !== "closed") throw new Error("Chưa xác minh được kết quả đóng phiên bàn. Giữ yêu cầu để kiểm tra lại.");
        clearPendingFloorClose(attempt);
        closeAttempt.current = null;
        setRecovered(false);
        setMoves([]);
        setPhase("done");
        toast.success(`Đã đóng Bàn ${tableNumber ?? "?"}`);
        onDone();
        return;
      }
      const attempt = closeAttempt.current ?? (context && preview?.complete && preview.blockers.length === 0
        ? { scope, tournamentId, tournamentTableId: context.tournamentTableId, tableSessionId: context.tableSessionId,
          expectedRevision: context.sessionRevision, controlEpoch: context.controlEpoch,
          activeSeatCount: context.seats.length, requestId: crypto.randomUUID(), drawMode, plan: preview } : null);
      if (!attempt?.plan) throw new Error("Chưa có kế hoạch chuyển người đầy đủ. Chưa gửi thao tác.");
      savePendingFloorClose(attempt);
      closeAttempt.current = attempt;
      const response = await canonical.breakTournamentTable({ tournamentTableId: attempt.tournamentTableId,
        expectedRevision: attempt.expectedRevision, requestId: attempt.requestId,
        drawMode: attempt.drawMode, planHash: attempt.plan.planHash });
      if (!isCurrent()) return;
      if (response.ok === false) {
        await refreshAfterDenial(response.error);
        if (!isCurrent()) return;
        throw new Error(closeTableErrorMessage(null, response.error));
      }
      const result = parseCanonicalCloseResult(response.data, { tournamentTableId: attempt.tournamentTableId,
        tableSessionId: attempt.tableSessionId, activeSeatCount: attempt.activeSeatCount });
      if (result.kind === "error") {
        await refreshAfterDenial(result.code);
        if (!isCurrent()) return;
        throw new Error(closeTableErrorMessage(null, result.code));
      }
      const tickets = parseCanonicalBreakTickets(response.data, attempt.plan.moves);
      if (!tickets || tickets.length !== result.movedCount) {
        throw new Error("Chưa xác minh được phiếu chuyển ghế. Giữ yêu cầu để kiểm tra lại, không gửi lượt chuyển mới.");
      }
      clearPendingFloorClose(attempt);
      closeAttempt.current = null;
      setRecovered(false);
      setMoves(tickets);
      setPendingCount(result.pendingCount);
      setPhase("done");
      toast.success(result.kind === "pending"
        ? `Đã lưu ${result.pendingCount} lượt chuyển. Bàn còn mở đến khi các hand và lượt chuyển hoàn tất.`
        : `Đã đóng Bàn ${tableNumber ?? "?"} · chuyển ${result.movedCount} người`);
      onDone();
    } catch (cause) {
      if (!isCurrent()) return;
      const message = cause instanceof Error ? `Không thể đóng bàn: ${cause.message}` : "Không thể đóng bàn.";
      setErrorMessage(message);
      toast.error(message);
      setPhase("confirm");
    } finally {
      if (activeRun.current === operation) {
        activeRun.current = null;
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const reprint = (m: CloseTableMove) => {
    if (!actorId || !m.entry_id) { setErrorMessage("Không xác minh được entry của phiếu chuyển ghế."); return; }
    setReceipt({
      floorSeatContext: { actorId, tournamentId, entryId: m.entry_id },
      tournamentName, tournamentDate,
      playerName: m.player_name,
      tableNumber: m.to_table_number,
      seatNumber: m.to_seat_number,
      receiptCode: m.receipt_code,
      startingStack: null,
      qrValue: m.receipt_code,
    });
    setReceiptOpen(true);
  };

  const close = (v: boolean) => {
    if (busy) return;
    onOpenChange(v);
    if (!v) { setPhase("confirm"); setMoves([]); setPreview(null); setPendingCount(0); setErrorMessage(null); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Lock className="w-4 h-4" /> Đóng bàn {tableNumber ?? ""}
            </DialogTitle>
            <DialogDescription>
              {phase === "confirm"
                ? `Bàn này có ${occupiedCount} người — sẽ bốc ngẫu nhiên sang ghế trống ở các bàn khác rồi đóng bàn.`
                : pendingCount > 0 ? "Bàn còn mở: các lượt chuyển đang chờ ranh giới hand an toàn."
                  : "Kết quả chuyển ghế đã được máy chủ xác nhận."}
            </DialogDescription>
          </DialogHeader>

          {phase === "confirm" && (
            <div className="space-y-3">
              {unlinkedActiveSeatCount > 0 && (
                <div role="alert" className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Không thể đóng bàn: phát hiện {unlinkedActiveSeatCount} ghế đang chơi chưa gắn entry. Máy chủ cũng sẽ chặn thao tác này.
                </div>
              )}
              {errorMessage && (
                <div role="alert" className="rounded-md border border-destructive/45 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {errorMessage}
                </div>
              )}
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Nếu không đủ ghế trống ở các bàn khác, thao tác sẽ bị chặn — hãy mở thêm bàn trước.
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cách xếp chỗ</Label>
                <Select value={drawMode} disabled={!!closeAttempt.current} onValueChange={(v) => { setDrawMode(v as DrawMode); setPreview(null); }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="redraw_balanced">Bốc ngẫu nhiên, ưu tiên bàn ít người (mặc định)</SelectItem>
                    <SelectItem value="fill_lowest_table">Lấp bàn số nhỏ trước</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {preview && <div className="space-y-2 max-h-64 overflow-y-auto" aria-label="Kế hoạch chuyển người">
                {preview.moves.map((move) => <div key={move.entryId} className="text-sm">
                  {move.playerName} → Bàn {move.destinationTableNumber} · Ghế {move.destinationSeatNumber}
                  {move.transferMode === "after_current_hand" && <span className="block text-xs text-muted-foreground">Chờ hand hiện tại kết thúc</span>}
                </div>)}
                {preview.blockers.map((blocker, index) => <div key={`${blocker.sourceSeatNumber}:${index}`} role="alert" className="text-xs text-destructive">
                  {blocker.playerName} · Ghế {blocker.sourceSeatNumber}: {blocker.reason === "missing_entry" ? "Chưa gắn entry" : "Chưa có ghế đích phù hợp"}
                </div>)}
                {!preview.complete && <p role="alert" className="text-xs text-destructive">Kế hoạch chưa đầy đủ. Không thể chuyển và đóng bàn.</p>}
              </div>}
            </div>
          )}

          {phase === "running" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang bốc lại & đóng bàn…
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {pendingCount > 0 && <p role="status" className="text-sm text-muted-foreground">Còn {pendingCount} lượt chuyển đang chờ. Phiếu chỉ được cấp khi ghế đích đã áp dụng.</p>}
              {moves.length === 0 && pendingCount === 0 ? (
                <div className="text-xs text-muted-foreground py-2">Bàn trống — đã đóng, không có ai cần chuyển.</div>
              ) : moves.map((m) => (
                <div key={m.receipt_code} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                    <span className="truncate">{m.player_name}</span>
                    <span className="text-muted-foreground text-xs shrink-0">→ Bàn {m.to_table_number ?? "?"} · Ghế {m.to_seat_number}</span>
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => reprint(m)}>
                    <Printer className="w-3.5 h-3.5 mr-1" /> Phiếu
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            {phase === "confirm" && (
              <>
                <Button variant="outline" onClick={() => close(false)}>Quay lại</Button>
                <Button variant="destructive" onClick={run} disabled={busy || recoveryBlocked || contextLoading || !actorId || (!context && closeAttempt.current?.scope !== scope) || (unlinkedActiveSeatCount > 0 && !closeAttempt.current) || (!!preview && !preview.complete && !closeAttempt.current)}>
                  <Lock className="w-3.5 h-3.5 mr-1" /> {recovered ? "Đối chiếu yêu cầu đã lưu" : context && context.seats.length > 0
                    ? preview || closeAttempt.current ? "Xác nhận chuyển & đóng" : "Xem kế hoạch chuyển" : "Đóng bàn"}
                </Button>
              </>
            )}
            {phase === "done" && <Button onClick={() => close(false)}>Xong</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen}
        receipt={receipt?.floorSeatContext?.actorId === actorId ? receipt : null} />
    </>
  );
}
