import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { formatVND } from "@/lib/format";
import { Search, TrendingUp, AlertCircle, Sparkles, X, ExternalLink, Users, CheckCircle2, Clock } from "lucide-react";
import { FomoPrice } from "@/components/FomoPrice";
import { TransferInstructions } from "@/components/TransferInstructions";

interface DealRow {
  id: string;
  player_id: string;
  tournament_id: string | null;
  custom_event_name: string | null;
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
  custom_event_date: string | null;
  player?: { display_name: string | null; avatar_url: string | null };
  tournament?: { name: string; start_time: string; club_id: string; buy_in: number; rake_amount?: number; free_rake_enabled?: boolean; free_rake_slots?: number; free_rake_used?: number } | null;
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

const Marketplace = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerFilter = searchParams.get("player");
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [tournaments, setTournaments] = useState<TournamentOpt[]>([]);
  const [statsByPlayer, setStatsByPlayer] = useState<Record<string, PlayerStats>>({});
  const [breakdownByDeal, setBreakdownByDeal] = useState<Record<string, DealBreakdown>>({});
  const [search, setSearch] = useState("");
  const [tournamentFilter, setTournamentFilter] = useState<string>("all");
  const [markupRange, setMarkupRange] = useState<[number, number]>([1.0, 1.5]);
  const [selected, setSelected] = useState<DealRow | null>(null);

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
    // Auto-close any deals whose registration deadline has passed before listing
    try { await supabase.rpc("auto_close_expired_deals" as any); } catch {}
    const { data, error } = await supabase
      .from("staking_deals")
      .select("*")
      .eq("admin_review_status", "approved")
      .in("status", ["listing", "committing"])
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
        ? supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", playerIds)
        : Promise.resolve({ data: [], error: null } as any),
      tournamentIds.length
        ? supabase.from("tournaments").select("id, name, start_time, club_id, buy_in, rake_amount, free_rake_enabled, free_rake_slots, free_rake_used").in("id", tournamentIds)
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

    setDeals(enriched);
    setStatsByPlayer(sMap);

    // Fetch purchase breakdown via security-definer RPC (so non-participants also see pending pct)
    const dealIds = rows.map((d) => d.id);
    const bMap: Record<string, DealBreakdown> = {};
    if (dealIds.length) {
      const { data: pData, error: pErr } = await supabase
        .rpc("get_deal_purchase_breakdown", { _deal_ids: dealIds });
      if (pErr) {
        console.error("get_deal_purchase_breakdown error", pErr);
      }
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
    // Tournament filter options from currently approved upcoming
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

  // Realtime: refresh on any change to listing deals or purchases
  useEffect(() => {
    const ch = supabase
      .channel("marketplace-deals")
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_deals" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "staking_purchases" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return deals.filter((d) => {
      const remaining = (d.percentage_sold ?? 0) - (d.filled_percent ?? 0);
      if (remaining <= 0) return false;
      // Hide deals whose linked tournament (or custom event) is past 24h — buy-in closed
      const eventTime = d.tournament?.start_time ?? d.custom_event_date ?? null;
      if (eventTime && new Date(eventTime).getTime() < cutoff) return false;
      if (playerFilter && d.player_id !== playerFilter) return false;
      if (tournamentFilter !== "all" && d.tournament_id !== tournamentFilter) return false;
      const mk = Number(d.markup);
      if (mk < markupRange[0] - 0.001 || mk > markupRange[1] + 0.001) return false;
      if (q) {
        const name = (d.player?.display_name ?? "").toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [deals, search, tournamentFilter, markupRange, playerFilter]);

  return (
    <div className="staking-scope space-y-6">
      <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-2xl md:text-3xl font-display font-bold">{t("marketplace.title")}</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("marketplace.subtitle")}{" "}
            <button onClick={() => nav("/find-backer")} className="text-primary underline underline-offset-2 hover:text-primary/80">{t("marketplace.findPlayerLink")}</button>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => nav(user ? "/staking/my-deals" : "/auth")}
            className="border-primary/40 text-primary hover:bg-primary/10"
          >
            {t("marketplace.myDealsBtn")}
          </Button>
          <Button
            onClick={() => nav(user ? "/staking/new" : "/auth")}
            className="gradient-neon text-primary-foreground font-bold tracking-wide shadow-neon"
          >
            {t("marketplace.createDealBtn")}
          </Button>
        </div>
      </header>

      {/* Filters */}
      <div className="grid gap-3 md:grid-cols-[1fr_220px_260px_auto] md:items-end p-4 rounded-xl border border-border bg-card/40">
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("marketplace.filterSearchLabel")}
          </label>
          <div className="relative mt-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("marketplace.filterSearchPh")}
              className="pl-9"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("marketplace.filterTournament")}
          </label>
          <Select value={tournamentFilter} onValueChange={setTournamentFilter}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("marketplace.filterAllTournaments")}</SelectItem>
              {tournaments.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("marketplace.filterMarkup", { from: markupRange[0].toFixed(2), to: markupRange[1].toFixed(2) })}
          </label>
          <Slider
            value={markupRange}
            min={1.0}
            max={1.5}
            step={0.05}
            onValueChange={(v) => setMarkupRange([v[0], v[1]] as [number, number])}
            className="mt-3"
          />
        </div>
        <Button variant="outline" onClick={() => { setSearch(""); setTournamentFilter("all"); setMarkupRange([1.0, 1.5]); }}>
          {t("marketplace.clearFilters")}
        </Button>
      </div>

      {/* Player filter banner */}
      {playerFilter && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-primary/40 bg-primary/10">
          <div className="flex items-center gap-2 text-sm">
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
          <Button size="sm" variant="ghost" onClick={clearPlayerFilter}>
            <X className="w-3.5 h-3.5 mr-1" /> {t("marketplace.removeFilter")}
          </Button>
        </div>
      )}

      {/* Deal list */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onDiscover={() => nav("/find-backer")} hasPlayerFilter={!!playerFilter} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              stats={statsByPlayer[d.player_id]}
              breakdown={breakdownByDeal[d.id]}
              onClick={() => setSelected(d)}
              onViewProfile={() => nav(`/player/${d.player_id}`)}
            />
          ))}
        </div>
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

const EmptyState = ({
  onDiscover,
  hasPlayerFilter,
}: {
  onDiscover: () => void;
  hasPlayerFilter: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <div className="text-center py-20 rounded-xl border border-dashed border-border bg-card/30 space-y-3">
      <TrendingUp className="w-10 h-10 mx-auto text-muted-foreground" />
      <h3 className="font-semibold">
        {hasPlayerFilter ? t("marketplace.emptyPlayerNoDeals") : t("marketplace.emptyNoMatch")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {hasPlayerFilter ? t("marketplace.emptyPlayerNoDealsHint") : t("marketplace.emptyNoMatchHint")}
      </p>
      <Button onClick={onDiscover} variant="outline" size="sm" className="mt-2">
        <Users className="w-4 h-4 mr-1.5" /> &nbsp;{t("marketplace.discoverPlayers")}
      </Button>
    </div>
  );
};

const DealCard = ({
  deal, stats, breakdown, onClick, onViewProfile,
}: { deal: DealRow; stats?: PlayerStats; breakdown?: DealBreakdown; onClick: () => void; onViewProfile: () => void }) => {
  const { t } = useTranslation();
  const initials = (deal.player?.display_name ?? "P").slice(0, 2).toUpperCase();
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("marketplace.customEvent");
  const showStats = !!stats?.verified && stats.tournaments_played > 0;
  const sold = Math.max(1, deal.percentage_sold);
  const filled = Math.min(deal.filled_percent ?? 0, sold);
  const remaining = sold - filled;
  // Per-1% price guidance
  const pricePer1Pct = (Number(deal.buy_in_amount_vnd) / 100) * Number(deal.markup);
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="cursor-pointer text-left rounded-xl border border-border bg-card hover:border-primary/60 hover:shadow-neon transition-all p-4 flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <Avatar className="w-10 h-10 ring-2 ring-primary/30">
          <AvatarImage src={deal.player?.avatar_url ?? undefined} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onViewProfile(); }}
            className="font-semibold truncate text-left hover:text-primary transition-colors inline-flex items-center gap-1 max-w-full"
            title={t("marketplace.viewProfileTitle")}
          >
            <span className="truncate">{deal.player?.display_name ?? t("marketplace.playerLabel")}</span>
            <ExternalLink className="w-3 h-3 opacity-60 shrink-0" />
          </button>
          <div className="text-xs text-muted-foreground truncate">{tournamentName}</div>
        </div>
        <span className="w-2.5 h-2.5 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success))]" title={t("marketplace.openSelling")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-primary text-primary-foreground hover:bg-primary/90">
          {t("marketplace.soldTotal", { n: deal.percentage_sold })}
        </Badge>
        <Badge variant="outline" className="border-primary/40 text-primary">
          {t("marketplace.markupX", { n: Number(deal.markup).toFixed(2) })}
        </Badge>
        {stats?.verified ? (
          <Badge variant="outline" className="border-success/40 text-success">{t("marketplace.verified")}</Badge>
        ) : (
          <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">{t("marketplace.unverified")}</Badge>
        )}
      </div>

      {/* Multi-backer progress: 2-color (funded green + pending amber) */}
      {(() => {
        const funded = Math.min(breakdown?.funded_pct ?? 0, sold);
        const pending = Math.min(breakdown?.pending_pct ?? 0, sold - funded);
        const fundedW = Math.round((funded / sold) * 100);
        const pendingW = Math.round((pending / sold) * 100);
        const fCount = breakdown?.funded_count ?? 0;
        const pCount = breakdown?.pending_count ?? 0;
        return (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t("marketplace.soldFraction")} <span className="font-semibold text-foreground">{filled}%</span> / {sold}%</span>
              <span className="text-success font-semibold">{t("marketplace.remaining", { n: remaining })}</span>
            </div>
            <div className="flex h-2 rounded-full bg-muted/60 overflow-hidden" aria-label={`Funded ${fundedW}%, pending ${pendingW}%`}>
              <div className="h-full bg-[hsl(142_76%_45%)] transition-all" style={{ width: `${fundedW}%` }} />
              <div className="h-full bg-[hsl(38_92%_55%)] transition-all" style={{ width: `${pendingW}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[hsl(142_76%_45%)]" /> {t("marketplace.confirmedCount", { n: fCount })}</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[hsl(38_92%_55%)]" /> {t("marketplace.pendingCount", { n: pCount })}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t("marketplace.minPurchaseHint", { min: deal.min_purchase_percent ?? 5, price: formatVND(Math.round(pricePer1Pct * (deal.min_purchase_percent ?? 5))) })}
            </div>
          </div>
        );
      })()}

      {showStats && (
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>ITM <span className="text-foreground font-semibold">{Number(stats!.itm_rate).toFixed(1)}%</span></span>
          <span>•</span>
          <span>ROI <span className="text-foreground font-semibold">{Number(stats!.roi_percentage).toFixed(1)}%</span></span>
          <span>•</span>
          <span>{stats!.tournaments_played} {t("marketplace.tournaments")}</span>
        </div>
      )}

      {deal.registration_deadline && (
        <RegistrationCountdown deadline={deal.registration_deadline} />
      )}

      <div className="mt-auto flex items-end justify-between pt-2 border-t border-border/60">
        <div>
          <div className="text-[11px] text-muted-foreground">{t("marketplace.pricePer1")}</div>
          <div className="text-lg font-bold text-primary">{formatVND(Math.round(pricePer1Pct))}</div>
        </div>
        <span className="text-[11px] text-primary font-semibold underline-offset-2 group-hover:underline">
          {t("marketplace.pickPercent")}
        </span>
      </div>
    </div>

  );
};

const RegistrationCountdown = ({ deadline }: { deadline: string }) => {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = new Date(deadline).getTime();
  const remaining = target - now;
  if (remaining <= 0) return null;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  if (remaining > TWO_HOURS) return null;
  const totalSec = Math.floor(remaining / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const urgent = remaining < 30 * 60 * 1000;
  return (
    <div className={`text-[11px] font-semibold flex items-center gap-1.5 px-2 py-1 rounded-md ${urgent ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}>
      <Clock className="w-3 h-3" />
      {t("marketplace.regClosesIn")} {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

  if (!deal) return null;

  const isOwn = currentUser && currentUser === deal.player_id;
  const tournamentName = deal.tournament?.name ?? deal.custom_event_name ?? t("marketplace.customEvent");
  const pricePer1Pct = (Number(deal.buy_in_amount_vnd) / 100) * Number(deal.markup);
  const totalToPay = Math.round(pricePer1Pct * percent);
  const canBuy = remaining > 0;
  const isLastSlice = remaining < minP && remaining > 0;

  const handleBuy = async () => {
    if (!currentUser) { onAuthRequired(); return; }
    if (isOwn) { toast.error(t("marketplace.cantBuyOwn")); return; }
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
      <DialogContent className="staking-scope max-w-lg max-h-[90vh] overflow-y-auto">
        {!committed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Avatar className="w-9 h-9 ring-2 ring-primary/30">
                  <AvatarImage src={deal.player?.avatar_url ?? undefined} />
                  <AvatarFallback>{(deal.player?.display_name ?? "P").slice(0,2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span>{deal.player?.display_name ?? t("marketplace.playerLabel")}</span>
              </DialogTitle>
              <DialogDescription>{tournamentName}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {stats?.verified && stats.tournaments_played > 0 ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="ITM" value={`${Number(stats.itm_rate).toFixed(1)}%`} />
                  <Stat label="ROI" value={`${Number(stats.roi_percentage).toFixed(1)}%`} />
                  <Stat label={t("marketplace.tournamentCount")} value={String(stats.tournaments_played)} />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/40 border border-border">
                  {t("marketplace.noVerifiedStats")}
                </div>
              )}

              {(() => {
                const fundedPct = Math.min(breakdown?.funded_pct ?? 0, sold);
                const pendingPct = Math.min(breakdown?.pending_pct ?? 0, Math.max(0, sold - fundedPct));
                const fW = Math.round((fundedPct / Math.max(1, sold)) * 100);
                const pW = Math.round((pendingPct / Math.max(1, sold)) * 100);
                return (
                  <div className="rounded-xl border border-border p-4 bg-card/40 space-y-3 text-sm">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{t("marketplace.soldFraction")} <b className="text-foreground">{filled}%</b> / {sold}%</span>
                      <span className="text-success font-semibold">{t("marketplace.remaining", { n: remaining })}</span>
                    </div>
                    <div className="flex h-2 rounded-full bg-muted/60 overflow-hidden">
                      <div className="h-full bg-[hsl(142_76%_45%)]" style={{ width: `${fW}%` }} />
                      <div className="h-full bg-[hsl(38_92%_55%)]" style={{ width: `${pW}%` }} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[hsl(142_76%_45%)]" /> {t("marketplace.confirmedCount", { n: breakdown?.funded_count ?? 0 })}</span>
                      <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[hsl(38_92%_55%)]" /> {t("marketplace.pendingCount", { n: breakdown?.pending_count ?? 0 })}</span>
                    </div>
                    {deal.tournament && 'buy_in' in deal.tournament && deal.tournament.buy_in != null ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{t("marketplace.buyIn")}</span>
                        <FomoPrice tournament={deal.tournament} compact />
                      </div>
                    ) : (
                      <Row k={t("marketplace.buyIn")} v={formatVND(deal.buy_in_amount_vnd)} />
                    )}
                    <Row k={t("marketplace.markupLabel")} v={`${Number(deal.markup).toFixed(2)}x`} />
                    <Row k={t("marketplace.pricePer1")} v={formatVND(Math.round(pricePer1Pct))} />
                  </div>
                );
              })()}

              {canBuy && !isOwn && (
                <div className="rounded-xl border border-primary/40 p-4 bg-primary/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
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
                        className="w-20 text-right font-bold"
                        disabled={isLastSlice}
                      />
                      <span className="text-sm font-semibold">%</span>
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
                  <div className="flex justify-between items-center pt-2 border-t border-primary/20">
                    <span className="text-xs text-muted-foreground">{t("marketplace.youPay")}</span>
                    <span className="text-xl font-bold text-primary">{formatVND(totalToPay)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {isLastSlice
                      ? t("marketplace.lastSliceMust", { n: remaining })
                      : t("marketplace.minMaxHint", { min: effectiveMin, max: remaining })}
                  </div>
                </div>
              )}

              {deal.description && (
                <div className="text-sm text-muted-foreground italic border-l-2 border-primary/40 pl-3">
                  "{deal.description}"
                </div>
              )}

              {!canBuy ? (
                <Button disabled className="w-full" size="lg">
                  {t("marketplace.soldOut")}
                </Button>
              ) : !confirming ? (
                <Button
                  className="w-full gradient-neon text-primary-foreground font-bold tracking-wide shadow-neon"
                  size="lg"
                  disabled={!!isOwn}
                  onClick={() => isOwn ? toast.error(t("marketplace.cantBuyOwn")) : setConfirming(true)}
                >
                  {isOwn ? t("marketplace.yourOwnDeal") : t("marketplace.buyAction", { pct: percent, price: formatVND(totalToPay) })}
                </Button>
              ) : (
                <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 space-y-3">
                  <div className="flex items-start gap-2 text-sm">
                    <AlertCircle className="w-4 h-4 mt-0.5 text-warning shrink-0" />
                    <span>
                      <Trans
                        i18nKey="marketplace.confirmBuyText"
                        values={{ pct: percent, price: formatVND(totalToPay) }}
                        components={{ b: <b /> }}
                      />
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)} disabled={submitting}>
                      {t("marketplace.cancel")}
                    </Button>
                    <Button
                      className="flex-1 gradient-neon text-primary-foreground font-bold"
                      onClick={handleBuy}
                      disabled={submitting}
                    >
                      {submitting ? t("marketplace.processing") : t("marketplace.confirmReserve")}
                    </Button>
                  </div>
                </div>
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

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border p-2">
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="font-semibold">{value}</div>
  </div>
);

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex items-center justify-between">
    <span className="text-muted-foreground">{k}</span>
    <span className="font-medium">{v}</span>
  </div>
);


export default Marketplace;
