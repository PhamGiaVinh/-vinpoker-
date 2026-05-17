import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBuyInShort, formatShortDate, formatTime } from "@/lib/format";
import { FomoPrice } from "@/components/FomoPrice";
import { Loader2, ChevronLeft, ChevronRight, Trophy, ExternalLink, Radio, Newspaper, ChevronDown, Filter, Search, X, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { LivestreamSection } from "@/components/LivestreamSection";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getCurrentLevel, getLevelEndsIn, isLateRegClosed, formatCountdown } from "@/lib/tournamentLive";
import { useTranslation } from "react-i18next";
import { TournamentRegisterModal } from "@/components/TournamentRegisterModal";
import News from "./News";


interface Tournament {
  id: string;
  name: string;
  start_time: string;
  buy_in: number;
  rake_amount?: number;
  free_rake_enabled?: boolean;
  free_rake_slots?: number;
  free_rake_used?: number;
  starting_stack: number;
  current_players: number;
  current_blinds: string | null;
  live_status: string;
  location: string | null;
  game_type: string;
  minutes_per_level: number | null;
  late_reg_close_level: number | null;
  club: { id: string; name: string; region: string };
}

interface BannerItem {
  id?: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_url: string;
}

const PAGE_SIZE = 5;
const GAME_LABEL: Record<string, string> = { nlh: "No Limit Hold'em", plo: "Pot Limit Omaha", mixed: "Mixed Games" };

interface SeriesItem {
  id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  cover_url: string | null;
}

const Tournaments = () => {
  const { user, isAdmin } = useAuth();
  const { t: tr } = useTranslation();
  const nav = useNavigate();
  const [items, setItems] = useState<Tournament[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [scheduleClubs, setScheduleClubs] = useState<{ id: string; name: string; region: string; daily_schedule_image_url: string | null; weekly_schedule_image_url: string | null; schedule_sort_order: number }[]>([]);
  const [reordering, setReordering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"daily" | "weekly" | "news" | "series" | "livestream">("weekly");
  const [buyInRange, setBuyInRange] = useState("all");
  const [statusUpcoming, setStatusUpcoming] = useState(true);
  const [statusLateReg, setStatusLateReg] = useState(true);
  const [gameTypes, setGameTypes] = useState<Record<string, boolean>>({ nlh: true, plo: true, mixed: true });
  const [page, setPage] = useState(1);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [registerFor, setRegisterFor] = useState<{ id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: t }, { data: bs }, { data: vb }, { data: sr }, { data: cs }] = await Promise.all([
        supabase
          .from("tournaments")
          .select("id,name,start_time,buy_in,rake_amount,free_rake_enabled,free_rake_slots,free_rake_used,starting_stack,current_players,current_blinds,live_status,location,game_type,minutes_per_level,late_reg_close_level, club:clubs(id,name,region)")
          .order("buy_in", { ascending: false }),
        supabase.from("app_settings").select("value").eq("key", "banners").maybeSingle(),
        supabase.from("app_settings").select("value").eq("key", "vip_banner").maybeSingle(),
        supabase.from("tournament_series").select("id,name,location,start_date,end_date,cover_url").order("start_date", { ascending: true }),
        supabase.from("clubs").select("id,name,region,daily_schedule_image_url,weekly_schedule_image_url,schedule_sort_order").eq("status", "approved").order("schedule_sort_order", { ascending: true }).order("name"),
      ]);
      setItems((t as any) ?? []);
      setSeries((sr as any) ?? []);
      setScheduleClubs((cs as any) ?? []);
      const list: BannerItem[] = [];
      const multi = (bs?.value as any)?.items;
      if (Array.isArray(multi)) {
        for (const b of multi) if (b?.image_url || b?.title) list.push(b);
      }
      // Fallback to legacy single VIP banner
      if (list.length === 0 && vb?.value) {
        const v = vb.value as any;
        if (v.image_url || v.title) list.push(v);
      }
      setBanners(list);
      setLoading(false);
    })();
  }, []);

  // Auto-rotate banners every 5s
  useEffect(() => {
    if (banners.length <= 1) return;
    const id = setInterval(() => setBannerIdx(i => (i + 1) % banners.length), 5000);
    return () => clearInterval(id);
  }, [banners.length]);

  const banner = banners[bannerIdx] ?? null;

  // Tick every 30s so countdowns / auto-hide refresh
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const q = searchQuery.trim().toLowerCase();
    return items.filter((i) => {
      const ts = new Date(i.start_time).getTime();
      // Auto-hide once late reg is closed (buy-in window ended) or finished
      if (isLateRegClosed(i, now)) return false;
      if (view === "daily") {
        const sameDay = new Date(i.start_time).toDateString() === new Date().toDateString();
        if (!sameDay && (ts < now || ts > now + 24 * 60 * 60 * 1000)) return false;
      } else {
        if (ts < now - 12 * 60 * 60 * 1000 || ts > now + weekMs) return false;
      }
      if (buyInRange !== "all") {
        const v = i.buy_in;
        if (buyInRange === "low" && v >= 2_000_000) return false;
        if (buyInRange === "mid" && (v < 2_000_000 || v >= 10_000_000)) return false;
        if (buyInRange === "high" && v < 10_000_000) return false;
      }
      if (!gameTypes[i.game_type ?? "nlh"]) return false;
      // Upcoming = not yet started; Late Reg = started but buy-in still open
      const isUp = ts > now;
      const isLate = ts <= now && !isLateRegClosed(i, now);
      if (!statusUpcoming && isUp) return false;
      if (!statusLateReg && isLate) return false;
      if (!statusUpcoming && !statusLateReg) return false;
      if (q) {
        const nameMatch = i.name?.toLowerCase().includes(q);
        const buyInMatch = formatBuyInShort(i.buy_in).toLowerCase().includes(q);
        if (!nameMatch && !buyInMatch) return false;
      }
      return true;
    });
  }, [items, view, buyInRange, statusUpcoming, statusLateReg, gameTypes, tick, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleGame = (k: string) => { setGameTypes(prev => ({ ...prev, [k]: !prev[k] })); setPage(1); };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (buyInRange !== "all") n++;
    if (!gameTypes.nlh || !gameTypes.plo || !gameTypes.mixed) n++;
    if (!statusUpcoming || !statusLateReg) n++;
    return n;
  }, [buyInRange, gameTypes, statusUpcoming, statusLateReg]);

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between flex-wrap gap-4">
        <div className="max-w-2xl">
          <h1 className="font-display font-black text-4xl md:text-5xl tracking-tight leading-[1.05] font-mono">
            {tr("tournamentsPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            {tr("tournamentsPage.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap gap-1 w-full sm:w-auto sm:inline-flex rounded-xl bg-card border border-border p-1">
          {(["weekly", "daily", "news", "series", "livestream"] as const).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); setPage(1); }}
              className={cn(
                "px-2 sm:px-4 py-1.5 text-[10px] sm:text-xs font-bold tracking-wider rounded-lg transition-all inline-flex items-center justify-center gap-1 sm:gap-1.5 leading-tight text-center",
                view === v
                  ? v === "livestream"
                    ? "text-foreground"
                    : "gradient-neon text-primary-foreground shadow-neon"
                  : "text-[#aba0a0]"
              )}
            >
              {v === "livestream" && <Radio className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#ff1900] shrink-0" />}
              {v === "news" && <Newspaper className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />}
              <span className="truncate">
                {v === "daily" ? tr("tournamentsPage.daily")
                  : v === "weekly" ? tr("tournamentsPage.weekly")
                  : v === "series" ? tr("tournamentsPage.series")
                  : v === "livestream" ? tr("tournamentsPage.livestream")
                  : tr("tournamentsPage.news")}
              </span>
            </button>
          ))}
        </div>
      </section>

      {view === "livestream" ? (
        <LivestreamSection />
      ) : view === "news" ? (
        <News />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5">
        <aside className="space-y-4">
          <Card className="p-5 gradient-card border border-border">
            <Collapsible open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 lg:cursor-default lg:pointer-events-none"
                >
                  <h3 className="font-display font-bold text-lg flex items-center gap-2">
                    <Filter className="w-4 h-4 lg:hidden text-primary" />
                    {tr("tournamentsPage.filters")}
                    {activeFilterCount > 0 && (
                      <span className="lg:hidden text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/40 rounded-full px-2 py-0.5">
                        {tr("tournamentsPage.filtersActive", { count: activeFilterCount })}
                      </span>
                    )}
                  </h3>
                  <ChevronDown className={cn("w-4 h-4 lg:hidden text-muted-foreground transition-transform", mobileFiltersOpen && "rotate-180")} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent forceMount className="overflow-hidden data-[state=closed]:hidden lg:!block">
                <div className="space-y-3 mt-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{tr("tournamentsPage.gameType")}</div>
                  {(["nlh","plo","mixed"] as const).map(k => (
                    <label key={k} className="flex items-center gap-2.5 text-sm cursor-pointer hover:text-primary transition-colors">
                      <Checkbox checked={gameTypes[k]} onCheckedChange={() => toggleGame(k)} />
                      <span>{GAME_LABEL[k]}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-5 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{tr("tournamentsPage.buyInRange")}</div>
                  <Select value={buyInRange} onValueChange={(v) => { setBuyInRange(v); setPage(1); }}>
                    <SelectTrigger className="bg-muted/40 border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tr("tournamentsPage.allStakes")}</SelectItem>
                      <SelectItem value="low">&lt; 2M</SelectItem>
                      <SelectItem value="mid">2M – 10M</SelectItem>
                      <SelectItem value="high">10M+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="mt-5 space-y-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{tr("tournamentsPage.status")}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setStatusUpcoming((v) => !v); setPage(1); }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-bold rounded-lg border transition-all",
                        statusUpcoming
                          ? "gradient-neon text-primary-foreground border-transparent shadow-neon"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tr("tournamentsPage.upcoming")}
                    </button>
                    <button
                      onClick={() => { setStatusLateReg((v) => !v); setPage(1); }}
                      className={cn(
                        "px-3 py-1.5 text-xs font-bold rounded-lg border transition-all",
                        statusLateReg
                          ? "bg-primary/15 text-primary border-primary/40"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tr("tournamentsPage.lateReg")}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* VIP Card (sidebar small) */}
          <Card className="relative overflow-hidden border border-primary/30 p-0">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-transparent to-transparent pointer-events-none" />
            <div className="aspect-[4/3] bg-gradient-to-br from-secondary to-background flex items-center justify-center overflow-hidden">
              {banner?.image_url ? (
                <img src={banner.image_url} alt={banner.title} className="w-full h-full object-cover" />
              ) : (
                <Trophy className="w-16 h-16 text-primary/60" />
              )}
            </div>
            {(banner?.title || banner?.subtitle) && (
              <div className="relative p-3">
                {banner?.title && <div className="font-display font-bold">{banner.title}</div>}
                {banner?.subtitle && <div className="text-xs text-primary mt-0.5">{banner.subtitle}</div>}
              </div>
            )}
          </Card>
        </aside>

        {/* Right column: VIP HERO Banner + Tournament Table */}
        <div className="space-y-5">
          {/* Big rotating Banner Carousel */}
          {banner && (
            <Card className="relative overflow-hidden border border-primary/40 p-0 shadow-neon">
              <div className="relative aspect-[16/6] md:aspect-[16/5] bg-gradient-to-br from-secondary via-background to-secondary">
                {banner.image_url && (
                  <img
                    key={banner.image_url}
                    src={banner.image_url}
                    alt={banner.title}
                    className="absolute inset-0 w-full h-full object-cover animate-fade-in"
                  />
                )}
                
                <div className="relative h-full flex flex-col justify-center px-6 md:px-10 max-w-[60%]">
                  
                  {banner.title && (
                    <h2 className="font-display font-black text-2xl md:text-4xl leading-tight">
                      {banner.title}
                    </h2>
                  )}
                  {banner.subtitle && <div className="text-sm md:text-base text-primary mt-2">{banner.subtitle}</div>}
                  {banner.cta_url && (
                    <a href={banner.cta_url} target="_blank" rel="noopener noreferrer"
                       className="mt-4 inline-flex items-center gap-2 self-start gradient-neon text-primary-foreground font-bold tracking-wider rounded-full px-5 h-9 shadow-neon hover:opacity-90 text-xs">
                      {tr("tournamentsPage.learnMore")} <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                {banners.length > 1 && (
                  <div className="absolute bottom-3 right-4 flex items-center gap-1.5">
                    {banners.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setBannerIdx(i)}
                        aria-label={`Banner ${i + 1}`}
                        className={cn(
                          "h-1.5 rounded-full transition-all",
                          i === bannerIdx ? "w-6 bg-primary shadow-neon" : "w-1.5 bg-muted-foreground/50 hover:bg-muted-foreground"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {view === "daily" && (
            <div className="relative w-full lg:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                placeholder={tr("tournamentsPage.searchPlaceholder")}
                className="pl-9 pr-9 bg-muted/40 border-border"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setPage(1); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Clear"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {view === "weekly" ? (() => {
            const visible = scheduleClubs.filter(c => c.weekly_schedule_image_url || c.daily_schedule_image_url);
            const moveClub = async (clubId: string, dir: "up" | "down") => {
              if (reordering) return;
              const idx = visible.findIndex(c => c.id === clubId);
              const newIdx = dir === "up" ? idx - 1 : idx + 1;
              if (newIdx < 0 || newIdx >= visible.length) return;
              setReordering(true);
              const reordered = [...visible];
              [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
              const updates = reordered.map((c, i) => ({ id: c.id, schedule_sort_order: (i + 1) * 10 }));
              setScheduleClubs(prev => {
                const mapped = prev.map(c => {
                  const u = updates.find(x => x.id === c.id);
                  return u ? { ...c, schedule_sort_order: u.schedule_sort_order } : c;
                });
                return [...mapped].sort((a, b) => (a.schedule_sort_order - b.schedule_sort_order) || a.name.localeCompare(b.name));
              });
              try {
                await Promise.all(updates.map(u =>
                  supabase.from("clubs").update({ schedule_sort_order: u.schedule_sort_order }).eq("id", u.id)
                ));
              } catch (e: any) {
                toast.error("Không thể cập nhật thứ tự: " + (e?.message ?? "lỗi"));
              } finally {
                setReordering(false);
              }
            };
            return (
              <div className="space-y-4">
                {visible.length === 0 ? (
                  <Card className="p-12 text-center text-sm text-muted-foreground">Chưa có CLB nào tải lên lịch thi đấu.</Card>
                ) : (
                  visible.map((c, idx) => (
                    <Card key={c.id} className="p-4 border border-border bg-card">
                      <div className="flex items-center justify-between mb-3 gap-2">
                        <Link to={`/club/${c.id}`} className="font-display font-bold text-lg hover:text-primary transition-colors truncate">
                          {c.name}
                        </Link>
                        <div className="flex items-center gap-2 shrink-0">
                          {isAdmin && (
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="outline" className="h-7 w-7" disabled={reordering || idx === 0} onClick={() => moveClub(c.id, "up")} aria-label="Lên">
                                <ArrowUp className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="outline" className="h-7 w-7" disabled={reordering || idx === visible.length - 1} onClick={() => moveClub(c.id, "down")} aria-label="Xuống">
                                <ArrowDown className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground">{c.region}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {c.weekly_schedule_image_url && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wider text-primary font-bold mb-1">Lịch hàng tuần</div>
                            <img src={c.weekly_schedule_image_url} alt={`${c.name} weekly schedule`} className="w-full h-auto object-contain rounded-md border border-border" loading="lazy" />
                          </div>
                        )}
                        {c.daily_schedule_image_url && (
                          <div>
                            <div className="text-[11px] uppercase tracking-wider text-primary font-bold mb-1">Lịch hàng ngày</div>
                            <img src={c.daily_schedule_image_url} alt={`${c.name} daily schedule`} className="w-full h-auto object-contain rounded-md border border-border" loading="lazy" />
                          </div>
                        )}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            );
          })()
          : view === "series" ? (
            <Card className="border border-border bg-card overflow-hidden p-0">
              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : series.length === 0 ? (
                <div className="px-5 py-16 text-center text-muted-foreground text-sm">{tr("tournamentsPage.noSeries")}</div>
              ) : (
                <div className="divide-y divide-border">
                  {series.map((s) => {
                    const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
                    const yr = new Date(s.end_date).getFullYear();
                    return (
                      <div key={s.id} className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-4 hover:bg-muted/20 transition-colors">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-muted overflow-hidden shrink-0">
                          {s.cover_url ? <img src={s.cover_url} alt={s.name} className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full grid place-items-center"><Trophy className="w-7 h-7 text-primary/50" /></div>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-display font-bold text-base">{s.name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {fmt(s.start_date)} – {fmt(s.end_date)}, {yr}
                            {s.location ? ` · ${s.location}` : ""}
                          </div>
                        </div>
                        <Link to={`/series/${s.id}`}>
                          <Button size="sm" variant="ghost" className="bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 font-bold tracking-wider rounded-full px-4 h-8 whitespace-nowrap">
                            {tr("tournamentsPage.viewDetails")}
                          </Button>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          ) : (
            <Card className="border border-border bg-card overflow-hidden p-0">
              {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase tracking-wider text-primary font-bold">
                          <th className="text-left px-5 py-3.5">{tr("tournamentsPage.tournamentName")}</th>
                          <th className="text-left px-3 py-3.5 hidden sm:table-cell">{tr("tournamentsPage.dateTime")}</th>
                          <th className="text-left px-3 py-3.5">{tr("tournamentsPage.buyIn")}</th>
                          <th className="text-left px-3 py-3.5 hidden md:table-cell">{tr("tournamentsPage.players")}</th>
                          <th className="text-right px-5 py-3.5">{tr("tournamentsPage.action")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageItems.length === 0 && (
                          <tr><td colSpan={5} className="px-5 py-12 text-center text-muted-foreground">{tr("tournamentsPage.noMatch")}</td></tr>
                        )}
                        {pageItems.map((t) => {
                          const nowMs = Date.now() + tick * 0; // tie to tick
                          const started = new Date(t.start_time).getTime() <= nowMs;
                          const isLive = started && !isLateRegClosed(t, nowMs);
                          const lvl = isLive ? getCurrentLevel(t, nowMs) : 0;
                          const endsIn = isLive ? formatCountdown(getLevelEndsIn(t, nowMs)) : "";
                          const mpl = t.minutes_per_level ?? 20;
                          const closeLv = t.late_reg_close_level ?? 6;
                          return (
                            <tr key={t.id} className="border-b border-border/60 hover:bg-muted/20 transition-colors align-top">
                              <td className="text-left px-5 py-4">
                                <div className="flex items-start gap-3">
                                  <span className={cn("mt-2 w-2 h-2 shrink-0 shadow-sm rounded-full", isLive ? "bg-primary animate-pulse" : "bg-primary")} />
                                  <div className="min-w-0">
                                    <Link to={`/tournament/${t.id}`} className="hover:text-primary transition-colors font-serif font-extrabold">
                                      {t.name}
                                    </Link>
                                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                      {GAME_LABEL[t.game_type ?? "nlh"]}{t.current_blinds ? ` · ${t.current_blinds} Blinds` : ""}
                                    </div>
                                    {/* Mobile-only: show date, blind info, live state and players (hidden on sm+) */}
                                    <div className="sm:hidden mt-1 space-y-0.5">
                                      <div className="text-[10px] text-muted-foreground">
                                        {formatShortDate(t.start_time)}, {formatTime(t.start_time)}
                                      </div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {tr("tournamentsPage.blindInfo", { minutes: mpl, level: closeLv })}
                                      </div>
                                      {isLive && (
                                        <div className="text-[10px] text-primary font-bold">
                                          {tr("tournamentsPage.live")} · Lv {lvl} · {endsIn}
                                        </div>
                                      )}
                                      <div className="text-[10px]">
                                        <span className="text-primary font-bold">{t.current_players}</span>
                                        <span className="text-muted-foreground"> {tr("tournamentsPage.entries")}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="text-left px-3 py-4 hidden sm:table-cell whitespace-nowrap">
                                <div>{formatShortDate(t.start_time)}, {formatTime(t.start_time)}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {tr("tournamentsPage.blindInfo", { minutes: mpl, level: closeLv })}
                                </div>
                                {isLive && (
                                  <div className="text-[10px] text-primary mt-0.5 font-bold">
                                    {tr("tournamentsPage.live")} · Lv {lvl} · {endsIn}
                                  </div>
                                )}
                              </td>
                              <td className="text-left px-3 py-4 font-display font-bold whitespace-nowrap"><FomoPrice tournament={t} compact formatter={formatBuyInShort} /></td>
                              <td className="text-left px-3 py-4 hidden md:table-cell">
                                <span className="text-primary font-bold">{t.current_players}</span>
                                <span className="text-muted-foreground text-xs"> {tr("tournamentsPage.entries")}</span>
                              </td>
                              <td className="px-5 py-4 text-right">
                                <Button
                                  size="sm"
                                  onClick={() => user ? setRegisterFor({ id: t.id, name: t.name }) : nav("/auth")}
                                  className="bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 font-bold tracking-wider rounded-full px-4 h-8"
                                  variant="ghost"
                                >
                                  {tr("tournamentsPage.register")}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs">
                    <div className="text-muted-foreground">
                      {tr("tournamentsPage.showing")} {(safePage - 1) * PAGE_SIZE + (pageItems.length ? 1 : 0)}–{(safePage - 1) * PAGE_SIZE + pageItems.length} {tr("tournamentsPage.of")} {filtered.length}
                    </div>
                    <div className="flex items-center gap-1">
                      <PageBtn disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </PageBtn>
                      {Array.from({ length: totalPages }).slice(0, 5).map((_, i) => {
                        const n = i + 1;
                        return (
                          <PageBtn key={n} active={n === safePage} onClick={() => setPage(n)}>{n}</PageBtn>
                        );
                      })}
                      <PageBtn disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </PageBtn>
                    </div>
                  </div>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
      )}

      {registerFor && (
        <TournamentRegisterModal
          tournamentId={registerFor.id}
          tournamentName={registerFor.name}
          open={!!registerFor}
          onClose={() => setRegisterFor(null)}
        />
      )}
    </div>
  );
};

const PageBtn = ({ children, active, disabled, onClick }: any) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "min-w-[28px] h-7 px-2 rounded-md text-xs font-semibold transition-colors flex items-center justify-center",
      active
        ? "bg-primary text-primary-foreground shadow-neon"
        : disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
    )}
  >
    {children}
  </button>
);

export default Tournaments;
