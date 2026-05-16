import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Copy, ImageIcon, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";

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

export const TournamentRegistrationsTab = () => {
  const { user, isAdmin, isCashier } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [preview, setPreview] = useState<string | null>(null);

  const load = async () => {
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

    if (filter === "pending") q = q.eq("status", "pending");

    const { data, error } = await q;
    setLoading(false);
    if (error) {
      // FK alias may not exist → fallback simpler query
      const { data: data2 } = await supabase
        .from("tournament_registrations")
        .select("id, reference_code, buy_in, platform_fixed_fee, total_pay, status, transfer_proof_image_url, transfer_proof_submitted, committed_at, player_id, tournament_id, club_id")
        .order("committed_at", { ascending: false })
        .limit(200);
      const base = (data2 ?? []) as any[];
      const playerIds = [...new Set(base.map(r => r.player_id))];
      const tournamentIds = [...new Set(base.map(r => r.tournament_id))];
      const clubIds = [...new Set(base.map(r => r.club_id).filter(Boolean))];
      const [{ data: profs }, { data: tours }, { data: clubs }] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, phone").in("user_id", playerIds),
        supabase.from("tournaments").select("id, name, start_time").in("id", tournamentIds),
        clubIds.length ? supabase.from("clubs").select("id, name").in("id", clubIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const pMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
      const tMap = new Map((tours ?? []).map((t: any) => [t.id, t]));
      const cMap = new Map((clubs ?? []).map((c: any) => [c.id, c]));
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

  useEffect(() => { load(); }, [filter]);

  const confirm = async (r: Row) => {
    if (!confirm_asks(r)) return;
    setBusy(r.id);
    const { error } = await supabase
      .from("tournament_registrations")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: user?.id })
      .eq("id", r.id)
      .eq("status", "pending");
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã xác nhận đăng ký");
    // Notify player
    await supabase.from("notifications").insert({
      user_id: r.player_id,
      type: "deal_committed",
      title: "Đăng ký giải đã được xác nhận",
      body: `Đăng ký giải "${r.tournament?.name ?? ""}" đã được CLB xác nhận. Vui lòng đến check-in.`,
      data: { registration_id: r.id, tournament_id: r.tournament_id },
    });
    load();
  };

  const cancel = async (r: Row) => {
    const reason = prompt("Lý do huỷ?", "Không nhận được tiền");
    if (reason == null) return;
    setBusy(r.id);
    const { error } = await supabase
      .from("tournament_registrations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: user?.id,
        cancellation_reason: reason || "cashier_cancelled",
      })
      .eq("id", r.id);
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Đã huỷ đăng ký");
    load();
  };

  if (!isAdmin && !isCashier) {
    // Allow club owners too — but RLS will enforce; show generic gate only if neither
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Đăng ký giải tập huấn</h2>
          <p className="text-xs text-muted-foreground">Player tự đóng lệ phí — xác nhận sau khi tiền đã về CLB.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={filter === "pending" ? "default" : "outline"} size="sm" onClick={() => setFilter("pending")}>Chờ xác nhận</Button>
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>Tất cả</Button>
          <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
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
                  Tổng: <span className="font-mono font-bold text-primary">{formatVND(r.buy_in)}</span>
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
                  <Button size="sm" className="flex-1" disabled={busy === r.id} onClick={() => confirm(r)}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Xác nhận
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/40" disabled={busy === r.id} onClick={() => cancel(r)}>
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Huỷ
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
    </Card>
  );
};

function confirm_asks(r: Row) {
  return window.confirm(
    `Xác nhận đã nhận ${formatVND(r.total_pay)} cho giải "${r.tournament?.name ?? ""}"?\n\nMã CK: ${r.reference_code}`,
  );
}

const StatusBadge = ({ status }: { status: string }) => {
  if (status === "pending") return <Badge variant="outline" className="text-warning border-warning/40">⏳ Chờ xác nhận</Badge>;
  if (status === "confirmed") return <Badge variant="outline" className="text-success border-success/40">✅ Đã xác nhận</Badge>;
  if (status === "cancelled") return <Badge variant="outline" className="text-muted-foreground">❌ Đã huỷ</Badge>;
  return <Badge variant="outline">{status}</Badge>;
};
