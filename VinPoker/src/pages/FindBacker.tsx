import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatVND, formatDateTime } from "@/lib/format";
import { Search, TrendingUp, TrendingDown, Sparkles, ShieldCheck, ShieldAlert, ArrowRight, Wallet, Users, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

/* ============================================================== *
 * Types                                                          *
 * ============================================================== */

interface Row {
  player_id: string;
  tournaments_played: number;
  itm_rate: number;
  roi_percentage: number;
  avg_finish: number;
  current_streak: number;
  looking_for_backing: boolean;
  backing_description: string | null;
  backing_percentage_available: number | null;
  verified: boolean;
  last_20_results: any[];
  display_name?: string;
  region?: string;
  avatar_url?: string | null;
  open_deals?: number;
  created_at?: string;
}

interface PortfolioItem {
  id: string;
  deal_id: string;
  percent: number;
  amount: number;
  status: string;
  created_at: string;
  deal: {
    id: string;
    custom_event_name: string | null;
    buy_in_amount_vnd: number;
    markup: number;
    filled_percent: number;
    status: string;
    player_id: string;
    result_prize_vnd: number | null;
    backer_payout_vnd: number | null;
    player_checked_in: boolean;
    player_busted_out: boolean;
    result_entered_at: string | null;
    payout_executed_at: string | null;
    player?: { display_name: string | null };
  } | null;
}

/* ============================================================== *
 * Main Component                                                 *
 * ============================================================== */

const FindBacker = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [section, setSection] = useState<string>("players");

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-background px-6 py-12 md:px-10 md:py-16">
        {/* Decorative glow effects */}
        <div className="pointer-events-none absolute -top-20 -left-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 w-80 h-80 rounded-full bg-primary/10 blur-[120px]" />

        {/* Content */}
        <div className="relative z-10 space-y-4">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 backdrop-blur-sm w-fit">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-bold tracking-[0.28em] uppercase text-primary">{t('findBacker.badge')}</span>
          </div>

          {/* Title */}
          <h1 className="font-display text-5xl md:text-7xl tracking-[0.04em] text-primary leading-[0.9] drop-shadow-[0_0_24px_hsl(var(--primary)/0.35)]">
            FIND POKER PLAYERS
          </h1>

          {/* Subtitle */}
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl">
            {t("findBacker.subtitle")}
          </p>

          {/* Chronograph divider */}
          <div className="flex items-center gap-2 pt-2 max-w-md">
            <div className="flex-1 h-[1px] bg-primary/60" />
            <div className="w-2 h-2 bg-primary rotate-45 shrink-0 shadow-[0_0_8px_hsl(var(--primary))]" />
            <div className="flex-1 h-[1px] bg-primary/30" />
          </div>
        </div>
      </div>

      <Tabs value={section} onValueChange={setSection} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="portfolio">{t("findBacker.myPortfolio")}</TabsTrigger>
          <TabsTrigger value="backed">{t("findBacker.currentlyBacked")}</TabsTrigger>
          <TabsTrigger value="players">{t("findBacker.findPlayers")}</TabsTrigger>
        </TabsList>

        <TabsContent value="portfolio" className="mt-4">
          {user ? <PortfolioSection userId={user.id} /> : <LoginPrompt />}
        </TabsContent>

        <TabsContent value="backed" className="mt-4">
          {user ? <CurrentlyBackedSection userId={user.id} /> : <LoginPrompt />}
        </TabsContent>

        <TabsContent value="players" className="mt-4">
          <FindPlayersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
};

/* ============================================================== *
 * Login Prompt                                                    *
 * ============================================================== */

function LoginPrompt() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <Card className="p-10 text-center">
      <Wallet className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
      <p className="text-muted-foreground">{t("account.notSignedIn")}</p>
      <Button className="mt-4 gradient-neon" onClick={() => nav("/auth")}>
        {t("account.signIn")}
      </Button>
    </Card>
  );
}

/* ============================================================== *
 * Section A: Portfolio                                            *
 * ============================================================== */

function PortfolioSection({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [items, setItems] = useState<PortfolioItem[] | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("staking_purchases")
      .select(`id, deal_id, percent, amount, status, created_at,
        deal:staking_deals(
          id, custom_event_name, buy_in_amount_vnd, markup, filled_percent,
          status, player_id, result_prize_vnd, backer_payout_vnd,
          player_checked_in, player_busted_out, result_entered_at, payout_executed_at
        )`)
      .eq("backer_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data) { setItems([]); return; }

    const playerIds = Array.from(new Set(data.map((r: any) => r.deal?.player_id).filter(Boolean)));
    let pmap: Record<string, any> = {};
    if (playerIds.length) {
      const { data: ps } = await supabase.from("profiles").select("user_id, display_name").in("user_id", playerIds);
      pmap = Object.fromEntries((ps ?? []).map((p: any) => [p.user_id, p]));
    }
    setItems(data.map((r: any) => ({
      ...r,
      deal: r.deal ? { ...r.deal, player: pmap[r.deal.player_id] ?? null } : null,
    })));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (filter === "active") return items.filter((i) => i.deal && ["funded", "result_entered", "result_verified", "release_requested"].includes(i.deal.status));
    if (filter === "completed") return items.filter((i) => i.deal && ["completed", "released"].includes(i.deal.status));
    return items;
  }, [items, filter]);

  if (items === null) return <Skeleton className="h-40 rounded-xl" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {t("activeDeals", { n: items.filter((i) => i.status === "funded").length })}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>
            {t("common.all")}
          </Button>
          <Button size="sm" variant={filter === "active" ? "default" : "outline"} onClick={() => setFilter("active")}>
            {t("myDeals.tabC")}
          </Button>
          <Button size="sm" variant={filter === "completed" ? "default" : "outline"} onClick={() => setFilter("completed")}>
            {t("myDeals.tabE")}
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Wallet className="w-10 h-10 mx-auto mb-2" />
          <p>{t("findBacker.noActiveBacking")}</p>
          <Button size="sm" className="mt-3" onClick={() => nav("/marketplace")}>
            {t("marketplace.title")} <ExternalLink className="w-3.5 h-3.5 ml-1" />
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <Card key={item.id} className="bg-[#121212] border border-[#1F1F1F] rounded-none hover:border-primary/40 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold truncate">
                    {item.deal?.custom_event_name ?? "—"}
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {item.deal?.status ?? item.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">{t("myDeals.pctSold")}:</span>
                    <span className="ml-1 font-mono">{item.percent}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("stakingNew.markupLbl", { n: "" })}:</span>
                    <span className="ml-1 font-mono">{item.deal?.markup ?? "—"}x</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("marketplace.buyIn")}:</span>
                    <span className="ml-1 font-mono">{item.deal ? formatVND(item.deal.buy_in_amount_vnd) : "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t("portfolio.youPay")}:</span>
                    <span className="ml-1 font-mono">{formatVND(item.amount)}</span>
                  </div>
                </div>
                {item.deal?.status === "completed" || item.deal?.status === "released" ? (
                  <div className="flex items-center justify-between pt-2 border-t border-[#1F1F1F]">
                    <span className="text-xs text-muted-foreground">P&L:</span>
                    <span className={`text-sm font-bold font-mono ${(item.deal?.backer_payout_vnd ?? 0) >= item.amount ? "text-success" : "text-destructive"}`}>
                      {item.deal?.backer_payout_vnd ? formatVND(item.deal.backer_payout_vnd - item.amount) : "—"}
                    </span>
                  </div>
                ) : item.deal?.player_busted_out ? (
                  <div className="pt-2 border-t border-[#1F1F1F] text-xs text-destructive">
                    {t("notifications.player_busted_out")}
                  </div>
                ) : (
                  <div className="pt-2 border-t border-[#1F1F1F] text-xs text-muted-foreground">
                    {item.deal?.player_checked_in
                      ? `✅ ${t("portfolio.checkedIn")}`
                      : `⏳ ${t("myDeals.waitCheckIn")}`}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================== *
 * Section B: Currently Backed                                      *
 * ============================================================== */

function CurrentlyBackedSection({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [deals, setDeals] = useState<any[] | null>(null);

  const load = useCallback(async () => {
    const { data: purchases } = await supabase
      .from("staking_purchases")
      .select("deal_id, percent, amount, deal:staking_deals!inner(id, club_id, status, player_checked_in, admin_review_status)")
      .eq("backer_id", userId)
      .eq("status", "funded");
    if (!purchases || purchases.length === 0) { setDeals([]); return; }

    const dealIds = purchases.map((p: any) => p.deal_id);
    const { data: dealsData } = await supabase
      .from("staking_deals")
      .select(`id, custom_event_name, club_id, buy_in_amount_vnd, markup, filled_percent, status,
        player_id, result_prize_vnd, backer_payout_vnd, player_checked_in, player_busted_out,
        result_entered_at, payout_executed_at,
        player:profiles!staking_deals_player_id_fkey(display_name)`)
      .in("id", dealIds)
      .in("status", ["funded", "result_entered", "result_verified", "release_requested"])
      .eq("player_checked_in", true)
      .eq("admin_review_status", "approved");

    if (!dealsData) { setDeals([]); return; }

    const pMap = Object.fromEntries(purchases.map((p: any) => [p.deal_id, p]));
    setDeals(dealsData.map((d: any) => ({ ...d, purchase: pMap[d.id] ?? null })));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("backed-deals")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "staking_deals" },
        () => load())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "staking_purchases", filter: `backer_id=eq.${userId}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  if (deals === null) return <Skeleton className="h-40 rounded-xl" />;

  if (deals.length === 0) {
    return (
      <Card className="p-10 text-center text-muted-foreground">
        <Users className="w-10 h-10 mx-auto mb-2" />
        <p>{t("findBacker.noActiveBacking")}</p>
        <Button size="sm" className="mt-3" onClick={() => nav("/marketplace")}>
          {t("marketplace.title")} <ExternalLink className="w-3.5 h-3.5 ml-1" />
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {deals.map((deal) => {
        const pnl = deal.backer_payout_vnd != null ? deal.backer_payout_vnd - (deal.purchase?.amount ?? 0) : null;
        return (
          <Card key={deal.id} className="bg-[#121212] border border-[#1F1F1F] rounded-none hover:border-primary/40 transition-colors">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold truncate">
                  {deal.custom_event_name ?? "—"}
                </div>
                <Badge variant="outline" className="text-[10px]">{deal.status}</Badge>
              </div>

              <div className="text-xs text-muted-foreground">
                {t("playerProfile.asPlayer")}: {deal.player?.display_name ?? "—"}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">{t("marketplace.buyIn")}:</span>
                  <span className="ml-1 font-mono">{formatVND(deal.buy_in_amount_vnd)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("marketplace.soldFraction")}:</span>
                  <span className="ml-1 font-mono">{deal.filled_percent}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("portfolio.ownPct")}:</span>
                  <span className="ml-1 font-mono">{deal.purchase?.percent ?? "—"}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t("myDeals.backerPays")}:</span>
                  <span className="ml-1 font-mono">{deal.purchase ? formatVND(deal.purchase.amount) : "—"}</span>
                </div>
              </div>

              {deal.player_busted_out ? (
                <div className="pt-2 border-t border-[#1F1F1F] text-xs text-destructive">
                  {t("notifications.player_busted_out")}
                </div>
              ) : pnl !== null ? (
                <div className="flex items-center justify-between pt-2 border-t border-[#1F1F1F]">
                  <span className="text-xs text-muted-foreground">P&L:</span>
                  <span className={`text-sm font-bold font-mono ${pnl >= 0 ? "text-success" : "text-destructive"}`}>
                    {pnl >= 0 ? "+" : ""}{formatVND(pnl)}
                  </span>
                </div>
              ) : (
                <div className="pt-2 border-t border-[#1F1F1F] text-xs text-muted-foreground">
                  ✅ {t("portfolio.checkedIn")}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ============================================================== *
 * Section C: Find Players (existing code)                          *
 * ============================================================== */

function FindPlayersSection() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState<string>("all");
  const [minItm, setMinItm] = useState<string>("0");
  const [positiveRoi, setPositiveRoi] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: stats } = await supabase
        .from("player_stats")
        .select("*")
        .eq("backing_status", "approved");
      let ids = (stats ?? []).map((s: any) => s.player_id);

      if (ids.length) {
        const { data: liveDeals } = await supabase
          .from("staking_deals")
          .select("player_id")
          .in("player_id", ids)
          .eq("player_checked_in", true)
          .in("status", ["funded", "result_entered", "result_verified", "release_requested", "cosigned"]);
        const checkedIn = new Set((liveDeals ?? []).map((d: any) => d.player_id));
        if (checkedIn.size) ids = ids.filter((id: string) => !checkedIn.has(id));
      }

      let profMap = new Map<string, any>();
      const dealMap = new Map<string, number>();
      if (ids.length) {
        const [{ data: profs }, { data: deals }] = await Promise.all([
          supabase
            .from("profiles")
            .select("user_id,display_name,region,avatar_url")
            .in("user_id", ids),
          supabase
            .from("staking_deals")
            .select("player_id")
            .in("player_id", ids)
            .eq("admin_review_status", "approved")
            .in("status", ["listing", "committed"])
            .is("backer_id", null),
        ]);
        profMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
        (deals ?? []).forEach((d: any) => {
          dealMap.set(d.player_id, (dealMap.get(d.player_id) ?? 0) + 1);
        });
      }
      const merged = (stats ?? [])
        .filter((s: any) => ids.includes(s.player_id))
        .map((s: any) => ({
          ...s,
          display_name: profMap.get(s.player_id)?.display_name ?? "Player",
          region: profMap.get(s.player_id)?.region ?? null,
          avatar_url: profMap.get(s.player_id)?.avatar_url ?? null,
          open_deals: dealMap.get(s.player_id) ?? 0,
        }));
      setRows(merged);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => (verifiedOnly ? r.verified : true))
      .filter((r) => (search ? r.display_name?.toLowerCase().includes(search.toLowerCase()) : true))
      .filter((r) => (region === "all" ? true : r.region === region))
      .filter((r) => (r.verified ? r.itm_rate >= Number(minItm) : true))
      .filter((r) => (positiveRoi ? r.verified && r.roi_percentage > 0 : true))
      .sort((a, b) => {
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        if (sortBy === "newest")
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        if (!a.verified && !b.verified) return 0;
        if (sortBy === "roi") return b.roi_percentage - a.roi_percentage;
        if (sortBy === "itm") return b.itm_rate - a.itm_rate;
        if (sortBy === "streak") return b.current_streak - a.current_streak;
        return b.tournaments_played - a.tournaments_played;
      });
  }, [rows, search, region, minItm, positiveRoi, verifiedOnly, sortBy]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2 relative h-10 self-start">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("findBacker.searchPlaceholder")}
              className="pl-9 h-10"
            />
          </div>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger><SelectValue placeholder={t("findBacker.region")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("findBacker.allRegions")}</SelectItem>
              <SelectItem value="HN">{t("findBacker.regions.HN")}</SelectItem>
              <SelectItem value="HCM">{t("findBacker.regions.HCM")}</SelectItem>
              <SelectItem value="DN">{t("findBacker.regions.DN")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minItm} onValueChange={setMinItm} disabled={!verifiedOnly}>
            <SelectTrigger><SelectValue placeholder={t("findBacker.itm")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("findBacker.anyItm")}</SelectItem>
              <SelectItem value="10">{t("findBacker.itmGt", { n: 10 })}</SelectItem>
              <SelectItem value="20">{t("findBacker.itmGt", { n: 20 })}</SelectItem>
              <SelectItem value="30">{t("findBacker.itmGt", { n: 30 })}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger><SelectValue placeholder={t("findBacker.sortBy")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t("findBacker.sortNewest")}</SelectItem>
              <SelectItem value="roi" disabled={!verifiedOnly}>{t("findBacker.sortRoi")}</SelectItem>
              <SelectItem value="itm" disabled={!verifiedOnly}>{t("findBacker.sortItm")}</SelectItem>
              <SelectItem value="streak" disabled={!verifiedOnly}>{t("findBacker.sortStreak")}</SelectItem>
              <SelectItem value="played" disabled={!verifiedOnly}>{t("findBacker.sortPlayed")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex flex-col gap-2 px-2 justify-center">
            <div className="flex items-center gap-2">
              <Switch checked={verifiedOnly} onCheckedChange={setVerifiedOnly} />
              <span className="text-xs">{t("findBacker.verifiedOnly")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={positiveRoi} onCheckedChange={setPositiveRoi} disabled={!verifiedOnly} />
              <span className="text-xs">{t("findBacker.positiveRoi")}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">{t("findBacker.loading")}</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("findBacker.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <PlayerCard
              key={r.player_id}
              row={r}
              onView={() => nav(`/player/${r.player_id}`)}
              onMarketplace={() => nav(`/marketplace?player=${r.player_id}`)}
            />
          ))}
        </div>
      )}

      <div className="text-xs text-muted-foreground text-center border-t border-border/40 pt-4 mt-8">
        {t("findBacker.disclaimer")}
      </div>
    </div>
  );
}

/* ============================================================== *
 * Player Card (unchanged)                                         *
 * ============================================================== */

const PlayerCard = ({
  row,
  onView,
  onMarketplace,
}: {
  row: Row;
  onView: () => void;
  onMarketplace: () => void;
}) => {
  const { t } = useTranslation();
  const roiPositive = row.roi_percentage >= 0;
  const chartData = (row.last_20_results ?? []).map((r: any, i: number) => ({ i, profit: r.profit ?? 0 }));
  const initial = (row.display_name?.[0] ?? "?").toUpperCase();
  const hasOpenDeals = (row.open_deals ?? 0) > 0;

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full overflow-hidden gradient-gold shrink-0 flex items-center justify-center border border-gold/40">
              {row.avatar_url ? (
                <img src={row.avatar_url} alt={row.display_name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-sm font-display font-bold text-primary-foreground">{initial}</span>
              )}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{row.display_name}</CardTitle>
              <div className="text-xs text-muted-foreground mt-0.5">{row.region ?? "—"}</div>
            </div>
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            {row.verified ? (
              <Badge className="bg-success/20 text-success border-success/40">
                <ShieldCheck className="w-3 h-3 mr-1" /> Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="border-warning/40 text-warning">
                <ShieldAlert className="w-3 h-3 mr-1" /> {t("findBacker.unverifiedBadge")}
              </Badge>
            )}
            {row.looking_for_backing && (
              <Badge className="bg-primary/20 text-primary border-primary/40 animate-pulse">
                {t("findBacker.lookingForBacker")}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {row.verified ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] text-muted-foreground tracking-wider">{t("findBacker.itm")}</div>
                <div className="font-bold text-[hsl(var(--ds-active))]">{row.itm_rate}%</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground tracking-wider">ROI</div>
                <div className={`font-bold flex items-center justify-center gap-0.5 ${roiPositive ? "text-success" : "text-destructive"}`}>
                  {roiPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {roiPositive ? "+" : ""}{row.roi_percentage}%
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground tracking-wider">{t("findBacker.tournaments")}</div>
                <div className="font-bold">{row.tournaments_played}</div>
              </div>
            </div>

            {chartData.length > 1 && (
              <div className="h-12">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <YAxis hide domain={["auto", "auto"]} />
                    <Line type="monotone" dataKey="profit" stroke={roiPositive ? "hsl(var(--primary))" : "hsl(0 80% 60%)"} strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ) : (
          <div className="text-xs text-muted-foreground italic rounded-md border border-warning/20 bg-warning/5 p-2">
            {t("findBacker.unverifiedHint")}
          </div>
        )}

        {row.backing_description && (
          <div className="text-xs text-muted-foreground italic line-clamp-2 border-l-2 border-primary/40 pl-2">
            "{row.backing_description}"
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {hasOpenDeals ? (
            <Button
              onClick={onMarketplace}
              size="sm"
              className="w-full gradient-neon text-primary-foreground font-bold tracking-wide"
            >
              {t("findBacker.openDealsCount", { n: row.open_deals })}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          ) : (
            <div className="text-[11px] text-muted-foreground text-center py-1">
              {t("findBacker.noOpenDeals")}
            </div>
          )}
          <Button onClick={onView} variant="outline" className="w-full" size="sm">
            {t("findBacker.viewProfile")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default FindBacker;
