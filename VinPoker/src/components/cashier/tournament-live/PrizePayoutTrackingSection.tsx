import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Lock, CheckCircle2, HandCoins } from "lucide-react";
import { formatVND } from "@/lib/format";
import {
  useTournamentPayoutRecipients, type PayoutRecipientPlace,
} from "@/hooks/useTournamentPayoutRecipients";

// W3-B2 — cashier "Đã trả thưởng" (record prize paid) section. Read via
// get_tournament_payout_recipients (server-derived list); write via
// record_tournament_prize_payment (server-derives amount + recipient — the client sends only
// tournament_id + finished_place + method). Money-action: a confirmation dialog restates the
// recipient / rank / amount before the ledger row is written; already_paid is idempotent success,
// never a red error. Read-only display doctrine: every number is Tạm tính (a hand-over
// acknowledgement, NOT a bank/cash reconciliation).

const METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt", bank: "Chuyển khoản", app: "Ví/App", other: "Khác",
};

const ERR_VI: Record<string, string> = {
  unauthorized: "Bạn chưa đăng nhập.",
  tournament_not_found: "Không tìm thấy giải.",
  actor_not_allowed: "Bạn không có quyền ghi nhận (cần Chủ CLB/Thu ngân).",
  place_not_in_money: "Hạng này không có tiền thưởng.",
  place_not_finalized: "Hạng này chưa chốt kết quả.",
};
function mapErr(code?: string | null, raw?: string): string {
  if (code && ERR_VI[code]) return ERR_VI[code];
  return raw || "Lỗi ghi nhận trả thưởng";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString("vi-VN"); } catch { return ""; }
}

export function PrizePayoutTrackingSection({ tournamentId }: { tournamentId: string }) {
  const { loading, error, notApplied, data, reload } = useTournamentPayoutRecipients(tournamentId);
  const [target, setTarget] = useState<PayoutRecipientPlace | null>(null);
  const [method, setMethod] = useState<string>("cash");
  const [busy, setBusy] = useState(false);

  const confirmPay = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const { data: res, error: rpcErr } = await (supabase as any).rpc(
        "record_tournament_prize_payment",
        { p_tournament_id: tournamentId, p_finished_place: target.finishedPlace, p_method: method },
      );
      if (rpcErr) {
        if (rpcErr.code === "42883" || rpcErr.code === "42P01") {
          toast.error("Chức năng chưa được bật trên hệ thống (chưa áp dụng).");
        } else {
          toast.error(mapErr(null, rpcErr.message));
        }
        return;
      }
      const r = res as any;
      if (!r?.ok) {
        toast.error(mapErr(r?.error));
        return;
      }
      const amt = formatVND(Number(r.prize_amount ?? target.prizeAmount));
      // recorded AND already_paid are BOTH success (idempotent is a feature).
      toast.success(
        r.outcome === "already_paid"
          ? `Đã ghi nhận trả trước đó · Hạng ${target.finishedPlace} · ${amt}`
          : `Đã ghi nhận trả · Hạng ${target.finishedPlace} · ${amt}`,
      );
      setTarget(null);
      reload();
    } catch (e: any) {
      toast.error(e?.message || "Lỗi ghi nhận trả thưởng");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <HandCoins className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Đã trả thưởng</span>
        </div>
        {data && data.totalCount > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {data.paidCount}/{data.totalCount} suất · {formatVND(data.paidTotal)}/{formatVND(data.owedTotal)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Ghi nhận đã trao tiền thưởng cho người thắng — <span className="text-amber-500">Tạm tính</span>,
        không phải đối soát ngân hàng. Số tiền do hệ thống tự tính theo hạng.
      </p>

      {notApplied ? (
        <div className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Cần áp dụng trên hệ thống (RPC chưa được bật). Xem được cấu trúc — chưa ghi nhận trả được.</span>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải danh sách…
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">Không tải được: {error}</p>
      ) : !data || data.places.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Chưa có hạng trúng thưởng đã chốt kết quả — chưa thể ghi nhận trả.
        </p>
      ) : (
        <div className="space-y-1">
          {data.places.map((p) => (
            <div
              key={p.finishedPlace}
              className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1.5"
            >
              <span className="text-xs font-semibold text-muted-foreground">#{p.finishedPlace}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.recipientName}</div>
                <div className="font-mono text-xs text-primary">{formatVND(p.prizeAmount)}</div>
              </div>
              {p.isPaid ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-[10px] whitespace-nowrap">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Đã trả{p.paidAt ? ` · ${fmtDate(p.paidAt)}` : ""}
                  {p.method && METHOD_LABEL[p.method] ? ` · ${METHOD_LABEL[p.method]}` : ""}
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => { setMethod("cash"); setTarget(p); }}
                >
                  Ghi nhận đã trả
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!target} onOpenChange={(v) => { if (!busy && !v) setTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận đã trả thưởng</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Người nhận</span>
                    <span className="font-medium">{target?.recipientName}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Hạng</span>
                    <span className="font-medium">#{target?.finishedPlace}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Số tiền</span>
                    <span className="font-mono font-bold text-primary">
                      {target ? formatVND(target.prizeAmount) : ""}
                    </span>
                  </div>
                </div>
                <p>Sau khi xác nhận, hệ thống ghi nhận đã trả vào lịch sử (không thể tự ý sửa).</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Hình thức trả</Label>
            <Select value={method} onValueChange={setMethod} disabled={busy}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tiền mặt</SelectItem>
                <SelectItem value="bank">Chuyển khoản</SelectItem>
                <SelectItem value="app">Ví/App</SelectItem>
                <SelectItem value="other">Khác</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Quay lại</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); confirmPay(); }}>
              {busy ? "Đang ghi nhận…" : "Xác nhận đã trả"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
