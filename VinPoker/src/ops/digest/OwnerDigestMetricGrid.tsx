import {
  BadgeDollarSign,
  BriefcaseBusiness,
  Coins,
  ReceiptText,
  TicketCheck,
  UserCheck,
  UsersRound,
  UtensilsCrossed,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { OwnerDailyDigestReport } from "@/ops/digest/ownerDailyDigestReadAdapter";

export function OwnerDigestMetricGrid({ report }: { report: OwnerDailyDigestReport }) {
  const operations: MetricProps[] = [
    { label: "Đăng ký thuộc ngày vận hành", value: formatCount(report.registrations), icon: TicketCheck },
    { label: "Người tham dự", value: formatCount(report.attendance), icon: UserCheck },
    { label: "Entries", value: formatCount(report.entries), icon: UsersRound },
    { label: "Nhân sự", value: formatCount(report.staffCount), icon: BriefcaseBusiness },
  ];
  const moneyMetrics: MetricProps[] = [
    buildMoneyMetric("Rake thực thu", report.rakeAmount, Coins, "positive"),
    buildMoneyMetric("Phí dịch vụ thực thu", report.serviceFeeAmount, BadgeDollarSign, "positive"),
    buildMoneyMetric("Doanh thu thuần F&B", report.fnbAmount, UtensilsCrossed, "positive"),
    buildMoneyMetric("Payout đang chờ của CLB", report.outstandingPayoutAmount, WalletCards, "warning"),
    buildMoneyMetric("Lương dealer tạm tính đang chờ", report.provisionalPayrollAmount, ReceiptText, "warning"),
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
      <MetricSection title="Nhịp vận hành" description="Người chơi và nguồn lực trong cửa sổ ngày vận hành" metrics={operations} />
      <MetricSection title="Tài chính & Đối soát" description="Số đã lưu trong snapshot; không được web tự tính lại" metrics={moneyMetrics} />
    </div>
  );
}

function MetricSection({ title, description, metrics }: {
  title: string;
  description: string;
  metrics: MetricProps[];
}) {
  return (
    <section className="rounded-3xl border border-white/8 bg-[#07100c] p-4 sm:p-5" aria-labelledby={`digest-${slug(title)}`}>
      <div className="border-b border-white/7 pb-3">
        <h2 id={`digest-${slug(title)}`} className="font-semibold text-white">{title}</h2>
        <p className="mt-1 text-xs text-[#7f9388]">{description}</p>
      </div>
      <dl className="mt-2 divide-y divide-white/7">
        {metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
      </dl>
    </section>
  );
}

type MetricProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "neutral" | "positive" | "warning" | "unavailable";
};

function Metric({ label, value, icon: Icon, tone = "neutral" }: MetricProps) {
  const toneClass = tone === "positive"
    ? "text-emerald-200"
    : tone === "warning"
      ? "text-amber-100"
      : tone === "unavailable"
        ? "text-[#708078]"
        : "text-[#f2ece6]";
  return (
    <div className="flex min-h-16 items-center gap-3 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/8 bg-white/[0.035] text-[#9fb4a9]">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <dt className="min-w-0 flex-1 text-sm text-[#91a49b]">{label}</dt>
      <dd className={`max-w-[48%] shrink-0 text-right font-mono text-sm font-semibold tabular-nums sm:text-lg ${toneClass}`}>{value}</dd>
    </div>
  );
}

function buildMoneyMetric(label: string, value: number | null, icon: LucideIcon, tone: MetricProps["tone"]): MetricProps {
  return value === null
    ? { label, value: "Chưa có dữ liệu", icon, tone: "unavailable" }
    : { label, value: formatMoney(value), icon, tone };
}

function formatCount(value: number): string {
  return value.toLocaleString("vi-VN");
}

function formatMoney(value: number): string {
  return `${value.toLocaleString("vi-VN")} ₫`;
}

function slug(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-");
}
