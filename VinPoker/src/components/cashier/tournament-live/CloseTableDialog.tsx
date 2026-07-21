import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { closeTableErrorMessage, parseCloseTableRpcResult, type CloseTableMove } from "./closeTableResponse";

type DrawMode = "redraw_balanced" | "fill_lowest_table";

/**
 * "Đóng bàn" — break a table. Re-draws ONLY this table's players into empty seats
 * at other tables (random, shortest-table-first) via the live `close_tournament_table`
 * RPC, then closes it. Atomic server-side; insufficient seats are blocked (no auto-open).
 * Each moved player gets a new seat ticket to reprint.
 */
export function CloseTableDialog({
  open, onOpenChange, tournamentName, tournamentDate,
  tableTtId, tableNumber, occupiedCount, unlinkedActiveSeatCount = 0, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentName: string;
  tournamentDate: string | null;
  tableTtId: string;
  tableNumber: number | null;
  occupiedCount: number;
  /** UX guard only. The RPC repeats this check under row locks. */
  unlinkedActiveSeatCount?: number;
  onDone: () => void;
}) {
  const [drawMode, setDrawMode] = useState<DrawMode>("redraw_balanced");
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [moves, setMoves] = useState<CloseTableMove[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const run = async () => {
    if (unlinkedActiveSeatCount > 0) {
      setErrorMessage(`Không thể đóng bàn khi còn ${unlinkedActiveSeatCount} ghế đang chơi chưa gắn entry. Hãy sửa dữ liệu ghế trước.`);
      return;
    }
    setBusy(true);
    setPhase("running");
    setErrorMessage(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- close-table RPC is not in generated types yet
      const { data, error } = await (supabase.rpc as any)("close_tournament_table", {
        p_tournament_table_id: tableTtId,
        p_draw_mode: drawMode,
        p_reason: "table_break",
      });
      const result = parseCloseTableRpcResult(data, error, occupiedCount);
      if (result.kind === "error") {
        const message = closeTableErrorMessage(
          result.response,
          result.rpcError?.message ?? result.code,
        );
        setErrorMessage(message);
        toast.error(message);
        setPhase("confirm");
        return;
      }
      setMoves(result.response.moved);
      setPhase("done");
      toast.success(`Đã đóng Bàn ${tableNumber ?? "?"} · chuyển ${result.response.moved_count} người`);
      onDone();
    } catch (cause) {
      const message = cause instanceof Error ? `Không thể đóng bàn: ${cause.message}` : "Không thể đóng bàn.";
      setErrorMessage(message);
      toast.error(message);
      setPhase("confirm");
    } finally {
      setBusy(false);
    }
  };

  const reprint = (m: CloseTableMove) => {
    setReceipt({
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
    if (!v) { setPhase("confirm"); setMoves([]); setErrorMessage(null); }
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
                : "Kết quả bốc lại — người chơi của bàn đã được xếp sang bàn khác."}
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
                <Select value={drawMode} onValueChange={(v) => setDrawMode(v as DrawMode)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="redraw_balanced">Bốc ngẫu nhiên, ưu tiên bàn ít người (mặc định)</SelectItem>
                    <SelectItem value="fill_lowest_table">Lấp bàn số nhỏ trước</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {phase === "running" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang bốc lại & đóng bàn…
            </div>
          )}

          {phase === "done" && (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {moves.length === 0 ? (
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
                <Button variant="destructive" onClick={run} disabled={busy || unlinkedActiveSeatCount > 0}>
                  <Lock className="w-3.5 h-3.5 mr-1" /> Đóng bàn
                </Button>
              </>
            )}
            {phase === "done" && <Button onClick={() => close(false)}>Xong</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receipt} />
    </>
  );
}
