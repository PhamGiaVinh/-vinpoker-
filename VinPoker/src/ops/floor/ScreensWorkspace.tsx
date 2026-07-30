import { ExternalLink, Monitor, QrCode, Wifi, WifiOff } from "lucide-react";
import { useTournamentOps } from "@/ops/floor/TournamentOpsProvider";

export default function ScreensWorkspace() {
  const { tournamentId, displays, errors } = useTournamentOps();

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Không gian giải</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Màn hình TV</h2>
        <p className="mt-1 text-sm text-[#91a49b]">
          Mở màn hình công cộng bằng một document mới; Ops không đăng ký service worker.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <a
          href={`/tv/${encodeURIComponent(tournamentId)}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-24 items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4 hover:border-emerald-300/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-300/10 text-emerald-300">
            <Monitor className="h-6 w-6" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold text-white">Mở TV giải <ExternalLink className="h-4 w-4" /></span>
            <span className="mt-1 block text-sm text-[#91a49b]">Chế độ xem công cộng của giải hiện tại.</span>
          </span>
        </a>
        <a
          href="/tv/pair"
          target="_blank"
          rel="noreferrer"
          className="flex min-h-24 items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.035] p-4 hover:border-emerald-300/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sky-300/10 text-sky-300">
            <QrCode className="h-6 w-6" />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold text-white">Ghép màn hình <ExternalLink className="h-4 w-4" /></span>
            <span className="mt-1 block text-sm text-[#91a49b]">Mở trang ghép mã trên document riêng.</span>
          </span>
        </a>
      </div>

      <section className="space-y-3">
        <h3 className="font-semibold text-white">Màn hình đang gắn với giải</h3>
        {errors.screens ? (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
            {errors.screens}
          </div>
        ) : displays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-[#789084]">
            Chưa có màn hình được gắn với giải này.
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {displays.map((display) => {
              const online = display.status === "online" || display.status === "active";
              return (
                <div key={display.id} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{display.name || "Màn hình chưa đặt tên"}</p>
                    <p className="mt-0.5 text-xs text-[#91a49b]">
                      {display.zone || "Chưa có khu vực"} · {display.layout}
                    </p>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1.5 text-xs ${online ? "text-emerald-300" : "text-[#789084]"}`}>
                    {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    {display.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
