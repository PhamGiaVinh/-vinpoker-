import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Search, UserPlus, Lock, Coins } from "lucide-react";
import { formatVND } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import type { Tournament } from "@/types/tournament";
import { ConfirmPaymentDialog, type DrawMode, type ConfirmPaymentInfo } from "@/components/cashier/registrations/ConfirmPaymentDialog";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

// RPC gate: while false the Buy-in button is disabled "Cần bật RPC" and the
// handler refuses to call the (not-yet-applied) RPC. Flip after live apply.
const BUYIN_LIVE = FEATURES.offlineBuyIn;

const ACTIVE_STATUSES = ["upcoming", "registering", "drawing", "active", "live", "break", "final_table"];

function mapErr(res: any, raw?: string): string {
  switch (res?.error ?? raw) {
    case "unauthorized": return "Phiên đăng nhập hết hạn — đăng nhập lại.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền buy-in cho CLB này.";
    case "invalid_player_name": return "Tên người chơi phải có ít nhất 2 ký tự.";
    case "invalid_buy_in": return "Buy-in phải lớn hơn 0.";
    case "invalid_fee": return "Phí không hợp lệ.";
    case "no_table_available": return "Không còn bàn trống — mở thêm bàn rồi thử lại.";
    case "seat_occupied": case "no_seat_available": return "Ghế vừa bị lấy — bấm lại để bốc ghế khác.";
    case "tournament_not_open": return "Giải đã kết thúc / huỷ.";
    default: return res?.error ? `Buy-in thất bại (${res.error}).` : (raw || "Buy-in thất bại.");
  }
}

/**
 * Cashier offline (cash / walk-in) buy-in: pick a tournament → enter player name
 * → buy-in + fee → auto-draw a seat + print receipt (via create_offline_buyin_and_seat).
 * The RPC takes the actor from auth.uid() server-side (no client actor id).
 */
export function OfflineBuyInPanel({ clubIds }: { clubIds: string[] }) {
  const [tours, setTours] = useState<Tournament[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Tournament | null>(null);

  const [playerName, setPlayerName] = useState("");
  const [buyIn, setBuyIn] = useState(0);
  const [fee, setFee] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("tournaments").select("*").in("status", ACTIVE_STATUSES).order("created_at", { ascending: false });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); setTours([]); return; }
    setTours((data as unknown as Tournament[]) ?? []);
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => (tours ?? []).filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase())),
    [tours, query],
  );

  const pick = (t: Tournament) => {
    setSelected(t);
    setPlayerName("");
    setBuyIn(Number((t as any).buy_in) || 0);
    setFee(Number((t as any).rake_amount) || 0);
  };

  const total = (Number(buyIn) || 0) + (Number(fee) || 0);
  const formValid = !!selected && playerName.trim().length >= 2 && Number(buyIn) > 0 && Number(fee) >= 0;

  const submit = async (drawMode: DrawMode) => {
    if (!BUYIN_LIVE || !selected) return; // defence-in-depth: never call a missing RPC
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_offline_buyin_and_seat", {
        p_tournament_id: selected.id,
        p_player_name: playerName.trim(),
        p_buy_in: Number(buyIn),
        p_fee: Number(fee),
        p_draw_mode: drawMode,
      });
      const res = data as any;
      if (error || !res?.ok) { toast.error(mapErr(res, error?.message)); return; }
      toast.success(`Đã buy-in ${res.display_name} → Bàn ${res.table_number ?? "?"} · Ghế ${res.seat_number}`);
      setReceipt({
        tournamentName: selected.name,
        tournamentDate: (selected as Tournament & { start_time?: string | null }).start_time ?? null,
        playerName: res.display_name ?? playerName.trim(),
        tableNumber: res.table_number ?? null,
        seatNumber: res.seat_number,
        receiptCode: res.receipt_code,
        startingStack: res.starting_stack ?? null,
        qrValue: res.receipt_code,
      });
      setConfirmOpen(false);
      setPlayerName("");
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  const confirmInfo: ConfirmPaymentInfo | null = selected ? {
    referenceCode: "Tiền mặt tại quầy",
    totalPay: total,
    buyIn: Number(buyIn) || 0,
    platformFixedFee: Number(fee) || 0,
    tournamentName: selected.name,
    playerName: playerName.trim() || "—",
  } : null;

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2"><UserPlus className="h-4 w-4" /> Buy-in tại quầy</div>
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
      </div>

      {!BUYIN_LIVE && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Chế độ xem trước: RPC <code>create_offline_buyin_and_seat</code> chưa bật trên production — chọn giải / nhập
          được nhưng chưa buy-in được. Bật sau khi apply RPC trong phiên DB có kiểm soát.
        </div>
      )}

      {!selected ? (
        // STEP 1 — tournament picker
        <>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Tìm giải…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {tours === null ? (
            <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Không có giải đang mở.</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">Buy-in {formatVND(Number((t as any).buy_in) || 0)}</div>
                  </div>
                  <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        // STEP 2 — buy-in form
        <>
          <button className="flex items-center gap-1 text-sm text-muted-foreground" onClick={() => setSelected(null)}>
            <ArrowLeft className="h-4 w-4" /> Chọn giải khác
          </button>
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <div className="text-sm font-medium">{selected.name}</div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Tên người chơi *</Label>
              <Input className="h-11" placeholder="VD: Nguyễn Văn A" value={playerName} onChange={(e) => setPlayerName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Buy-in</Label>
                <Input className="h-11 font-mono" type="number" min={0} value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-primary">Phí (rake)</Label>
                <Input className="h-11 font-mono" type="number" min={0} value={fee} onChange={(e) => setFee(Number(e.target.value))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Tổng thu</span>
              <span className="font-mono font-bold text-primary">{formatVND(total)}</span>
            </div>

            {BUYIN_LIVE ? (
              <Button className="h-12 w-full text-base" disabled={!formValid || busy} onClick={() => setConfirmOpen(true)}>
                <Coins className="mr-1.5 h-5 w-5" /> Buy-in
              </Button>
            ) : (
              <Button className="h-12 w-full text-base" variant="outline" disabled title="Cần apply RPC create_offline_buyin_and_seat">
                <Lock className="mr-1.5 h-5 w-5" /> Cần bật RPC
              </Button>
            )}
          </div>
        </>
      )}

      <ConfirmPaymentDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        info={confirmInfo}
        busy={busy}
        onConfirm={submit}
      />

      <SeatReceiptDialog open={receipt !== null} onOpenChange={(v) => { if (!v) setReceipt(null); }} receipt={receipt} />
    </Card>
  );
}
