import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Lock, Info, History, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { formatVND } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dealer Mobile App — "Lương của tôi" (my salary), READ-ONLY.
 *
 * Salary-D: branches on the dealer's real employment_type and reads the live RPCs —
 * `get_my_pt_wage` (PT: live balance + history) and `get_my_dealer_payroll` (FT: SAVED
 * immutable payslip). Dealers never pay themselves — there is no pay control by design;
 * the club pays + resets (operator side).
 *
 * The Salary-B1 / Salary-D RPCs are merged as source but not applied live + types are not
 * regenerated yet, so they are called via the UNTYPED client (same pattern as useDealerLink /
 * useDealerPayroll's save_payroll_period). The whole screen is reached only when the route gate
 * (FEATURES.dealerSelfSalary, default OFF) is on, so while the RPCs are absent it is never hit.
 */

const GOLD = "#E6B84C";
const db = supabase as unknown as { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }> };

function fmtHMS(ms: number): string {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface PtWage {
  employment_type?: string;
  hourly_rate_vnd?: number;
  accrued_minutes?: number;
  balance_vnd?: number;
  current_shift_open?: boolean;
  current_shift_start?: string | null;
  recent_payments?: Array<{ amount_vnd: number; paid_at: string; payment_method?: string | null }>;
}
interface FtPayslip {
  has_data?: boolean;
  period_year?: number;
  period_month?: number;
  monthly_salary_vnd?: number | null;
  total_hours?: number | null;
  ot_pay_vnd?: number | null;
  bhxh_deduction_vnd?: number;
  bhyt_deduction_vnd?: number;
  bhtn_deduction_vnd?: number;
  pit_deduction_vnd?: number;
  total_adjustments_vnd?: number | null;
  net_pay_vnd?: number | null;
  payment_status?: string | null;
}

export function DealerSalaryScreen() {
  const { t } = useTranslation();
  const { dealer, isDealer, loading: linkLoading } = useDealerLink();
  const dealerId = dealer?.dealerId ?? null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empType, setEmpType] = useState<string | null>(null);
  const [pt, setPt] = useState<PtWage | null>(null);
  const [ft, setFt] = useState<FtPayslip | null>(null);

  const ptFetchedAt = useRef<number>(Date.now());
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const load = useCallback(async () => {
    if (!dealerId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: ptw, error: e1 } = await db.rpc("get_my_pt_wage", { p_dealer_id: dealerId });
      if (e1) throw e1;
      const et = (ptw?.employment_type as string) ?? null;
      setEmpType(et);
      if (et === "part_time") {
        setPt(ptw as PtWage);
        ptFetchedAt.current = Date.now();
        setFt(null);
      } else {
        const { data: ftp, error: e2 } = await db.rpc("get_my_dealer_payroll", { p_dealer_id: dealerId });
        if (e2) throw e2;
        setFt(ftp as FtPayslip);
        setPt(null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Lỗi tải lương");
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => { load(); }, [load]);
  // tick the display every 1s; resync PT from the server every 60s
  useEffect(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    const resync = setInterval(() => { if (empType === "part_time") load(); }, 60000);
    return () => { clearInterval(tick); clearInterval(resync); };
  }, [empType, load]);

  const Header = (
    <>
      <h1 className="text-xl font-display font-bold text-foreground mb-1">{t("dealer.salary.title", "Lương của tôi")}</h1>
      <p className="text-[12px] text-muted-foreground mb-3">
        {dealer?.clubName ? `${dealer.clubName} · ` : ""}{dealer?.fullName ?? t("dealer.salary.you", "Bạn")}
      </p>
    </>
  );

  if (linkLoading || loading) {
    return <div>{Header}<Skeleton className="h-40 w-full rounded-2xl mb-3" /><Skeleton className="h-56 w-full rounded-2xl" /></div>;
  }
  if (!isDealer || !dealerId) {
    return (
      <div>{Header}
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
          {t("dealer.salary.notLinked", "Tài khoản chưa liên kết với hồ sơ dealer nào.")}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>{Header}
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-center text-[13px] text-destructive">{error}</div>
      </div>
    );
  }

  // ── PART-TIME: live balance ────────────────────────────────────────────────
  if (empType === "part_time" && pt) {
    const rate = pt.hourly_rate_vnd ?? 0;
    const open = !!pt.current_shift_open;
    const liveBalance = (pt.balance_vnd ?? 0) + (open ? Math.floor(((nowMs - ptFetchedAt.current) / 3_600_000) * rate) : 0);
    const shiftMs = open && pt.current_shift_start ? nowMs - new Date(pt.current_shift_start).getTime() : 0;
    const accruedH = (((pt.accrued_minutes ?? 0) * 60_000) + (open ? nowMs - ptFetchedAt.current : 0)) / 3_600_000;
    const history = pt.recent_payments ?? [];
    return (
      <div>{Header}
        <div className="rounded-2xl border border-border bg-card p-4 mb-3">
          <div className="flex items-center justify-between">
            {open ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-primary">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />{t("dealer.salary.onShift", "Đang làm")}
              </span>
            ) : (
              <span className="text-[12px] text-muted-foreground">{t("dealer.salary.offShift", "Nghỉ")}</span>
            )}
            <span className="text-[12px] text-muted-foreground">Part-time · {Math.round(rate / 1000)}K/h</span>
          </div>
          <div className="text-center my-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("dealer.salary.unpaidBalance", "Số dư chưa thanh toán")}</div>
            <div className="font-mono font-bold mt-1" style={{ color: GOLD, fontSize: 34 }}>{formatVND(liveBalance)}</div>
          </div>
          <div className="flex items-center justify-center gap-5 text-[12px] text-muted-foreground">
            {open && (
              <span><Clock className="w-3.5 h-3.5 inline-block -mt-0.5 mr-1" />{t("dealer.salary.thisShift", "ca này")}{" "}
                <span className="font-mono text-foreground">{fmtHMS(shiftMs)}</span></span>
            )}
            <span>{t("dealer.salary.accrued", "tích luỹ")}{" "}<span className="font-mono text-foreground">{accruedH.toFixed(2)}h</span></span>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground mt-3">
            <Info className="w-3.5 h-3.5" />{t("dealer.salary.accrueNote", "Tính từ kỳ trả gần nhất · cập nhật trực tiếp")}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-3 py-2.5 mb-3">
          <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-[12px] text-muted-foreground">{t("dealer.salary.readOnly", "Chỉ xem — câu lạc bộ thực hiện chi trả & reset số dư.")}</span>
        </div>

        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <History className="w-4 h-4 text-muted-foreground" />
            <span className="text-[13px] font-bold text-foreground">{t("dealer.salary.history", "Lịch sử thanh toán")}</span>
          </div>
          {history.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-muted-foreground">{t("dealer.salary.noHistory", "Chưa có lịch sử thanh toán")}</div>
          ) : history.map((h, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] text-muted-foreground">
                {new Date(h.paid_at).toLocaleDateString("vi-VN")}{h.payment_method ? ` · ${h.payment_method === "bank_transfer" ? "Chuyển khoản" : "Tiền mặt"}` : ""}
              </span>
              <span className="font-mono text-[13px] font-bold text-foreground">{formatVND(h.amount_vnd)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── FULL-TIME: saved payslip ───────────────────────────────────────────────
  if (!ft || ft.has_data === false) {
    return (
      <div>{Header}
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <Wallet className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <div className="text-[13px] text-muted-foreground">{t("dealer.salary.notClosed", "Chưa chốt bảng lương tháng này")}</div>
        </div>
      </div>
    );
  }
  const paid = ft.payment_status === "paid" || ft.payment_status === "reconciled";
  const adj = ft.total_adjustments_vnd ?? 0;
  return (
    <div>{Header}
      <div className="rounded-2xl border border-border bg-card p-4 mb-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
              <Wallet className="w-4 h-4 text-muted-foreground" />
              {t("dealer.salary.payslip", "Bảng lương")} {t("dealer.salary.month", "Tháng")} {ft.period_month}/{ft.period_year}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{t("dealer.salary.ftClosed", "Full-time · đã chốt")}</div>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${paid ? "text-primary border-primary/40 bg-primary/10" : "text-amber-400 border-amber-500/40 bg-amber-500/10"}`}>
            {paid ? t("dealer.salary.paid", "Đã trả") : t("dealer.salary.unpaid", "Chưa trả")}
          </span>
        </div>
        <div className="text-center my-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("dealer.salary.net", "Thực lãnh")}</div>
          <div className="font-mono font-bold mt-1" style={{ color: GOLD, fontSize: 32 }}>{formatVND(ft.net_pay_vnd ?? 0)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card divide-y divide-border mb-3">
        <Row label={t("dealer.salary.monthlySalary", "Lương tháng")} value={formatVND(ft.monthly_salary_vnd ?? 0)} />
        <Row label={t("dealer.salary.hours", "Giờ làm")} value={`${(ft.total_hours ?? 0).toFixed(1)}h`} />
        {(ft.ot_pay_vnd ?? 0) > 0 && <Row label={t("dealer.salary.ot", "Tăng ca (OT)")} value={`+${formatVND(ft.ot_pay_vnd ?? 0)}`} positive />}
        {(ft.bhxh_deduction_vnd ?? 0) > 0 && <Row label="BHXH (8%)" value={`−${formatVND(ft.bhxh_deduction_vnd ?? 0)}`} negative />}
        {(ft.bhyt_deduction_vnd ?? 0) > 0 && <Row label="BHYT (1.5%)" value={`−${formatVND(ft.bhyt_deduction_vnd ?? 0)}`} negative />}
        {(ft.bhtn_deduction_vnd ?? 0) > 0 && <Row label="BHTN (1%)" value={`−${formatVND(ft.bhtn_deduction_vnd ?? 0)}`} negative />}
        {(ft.pit_deduction_vnd ?? 0) > 0 && <Row label={t("dealer.salary.pit", "Thuế TNCN")} value={`−${formatVND(ft.pit_deduction_vnd ?? 0)}`} negative />}
        {adj !== 0 && <Row label={t("dealer.salary.adjustments", "Điều chỉnh")} value={`${adj > 0 ? "+" : "−"}${formatVND(Math.abs(adj))}`} positive={adj > 0} negative={adj < 0} />}
        <Row label={t("dealer.salary.net", "Thực lãnh")} value={formatVND(ft.net_pay_vnd ?? 0)} strong />
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Info className="w-3.5 h-3.5" />{t("dealer.salary.ftSavedNote", "Số liệu do CLB chốt — giá trị đã lưu, không tự tính lại.")}
      </div>
    </div>
  );
}

function Row({ label, value, positive, negative, strong }: {
  label: string; value: string; positive?: boolean; negative?: boolean; strong?: boolean;
}) {
  const valueColor = strong ? undefined : positive ? "text-primary" : negative ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={`text-[13px] ${strong ? "font-bold text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <span className={`font-mono text-[13px] font-bold ${valueColor ?? ""}`} style={strong ? { color: GOLD } : undefined}>{value}</span>
    </div>
  );
}
