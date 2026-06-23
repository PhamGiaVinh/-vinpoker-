import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Lock, Info, History, CalendarDays, Wallet } from "lucide-react";
import { useDealerLink } from "@/hooks/dealer/useDealerLink";
import { formatVND } from "@/lib/format";

/**
 * Dealer Mobile App — "Lương của tôi" (my salary), READ-ONLY.
 *
 * Salary-A (this file): MOCK preview only — no DB / no RPC. It renders sample
 * numbers behind a clear "Dữ liệu mẫu" banner so the owner can sign off the
 * visual. The FT/PT toggle is a preview affordance (a real dealer is one type);
 * in Salary-D it is removed and the screen branches on the dealer's real
 * employment_type, reading `get_my_dealer_payroll` (FT, saved immutable values)
 * and `get_my_pt_wage` (PT, live balance + history). Dealers never pay
 * themselves — there is no pay control here by design; the club pays + resets.
 */

const GOLD = "#E6B84C";

function fmtHMS(ms: number): string {
  let s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Mock data (Salary-A preview only) ────────────────────────────────────────
const PT_RATE_VND = 180_000;
const PT_PRIOR_MS = 6 * 3_600_000; // 6h chưa trả từ các ca trước
const PT_HISTORY = [
  { date: "18/06", amount: 2_880_000, method: "Tiền mặt" },
  { date: "09/06", amount: 3_240_000, method: "Chuyển khoản" },
  { date: "31/05", amount: 2_520_000, method: "Tiền mặt" },
];

const FT_MOCK = {
  month: "Tháng 6/2026",
  monthlySalary: 12_000_000,
  hours: "212h",
  otPay: 430_000,
  bhxh: 960_000,
  bhyt: 180_000,
  bhtn: 120_000,
  pit: 90_000,
  net: 11_080_000,
  paid: false,
};

export function DealerSalaryScreen() {
  const { t } = useTranslation();
  const { dealer } = useDealerLink();
  const [view, setView] = useState<"pt" | "ft">("pt");

  // Live PT clock (mock): accrue from a fixed sample check-in.
  const [shiftStart] = useState(() => Date.now() - (1 * 3_600_000 + 20 * 60_000));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsedMs = now - shiftStart;
  const accruedMs = PT_PRIOR_MS + elapsedMs;
  const ptBalance = Math.round((accruedMs / 3_600_000) * PT_RATE_VND);

  return (
    <div>
      <h1 className="text-xl font-display font-bold text-foreground mb-1">
        {t("dealer.salary.title", "Lương của tôi")}
      </h1>
      <p className="text-[12px] text-muted-foreground mb-3">
        {dealer?.clubName ? `${dealer.clubName} · ` : ""}
        {dealer?.fullName ?? t("dealer.salary.you", "Bạn")}
      </p>

      {/* Sample-data banner (Salary-A is a preview) */}
      <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-3">
        <Info className="w-4 h-4 shrink-0" style={{ color: GOLD }} />
        <span className="text-[12px] text-muted-foreground">
          {t("dealer.salary.previewNote", "Bản xem trước · dữ liệu mẫu (chưa nối số liệu thật)")}
        </span>
      </div>

      {/* Preview toggle (mock affordance — removed in Salary-D) */}
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-border bg-card p-1 mb-3">
        <button
          onClick={() => setView("pt")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-bold transition-colors ${
            view === "pt" ? "bg-primary/15 text-primary" : "text-muted-foreground"
          }`}
        >
          <Clock className="w-4 h-4" />
          {t("dealer.salary.previewPt", "Part-time")}
        </button>
        <button
          onClick={() => setView("ft")}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-bold transition-colors ${
            view === "ft" ? "bg-primary/15 text-primary" : "text-muted-foreground"
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          {t("dealer.salary.previewFt", "Full-time")}
        </button>
      </div>

      {view === "pt" ? (
        <>
          {/* Live balance */}
          <div className="rounded-2xl border border-border bg-card p-4 mb-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-primary">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                {t("dealer.salary.onShift", "Đang làm")}
              </span>
              <span className="text-[12px] text-muted-foreground">
                Part-time · {Math.round(PT_RATE_VND / 1000)}K/h
              </span>
            </div>

            <div className="text-center my-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("dealer.salary.unpaidBalance", "Số dư chưa thanh toán")}
              </div>
              <div className="font-mono font-bold mt-1" style={{ color: GOLD, fontSize: 34 }}>
                {formatVND(ptBalance)}
              </div>
            </div>

            <div className="flex items-center justify-center gap-5 text-[12px] text-muted-foreground">
              <span>
                <Clock className="w-3.5 h-3.5 inline-block -mt-0.5 mr-1" />
                {t("dealer.salary.thisShift", "ca này")}{" "}
                <span className="font-mono text-foreground">{fmtHMS(elapsedMs)}</span>
              </span>
              <span>
                {t("dealer.salary.accrued", "tích luỹ")}{" "}
                <span className="font-mono text-foreground">{(accruedMs / 3_600_000).toFixed(2)}h</span>
              </span>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground mt-3">
              <Info className="w-3.5 h-3.5" />
              {t("dealer.salary.accrueNote", "Tính từ kỳ trả gần nhất · cập nhật trực tiếp")}
            </div>
          </div>

          {/* Read-only notice */}
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-3 py-2.5 mb-3">
            <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-[12px] text-muted-foreground">
              {t("dealer.salary.readOnly", "Chỉ xem — câu lạc bộ thực hiện chi trả & reset số dư.")}
            </span>
          </div>

          {/* History */}
          <div className="rounded-2xl border border-border bg-card divide-y divide-border">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <History className="w-4 h-4 text-muted-foreground" />
              <span className="text-[13px] font-bold text-foreground">
                {t("dealer.salary.history", "Lịch sử thanh toán")}
              </span>
            </div>
            {PT_HISTORY.map((h, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-muted-foreground">
                  {h.date} · {h.method}
                </span>
                <span className="font-mono text-[13px] font-bold text-foreground">{formatVND(h.amount)}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* FT headline */}
          <div className="rounded-2xl border border-border bg-card p-4 mb-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                  <Wallet className="w-4 h-4 text-muted-foreground" />
                  {t("dealer.salary.payslip", "Bảng lương")} {FT_MOCK.month}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("dealer.salary.ftClosed", "Full-time · đã chốt")}
                </div>
              </div>
              <span
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                  FT_MOCK.paid
                    ? "text-primary border-primary/40 bg-primary/10"
                    : "text-amber-400 border-amber-500/40 bg-amber-500/10"
                }`}
              >
                {FT_MOCK.paid ? t("dealer.salary.paid", "Đã trả") : t("dealer.salary.unpaid", "Chưa trả")}
              </span>
            </div>

            <div className="text-center my-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t("dealer.salary.net", "Thực lãnh")}
              </div>
              <div className="font-mono font-bold mt-1" style={{ color: GOLD, fontSize: 32 }}>
                {formatVND(FT_MOCK.net)}
              </div>
            </div>
          </div>

          {/* FT full breakdown */}
          <div className="rounded-2xl border border-border bg-card divide-y divide-border mb-3">
            <Row label={t("dealer.salary.monthlySalary", "Lương tháng")} value={formatVND(FT_MOCK.monthlySalary)} />
            <Row label={t("dealer.salary.hours", "Giờ làm")} value={FT_MOCK.hours} />
            <Row label={t("dealer.salary.ot", "Tăng ca (OT)")} value={`+${formatVND(FT_MOCK.otPay)}`} positive />
            <Row label="BHXH (8%)" value={`−${formatVND(FT_MOCK.bhxh)}`} negative />
            <Row label="BHYT (1.5%)" value={`−${formatVND(FT_MOCK.bhyt)}`} negative />
            <Row label="BHTN (1%)" value={`−${formatVND(FT_MOCK.bhtn)}`} negative />
            <Row label={t("dealer.salary.pit", "Thuế TNCN")} value={`−${formatVND(FT_MOCK.pit)}`} negative />
            <Row label={t("dealer.salary.net", "Thực lãnh")} value={formatVND(FT_MOCK.net)} strong />
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="w-3.5 h-3.5" />
            {t("dealer.salary.ftSavedNote", "Số liệu do CLB chốt — giá trị đã lưu, không tự tính lại.")}
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  positive,
  negative,
  strong,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
  strong?: boolean;
}) {
  const valueColor = strong ? undefined : positive ? "text-primary" : negative ? "text-destructive" : "text-foreground";
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={`text-[13px] ${strong ? "font-bold text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <span
        className={`font-mono text-[13px] font-bold ${valueColor ?? ""}`}
        style={strong ? { color: GOLD } : undefined}
      >
        {value}
      </span>
    </div>
  );
}
