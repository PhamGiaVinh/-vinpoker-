import { CalendarDays, RefreshCw, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import type { SeriesReadModel } from "@/ops/series/seriesReadAdapter";

export function SeriesWorkspaceView({
  clubName,
  model,
  loading,
  errorCode,
  onRefresh,
}: {
  clubName: string;
  model: SeriesReadModel | null;
  loading: boolean;
  errorCode: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-200">
            <Sparkles className="h-4 w-4" /> Series planner read surface
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.02em] text-white">Series</h1>
          <p className="mt-1 text-sm text-[#91a49b]">{clubName} · sự kiện native do server xác nhận</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-sky-300/20 bg-sky-300/8 px-3 py-1 text-xs font-semibold text-sky-200">READ_ONLY</span>
          <button
            type="button"
            data-ops-action="series.refresh"
            onClick={onRefresh}
            disabled={loading}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#b9c8c0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
            aria-label="Làm mới Series"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-sky-300/15 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100">
        <ShieldCheck className="mr-2 inline h-4 w-4" />
        Ops không mount thư viện CSV, bộ nhớ trình duyệt, autosync, quyết định hoặc writer. Back luôn về Hub qua “Đổi không gian”.
      </div>

      {errorCode ? (
        <StateCard title="Series chưa khả dụng" detail={errorCode} />
      ) : loading && !model ? (
        <StateCard title="Đang tải sự kiện Series…" />
      ) : !model?.events.length ? (
        <StateCard title="Chưa có sự kiện Series native trong CLB." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Metric icon={<CalendarDays className="h-4 w-4" />} label="Số giải" value={model.events.length.toLocaleString("vi-VN")} />
            <Metric icon={<Users className="h-4 w-4" />} label="Tổng entries" value={model.totalEntries.toLocaleString("vi-VN")} />
            <Metric icon={<Trophy className="h-4 w-4" />} label="Prize pool" value={`${model.totalPrizePool.toLocaleString("vi-VN")} ₫`} />
          </div>
          {model.events.length < 12 && (
            <p className="rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3 text-sm text-amber-100">
              Mới có {model.events.length}/12 giải: chỉ là giả thuyết quan sát, chưa đủ mẫu để dự báo đáng tin.
            </p>
          )}
          <div className="overflow-hidden rounded-3xl border border-white/8 bg-[#07100c]">
            {model.events.map((event) => (
              <article key={event.id} className="grid min-w-0 gap-2 border-b border-white/7 px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-white">{event.name}</h2>
                  <p className="mt-1 text-xs text-[#91a49b]">{new Date(event.date).toLocaleDateString("vi-VN")} · Buy-in {event.buyIn.toLocaleString("vi-VN")} ₫</p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="font-mono text-xs text-[#b9c8c0]">{event.totalEntries} entries</span>
                  <span className="font-mono text-xs text-[#d8bc85]">{event.prizePool.toLocaleString("vi-VN")} ₫</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-[#07100c] px-4 py-3">
      <span className="flex items-center gap-1.5 text-[11px] text-[#91a49b]">{icon}{label}</span>
      <span className="mt-1 block truncate font-mono text-lg font-semibold text-white">{value}</span>
    </div>
  );
}

function StateCard({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-white/8 bg-[#07100c] px-5 text-center">
      <Sparkles className="h-8 w-8 text-[#91a49b]" />
      <p className="mt-3 font-semibold text-white">{title}</p>
      {detail && <p className="mt-1 font-mono text-xs text-rose-200">{detail}</p>}
    </div>
  );
}
