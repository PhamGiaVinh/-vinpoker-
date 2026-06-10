import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { Search, TrendingUp, Sparkles, X, Users, ExternalLink, Clock, ChevronRight } from "lucide-react";
import { TransferInstructions } from "@/components/TransferInstructions";

interface DealRow {
  id: string;
  player_id: string;
  tournament_id: string | null;
  custom_event_name: string | null;
  custom_event_date: string | null;
  buy_in_amount_vnd: number;
  percentage_sold: number;
  filled_percent: number;
  min_purchase_percent: number;
  early_closed: boolean;
  markup: number;
  asking_price_vnd: number;
  status: string;
  description: string | null;
  escrow_bank_reference: string;
  created_at: string;
  registration_deadline: string | null;
  player_checked_in: boolean;
  player?: { display_name: string | null; avatar_url: string | null; verification_status: string | null };
  tournament?: { name: string; start_time: string; club_id: string; buy_in: number } | null;
}

interface PlayerStats {
  player_id: string;
  itm_rate: number;
  roi_percentage: number;
  tournaments_played: number;
  total_profit_loss: number;
  verified: boolean;
}

interface DealBreakdown {
  funded_pct: number;
  pending_pct: number;
  funded_count: number;
  pending_count: number;
}

interface TournamentOpt { id: string; name: string }

const TWO_HOURS = 2 * 60 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

const Marketplace = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerFilter = searchParams.get("player");
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [allDeals, setAllDeals] = useState<DealRow[]>([]);
  const [tournaments, setTournaments] = useState<TournamentOpt[]>([]);
  const [statsByPlayer, setStatsByPlayer] = useState<Record<string, PlayerStats>>({});
  const [breakdownByDeal, setBreakdownByDeal] = useState<Record<string, DealBreakdown>>({});
  const [search, setSearch] = useState("");
  const [tournamentFilter, setTournamentFilter] = useState<string>("all");
  const [markupRange, setMarkupRange] = useState<[number, number]>([1.0, 2.0]);
  const [verifFilter, setVerifFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("closing");
  const [selected, setSelected] = useState<DealRow | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const playerFilterName = useMemo(() => {
    if (!playerFilter) return null;
    const d = deals.find((x) => x.player_id === playerFilter);
    return d?.player?.display_name ?? null;
  }, [playerFilter, deals]);

  const clearPlayerFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("player");
    setSearchParams(next, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    try { await supabase.rpc("auto_close_expired_deals" as any); } catch { /* noop */ }

    const { data, error } = await supabase
      .from("staking_deals")
      .select("*")
      .eq("admin_review_status", "approved")
      .in("status", ["listing", "committing", "funded"])
      .eq("early_closed", false)
      .eq("player_checked_in", false)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as DealRow[];
    const playerIds = Array.from(new Set(rows.map((d) => d.player_id)));
    const tournamentIds = Array.from(new Set(rows.map((d) => d.tournament_id).filter(Boolean) as string[]));

    const [profilesRes, tourRes, statsRes] = await Promise.all([
      playerIds.length
        ? supabase.from("profiles").select("user_id, display_name, avatar_url, verification_status").in("user_id", playerIds)
        : Promise.resolve({ data: [], error: null } as any),
      tournamentIds.length
        ? supabase.from("tournaments").select("id, name, start_time, club_id, buy_in").in("id", tournamentIds)
        : Promise.resolve({ data: [], error: null } as any),
      playerIds.length
        ? supabase.from("player_stats").select("player_id, itm_rate, roi_percentage, tournaments_played, total_profit_loss, verified").in("player_id", playerIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    const profMap = new Map<string, any>((profilesRes.data ?? []).map((p: any) => [p.user_id, p]));
    const tourMap = new Map<string, any>((tourRes.data ?? []).map((t: any) => [t.id, t]));
    const sMap: Record<string, PlayerStats> = {};
    (statsRes.data ?? []).forEach((s: any) => { sMap[s.player_id] = s; });

    const enriched = rows.map((d) => ({
      ...d,
      player: profMap.get(d.player_id) ?? null,
      tournament: d.tournament_id ? tourMap.get(d.tournament_id) ?? null : null,
    }));

    setAllDeals(enriched);

    const bMap: Record<string, DealBreakdown> = {};
    const dealIds = rows.map((d) => d.id);
    if (dealIds.length) {
      const { data: pData } = await supabase.rpc("get_deal_purchase_breakdown", { _deal_ids: dealIds });
      (pData ?? []).forEach((row: any) => {
        bMap[row.deal_id] = {
          funded_pct: Number(row.funded_pct ?? 0),
          pending_pct: Number(row.pending_pct ?? 0),
          funded_count: Number(row.funded_count ?? 0),
          pending_count: Number(row.pending_count ?? 0),
        };
      });
    }

    setBreakdownByDeal(bMap);
    setStatsByPlayer(sMap);

    const { data: allT } = await supabase
      .from("tournaments")
      .select("id, name")
      .gt("start_time", new Date().toISOString())
      .order("start_time", { ascending: true })
      .limit(50);
    setTournaments((allT ?? []) as TournamentOpt[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel("marketplace-deals")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_purchases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const { availableDeals, soldDeals } = useMemo(() => {
    const avail: DealRow[] = [];
    const sold: DealRow[] = [];
    const cutoff = now - DAY_MS;
    for (const d of allDeals) {
      const remaining = (d.percentage_sold ?? 0) - (d.filled_percent ?? 0);
      const eventTime = d.tournament?.start_time ?? d.custom_event_date ?? null;
      if (eventTime && new Date(eventTime).getTime() < cutoff) continue;
      if (remaining <= 0) { sold.push(d); continue; }
      avail.push(d);
    }
    return { availableDeals: avail, soldDeals: sold };
  }, [allDeals, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return availableDeals.filter((d) => {
      if (playerFilter && d.player_id !== playerFilter) return false;
      if (tournamentFilter !== "all" && d.tournament_id !== tournamentFilter) return false;
      const mk = Number(d.markup);
      if (mk < markupRange[0] - 0.001 || mk > markupRange[1] + 0.001) return false;
      const verified = d.player?.verification_status === "verified";
      if (verifFilter === "verified" && !verified) return false;
      if (verifFilter === "unverified" && verified) return false;
      if (q) {
        const name = (d.player?.display_name ?? "").toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === "roi") {
        const aRoi = statsByPlayer[a.player_id]?.roi_percentage ?? 0;
        const bRoi = statsByPlayer[b.player_id]?.roi_percentage ?? 0;
        return bRoi - aRoi;
      }
      const aDeadline = resolveDeadline(a);
      const bDeadline = resolveDeadline(b);
      return (aDeadline?.getTime() ?? Infinity) - (bDeadline?.getTime() ?? Infinity);
    });
  }, [availableDeals, search, tournamentFilter, markupRange, verifFilter, sortBy, playerFilter, statsByPlayer]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="font-bebas text-4xl md:text-5xl tracking-[0.05em] text-primary leading-none">
            {t("marketplace.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl font-sans">
            {t("marketplace.subtitle")}{" "}
            <button onClick={() => nav("/find-backer")} className="text-primary underline underline-offset-2 hover:text-primary/80">
              {t("marketplace.findPlayerLink")}
            </button>.
          </p>
          {/* Chronograph divider */}
          <div className="flex items-center gap-2 mt-4">
            <div className="flex-1 h-[1px] bg-[#10B981]" />
            <div className="w-2 h-2 bg-[#10B981] rotate-45 shrink-0" />
            <div className="flex-1 h-[1px] bg-[#10B981]" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => nav(user ? "/staking/my-deals" : "/auth")}
            className="border-[#1F1F1F] text-foreground hover:bg-[#1F1F1F] hover:text-primary font-sans rounded-none h-10 px-5"
          >
            {t("marketplace.myDealsBtn")}
          </Button>
          <Button
            onClick={() => nav(user ? "/staking/new" : "/auth")}
            className="bg-[#10B981] hover:bg-[#059669] text-black font-bold font-jetbrains tracking-wider rounded-none h-10 px-5"
          >
            {t("marketplace.createDealBtn")}
          </Button>
        </div>
      </header>

      {/* Filter bar */}
      <div className="grid gap-3 md:grid-cols-[1fr_180px_200px_160px_140px] items-end bg-[#121212] border border-[#1F1F1F] p-4">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-sans">
            {t("marketplace.filterSearchLabel")}
          </label>
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("marketplace.filterSearchPh")}
              className="pl-9 bg-transparent border-[#1F1F1F] rounded-none h-9 text-sm font-sans"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-sans">
            {t("marketplace.filterTournament")}
          </label>
          <Select value={tournamentFilter} onValueChange={setTournamentFilter}>
            <SelectTrigger className="mt-1 bg-transparent border-[#1F1F1F] rounded-none h-9 font-sans">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-[#1F1F1F] bg-[#121212]">
              <SelectItem value="all" className="font-sans">{t("marketplace.filterAllTournaments")}</SelectItem>
              {tournaments.map((t) => (
                <SelectItem key={t.id} value={t.id} className="font-sans">{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-sans">
            {t("marketplace.filterMarkup", { from: markupRange[0].toFixed(2), to: markupRange[1].toFixed(2) })}
          </label>
          <Slider
            value={markupRange}
            min={1.0}
            max={2.0}
            step={0.05}
            onValueChange={(v) => setMarkupRange([v[0], v[1]] as [number, number])}
            className="mt-3"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-sans">
            {t("marketplace.filterVerified")}
          </label>
          <Select value={verifFilter} onValueChange={setVerifFilter}>
            <SelectTrigger className="mt-1 bg-transparent border-[#1F1F1F] rounded-none h-9 font-sans">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-[#1F1F1F] bg-[#121212]">
              <SelectItem value="all" className="font-sans">{t("marketplace.filterAllVerified")}</SelectItem>
              <SelectItem value="verified" className="font-sans">{t("marketplace.filterVerifiedOnly")}</SelectItem>
              <SelectItem value="unverified" className="font-sans">{t("marketplace.filterUnverifiedOnly")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold font-sans">
            {t("marketplace.filterSort")}
          </label>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="mt-1 bg-transparent border-[#1F1F1F] rounded-none h-9 font-sans">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-[#1F1F1F] bg-[#121212]">
              <SelectItem value="closing" className="font-sans">{t("marketplace.sortClosing")}</SelectItem>
              <SelectItem value="roi" className="font-sans">{t("marketplace.sortRoi")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Player filter banner */}
      {playerFilter && (
        <div className="flex items-center justify-between gap-3 p-3 border border-[#1F1F1F] bg-[#121212]">
          <div className="flex items-center gap-2 text-sm font-sans">
            <Users className="w-4 h-4 text-primary" />
            <span>
              {t("marketplace.viewingDealsOf")}{" "}
              <span className="font-semibold text-primary">
                {playerFilterName ?? t("marketplace.thisPlayer")}
              </span>
              {filtered.length > 0 && (
                <span className="text-muted-foreground"> · {t("marketplace.dealCount", { n: filtered.length })}</span>
              )}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={clearPlayerFilter} className="font-sans">
            <X className="w-3.5 h-3.5 mr-1" /> {t("marketplace.removeFilter")}
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-[#121212] border border-[#1F1F1F] p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-full bg-[#1F1F1F] animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[#1F1F1F] animate-pulse w-2/3" />
                  <div className="h-3 bg-[#1F1F1F] animate-pulse w-1/2" />
                </div>
              </div>
              <div className="h-3 bg-[#1F1F1F] animate-pulse w-1/4 mb-3" />
              <div className="h-2 bg-[#1F1F1F] animate-pulse mb-3" />
              <div className="h-3 bg-[#1F1F1F] animate-pulse w-1/3 mb-4" />
              <div className="h-10 bg-[#1F1F1F] animate-pulse" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 && soldDeals.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-[#1F1F1F] bg-[#121212] space-y-3">
          <TrendingUp className="w-10 h-10 mx-auto text-muted-foreground" />
          <h3 className="font-semibold font-sans">
            {playerFilter ? t("marketplace.emptyPlayerNoDeals") : t("marketplace.emptyNoMatch")}
          </h3>
          <p className="text-sm text-muted-foreground font-sans">
            {playerFilter ? t("marketplace.emptyPlayerNoDealsHint") : t("marketplace.emptyNoMatchHint")}
          </p>
          {!playerFilter && (
            <Button onClick={() => nav("/find-backer")} variant="outline" size="sm" className="mt-2 border-[#1F1F1F] rounded-none font-sans">
              <Users className="w-4 h-4 mr-1.5" /> {t("marketplace.discoverPlayers")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Active deals grid */}
          {filtered.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((d) => (
                <DealCard
                  key={d.id}
                  deal={d}
                  stats={statsByPlayer[d.player_id]}
                  breakdown={breakdownByDeal[d.id]}
                  onClick={() => setSelected(d)}
                  onViewProfile={() => nav(`/player/${d.player_id}`)}
                  now={now}
                />
              ))}
            </div>
          )}

          {/* Sold-out section */}
          {soldDeals.length > 0 && (
            <div className="space-y-4 pt-6 border-t border-[#1F1F1F]">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-[1px] bg-muted-foreground/30" />
                <h2 className="font-bebas text-xl tracking-[0.04em] text-muted-foreground">
                  {t("marketplace.soldOutSection")}
                </h2>
                <div className="flex-1 h-[1px] bg-muted-foreground/30" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {soldDeals.slice(0, 6).map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    stats={statsByPlayer[d.player_id]}
                    breakdown={breakdownByDeal[d.id]}
                    onClick={() => {}}
                    onViewProfile={() => nav(`/player/${d.player_id}`)}
                    sold
                    now={now}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <DealDetailDialog
        deal={selected}
        stats={selected ? statsByPlayer[selected.player_id] : undefined}
        breakdown={selected ? breakdownByDeal[selected.id] : undefined}
        onClose={() => setSelected(null)}
        onPurchased={() => { setSelected(null); load(); }}
        currentUser={user?.id ?? null}
        onAuthRequired={() => { setSelected(null); nav("/auth"); }}
      />
    </div>
  );
};

function resolveDeadline(deal: DealRow): Date | null {
  if (deal.registration_deadline) return new Date(deal.registration_deadline);
  if (deal.tournament?.start_time) return new Date(new Date(deal.tournament.start_time).getTime() - ONE_HOUR);
  return new Date(new Date(deal.created_at).getTime() + DAY_MS);
}

const DealCard = ({
  deal, stats, breakdown, onClick, onViewProfile, sold, now,
}: {
  deal: DealRow; stats?: PlayerStats; breakdown?: DealBreakdown; onClick: () => void;
  onViewProfile: () => void; sold?: boolean; now: number;
}) => {
  const { t } = useTranslation();
  const initials = (deal.player?.display_name ?? "P").slice(0, 2).toUpperCase();
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("marketplace.customEvent");
  const soldPct = deal.percentage_sold;
  const filledPct = Math.min(deal.filled_percent ?? 0, soldPct);
  const remaining = soldPct - filledPct;
  const pricePer1Pct = (Number(deal.buy_in_amount_vnd) / 100) * Number(deal.markup);
  const verified = deal.player?.verification_status === "verified";

  const fundedPct = Math.min(breakdown?.funded_pct ?? 0, soldPct);
  const pendingPct = Math.min(breakdown?.pending_pct ?? 0, soldPct - fundedPct);
  const fundedW = Math.round((fundedPct / Math.max(1, soldPct)) * 100);
  const pendingW = Math.round((pendingPct / Math.max(1, soldPct)) * 100);

  const deadline = resolveDeadline(deal);
  const remainingMs = deadline ? deadline.getTime() - now : null;
  const showCountdown = remainingMs !== null && remainingMs > 0 && remainingMs <= TWO_HOURS;
  const isCritical = remainingMs !== null && remainingMs < THIRTY_MIN;
  const isUrgent = remainingMs !== null && remainingMs < TWO_HOURS && remainingMs >= THIRTY_MIN;

  const totalSec = remainingMs !== null ? Math.floor(remainingMs / 1000) : 0;
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  return (
    <div
      onClick={sold ? undefined : onClick}
      className={`bg-[#121212] border ${sold ? "border-[#1F1F1F] opacity-50" : "border-[#1F1F1F] hover:border-[#333] hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] cursor-pointer"} transition-all p-5 flex flex-col gap-3`}
    >
      {/* Player row */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full overflow-hidden border border-[#1F1F1F] bg-[#1F1F1F] shrink-0">
          {deal.player?.avatar_url ? (
            <img src={deal.player.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">
              {initials}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onViewProfile(); }}
              className="font-bebas text-lg leading-none truncate text-left hover:text-primary transition-colors"
            >
              {deal.player?.display_name ?? t("marketplace.playerLabel")}
            </button>
            {verified && (
              <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" title={t("marketplace.verified")} />
            )}
            {!verified && (
              <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" title={t("marketplace.unverified")} />
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate font-sans mt-0.5">{tournamentName}</div>
        </div>
      </div>

      {/* Markup tag */}
      <div className="inline-flex self-start items-center gap-1 border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
        <span className="font-jetbrains text-sm text-emerald-400">{Number(deal.markup).toFixed(2)}x</span>
        <span className="text-[10px] text-emerald-400/70 font-sans">{t("marketplace.markupLabel")}</span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-jetbrains text-muted-foreground">
          <span>{t("marketplace.sold")}: <span className="text-foreground font-semibold">{filledPct}%</span></span>
          <span className="text-[#10B981]">{t("marketplace.remaining")}: {remaining}%</span>
        </div>
        <div className="flex h-1.5 bg-[#1F1F1F] overflow-hidden">
          <div className="h-full bg-[#10B981] transition-all" style={{ width: `${fundedW}%` }} />
          <div className="h-full bg-amber-500/60 transition-all" style={{ width: `${pendingW}%` }} />
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1F1F1F]">
        <div className="text-center">
          <div className="font-jetbrains text-xs text-foreground">{filledPct}%</div>
          <div className="text-[10px] text-muted-foreground font-sans">{t("marketplace.sold")}</div>
        </div>
        <div className="text-center">
          <div className="font-jetbrains text-xs text-foreground">{remaining}%</div>
          <div className="text-[10px] text-muted-foreground font-sans">{t("marketplace.remaining")}</div>
        </div>
        <div className="text-center">
          <div className="font-jetbrains text-xs text-[#10B981]">{formatVND(Math.round(pricePer1Pct))}</div>
          <div className="text-[10px] text-muted-foreground font-sans">{t("marketplace.pricePer1")}</div>
        </div>
      </div>

      {/* Countdown */}
      {showCountdown && (
        <div className={`font-jetbrains text-xs text-center py-1.5 border ${isCritical ? "bg-red-500/10 border-red-500/20 text-red-400" : isUrgent ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-muted/10 border-[#1F1F1F] text-muted-foreground"}`}>
          <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
          {t("marketplace.regClosesIn")} {String(hrs).padStart(2, "0")}:{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>
      )}

      {/* CTA */}
      {sold ? (
        <div className="w-full py-2.5 text-center text-xs font-jetbrains tracking-wider text-muted-foreground border border-[#1F1F1F]">
          {t("marketplace.soldOut")}
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-bold font-jetbrains tracking-wider py-2.5 text-sm transition-colors"
        >
          {t("marketplace.buyActionShort")} <ChevronRight className="w-4 h-4 inline -mt-0.5" />
        </button>
      )}
    </div>
  );
};

const DealDetailDialog = ({
  deal, stats, breakdown, onClose, onPurchased, currentUser, onAuthRequired,
}: {
  deal: DealRow | null;
  stats?: PlayerStats;
  breakdown?: DealBreakdown;
  onClose: () => void;
  onPurchased: () => void;
  currentUser: string | null;
  onAuthRequired: () => void;
}) => {
  const { t } = useTranslation();
  const sold = deal?.percentage_sold ?? 0;
  const filled = deal?.filled_percent ?? 0;
  const remaining = Math.max(0, sold - filled);
  const minP = deal?.min_purchase_percent ?? 5;
  const effectiveMin = Math.min(minP, remaining);
  const initialPercent = Math.min(remaining, Math.max(effectiveMin, Math.min(10, remaining)));

  const [percent, setPercent] = useState<number>(initialPercent || effectiveMin);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [committed, setCommitted] = useState<{
    purchaseId: string; amount: number; reference: string; committedAt: string;
  } | null>(null);

  useEffect(() => {
    if (!deal) {
      setConfirming(false);
      setCommitted(null);
      return;
    }
    setPercent(Math.min(remaining, Math.max(effectiveMin, Math.min(10, remaining))) || effectiveMin);
  }, [deal?.id]);

  if (!deal) return null;

  const isOwn = currentUser && currentUser === deal.player_id;
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("marketplace.customEvent");
  const pricePer1Pct = (Number(deal.buy_in_amount_vnd) / 100) * Number(deal.markup);
  const totalToPay = Math.round(pricePer1Pct * percent);
  const canBuy = remaining > 0 && !isOwn;
  const isLastSlice = remaining < minP && remaining > 0;

  const fundedPct = Math.min(breakdown?.funded_pct ?? 0, sold);
  const pendingPct = Math.min(breakdown?.pending_pct ?? 0, Math.max(0, sold - fundedPct));
  const fundedW = Math.round((fundedPct / Math.max(1, sold)) * 100);
  const pendingW = Math.round((pendingPct / Math.max(1, sold)) * 100);

  const handleBuy = async () => {
    if (!currentUser) { onAuthRequired(); return; }
    if (percent < effectiveMin || percent > remaining) {
      toast.error(t("marketplace.pickRange", { min: effectiveMin, max: remaining })); return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("staking-commit-deal", {
        body: { deal_id: deal.id, percent },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let body: any = null;
        try { body = ctx ? await ctx.json() : null; } catch { /* noop */ }
        if (body?.code === "MISSING_BANK_ACCOUNT") {
          toast.error(body.error, {
            action: { label: t("marketplace.openProfile"), onClick: () => { window.location.href = "/account"; } },
          });
          return;
        }
        throw new Error(body?.error || error.message);
      }
      const d = data as any;
      if (d?.error) {
        if (d?.code === "MISSING_BANK_ACCOUNT") {
          toast.error(d.error, {
            action: { label: t("marketplace.openProfile"), onClick: () => { window.location.href = "/account"; } },
          });
          return;
        }
        throw new Error(d.error);
      }
      toast.success(t("marketplace.reservedToast", { pct: percent }));
      setCommitted({
        purchaseId: d.purchase_id,
        amount: d.amount_vnd,
        reference: d.reference_code,
        committedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      toast.error(e.message ?? t("marketplace.cantReserve"));
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  return (
    <Dialog open={!!deal} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-[#0A0A0A] border border-[#1F1F1F] max-w-lg max-h-[90vh] overflow-y-auto">
        {!committed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 font-bebas text-2xl tracking-[0.03em]">
                <div className="w-10 h-10 rounded-full overflow-hidden border border-[#1F1F1F] bg-[#1F1F1F] shrink-0">
                  {deal.player?.avatar_url ? (
                    <img src={deal.player.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {(deal.player?.display_name ?? "P").slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <span>{deal.player?.display_name ?? t("marketplace.playerLabel")}</span>
              </DialogTitle>
              <DialogDescription className="font-sans text-muted-foreground">{tournamentName}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 font-sans">
              {/* Stats */}
              {stats?.verified && stats.tournaments_played > 0 ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="border border-[#1F1F1F] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">ITM</div>
                    <div className="font-semibold font-jetbrains">{Number(stats.itm_rate).toFixed(1)}%</div>
                  </div>
                  <div className="border border-[#1F1F1F] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">ROI</div>
                    <div className="font-semibold font-jetbrains">{Number(stats.roi_percentage).toFixed(1)}%</div>
                  </div>
                  <div className="border border-[#1F1F1F] p-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-sans">{t("marketplace.tournamentCount")}</div>
                    <div className="font-semibold font-jetbrains">{stats.tournaments_played}</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground p-3 border border-[#1F1F1F] bg-[#0A0A0A] font-sans">
                  {t("marketplace.noVerifiedStats")}
                </div>
              )}

              {/* Deal breakdown */}
              <div className="border border-[#1F1F1F] p-4 space-y-3">
                <div className="flex justify-between text-xs text-muted-foreground font-sans">
                  <span>{t("marketplace.soldFraction")} <strong className="text-foreground font-jetbrains">{filled}%</strong> / {sold}%</span>
                  <span className="text-[#10B981] font-semibold font-jetbrains">{t("marketplace.remaining", { n: remaining })}</span>
                </div>
                <div className="flex h-1.5 bg-[#1F1F1F] overflow-hidden">
                  <div className="h-full bg-[#10B981]" style={{ width: `${fundedW}%` }} />
                  <div className="h-full bg-amber-500/60" style={{ width: `${pendingW}%` }} />
                </div>
                <div className="flex items-center justify-between text-xs font-jetbrains">
                  <span className="text-muted-foreground">{t("marketplace.markupLabel")}</span>
                  <span className="font-semibold text-emerald-400">{Number(deal.markup).toFixed(2)}x</span>
                </div>
                <div className="flex items-center justify-between text-xs font-jetbrains">
                  <span className="text-muted-foreground">{t("marketplace.pricePer1")}</span>
                  <span className="font-semibold">{formatVND(Math.round(pricePer1Pct))}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-jetbrains">
                  <span className="text-muted-foreground">{t("marketplace.buyIn")}</span>
                  <span className="font-semibold">{formatVND(deal.buy_in_amount_vnd)}</span>
                </div>
              </div>

              {/* Buy section */}
              {canBuy && (
                <div className="border border-[#10B981]/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold font-sans">
                      {t("marketplace.buyHowMany")}
                    </label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={effectiveMin}
                        max={remaining}
                        value={percent}
                        onChange={(e) => {
                          const v = Math.floor(Number(e.target.value));
                          if (Number.isFinite(v)) setPercent(Math.max(effectiveMin, Math.min(remaining, v)));
                        }}
                        className="w-20 text-right font-bold font-jetbrains bg-transparent border-[#1F1F1F] rounded-none h-9 text-sm"
                        disabled={isLastSlice}
                      />
                      <span className="text-sm font-semibold font-jetbrains">%</span>
                    </div>
                  </div>
                  {!isLastSlice && (
                    <Slider
                      value={[percent]}
                      min={effectiveMin}
                      max={remaining}
                      step={1}
                      onValueChange={(v) => setPercent(v[0])}
                    />
                  )}
                  <div className="flex justify-between items-center pt-2 border-t border-[#10B981]/20">
                    <span className="text-xs text-muted-foreground font-sans">{t("marketplace.youPay")}</span>
                    <span className="text-xl font-bold font-jetbrains text-[#10B981]">{formatVND(totalToPay)}</span>
                  </div>
                  {deal.description && (
                    <div className="text-xs text-muted-foreground italic border-l-2 border-[#10B981]/40 pl-3 font-sans">
                      &ldquo;{deal.description}&rdquo;
                    </div>
                  )}
                  {!confirming ? (
                    <Button
                      className="w-full bg-[#10B981] hover:bg-[#059669] text-black font-bold font-jetbrains tracking-wider rounded-none h-11"
                      onClick={() => setConfirming(true)}
                    >
                      {t("marketplace.buyAction", { pct: percent, price: formatVND(totalToPay) })}
                    </Button>
                  ) : (
                    <div className="border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                      <div className="flex items-start gap-2 text-sm font-sans">
                        <Sparkles className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
                        <span>
                          <Trans
                            i18nKey="marketplace.confirmBuyText"
                            values={{ pct: percent, price: formatVND(totalToPay) }}
                            components={{ b: <b /> }}
                          />
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" className="flex-1 border-[#1F1F1F] rounded-none font-sans" onClick={() => setConfirming(false)} disabled={submitting}>
                          {t("marketplace.cancel")}
                        </Button>
                        <Button
                          className="flex-1 bg-[#10B981] hover:bg-[#059669] text-black font-bold font-jetbrains tracking-wider rounded-none"
                          onClick={handleBuy}
                          disabled={submitting}
                        >
                          {submitting ? t("marketplace.processing") : t("marketplace.confirmReserve")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sold out state */}
              {(!canBuy || isOwn) && (
                <Button disabled className="w-full bg-[#1F1F1F] text-muted-foreground font-sans rounded-none h-11 cursor-not-allowed border border-[#1F1F1F]">
                  {isOwn ? t("marketplace.yourOwnDeal") : t("marketplace.soldOut")}
                </Button>
              )}
            </div>
          </>
        ) : (
          <TransferInstructions
            purchaseId={committed.purchaseId}
            dealId={deal.id}
            amount={committed.amount}
            reference={committed.reference}
            committedAt={committed.committedAt}
            onMarkedTransferred={onPurchased}
            onCancel={onPurchased}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

export default Marketplace;
