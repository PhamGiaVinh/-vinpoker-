import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarClock, Clock3, Newspaper, Radio, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmtCompact } from "@/components/cashier/tournament-live/viewer-hub/hubDerive";
import type { PublicTournamentSummary } from "@/components/cashier/tournament-live/viewer-hub/viewerTypes";

interface NewsItem {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover_url: string | null;
  published_at: string | null;
}

function statusGroup(status: string): "live" | "upcoming" | "finished" {
  const value = status.toLowerCase();
  if (["running", "live", "in_progress", "active"].includes(value)) return "live";
  if (["completed", "finished", "cancelled"].includes(value)) return "finished";
  return "upcoming";
}

function TournamentTile({ tournament }: { tournament: PublicTournamentSummary }) {
  const group = statusGroup(tournament.status);
  return (
    <article className="group overflow-hidden rounded-[22px] border border-border/55 bg-[linear-gradient(145deg,hsl(var(--card)_/_0.96),hsl(var(--background)_/_0.74))] shadow-[0_22px_70px_rgba(0,0,0,0.28)]">
      <div className={`h-1 ${group === "live" ? "bg-[hsl(var(--viewer-neon))] shadow-[0_0_18px_hsl(var(--viewer-neon)_/_0.7)]" : "bg-[hsl(var(--poker-gold)_/_0.72)]"}`} />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.15em] ${group === "live" ? "border-[hsl(var(--viewer-neon)_/_0.45)] bg-[hsl(var(--viewer-neon)_/_0.1)] text-[hsl(var(--viewer-neon))]" : "border-border/70 text-muted-foreground"}`}>
              {group === "live" && <Radio className="h-3 w-3" aria-hidden="true" />}
              {group === "live" ? "Đang live" : group === "upcoming" ? "Sắp diễn ra" : "Đã kết thúc"}
            </span>
            <h2 className="mt-3 line-clamp-2 text-lg font-black tracking-tight text-foreground sm:text-xl">{tournament.name}</h2>
          </div>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[hsl(var(--poker-gold)_/_0.3)] bg-[hsl(var(--poker-gold)_/_0.08)] text-[hsl(var(--poker-gold))]"><Trophy className="h-5 w-5" /></span>
        </div>

        <dl className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/45 bg-background/30 text-center">
          <div className="p-2.5"><dt className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">GTD</dt><dd className="tracker-num mt-1 text-xs font-bold text-[hsl(var(--poker-gold))]">{tournament.guarantee ? fmtCompact(tournament.guarantee) : "--"}</dd></div>
          <div className="border-x border-border/40 p-2.5"><dt className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">Buy-in</dt><dd className="tracker-num mt-1 text-xs font-bold">{tournament.buyIn ? fmtCompact(tournament.buyIn) : "--"}</dd></div>
          <div className="p-2.5"><dt className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground">Còn lại</dt><dd className="tracker-num mt-1 text-xs font-bold">{tournament.playersRemaining ?? "--"}</dd></div>
        </dl>

        {tournament.startsAt && <p className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="h-4 w-4" />{new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(tournament.startsAt))}</p>}
        <div className="grid grid-cols-2 gap-2">
          <Link to={`/clock/${tournament.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border/60 text-xs font-bold text-foreground transition hover:border-[hsl(var(--poker-gold)_/_0.5)]"><Clock3 className="h-4 w-4" /> Đồng hồ</Link>
          <Link to={`/live/${tournament.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--viewer-neon))] text-xs font-black text-[hsl(var(--viewer-neon-ink))] shadow-[0_0_24px_hsl(var(--viewer-neon)_/_0.25)] transition hover:brightness-110">Xem live <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
    </article>
  );
}

export default function LiveCenter() {
  const [searchParams] = useSearchParams();
  const [tournaments, setTournaments] = useState<PublicTournamentSummary[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (import.meta.env.DEV && searchParams.get("preview") === "mock") {
      setTournaments([
        { id: "mock-live", name: "Midnight Sakura Championship", status: "running", startsAt: "2026-07-11T12:00:00Z", guarantee: 3_000_000_000, buyIn: 12_000_000, playersRemaining: 23, currentLevel: 18 },
        { id: "mock-next", name: "VinPoker High Roller", status: "scheduled", startsAt: "2026-07-12T12:00:00Z", guarantee: 1_500_000_000, buyIn: 35_000_000, playersRemaining: null, currentLevel: null },
        { id: "mock-finished", name: "Sakura Deepstack Finale", status: "completed", startsAt: "2026-07-10T12:00:00Z", guarantee: 800_000_000, buyIn: 8_000_000, playersRemaining: 1, currentLevel: 24 },
      ]);
      setNews([]);
      setLoading(false);
      return () => { active = false; };
    }
    void (async () => {
      const [tournamentsResult, newsResult] = await Promise.all([
        supabase.from("tournaments").select("id, name, status, start_time, guarantee_amount, buy_in, players_remaining, current_level").is("deleted_at", null).order("start_time", { ascending: false }).limit(18),
        supabase.from("news_posts").select("id, slug, title, summary, cover_url, published_at").eq("status", "published").order("published_at", { ascending: false }).limit(6),
      ]);
      if (!active) return;
      setTournaments((tournamentsResult.data ?? []).map((row) => ({ id: row.id, name: row.name, status: row.status, startsAt: row.start_time, guarantee: row.guarantee_amount, buyIn: row.buy_in, playersRemaining: row.players_remaining, currentLevel: row.current_level })));
      setNews((newsResult.data ?? []) as NewsItem[]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [searchParams]);

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-9 px-3 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-7">
      <header className="relative overflow-hidden rounded-[28px] border border-[hsl(var(--poker-gold)_/_0.28)] bg-[radial-gradient(circle_at_14%_0%,hsl(var(--viewer-neon)_/_0.12),transparent_32%),radial-gradient(circle_at_90%_20%,hsl(var(--poker-gold)_/_0.15),transparent_34%),linear-gradient(140deg,hsl(var(--card)),hsl(var(--background)))] px-5 py-8 sm:px-8 sm:py-12">
        <div className="relative max-w-3xl">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-[hsl(var(--viewer-neon))]">VinPoker Live Center</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-5xl">Theo dõi giải đấu như đang đứng bên rail.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Sự kiện đang live, lịch sử ván, đồng hồ giải và tin mới nhất trong một hành trình tối ưu cho điện thoại.</p>
        </div>
      </header>

      {loading ? <div className="rounded-2xl border border-border/50 p-8 text-center text-sm text-muted-foreground">Đang tải Live Center...</div> : (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--viewer-neon))] shadow-[0_0_12px_hsl(var(--viewer-neon))]" />Sự kiện nổi bật</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...tournaments].sort((a, b) => {
              const order = { live: 0, upcoming: 1, finished: 2 };
              return order[statusGroup(a.status)] - order[statusGroup(b.status)];
            }).map((tournament) => <TournamentTile key={tournament.id} tournament={tournament} />)}
          </div>
        </section>
      )}

      {news.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-xl font-black tracking-tight"><Newspaper className="h-5 w-5 text-[hsl(var(--poker-gold))]" /> Tin mới</h2><Link to="/news" className="text-xs font-bold text-[hsl(var(--viewer-neon))]">Xem tất cả</Link></div>
          <div className="grid gap-3 lg:grid-cols-3">{news.map((item) => <Link key={item.id} to={`/news/${item.slug}`} className="group overflow-hidden rounded-2xl border border-border/50 bg-card/70"><div className="aspect-[16/8] bg-secondary/40">{item.cover_url && <img src={item.cover_url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />}</div><div className="p-4"><h3 className="line-clamp-2 font-black">{item.title}</h3>{item.summary && <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</p>}</div></Link>)}</div>
        </section>
      )}
    </main>
  );
}
