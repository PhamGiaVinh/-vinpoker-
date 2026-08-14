import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  RefreshCw,
  Repeat2,
  ShieldCheck,
} from "lucide-react";
import { OwnerDigestMetricGrid } from "@/ops/digest/OwnerDigestMetricGrid";
import type { OwnerDailyDigestReport } from "@/ops/digest/ownerDailyDigestReadAdapter";

export type OwnerDigestViewState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "unavailable"; code: string }
  | { kind: "error"; code: string }
  | { kind: "ready"; report: OwnerDailyDigestReport };

export type DigestGenerationNotice = {
  tone: "info" | "warning";
  text: string;
};

export function OwnerDailyDigestView({
  clubName,
  state,
  refreshing,
  environmentLabel,
  onRefresh,
  onChangeClub,
  extraActions,
  generationNotice,
}: {
  clubName: string;
  state: OwnerDigestViewState;
  refreshing: boolean;
  environmentLabel?: string;
  onRefresh: () => void;
  onChangeClub?: () => void;
  extraActions?: ReactNode;
  generationNotice?: DigestGenerationNotice | null;
}) {
  const report = state.kind === "ready" ? state.report : null;
  return (
    <div className="min-w-0 space-y-4" data-owner-digest-report>
      <header className="rounded-3xl border border-emerald-300/12 bg-[#07100c] px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <ClipboardList className="h-4 w-4" aria-hidden="true" /> Báo cáo ngày
              {environmentLabel && <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-2 py-1 text-[10px] tracking-wide text-sky-200">{environmentLabel}</span>}
            </div>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">
              Một ngày vận hành, nhìn trong 60 giây
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91a49b]">
              {clubName} · Snapshot đọc-chỉ do server tạo. Web không tự cộng lại tiền hay số liệu nghiệp vụ.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onChangeClub && (
              <button type="button" onClick={onChangeClub}
                className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-[#d7e3dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
                <Repeat2 className="h-4 w-4" aria-hidden="true" /> Đổi CLB
              </button>
            )}
            {extraActions}
            <button type="button" onClick={onRefresh} disabled={refreshing}
              data-ops-action="daily-digest.refresh"
              className="flex min-h-11 items-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-300/8 px-4 text-sm font-semibold text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50">
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" /> Làm mới màn hình
            </button>
          </div>
        </div>

        {report && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/7 pt-4">
            <StatusBadge icon={CalendarDays} label={formatReportDate(report.reportDate)} />
            <StatusBadge icon={report.moneyState === "CLOSED" ? CheckCircle2 : AlertTriangle} label={moneyStateLabel(report.moneyState)} tone={report.moneyState === "CLOSED" ? "positive" : "warning"} />
            <StatusBadge icon={ShieldCheck} label={freshnessLabel(report.freshnessState)} tone={report.freshnessState === "FRESH" ? "positive" : "warning"} />
            {report.snapshotVersion && <StatusBadge icon={RefreshCw} label={`Revision ${report.snapshotVersion}`} />}
          </div>
        )}
      </header>

      {generationNotice && (
        <div role="status" className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${generationNotice.tone === "warning" ? "border-amber-300/20 bg-amber-300/8 text-amber-100" : "border-sky-300/20 bg-sky-300/8 text-sky-100"}`}>
          {generationNotice.text}
        </div>
      )}

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "empty" && <MessageState icon={CalendarDays} title="Chưa có báo cáo cho ngày này" body="Server chưa có snapshot thành công. Hệ thống không dùng số 0 hoặc báo cáo ngày khác để thay thế." />}
      {state.kind === "unavailable" && <MessageState icon={ShieldCheck} title="Báo cáo V2 chưa được mở" body="Đường đọc V2 đang tắt hoặc migration chưa được áp dụng. Báo cáo V1 hiện tại vẫn được giữ nguyên." code={state.code} />}
      {state.kind === "error" && <MessageState icon={AlertTriangle} title="Không đọc được báo cáo" body="Snapshot trả về không đúng contract hoặc không thuộc CLB đang chọn. Không dùng dữ liệu fallback." code={state.code} danger />}
      {report && (
        <>
          <OwnerDigestMetricGrid report={report} />
          <section className="grid gap-3 md:grid-cols-2" aria-label="Giải thích trạng thái số tiền">
            <Notice title="Payout đang chờ" body="Đây là khoản phải trả của CLB tại thời điểm snapshot, không phải doanh thu." />
            <Notice title="Lương tạm tính" body="Chưa phải lương đã chốt hoặc đã trả. Sai lệch phải đi qua quy trình duyệt riêng." />
          </section>
          <footer className="flex flex-col gap-2 rounded-2xl border border-white/7 bg-white/[0.025] px-4 py-3 text-xs text-[#7f9388] sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" aria-hidden="true" /> Tạo lúc {formatGeneratedAt(report.generatedAt, report.effectiveTimezone)}</span>
            <span>Mã báo cáo {maskId(report.digestId)} · Chỉ đọc{report.calculationVersion ? ` · ${report.calculationVersion}` : ""}</span>
          </footer>
        </>
      )}
    </div>
  );
}

function LoadingState() {
  return <div className="grid gap-4 xl:grid-cols-2" aria-busy="true" aria-label="Đang tải Báo cáo ngày">
    {[0, 1].map((item) => <div key={item} className="h-72 animate-pulse rounded-3xl border border-white/7 bg-[#07100c]" />)}
  </div>;
}

function MessageState({ icon: Icon, title, body, code, danger = false }: {
  icon: typeof CalendarDays;
  title: string;
  body: string;
  code?: string;
  danger?: boolean;
}) {
  return <div role="status" className={`flex min-h-72 flex-col items-center justify-center rounded-3xl border px-5 text-center ${danger ? "border-rose-300/20 bg-rose-300/8" : "border-amber-300/20 bg-amber-300/8"}`}>
    <Icon className={`h-8 w-8 ${danger ? "text-rose-200" : "text-amber-200"}`} aria-hidden="true" />
    <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
    <p className="mt-2 max-w-xl text-sm leading-6 text-[#b9c8c0]">{body}</p>
    {code && <code className="mt-3 text-xs text-amber-100">{code}</code>}
  </div>;
}

function Notice({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl border border-amber-300/12 bg-amber-300/7 px-4 py-3 text-sm leading-6">
    <strong className="text-amber-100">{title}:</strong> <span className="text-[#b9c8c0]">{body}</span>
  </div>;
}

function StatusBadge({ icon: Icon, label, tone = "neutral" }: { icon: typeof CalendarDays; label: string; tone?: "neutral" | "positive" | "warning" }) {
  const color = tone === "positive" ? "border-emerald-300/20 bg-emerald-300/8 text-emerald-200" : tone === "warning" ? "border-amber-300/20 bg-amber-300/8 text-amber-100" : "border-white/10 bg-white/5 text-[#d7e3dc]";
  return <span className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold ${color}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</span>;
}

function moneyStateLabel(state: OwnerDailyDigestReport["moneyState"]): string {
  if (state === "CLOSED") return "Đã chốt";
  if (state === "PROVISIONAL") return "Tạm tính";
  return "Không có số tiền";
}

function freshnessLabel(state: OwnerDailyDigestReport["freshnessState"]): string {
  if (state === "FRESH") return "Dữ liệu mới";
  if (state === "PARTIAL") return "Có nguồn chưa sẵn sàng";
  return "Dữ liệu đã cũ";
}

function formatReportDate(value: string): string {
  // business_date is already a canonical date-only value. Formatting in UTC
  // prevents an extreme Club timezone from shifting the label by one day.
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function formatGeneratedAt(value: string, timezone: string | null): string {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: timezone ?? "Asia/Bangkok" }).format(new Date(value));
}

function maskId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
