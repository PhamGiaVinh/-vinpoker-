import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Search, RotateCcw, Lock, Coins } from "lucide-react";
import { formatVND } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import type { Tournament } from "@/types/tournament";
import { ConfirmPaymentDialog, type DrawMode, type ConfirmPaymentInfo } from "@/components/cashier/registrations/ConfirmPaymentDialog";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

// RPC gate: while false the Re-entry button is disabled "Cần bật RPC" and the
// handler refuses to call the (not-yet-applied) RPC. Flip after live apply.
const REENTRY_LIVE = FEATURES.registrationExtensions;

const ACTIVE_STATUSES = ["upcoming", "registering", "drawing", "active", "live", "break", "final_table"];

type Busted = { entry_id: string; player_id: string; entry_no: number; name: string };

function mapErr(res: any, raw?: string): string {
  switch (res?.error ?? raw) {
    case "unauthorized": return "Phiên đăng nhập hết hạn — đăng nhập lại.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền re-entry cho CLB này.";
    case "invalid_buy_in": return "Buy-in phải lớn hơn 0.";
    case "invalid_fee": return "Phí không hợp lệ.";
    case "entry_not_found": return "Không tìm thấy lượt chơi.";
    case "entry_not_reenterable": return "Người chơi này chưa bị loại (chỉ re-entry cho người đã bust).";
    case "player_already_active": return "Người chơi đang có ghế — không thể re-entry.";
    case "no_table_available": return "Không còn bàn trống — mở thêm bàn rồi thử lại.";
    case "seat_occupied": return "Ghế vừa bị lấy — bấm lại để bốc ghế khác.";
    case "tournament_not_open": return "Giải đã kết thúc / huỷ.";
    default: return res?.error ? `Re-entry thất bại (${res.error}).` : (raw || "Re-entry thất bại.");
  }
}

/**
 * Cashier re-entry: pick a tournament → list busted players → re-buy one back in
 * → auto-draw a new seat + print receipt (via reenter_tournament_player). The RPC
 * takes the actor from auth.uid() server-side (no client actor id), reuses the
 * player's identity, and increments entry_no.
 */
export function ReentryPanel({ clubIds }: { clubIds: string[] }) {
  const [tours, setTours] = useState<Tournament[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Tournament | null>(null);

  const [busted, setBusted] = useState<Busted[] | null>(null);
  const [bustedLoading, setBustedLoading] = useState(false);

  const [target, setTarget] = useState<Busted | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [fee, setFee] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);

  const loadTours = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("tournaments").select("*").in("status", ACTIVE_STATUSES).order("created_at", { ascending: false });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); setTours([]); return; }
    setTours((data as unknown as Tournament[]) ?? []);
  }, [clubIds]);

  useEffect(() => { loadTours(); }, [loadTours]);

  const loadBusted = useCallback(async (tournamentId: string) => {
    setBustedLoading(true);
    const { data: entries, error } = await supabase
      .from("tournament_entries")
      .select("id, player_id, entry_no, status")
      .eq("tournament_id", tournamentId)
      .eq("status", "busted")
      .order("entry_no", { ascending: true });
    if (error) { setBustedLoading(false); toast.error(error.message); setBusted([]); return; }
    const rows = (entries ?? []) as any[];
    const entryIds = rows.map((r) => r.id);
    const playerIds = [...new Set(rows.map((r) => r.player_id).filter(Boolean))];
    // Name: profile (online) → latest receipt display_name (offline walk-in) fallback.
    const [{ data: profs }, { data: receipts }] = await Promise.all([
      playerIds.length
        ? supabase.from("profiles").select("user_id, display_name").in("user_id", playerIds)
        : Promise.resolve({ data: [] as any[] }),
      entryIds.length
        ? supabase.from("seat_draw_receipts").select("entry_id, display_name, issued_at").in("entry_id", entryIds).order("issued_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const pMap = new Map((profs ?? []).map((p: any) => [p.user_id, p.display_name]));
    const rMap = new Map<string, string>();
    for (const rc of (receipts ?? []) as any[]) {
      if (rc.entry_id && !rMap.has(rc.entry_id)) rMap.set(rc.entry_id, rc.display_name);
    }
    setBustedLoading(false);
    setBusted(rows.map((r): Busted => ({
      entry_id: r.id,
      player_id: r.player_id,
      entry_no: r.entry_no,
      name: pMap.get(r.player_id) || rMap.get(r.id) || "Player",
    })));
  }, []);

  const pickTour = (t: Tournament) => {
    setSelected(t);
    setTarget(null);
    setBusted(null);
    loadBusted(t.id);
  };

  const pickPlayer = (b: Busted) => {
    setTarget(b);
    setBuyIn(Number((selected as any)?.buy_in) || 0);
    setFee(Number((selected as any)?.rake_amount) || 0);
  };

  const total = (Number(buyIn) || 0) + (Number(fee) || 0);
  const formValid = !!target && Number(buyIn) > 0 && Number(fee) >= 0;

  const submit = async (drawMode: DrawMode) => {
    if (!REENTRY_LIVE || !target || !selected) return; // defence-in-depth: never call a missing RPC
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("reenter_tournament_player", {
        p_entry_id: target.entry_id,
        p_buy_in: Number(buyIn),
        p_fee: Number(fee),
        p_draw_mode: drawMode,
      });
      const res = data as any;
      if (error || !res?.ok) { toast.error(mapErr(res, error?.message)); return; }
      toast.success(`Re-entry ${res.display_name} (lượt ${res.entry_no}) → Bàn ${res.table_number ?? "?"} · Ghế ${res.seat_number}`);
      setReceipt({
        tournamentName: selected.name,
        tournamentDate: (selected as Tournament & { start_time?: string | null }).start_time ?? null,
        playerName: res.display_name ?? target.name,
        tableNumber: res.table_number ?? null,
        seatNumber: res.seat_number,
        receiptCode: res.receipt_code,
        startingStack: res.starting_stack ?? null,
        qrValue: res.receipt_code,
      });
      setConfirmOpen(false);
      setTarget(null);
      loadBusted(selected.id);
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(
    () => (tours ?? []).filter((t) => !query || t.name.toLowerCase().includes(query.toLowerCase())),
    [tours, query],
  );

  const confirmInfo: ConfirmPaymentInfo | null = (selected && target) ? {
    referenceCode: "Tiền mặt tại quầy (re-entry)",
    totalPay: total,
    buyIn: Number(buyIn) || 0,
    platformFixedFee: Number(fee) || 0,
    tournamentName: selected.name,
    playerName: target.name,
  } : null;

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Re-entry</div>
        <Button size="sm" variant="outline" className="h-9" onClick={loadTours} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
      </div>

      {!REENTRY_LIVE && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          Chế độ xem trước: RPC <code>reenter_tournament_player</code> chưa bật trên production — xem được danh sách
          người bust nhưng chưa re-entry được. Bật sau khi apply RPC trong phiên DB có kiểm soát.
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
                  onClick={() => pickTour(t)}
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
      ) : !target ? (
        // STEP 2 — busted players list
        <>
          <button className="flex items-center gap-1 text-sm text-muted-foreground" onClick={() => { setSelected(null); setBusted(null); }}>
            <ArrowLeft className="h-4 w-4" /> Chọn giải khác
          </button>
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 flex items-center justify-between">
            <div className="text-sm font-medium">{selected.name}</div>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => loadBusted(selected.id)} disabled={bustedLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${bustedLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {busted === null ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : busted.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Chưa có người chơi nào bị loại (bust) ở giải này.</div>
          ) : (
            <div className="space-y-2">
              {busted.map((b) => (
                <div key={b.entry_id} className="rounded-lg border border-border bg-card/40 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{b.name}</div>
                    <Badge variant="outline" className="text-muted-foreground text-[11px] mt-0.5">Lượt {b.entry_no} · đã bust</Badge>
                  </div>
                  <Button size="sm" className="h-9 shrink-0" onClick={() => pickPlayer(b)}>
                    <RotateCcw className="h-3.5 w-3.5 mr-1" /> Re-entry
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        // STEP 3 — re-entry buy-in form
        <>
          <button className="flex items-center gap-1 text-sm text-muted-foreground" onClick={() => setTarget(null)}>
            <ArrowLeft className="h-4 w-4" /> Chọn người khác
          </button>
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <div className="text-sm font-medium">{target.name}</div>
            <div className="text-xs text-muted-foreground">{selected.name} · re-entry lượt {target.entry_no + 1}</div>
          </div>

          <div className="space-y-3">
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

            {REENTRY_LIVE ? (
              <Button className="h-12 w-full text-base" disabled={!formValid || busy} onClick={() => setConfirmOpen(true)}>
                <Coins className="mr-1.5 h-5 w-5" /> Re-entry
              </Button>
            ) : (
              <Button className="h-12 w-full text-base" variant="outline" disabled title="Cần apply RPC reenter_tournament_player">
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
