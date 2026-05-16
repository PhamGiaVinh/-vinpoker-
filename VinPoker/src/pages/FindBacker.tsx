import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Sparkles, Search, ShieldCheck, ShieldAlert, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

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

const FindBacker = () => {
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

      // Hide players already checked-in to a live deal
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
        // Unverified players always sort after verified ones
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Sparkles className="w-7 h-7 text-primary" /> {t("findBacker.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">{t("findBacker.subtitle")}</p>
      </div>

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
};

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
              <Badge className="bg-green-500/20 text-green-500 border-green-500/40">
                <ShieldCheck className="w-3 h-3 mr-1" /> Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="border-yellow-500/40 text-yellow-500">
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
                <div className="font-bold text-cyan-400">{row.itm_rate}%</div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground tracking-wider">ROI</div>
                <div className={`font-bold flex items-center justify-center gap-0.5 ${roiPositive ? "text-green-500" : "text-red-500"}`}>
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
          <div className="text-xs text-muted-foreground italic rounded-md border border-yellow-500/20 bg-yellow-500/5 p-2">
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
