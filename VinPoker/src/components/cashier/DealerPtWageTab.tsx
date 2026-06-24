import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { RefreshCw, Loader2, Clock, Coins, Wallet } from "lucide-react";

/**
 * Salary-C — Operator "Theo giờ · Part-time" sub-tab. Live accruing balances per PT dealer
 * + full-payment-then-reset via the Salary-B1 RPCs (get_club_pt_wages / pay_part_time_balance).
 *
 * The B1 migrations are merged as SOURCE but not yet applied live + types are not regenerated,
 * so the RPCs are called through the untyped client (same pattern as useDealerLink /
 * useDealerPayroll's save_payroll_period). This whole tab only mounts when FEATURES.salaryTabV2
 * is ON (default OFF) — so while the RPCs are absent it is never reached. Read + pay only;
 * the server recomputes + resets (the client never sets the amount).
 */

type ClubRow = { id: string; name: string };

interface PtDealer {
  dealer_id: string;
  full_name: string;
  hourly_rate_vnd: number;
  accrued_minutes: number;
  balance_vnd: number;
  last_reset_at: string | null;
  current_shift_open: boolean;
  current_shift_start: string | null;
  last_payment: { amount_vnd: number; paid_at: string } | null;
}

interface Props {
  clubIds: string[];
  clubs: ClubRow[];
}

const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }> };

function fmtHMS(ms: number): string {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function DealerPtWageTab({ clubIds, clubs }: Props) {
  const [clubFilter, setClubFilter] = useState<string>(clubIds[0] ?? "");
  const activeClubId = clubFilter || clubIds[0] || "";

  const [dealers, setDealers] = useState<PtDealer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedAtRef = useRef<number>(Date.now());
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [paidSession, setPaidSession] = useState(0);

  // pay dialog
  const [payOpen, setPayOpen] = useState(false);
  const [payDealer, setPayDealer] = useState<PtDealer | null>(null);
  const [payMethod, setPayMethod] = useState("cash");
  const [payRef, setPayRef] = useState("");
  const [paying, setPaying] = useState(false);

  const fetchData = useCallback(async () => {
    if (!activeClubId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await db.rpc("get_club_pt_wages", { p_club_id: activeClubId });
      if (rpcError) throw rpcError;
      setDealers(((data?.dealers ?? []) as PtDealer[]));
      fetchedAtRef.current = Date.now();
    } catch (e: any) {
      setError(e?.message ?? "Lỗi tải lương part-time");
      setDealers([]);
    } finally {
      setLoading(false);
    }
  }, [activeClubId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  // resync from the server every 60s; tick the display every 1s
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    const resync = setInterval(() => { fetchData(); }, 60000);
    return () => { clearInterval(tick); clearInterval(resync); };
  }, [fetchData]);

  // Live balance: server value at fetch + client-delta accrual for on-shift dealers.
  const liveBalance = (d: PtDealer): number =>
    d.current_shift_open
      ? d.balance_vnd + Math.floor(((nowMs - fetchedAtRef.current) / 3_600_000) * d.hourly_rate_vnd)
      : d.balance_vnd;

  const totalUnpaid = dealers.reduce((s, d) => s + liveBalance(d), 0);
  const workingCount = dealers.filter((d) => d.current_shift_open).length;

  const openPay = (d: PtDealer) => {
    setPayDealer(d);
    setPayMethod("cash");
    setPayRef("");
    setPayOpen(true);
  };

  const handlePay = useCallback(async () => {
    if (!payDealer) return;
    setPaying(true);
    try {
      const key =
        (typeof crypto !== "undefined" && "randomUUID" in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.floor((nowMs % 1) * 1e9)}-${payDealer.dealer_id}`;
      const { data, error: rpcError } = await db.rpc("pay_part_time_balance", {
        p_dealer_id: payDealer.dealer_id,
        p_payment_method: payMethod,
        p_payment_reference: payRef.trim() || null,
        p_idempotency_key: key,
        p_note: null,
      });
      if (rpcError) throw rpcError;
      const amt = Number(data?.amount_vnd ?? 0);
      if (!data?.idempotent) setPaidSession((p) => p + amt);
      toast.success(`Đã thanh toán ${formatVND(amt)} cho ${payDealer.full_name}`);
      setPayOpen(false);
      await fetchData();
    } catch (e: any) {
      toast.error(e?.message ?? "Lỗi thanh toán");
    } finally {
      setPaying(false);
    }
  }, [payDealer, payMethod, payRef, nowMs, fetchData]);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {clubs.length > 1 && (
          <Select value={clubFilter} onValueChange={setClubFilter}>
            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue placeholder="Chọn CLB" /></SelectTrigger>
            <SelectContent>
              {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
        <div className="flex-1" />
        <div className="text-[11px] text-zinc-500">Lương theo giờ · cập nhật trực tiếp · trả đủ thì reset</div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">PT đang làm</div>
          <div className="text-base font-semibold text-emerald-400">{workingCount}/{dealers.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Tổng chưa trả</div>
          <div className="text-base font-semibold text-amber-400 font-mono">{formatVND(totalUnpaid)}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
          <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Đã trả (phiên này)</div>
          <div className="text-base font-semibold text-emerald-400 font-mono">{formatVND(paidSession)}</div>
        </div>
      </div>

      {loading && <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center text-red-400 text-sm">{error}</div>
      )}

      {!loading && !error && dealers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <Coins className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Chưa có dealer part-time đang hoạt động</p>
        </div>
      )}

      {/* Cards */}
      {!loading && !error && dealers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {dealers.map((d) => {
            const bal = liveBalance(d);
            return (
              <div key={d.dealer_id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-white">{d.full_name}</div>
                  {d.current_shift_open ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 border border-emerald-500/40 rounded-full px-2 py-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Đang làm
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-500 border border-zinc-700 rounded-full px-2 py-0.5">Nghỉ</span>
                  )}
                </div>

                <div className="flex items-end justify-between gap-3 mt-3">
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Số dư chưa thanh toán</div>
                    <div className={`text-2xl font-semibold font-mono ${d.current_shift_open ? "text-emerald-400" : "text-white"}`}>
                      {formatVND(bal)}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-zinc-400">
                    {d.current_shift_open && d.current_shift_start && (
                      <div><Clock className="w-3 h-3 inline -mt-0.5 mr-1" /><span className="font-mono">{fmtHMS(nowMs - new Date(d.current_shift_start).getTime())}</span></div>
                    )}
                    <div className="font-mono">{Math.round(d.hourly_rate_vnd / 1000)}K/h</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mt-3">
                  <div className="text-[11px] text-zinc-500">
                    {d.last_payment
                      ? <>Lần trả gần nhất: {new Date(d.last_payment.paid_at).toLocaleDateString("vi-VN")} · <span className="font-mono">{formatVND(d.last_payment.amount_vnd)}</span></>
                      : "Chưa có lịch sử thanh toán"}
                  </div>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                    onClick={() => openPay(d)}
                    disabled={bal < 1}
                  >
                    <Wallet className="w-3.5 h-3.5 mr-1" /> Thanh toán
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pay confirm */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thanh toán lương part-time</DialogTitle>
            <DialogDescription>
              Trả toàn bộ số dư đang tích luỹ cho {payDealer?.full_name ?? "dealer"}. Hệ thống tính lại số tiền ở thời điểm xác nhận, ghi nhận và reset số dư về 0.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-center">
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Số dư hiện tại (≈)</div>
              <div className="text-2xl font-semibold font-mono text-emerald-400 mt-1">
                {payDealer ? formatVND(liveBalance(payDealer)) : "—"}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">Số tiền cuối cùng do máy chủ tính tại thời điểm xác nhận</div>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Hình thức</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Tiền mặt</SelectItem>
                  <SelectItem value="bank_transfer">Chuyển khoản</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Mã tham chiếu (tuỳ chọn)</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="VD: phiếu chi #123" className="bg-zinc-900 border-zinc-700 text-white" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>Huỷ</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={handlePay} disabled={paying}>
              {paying ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Wallet className="w-4 h-4 mr-1" />}
              Xác nhận &amp; reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
