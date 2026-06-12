import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowRightLeft, CheckCircle2, Loader2 } from "lucide-react";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

const REASON_PRESETS = ["Cân bàn", "Bàn đóng", "Yêu cầu người chơi", "Khác"] as const;
type ReasonPreset = (typeof REASON_PRESETS)[number];

interface TargetTable {
  id: string;            // tournament_tables.id — the id move_player_seat expects
  tableName: string;
  tableNumber: number | null;
  maxSeats: number;
  activeCount: number;
}

interface OccupiedSeat {
  seat_number: number;
  player_name: string | null;
}

type MoveResult = {
  ok: boolean;
  error?: string;
  already_there?: boolean;
  player_name?: string;
  to_table_number?: number | null;
  to_seat_number?: number;
  from_table_number?: number | null;
  from_seat_number?: number | null;
  receipt_code?: string;
  current_stack?: number | null;
  max_seats?: number;
};

function mapError(res: MoveResult | null, rawMessage?: string): string {
  const code = res?.error ?? rawMessage;
  switch (code) {
    case "entry_not_found": return "Không tìm thấy entry của người chơi.";
    case "entry_not_seated": return "Người chơi không còn ở trạng thái đang ngồi.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền chuyển ghế cho CLB này.";
    case "no_active_seat": return "Người chơi không có ghế active — kiểm tra Table Draw.";
    case "invalid_destination_table": return "Bàn đích không hợp lệ hoặc đã đóng — tải lại danh sách bàn.";
    case "invalid_seat_number": return `Số ghế không hợp lệ${res?.max_seats ? ` (1–${res.max_seats})` : ""}.`;
    case "seat_occupied": return "Ghế vừa có người khác ngồi — sơ đồ đã được tải lại, chọn ghế khác.";
    default: return code ? `Chuyển ghế thất bại (${code}).` : "Chuyển ghế thất bại.";
  }
}

/**
 * Move a System-A (entry-backed) player through move_player_seat — the ONLY
 * seat-change path that keeps receipts + seat_assignment_history consistent
 * (old receipt superseded, new receipt draw_type='manual_move', audited reason).
 * Self-loads fresh table/occupancy state on every open; occupied targets are
 * disabled client-side and the server's partial unique index is the real guard
 * (seat_occupied → reload + retry).
 */
export function MovePlayerDialog({
  open, onOpenChange, tournamentId,
  entryId, playerName, currentTournamentTableId, currentSeatNumber, onMoved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tournamentId: string;
  entryId: string;
  playerName: string;
  /** tournament_tables.id of the player's current table (highlighting only). */
  currentTournamentTableId: string | null;
  currentSeatNumber: number | null;
  onMoved: () => void;
}) {
  const { user } = useAuth();
  const [tournamentMeta, setTournamentMeta] = useState<{ name: string; start_time: string | null }>({ name: "Giải đấu", start_time: null });
  const [tables, setTables] = useState<TargetTable[] | null>(null);
  const [occupied, setOccupied] = useState<Record<string, OccupiedSeat[]>>({});
  const [targetTableId, setTargetTableId] = useState<string>("");
  const [targetSeat, setTargetSeat] = useState<number | null>(null);
  const [reasonPreset, setReasonPreset] = useState<ReasonPreset>("Cân bàn");
  const [reasonText, setReasonText] = useState("");
  const [phase, setPhase] = useState<"pick" | "confirm" | "moving" | "done">("pick");
  const [result, setResult] = useState<MoveResult | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const loadState = async () => {
    const [{ data: tt }, { data: seats }, { data: tour }] = await Promise.all([
      supabase.from("tournament_tables")
        .select("id, table_name, table_number, max_seats, status, table_id")
        .eq("tournament_id", tournamentId),
      supabase.from("tournament_seats")
        .select("table_id, seat_number, player_name, is_active")
        .eq("tournament_id", tournamentId)
        .eq("is_active", true),
      supabase.from("tournaments")
        .select("name, start_time")
        .eq("id", tournamentId)
        .single(),
    ]);
    if (tour) setTournamentMeta({ name: (tour as any).name ?? "Giải đấu", start_time: (tour as any).start_time ?? null });
    const occ: Record<string, OccupiedSeat[]> = {};
    for (const s of (seats ?? []) as any[]) {
      (occ[s.table_id] ??= []).push({ seat_number: s.seat_number, player_name: s.player_name });
    }
    setOccupied(occ);
    setTables(((tt ?? []) as any[])
      // mirror the RPC's destination filter: active + linked to a game table
      .filter((t) => t.status === "active" && t.table_id !== null)
      .map((t) => ({
        id: t.id,
        tableName: t.table_name ?? (t.table_number != null ? `Bàn ${t.table_number}` : "Bàn ?"),
        tableNumber: t.table_number,
        maxSeats: t.max_seats ?? 9,
        activeCount: (occ[t.id] ?? []).length,
      }))
      .sort((a, b) => (a.tableNumber ?? 1e9) - (b.tableNumber ?? 1e9)));
  };

  useEffect(() => {
    if (!open) {
      setPhase("pick"); setResult(null); setTables(null);
      setTargetTableId(""); setTargetSeat(null);
      setReasonPreset("Cân bàn"); setReasonText("");
      return;
    }
    loadState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tournamentId]);

  const targetTable = useMemo(
    () => (tables ?? []).find((t) => t.id === targetTableId) ?? null,
    [tables, targetTableId],
  );

  const occupantBySeat = useMemo(() => {
    const m = new Map<number, OccupiedSeat>();
    for (const o of occupied[targetTableId] ?? []) m.set(o.seat_number, o);
    return m;
  }, [occupied, targetTableId]);

  const reason = reasonPreset === "Khác" ? reasonText.trim() : reasonPreset;

  const runMove = async () => {
    if (!user || !targetTable || targetSeat == null) return;
    setPhase("moving");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source: supabase/migrations/20260807000002 (+ guard v2 20260818000000, pending apply)
    const { data, error } = await (supabase.rpc as any)("move_player_seat", {
      p_entry_id: entryId,
      p_to_tournament_table_id: targetTable.id,
      p_to_seat_number: targetSeat,
      p_actor_user_id: user.id,
      p_reason: reason,
    });
    const res = (data ?? null) as MoveResult | null;
    if (error || !res?.ok) {
      toast.error(mapError(res, error?.message));
      if (res?.error === "seat_occupied") await loadState(); // somebody won the race — refresh occupancy
      setPhase("pick");
      return;
    }
    setResult(res);
    if (res.receipt_code) {
      setReceipt({
        tournamentName: tournamentMeta.name,
        tournamentDate: tournamentMeta.start_time,
        playerName: res.player_name ?? playerName,
        tableNumber: res.to_table_number ?? targetTable.tableNumber,
        seatNumber: res.to_seat_number ?? targetSeat,
        receiptCode: res.receipt_code,
        startingStack: res.current_stack ?? null,
        qrValue: res.receipt_code,
      });
    }
    setPhase("done");
    toast.success(
      res.already_there
        ? "Người chơi đã ở đúng ghế này."
        : `Đã chuyển ${res.player_name ?? playerName} → Bàn ${res.to_table_number ?? "?"} · Ghế ${res.to_seat_number}`,
    );
    onMoved();
  };

  const close = (v: boolean) => {
    if (phase === "moving") return;
    onOpenChange(v);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-primary" /> Chuyển ghế — {playerName}
            </DialogTitle>
            <DialogDescription>
              Chuyển qua RPC có kiểm soát: phiếu cũ bị thay thế, phiếu mới được in, lý do được ghi vào lịch sử ghế.
            </DialogDescription>
          </DialogHeader>

          {phase === "pick" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Bàn đích</Label>
                {tables === null ? (
                  <Skeleton className="h-9" />
                ) : (
                  <Select value={targetTableId} onValueChange={(v) => { setTargetTableId(v); setTargetSeat(null); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Chọn bàn" /></SelectTrigger>
                    <SelectContent>
                      {tables.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.tableName} — {t.activeCount}/{t.maxSeats} ghế
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {targetTable && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Ghế (trống mới chọn được)</Label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {Array.from({ length: targetTable.maxSeats }, (_, i) => i + 1).map((n) => {
                      const occ = occupantBySeat.get(n);
                      const isCurrent = targetTable.id === currentTournamentTableId && n === currentSeatNumber;
                      return (
                        <Button
                          key={n}
                          type="button"
                          size="sm"
                          variant={targetSeat === n ? "default" : "outline"}
                          className="h-9"
                          disabled={!!occ}
                          title={occ ? `${occ.player_name ?? "Có người"}${isCurrent ? " (ghế hiện tại)" : ""}` : `Ghế ${n} trống`}
                          onClick={() => setTargetSeat(n)}
                        >
                          {n}{isCurrent ? "•" : ""}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">• = ghế hiện tại của người chơi. Ghế mờ = đã có người.</p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Lý do chuyển (bắt buộc — vào lịch sử)</Label>
                <Select value={reasonPreset} onValueChange={(v) => setReasonPreset(v as ReasonPreset)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASON_PRESETS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                {reasonPreset === "Khác" && (
                  <Input value={reasonText} onChange={(e) => setReasonText(e.target.value)}
                    placeholder="Nhập lý do…" className="h-9" />
                )}
              </div>
            </div>
          )}

          {phase === "confirm" && targetTable && targetSeat != null && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1 text-sm">
              <div className="font-medium">
                {playerName}: {currentSeatNumber != null ? `Ghế ${currentSeatNumber}` : "ghế hiện tại"} → {targetTable.tableName} · Ghế {targetSeat}
              </div>
              <div className="text-xs text-muted-foreground">Lý do: {reason}</div>
              <div className="text-xs text-muted-foreground">Phiếu cũ sẽ bị thay thế bằng phiếu mới — in lại cho người chơi.</div>
            </div>
          )}

          {phase === "moving" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang chuyển ghế…
            </div>
          )}

          {phase === "done" && result && (
            <div className="rounded-md border border-emerald-600/40 bg-emerald-950/20 p-3 text-sm flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {result.already_there
                ? "Người chơi đã ở đúng ghế này — không có gì thay đổi."
                : <>Đã chuyển → Bàn {result.to_table_number ?? "?"} · Ghế {result.to_seat_number}. Phiếu mới: <span className="font-mono">{result.receipt_code}</span></>}
            </div>
          )}

          <DialogFooter>
            {phase === "pick" && (
              <>
                <Button variant="outline" onClick={() => close(false)}>Quay lại</Button>
                <Button
                  disabled={!targetTable || targetSeat == null || !reason}
                  onClick={() => setPhase("confirm")}
                >
                  Tiếp tục
                </Button>
              </>
            )}
            {phase === "confirm" && (
              <>
                <Button variant="outline" onClick={() => setPhase("pick")}>Sửa lại</Button>
                <Button onClick={runMove}>
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" /> Xác nhận chuyển
                </Button>
              </>
            )}
            {phase === "done" && (
              <>
                {receipt && !result?.already_there && (
                  <Button variant="outline" onClick={() => setReceiptOpen(true)}>Xem phiếu mới</Button>
                )}
                <Button onClick={() => close(false)}>Đóng</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receipt} />
    </>
  );
}
