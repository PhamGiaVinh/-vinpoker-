import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND, formatDateTime } from "@/lib/format";
import { Loader2, RefreshCw, CheckCircle2, XCircle, Banknote } from "lucide-react";

// Shape returned by public.sepay_cashier_settlement_worklist (20261116000000) — RAW FACTS only.
type Row = {
  bank_transaction_id: string;
  club_id: string | null;
  club_name: string | null;
  amount: number | null;
  content: string | null;
  txn_ref: string | null;
  occurred_at: string | null;
  created_at: string;
  bt_status: string;
  reference_code: string | null;
  reg_match_count: number;
  registration_id: string | null;
  reg_status: string | null;
  reg_total_pay: number | null;
  player_display: string | null;
  tournament_name: string | null;
  amount_delta: number | null;
  settlement_outcome: string | null;
  settlement_reason: string | null;
  settlement_created_at: string | null;
};

/**
 * Cashier "Đối soát SePay" tab — surfaces the SePay reconciliation worklist (transfers the reconcile
 * worker verified + flagged) and lets a cashier confirm (→ manual_confirm_bank_transaction) or ignore
 * (→ ignore_bank_transaction). The RPC returns raw facts; the cashier eyeballs the comparison and the
 * RPC re-validates authoritatively on click. clubIds is accepted for parity (the RPC self-scopes).
 */
export const SePaySettlementTab = ({ clubIds }: { clubIds?: string[] } = {}) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scope, setScope] = useState<"actionable" | "resolved">("actionable");
  const [confirmTarget, setConfirmTarget] = useState<Row | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [ignoreTarget, setIgnoreTarget] = useState<Row | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");
  // Stale-response guard (mount + clubs-loaded fire back to back; only the latest may write state).
  const loadSeq = useState({ n: 0 })[0];

  const load = async () => {
    const seq = ++loadSeq.n;
    setRows(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source: supabase/migrations/20261116000000; not yet in generated types.ts
    const { data, error } = await (supabase.rpc as any)("sepay_cashier_settlement_worklist", {
      p_scope: scope,
      p_limit: 200,
    });
    if (seq !== loadSeq.n) return;
    if (error) { toast.error(error.message); setRows([]); return; }
    setRows((data ?? []) as Row[]);
  };

  // Re-run when the scope filter or the cashier's club set changes.
  useEffect(() => { load(); }, [scope, clubIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const doConfirm = async () => {
    const r = confirmTarget;
    if (!r || !r.registration_id) return;
    setBusy(r.bank_transaction_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source: supabase/migrations/20261114000000; not yet in generated types.ts
    const { data, error } = await (supabase.rpc as any)("manual_confirm_bank_transaction", {
      p_bank_transaction_id: r.bank_transaction_id,
      p_registration_id: r.registration_id,
      p_reason: confirmReason.trim() || null,
    });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string; outcome?: string } | null;
    if (error || !res?.ok) { toast.error(mapError(res?.error, error?.message)); return; }
    setConfirmTarget(null); setConfirmReason("");
    toast.success("Đã xác nhận — ghế đã được xếp.");
    load();
  };

  const doIgnore = async () => {
    const r = ignoreTarget;
    if (!r) return;
    setBusy(r.bank_transaction_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC source: supabase/migrations/20261114000000; not yet in generated types.ts
    const { data, error } = await (supabase.rpc as any)("ignore_bank_transaction", {
      p_bank_transaction_id: r.bank_transaction_id,
      p_reason: ignoreReason.trim() || null,
    });
    setBusy(null);
    const res = data as { ok?: boolean; error?: string } | null;
    if (error || !res?.ok) { toast.error(mapError(res?.error, error?.message)); return; }
    setIgnoreTarget(null); setIgnoreReason("");
    toast.success("Đã bỏ qua giao dịch.");
    load();
  };

  // Mirror the RPC's reason_required_on_mismatch: reason is required when CK amount ≠ reg total_pay.
  const confirmMismatch = !!confirmTarget && confirmTarget.amount != null && confirmTarget.reg_total_pay != null
    && confirmTarget.amount !== confirmTarget.reg_total_pay;
  const confirmDisabled = busy === confirmTarget?.bank_transaction_id
    || (confirmMismatch && confirmReason.trim().length === 0);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Banknote className="w-5 h-5 text-primary" /> Đối soát SePay
          </h2>
          <p className="text-xs text-muted-foreground">
            Các khoản chuyển khoản hệ thống đã xác minh với SePay. Đối chiếu với đăng ký rồi xác nhận hoặc bỏ qua. App KHÔNG giữ tiền.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={scope === "actionable" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setScope("actionable")}>Cần xử lý</Button>
          <Button variant={scope === "resolved" ? "default" : "outline"} size="sm" className="h-9" onClick={() => setScope("resolved")}>Đã xử lý</Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={load} disabled={rows === null}>
            {rows === null ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {rows === null ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-10">
          {scope === "actionable" ? "Không có khoản nào cần xử lý." : "Chưa có khoản nào đã xử lý."}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const isMismatch = r.amount != null && r.reg_total_pay != null && r.amount !== r.reg_total_pay;
            return (
              <div key={r.bank_transaction_id} className="rounded-lg border border-border bg-card/40 p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1.5 text-sm min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-primary">
                      {r.amount != null ? formatVND(r.amount) : <span className="text-warning">Thiếu số tiền</span>}
                    </span>
                    {r.reference_code
                      ? <Badge variant="outline" className="font-mono">{r.reference_code}</Badge>
                      : <Badge variant="outline" className="text-muted-foreground">không có mã</Badge>}
                    {r.bt_status === "matched" && <Badge variant="outline" className="text-success border-success/40">đã khớp</Badge>}
                    {r.bt_status === "ignored" && <Badge variant="outline" className="text-muted-foreground">đã bỏ qua</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{r.content ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{r.club_name ?? "—"} · {formatDateTime(r.occurred_at ?? r.created_at)}</div>

                  {/* Matched registration + raw amounts side by side — cashier eyeballs the comparison */}
                  {r.reg_match_count === 1 && r.registration_id ? (
                    <div className="rounded-md bg-muted/40 p-2 text-xs space-y-0.5">
                      <div className="font-medium">{r.player_display ?? "Player"} · {r.tournament_name ?? "—"}</div>
                      <div className={isMismatch ? "text-warning" : "text-muted-foreground"}>
                        CK <b>{r.amount != null ? formatVND(r.amount) : "—"}</b> · Cần thu <b>{r.reg_total_pay != null ? formatVND(r.reg_total_pay) : "—"}</b>
                        {isMismatch && r.amount_delta != null && <span> · lệch {formatVND(r.amount_delta)}</span>}
                      </div>
                      {r.reg_status && r.reg_status !== "pending" && (
                        <div className="text-warning">Đăng ký không ở trạng thái chờ (đang: {r.reg_status})</div>
                      )}
                    </div>
                  ) : r.reg_match_count === 0 ? (
                    <div className="text-xs text-muted-foreground">Không tìm thấy đăng ký khớp mã.</div>
                  ) : (
                    <div className="text-xs text-warning">Nhiều đăng ký khớp mã ({r.reg_match_count}) — kiểm tra thủ công.</div>
                  )}

                  {r.settlement_outcome && (
                    <div className="text-[11px] text-muted-foreground">
                      Cờ gần nhất: {r.settlement_outcome}{r.settlement_reason ? ` (${r.settlement_reason})` : ""}
                    </div>
                  )}
                </div>

                {scope === "actionable" && (
                  <div className="flex md:flex-col gap-2 md:w-40">
                    <Button size="sm" className="flex-1 h-9"
                      disabled={busy === r.bank_transaction_id || r.reg_match_count !== 1 || r.amount == null}
                      onClick={() => { setConfirmTarget(r); setConfirmReason(""); }}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Xác nhận
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1 h-9 text-destructive border-destructive/40"
                      disabled={busy === r.bank_transaction_id}
                      onClick={() => { setIgnoreTarget(r); setIgnoreReason(""); }}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Bỏ qua
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmTarget !== null} onOpenChange={(o) => { if (!o) { setConfirmTarget(null); setConfirmReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận khoản chuyển khoản</DialogTitle>
            <DialogDescription>
              Xếp ghế cho <b>{confirmTarget?.player_display ?? "Player"}</b> — giải <b>{confirmTarget?.tournament_name ?? "—"}</b>.
              <br />CK <b>{confirmTarget?.amount != null ? formatVND(confirmTarget.amount) : "—"}</b> · Cần thu <b>{confirmTarget?.reg_total_pay != null ? formatVND(confirmTarget.reg_total_pay) : "—"}</b>
              {confirmMismatch && <span className="text-warning"> — số tiền LỆCH, bắt buộc nhập lý do.</span>}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={confirmMismatch ? "Lý do (bắt buộc khi lệch tiền) — VD: khách bù tiền mặt phần thiếu" : "Ghi chú (không bắt buộc)"}
            value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmTarget(null); setConfirmReason(""); }}>Huỷ</Button>
            <Button disabled={confirmDisabled} onClick={doConfirm}>
              {busy === confirmTarget?.bank_transaction_id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Xác nhận & xếp ghế
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={ignoreTarget !== null} onOpenChange={(o) => { if (!o) { setIgnoreTarget(null); setIgnoreReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bỏ qua giao dịch</DialogTitle>
            <DialogDescription>
              Đánh dấu khoản <b>{ignoreTarget?.amount != null ? formatVND(ignoreTarget.amount) : "—"}</b> là không cần đối soát (không phải đăng ký giải).
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Lý do (không bắt buộc) — VD: nạp quỹ, không liên quan đăng ký"
            value={ignoreReason} onChange={(e) => setIgnoreReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIgnoreTarget(null); setIgnoreReason(""); }}>Huỷ</Button>
            <Button variant="destructive" disabled={busy === ignoreTarget?.bank_transaction_id} onClick={doIgnore}>
              {busy === ignoreTarget?.bank_transaction_id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Xác nhận bỏ qua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// Maps manual_confirm_bank_transaction / ignore_bank_transaction RPC error codes to Vietnamese.
function mapError(code?: string, raw?: string): string {
  switch (code ?? raw) {
    case "unauthorized": return "Phiên đăng nhập hết hạn — đăng nhập lại.";
    case "actor_not_allowed": return "Tài khoản của bạn không có quyền cho CLB này.";
    case "bank_txn_not_found": return "Không tìm thấy giao dịch.";
    case "registration_not_found": return "Không tìm thấy đăng ký.";
    case "club_unresolved": return "Không xác định được CLB của giao dịch.";
    case "club_mismatch": return "Tiền của CLB khác — không thể xác nhận cho đăng ký này.";
    case "already_settled": return "Giao dịch này đã được xử lý.";
    case "registration_already_settled": return "Đăng ký này đã được thanh toán bằng một giao dịch khác.";
    case "amount_missing": return "Giao dịch chưa có số tiền — chờ SePay cập nhật rồi thử lại.";
    case "reason_required_on_mismatch": return "Số tiền lệch — bắt buộc nhập lý do.";
    case "seating_failed": return "Hết bàn/ghế — mở bàn cho giải rồi thử lại.";
    case "club_unresolved_super_admin_only": return "Giao dịch không thuộc CLB nào — chỉ super admin xử lý.";
    default: return code ? `Thao tác thất bại (${code}).` : (raw || "Thao tác thất bại.");
  }
}
