import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CircleEllipsis, Image as ImageIcon, ListTree, Newspaper, Share2, Spade, Trophy } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PublicTournamentRail } from "@/components/cashier/tournament-live/public-event/PublicTournamentRail";
import { PublicTournamentTables } from "@/components/cashier/tournament-live/public-event/PublicTournamentTables";
import { makePublicTournamentFixture } from "@/components/cashier/tournament-live/public-event/publicTournamentFixtures";
import type { PublicClockPhase, PublicDataQuality } from "@/components/cashier/tournament-live/public-event/publicTournamentEvent";

const primaryTabs = [
  { id: "overview", label: "Tổng quan", Icon: Spade },
  { id: "tables", label: "Bàn", Icon: ListTree },
  { id: "structure", label: "Cấu trúc", Icon: Newspaper },
] as const;

const moreTabs = [
  { id: "updates", label: "Diễn biến", Icon: Newspaper },
  { id: "hands", label: "Ván đấu", Icon: Spade },
  { id: "prizes", label: "Giải thưởng", Icon: Trophy },
  { id: "photos", label: "Hình ảnh", Icon: ImageIcon },
] as const;

type PreviewTab = typeof primaryTabs[number]["id"] | typeof moreTabs[number]["id"];

export default function PublicTournamentEventPreview() {
  const [params] = useSearchParams();
  const [moreOpen, setMoreOpen] = useState(false);
  const requestedPhase = params.get("phase") as PublicClockPhase | null;
  const phase: PublicClockPhase = ["running", "paused", "break", "not_started", "completed"].includes(requestedPhase ?? "")
    ? requestedPhase!
    : "running";
  const requestedQuality = params.get("quality") as PublicDataQuality | null;
  const quality: PublicDataQuality = ["exact", "partial", "stale"].includes(requestedQuality ?? "")
    ? requestedQuality!
    : "exact";
  const requestedTab = params.get("tab") as PreviewTab | null;
  const allTabIds = [...primaryTabs, ...moreTabs].map((item) => item.id);
  const tab: PreviewTab = allTabIds.includes(requestedTab ?? "") ? requestedTab! : "overview";
  const snapshot = useMemo(() => makePublicTournamentFixture(phase, quality), [phase, quality]);

  return (
    <main
      data-public-tournament-v2
      data-phase={phase}
      data-quality={quality}
      className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_20%_-10%,rgba(16,185,129,0.12),transparent_32%),linear-gradient(180deg,#050a08_0%,#030504_100%)] text-slate-100"
    >
      <header className="border-b border-white/10 bg-black/35 px-[max(0.85rem,env(safe-area-inset-left))] py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3">
          <Link to="/__dev/public-live-v2" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-bold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Live Center</span>
          </Link>
          <div className="min-w-0 text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">HSOP Live</div>
            <div className="truncate text-sm font-bold text-white">Main Event Championship</div>
          </div>
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-bold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" aria-label="Chia sẻ giải">
            <Share2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Chia sẻ</span>
          </button>
        </div>
      </header>

      <div className="mx-auto min-w-0 max-w-[1440px] px-[max(0.75rem,env(safe-area-inset-left))] pb-[max(6.5rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-10 sm:pt-5">
        <div className="sticky top-0 z-30 -mx-1 bg-[#050a08]/92 px-1 py-2 backdrop-blur-xl sm:static sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <PublicTournamentRail snapshot={snapshot} />
        </div>

        <nav aria-label="Nội dung giải" className="mt-4 hidden min-h-12 items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.025] p-1 md:flex">
          {[...primaryTabs, ...moreTabs].map(({ id, label, Icon }) => (
            <Link
              key={id}
              to={`?tab=${id}&phase=${phase}&quality=${quality}`}
              aria-current={tab === id ? "page" : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${tab === id ? "bg-emerald-300 text-emerald-950" : "text-slate-400 hover:bg-white/[0.05] hover:text-white"}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </Link>
          ))}
        </nav>

        <section className="mt-5">
          {tab === "tables" ? <PublicTournamentTables tables={snapshot.tables} /> : tab === "structure" ? <StructureFixture snapshot={snapshot} /> : <OverviewFixture snapshot={snapshot} tab={tab} />}
        </section>
      </div>

      <nav aria-label="Điều hướng Live mobile" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-[#050a08]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {primaryTabs.map(({ id, label, Icon }) => (
          <Link
            key={id}
            to={`?tab=${id}&phase=${phase}&quality=${quality}`}
            aria-current={tab === id ? "page" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${tab === id ? "text-emerald-300" : "text-slate-500"}`}
          >
            <Icon className="h-5 w-5" aria-hidden="true" /> {label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${moreTabs.some((item) => item.id === tab) ? "text-emerald-300" : "text-slate-500"}`}
        >
          <CircleEllipsis className="h-5 w-5" aria-hidden="true" /> Thêm
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-white/10 bg-[#07100c] pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
          <SheetHeader className="text-left">
            <SheetTitle className="text-white">Xem thêm</SheetTitle>
            <SheetDescription>Chọn nội dung công khai của giải đấu.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 grid gap-2">
            {moreTabs.map(({ id, label, Icon }) => (
              <Link
                key={id}
                to={`?tab=${id}&phase=${phase}&quality=${quality}`}
                onClick={() => setMoreOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 font-bold text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Icon className="h-5 w-5 text-emerald-300" aria-hidden="true" /> {label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <FixtureControl phase={phase} quality={quality} />
    </main>
  );
}

function OverviewFixture({ snapshot, tab }: { snapshot: ReturnType<typeof makePublicTournamentFixture>; tab: PreviewTab }) {
  if (tab !== "overview") {
    const label = moreTabs.find((item) => item.id === tab)?.label ?? "Nội dung";
    return (
      <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.025] px-5 py-16 text-center">
        <h2 className="text-xl font-black text-white">{label}</h2>
        <p className="mt-2 text-sm text-slate-400">PR B sẽ gắn màn hiện có vào cùng snapshot owner mà không đổi deep link.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
      <article className="rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">Tình hình giải</div>
        <h2 className="mt-2 text-2xl font-black text-white">Nhịp độ đang tăng ở Level {snapshot.clock.levelNumber ?? "—"}</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">Theo dõi đồng hồ, blinds và toàn bộ bàn đang chạy từ một nguồn snapshot. Trang công khai không có thao tác Floor.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Bàn chạy" value={String(snapshot.tables.length)} />
          <Metric label="Người còn lại" value={snapshot.playersRemaining == null ? "—" : String(snapshot.playersRemaining)} />
          <Metric label="Entries" value={String(snapshot.entries)} />
          <Metric label="AVG stack" value={snapshot.averageStack == null ? "—" : snapshot.averageStack.toLocaleString("vi-VN")} />
        </div>
      </article>
      <aside className="rounded-3xl border border-white/10 bg-[linear-gradient(145deg,rgba(251,191,36,0.09),rgba(255,255,255,0.02))] p-5">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-200">Bàn nổi bật</div>
        <div className="mt-3 text-3xl font-black text-white">Bàn 55</div>
        <p className="mt-1 text-sm text-slate-400">7/9 người chơi · Chip leader 7.4M</p>
        <Link to={`?tab=tables&phase=${snapshot.clock.phase}&quality=${snapshot.dataQuality}`} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-amber-200 px-4 text-sm font-black text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          Xem đủ 9 ghế
        </Link>
      </aside>
    </div>
  );
}

function StructureFixture({ snapshot }: { snapshot: ReturnType<typeof makePublicTournamentFixture> }) {
  return (
    <section aria-labelledby="structure-title" className="rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-6">
      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">Blind structure</div>
      <h2 id="structure-title" className="mt-1 text-2xl font-black text-white">Cấu trúc blinds</h2>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
        {snapshot.structure.map((level) => (
          <div key={level.levelNumber} className={`grid min-h-14 grid-cols-[4rem_1fr_auto] items-center gap-3 border-b border-white/[0.07] px-4 last:border-b-0 ${level.levelNumber === snapshot.clock.levelNumber ? "bg-emerald-300/10" : ""}`}>
            <strong className="tabular-nums text-slate-300">L{level.levelNumber}</strong>
            <span className="font-semibold text-white">{level.isBreak ? "Nghỉ giải lao" : `${level.smallBlind.toLocaleString("vi-VN")} / ${level.bigBlind.toLocaleString("vi-VN")} · BBA ${level.bigBlindAnte.toLocaleString("vi-VN")}`}</span>
            <span className="text-sm tabular-nums text-slate-500">{level.durationMinutes}′</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div><div className="mt-1 truncate text-xl font-black tabular-nums text-white">{value}</div></div>;
}

function FixtureControl({ phase, quality }: { phase: PublicClockPhase; quality: PublicDataQuality }) {
  return (
    <div className="fixed bottom-20 right-3 z-50 hidden max-w-xs rounded-2xl border border-fuchsia-300/20 bg-fuchsia-950/90 p-3 text-xs shadow-2xl lg:block">
      <div className="font-black uppercase tracking-wider text-fuchsia-200">DEV fixture</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(["running", "paused", "break", "not_started", "completed"] as PublicClockPhase[]).map((item) => <Link key={item} to={`?phase=${item}&quality=${quality}`} className={`rounded-md px-2 py-1 ${phase === item ? "bg-fuchsia-200 text-fuchsia-950" : "bg-white/10 text-white"}`}>{item}</Link>)}
      </div>
      <div className="mt-2 flex gap-1">
        {(["exact", "partial", "stale"] as PublicDataQuality[]).map((item) => <Link key={item} to={`?phase=${phase}&quality=${item}`} className={`rounded-md px-2 py-1 ${quality === item ? "bg-fuchsia-200 text-fuchsia-950" : "bg-white/10 text-white"}`}>{item}</Link>)}
      </div>
    </div>
  );
}
