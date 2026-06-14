import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Copy, ImageIcon, RefreshCw, CheckCircle2, XCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { ConfirmPaymentDialog, type DrawMode } from "@/components/cashier/registrations/ConfirmPaymentDialog";
import { CancelRegistrationDialog } from "@/components/cashier/registrations/CancelRegistrationDialog";
import { VoidRegistrationDialog } from "@/components/cashier/registrations/VoidRegistrationDialog";

type Row = {
  id: string;
  reference_code: string;
  buy_in: number;
  platform_fixed_fee: number;
  total_pay: number;
  status: string;
  transfer_proof_image_url: string | null;
  transfer_proof_submitted: boolean;
  committed_at: string;
  player_id: string;
  tournament_id: string;
  club_id: string | null;
  player?: { display_name: string | null; phone: string | null } | null;
  tournament?: { name: string; start_time: string } | null;
  club?: { name: string } | null;
};

const maskPhone = (p?: string | null) => {
  if (!p) return "—";
  const s = p.replace(/\D/g, "");
  if (s.length < 7) return p;
  return s.slice(0, 3) + "****" + s.slice(-3);
};

/**
 * @param clubIds When provided (cashier dashboard), constrains the list to these
 *   clubs in addition to RLS. Omitted (admin Ops) → global RLS-scoped behavior.
 */
export const TournamentRegistrationsTab = ({ clubIds }: { clubIds?: string[] } = {}) => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "confirmed" | "all">("pending");
  const [preview, setPreview] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Row | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [voidTarget, setVoidTarget] = useState<Row | null>(null);
  // Stale-response guard: mount + clubs-loaded fire loads back to back; only the
  // latest request may write state (observed: empty first response landing last).
  const loadSeq = useState({ n: 0 })[0];

  const load = async () => {
    const seq = ++loadSeq.n;
    const fresh = () => seq === loadSeq.n;
    setLoading(true);

    // Scope: cashier/club_owner → only own clubs (RLS handles, but we also constrain UI)
    let q = supabase
      .from("tournament_registrations")
      .select(`
        id, reference_code, buy_in, platform_fixed_fee, total_pay, status,
        transfer_proof_image_url, transfer_proof_submitted, committed_at,
        player_id, tournament_id, club_id,
        player:profiles!tournament_registrations_player_id_fkey(display_name, phone),
        tournament:tournaments(name, start_time),
        club:clubs(name)
      `)
      .order("committed_at", { ascending: false })
      .limit(200);

    if (clubIds?.length) q = q.in("club_id", clubIds);
    if (filter === "pending") q = q.eq("status", "pending");
    else if (filter === "confirmed") q = q.eq("status", "confirmed");

    const { data, error } = await q;
    if (!fresh()) return;
    setLoading(false);
    if (error) {
      // FK alias may not exist → fallback simpler query (same scope + status filter)
      let q2 = supabase
        .from("tournament_registrations")
        .select("id, reference_code, buy_in, platform_fixed_fee, total_pay, status, transfer_proof_image_url, transfer_proof_submitted, committed_at, player_id, tournament_id, club_id")
        .order("committed_at", { ascending: false })
        .limit(200);
      if (clubIds?.length) q2 = q2.in("club_id", clubIds);
      if (filter === "pending") q2 = q2.eq("status", "pending");
      else if (filter === "confirmed") q2 = q2.eq("status", "confirmed");
      const { data: data2 } = await q2;
      const base = (data2 ?? []) as any[];
      const playerIds = [...new Set(base.map(r => r.player_id))];
      const tournamentIds = [...new Set(base.map(r => r.tournament_id))];
      const rowClubIds = [...new Set(base.map(r => r.club_id).filter(Boolean))];
      const [{ data: profs }, { data: tours }, { data: clubsData }] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, phone").in("user_id", playerIds),
        supabase.from("tournaments").select("id, name, start_time").in("id", tournamentIds),
        rowClubIds.length ? supabase.from("clubs").select("id, name").in("id", rowClubIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
      const tMap = new Map((tours ?? []).map((t: any) => [t.id, t]));
      const cMap = new Map((clubsData ?? []).map((c: any) => [c.id, c]));
      if (!fresh()) return;
      setRows(base.map(r => ({
        ...r,
        player: pMap.get(r.player_id) ?? null,
        tournament: tMap.get(r.tournament_id) ?? null,
        club: r.club_id ? cMap.get(r.club_id) ?? null : null,
      })));
      return;
    }
    setRows((data ?? []) as any);
  };

  // Re-run when the status filter changes or the cashier's club set changes
  // (clubIds is a fresh array each render; key on its contents to avoid loops).
  useEffect(() => { load(); }, [filter, clubIds?.join(",")]);

  const confirm = async (r: Row, drawMode: DrawMode) => {
    setBusy(r.id);
    // Atomic confirm + auto seat draw + receipt + history (one transaction, FOR UPDATE locks).
    // RPC is the real guard against double-confirm / duplicate seats; the button busy state
    // only prevents accidental double-click.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source: supabase/migrations/20260807000001 + 20260811000000; not yet in generated types.ts
    const { data, error } = await (supabase.rpc as any)("confirm_registration_and_assign_seat", {
      p_registration_id: r.id,
      p_actor_user_id: user?.id,
      p_draw_mode: drawMode,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    const res = data as ConfirmResult | null;
    if (!res?.ok) { toast.error(mapError(res?.error)); return; }

    setConfirmTarget(null);
    toast.success(`Đã xác nhận — Bàn ${res.table_number ?? "?"}, Ghế ${res.seat_number}`);
    setReceipt({
      tournamentName: r.tournament?.name ?? "Giải đấu",
      tournamentDate: r.tournament?.start_time ?? null,
      playerName: res.display_name ?? r.player?.display_name ?? "PLAYER",
      tableNumber: res.table_number ?? null,
      seatNumber: res.seat_number,
      receiptCode: res.receipt_code,
      startingStack: res.starting_stack ?? null,
      qrValue: res.receipt_code,
    });
    setReceiptOpen(true);

    // Notify the player of their seat (best-effort; failure here must not block the flow).
    await supabase.from("notifications").insert({
      user_id: r.player_id,
      type: "system_announcement",
      title: "Đăng ký giải đã được xác nhận",
      body: `Bạn được xếp Bàn ${res.table_number ?? "?"}, Ghế ${res.seat_number} cho giải "${r.tournament?.name ?? ""}". Mã phiếu: ${res.receipt_code}.`,
      data: {
        registration_id: r.id,
        tournament_id: r.tournament_id,
        table_number: res.table_number,
        seat_number: res.seat_number,
        receipt_code: res.receipt_code,
      },
    });
    load();
  };

  const cancel = async (r: Row, reason: string) => {
    setBusy(r.id);
    const { error } = await supabase
      .from("tournament_registrations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id,
        cancellation_reason: reason,
      })
      .eq("id", r.id)
      .eq("status", "pending"); // status guard: never cancel an already-confirmed row
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    setCancelTarget(null);
    toast.success("Đã huỷ đăng ký");
    load();
  };

  // Void a CONFIRMED registration: cascades seat/entry/receipt + reverses revenue
  // via the void_registration RPC (actor bound to auth.uid() server-side).
  const voidReg = async (r: Row, reason: string) => {
    setBusy(r.id);
    const { data, error } = await supabase.rpc("void_registration", {
      p_registration_id: r.id,
      p_reason: reason,
    });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string; refund_amount?: number } | null;
    if (error || !res?.ok) { toast.error(mapVoidError(res?.error, error?.message)); return; }
    setVoidTarget(null);
    toast.success(`Đã huỷ & hoàn ${formatVND(res.refund_amount ?? r.total_pay)} — ghế đã giải phóng`);
    load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Đăng ký giải</h2>
          <p className="text-xs text-muted-foreground">Player tự đóng lệ phí — xác nhận sau khi tiền đã về CLB. Xác nhận sẽ tự bốc thăm chỗ và in phiếu.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={filter === "pending" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setFilter("pending")}>Chờ xác nhận</Button>
          <Button variant={filter === "confirmed" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setFilter("confirmed")}>Đã xác nhận</Button>
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setFilter("all")}>Tất cả</Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">Không có đăng ký nào.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <div className="space-y-1.5 text-sm min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => { navigator.clipboard.writeText(r.reference_code); toast.success("Đã copy mã"); }}
                    className="font-mono font-bold text-primary inline-flex items-center gap-1 hover:underline">
                    {r.reference_code} <Copy className="w-3 h-3" />
                  </button>
                  <StatusBadge status={r.status} />
                  {r.transfer_proof_submitted && <Badge variant="outline" className="text-success border-success/40">Player báo đã CK</Badge>}
                </div>
                <div className="font-medium truncate">{r.tournament?.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {r.player?.display_name ?? "Player"} · {maskPhone(r.player?.phone)} · {r.club?.name ?? "—"}
                </div>
                <div className="text-xs text-muted-foreground">Đăng ký: {formatDateTime(r.committed_at)}</div>
                <div className="text-sm">
                  Tổng: <span className="font-mono font-bold text-primary">{formatVND(r.total_pay)}</span>
                  {r.platform_fixed_fee > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (Buy-in {formatVND(r.buy_in)} + Phí {formatVND(r.platform_fixed_fee)})
                    </span>
                  )}
                </div>
                {r.transfer_proof_image_url && (
                  <button onClick={() => setPreview(r.transfer_proof_image_url)}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <ImageIcon className="w-3.5 h-3.5" /> Xem ảnh CK
                  </button>
                )}
              </div>

              {r.status === "pending" && (
                <div className="flex md:flex-col gap-2 md:w-40">
                  <Button size="sm" className="flex-1 h-9" disabled={busy === r.id} onClick={() => setConfirmTarget(r)}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Xác nhận
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40" disabled={busy === r.id} onClick={() => setCancelTarget(r)}>
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Huỷ
                  </Button>
                </div>
              )}
              {FEATURES.registrationExtensions && r.status === "confirmed" && (
                <div className="flex md:flex-col gap-2 md:w-40">
                  <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40" disabled={busy === r.id} onClick={() => setVoidTarget(r)}>
                    <Undo2 className="w-3.5 h-3.5 mr-1" /> Huỷ & hoàn
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <img src={preview} alt="proof" className="max-w-full max-h-[90vh] rounded" />
        </div>
      )}

      <ConfirmPaymentDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null); }}
        info={confirmTarget ? {
          referenceCode: confirmTarget.reference_code,
          totalPay: confirmTarget.total_pay,
          buyIn: confirmTarget.buy_in,
          platformFixedFee: confirmTarget.platform_fixed_fee,
          tournamentName: confirmTarget.tournament?.name ?? "—",
          playerName: confirmTarget.player?.display_name ?? "Player",
        } : null}
        busy={busy === confirmTarget?.id}
        onConfirm={(drawMode) => { if (confirmTarget) confirm(confirmTarget, drawMode); }}
      />

      <CancelRegistrationDialog
        open={cancelTarget !== null}
        onOpenChange={(v) => { if (!v) setCancelTarget(null); }}
        playerName={cancelTarget?.player?.display_name ?? "Player"}
        referenceCode={cancelTarget?.reference_code ?? ""}
        busy={busy === cancelTarget?.id}
        onCancel={(reason) => { if (cancelTarget) cancel(cancelTarget, reason); }}
      />

      <VoidRegistrationDialog
        open={voidTarget !== null}
        onOpenChange={(v) => { if (!v) setVoidTarget(null); }}
        playerName={voidTarget?.player?.display_name ?? "Player"}
        referenceCode={voidTarget?.reference_code ?? ""}
        refundAmount={voidTarget?.total_pay ?? 0}
        busy={busy === voidTarget?.id}
        onConfirm={(reason) => { if (voidTarget) voidReg(voidTarget, reason); }}
      />

      <SeatReceiptDialog open={receiptOpen} onOpenChange={setReceiptOpen} receipt={receipt} />
    </Card>
  );
};

type ConfirmResult = {
  ok: boolean;
  error?: string;
  table_number?: number | null;
  seat_number?: number;
  receipt_code?: string;
  display_name?: string;
  starting_stack?: number | null;
};

// Maps RPC error codes from confirm_registration_and_assign_seat to cashier-facing Vietnamese.
function mapError(code?: string): string {
  switch (code) {
    case "registration_not_found": return "Không tìm thấy đăng ký.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền xác nhận cho CLB này.";
    case "invalid_status": return "Đăng ký không ở trạng thái chờ xác nhận.";
    case "tournament_not_found": return "Không tìm thấy giải đấu.";
    case "tournament_not_open": return "Giải đã kết thúc hoặc đã huỷ — không thể xác nhận.";
    case "player_already_active": return "Người chơi đã có ghế trong giải này.";
    case "no_table_available":
    case "no_seat_available": return "Không còn bàn/ghế trống — thêm bàn cho giải rồi xác nhận lại.";
    case "already_confirmed_no_entry": return "Đăng ký đã xác nhận trước đó nhưng chưa có ghế — cần xếp ghế thủ công.";
    default: return code ? `Xác nhận thất bại (${code}).` : "Xác nhận thất bại.";
  }
}

// Maps void_registration RPC error codes to cashier-facing Vietnamese.
function mapVoidError(code?: string, raw?: string): string {
  switch (code ?? raw) {
    case "unauthorized": return "Phiên đăng nhập hết hạn — đăng nhập lại.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền huỷ cho CLB này.";
    case "registration_not_found": return "Không tìm thấy đăng ký.";
    case "already_cancelled": return "Đăng ký đã được huỷ trước đó.";
    case "invalid_status": return "Chỉ huỷ được đăng ký đã xác nhận.";
    case "entry_not_voidable": return "Người chơi đã bust/kết thúc — không thể huỷ (dùng re-entry nếu cần).";
    default: return code ? `Huỷ thất bại (${code}).` : (raw || "Huỷ thất bại.");
  }
}

const StatusBadge = ({ status }: { status: string }) => {
  if (status === "pending") return <Badge variant="outline" className="text-warning border-warning/40">⏳ Chờ xác nhận</Badge>;
  if (status === "confirmed") return <Badge variant="outline" className="text-success border-success/40">✅ Đã xác nhận</Badge>;
  if (status === "cancelled") return <Badge variant="outline" className="text-muted-foreground">❌ Đã huỷ</Badge>;
  return <Badge variant="outline">{status}</Badge>;
};
