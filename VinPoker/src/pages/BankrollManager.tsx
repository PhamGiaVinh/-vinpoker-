import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  TrendingUp, TrendingDown, Wallet, Target, Percent, BarChart3, Plus, Settings as SettingsIcon,
  Download, Pencil, Trash2, Info, AlertTriangle, ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, AreaChart, Area, ReferenceLine, Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { SyncingBadge } from "@/components/SyncingBadge";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import SessionFormDialog from "@/components/bankroll/SessionFormDialog";
import {
  type BankrollEntry, computeSummary, confidenceInterval, riskOfRuin,
  recommendedBankroll, maxDownswing, projectBankroll, entryNetPL,
} from "@/lib/bankrollMath";

const fmtMoney = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(Math.round(n));

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

type RangeKey = "all" | "30" | "90" | "custom";

interface Settings {
  starting_bankroll: number;
  currency: string;
  ror_threshold: number;
}

const DEFAULT_SETTINGS: Settings = { starting_bankroll: 0, currency: "USD", ror_threshold: 5 };

export default function BankrollManager() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BankrollEntry | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [range, setRange] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["bankroll", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const [eRes, sRes] = await Promise.all([
        supabase.from("bankroll_entries").select("*").eq("user_id", user!.id).order("entry_date", { ascending: false }),
        supabase.from("bankroll_settings").select("*").eq("user_id", user!.id).maybeSingle(),
      ]);
      if (eRes.error) throw eRes.error;
      if (sRes.error) throw sRes.error;
      const settings: Settings = sRes.data
        ? {
            starting_bankroll: Number(sRes.data.starting_bankroll) || 0,
            currency: sRes.data.currency || "USD",
            ror_threshold: Number(sRes.data.ror_threshold) || 5,
          }
        : DEFAULT_SETTINGS;
      return { entries: ((eRes.data as any) ?? []) as BankrollEntry[], settings };
    },
  });

  const entries: BankrollEntry[] = data?.entries ?? [];
  const settings: Settings = data?.settings ?? DEFAULT_SETTINGS;
  const loading = isLoading && !data;
  const load = () => { refetch(); };

  const generateSampleData = async () => {
    if (!user) return;
    setGenLoading(true);
    const buyins = [5, 10, 20, 30, 50, 100, 200];
    const count = 80 + Math.floor(Math.random() * 21);
    const now = Date.now();
    const threeMonthsAgo = now - 90 * 86400_000;
    const rows: any[] = [];
    for (let i = 0; i < count; i++) {
      const buyin = buyins[Math.floor(Math.random() * buyins.length)];
      const rake = Math.round(buyin * 0.1 * 100) / 100;
      const totalCost = buyin + rake;
      const isItm = Math.random() < 0.22;
      let prize = 0;
      if (isItm) {
        const r = Math.random();
        let multiplier: number;
        if (r < 0.6) multiplier = 1.5 + Math.random() * 2;
        else if (r < 0.9) multiplier = 3.5 + Math.random() * 4;
        else multiplier = 7.5 + Math.random() * 10;
        prize = Math.round(totalCost * multiplier);
      }
      const ts = threeMonthsAgo + Math.random() * (now - threeMonthsAgo);
      const date = new Date(ts).toISOString().slice(0, 10);
      rows.push({
        user_id: user.id,
        entry_date: date,
        game_type: "tournament",
        buyin,
        rake,
        prize_won: prize,
        entries: 1,
        notes: null,
      });
    }
    const chunk = 50;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await supabase.from("bankroll_entries").insert(rows.slice(i, i + chunk));
      if (error) {
        toast.error(error.message);
        setGenLoading(false);
        return;
      }
    }
    toast.success(t("bankroll.sampleCreated", { count: rows.length }));
    setGenLoading(false);
    load();
  };

  const clearAllData = async () => {
    if (!user) return;
    if (!confirm(t("bankroll.clearConfirm"))) return;
    const { error } = await supabase.from("bankroll_entries").delete().eq("user_id", user.id);
    if (error) return toast.error(error.message);
    toast.success(t("bankroll.clearedAll"));
    load();
  };


  const filtered = useMemo(() => {
    const now = Date.now();
    return entries.filter((e) => {
      const t = new Date(e.entry_date).getTime();
      if (range === "30") return t >= now - 30 * 86400_000;
      if (range === "90") return t >= now - 90 * 86400_000;
      if (range === "custom") {
        if (customFrom && t < new Date(customFrom).getTime()) return false;
        if (customTo && t > new Date(customTo).getTime() + 86400_000) return false;
      }
      return true;
    });
  }, [entries, range, customFrom, customTo]);

  const summary = useMemo(
    () => computeSummary(filtered, settings.starting_bankroll),
    [filtered, settings.starting_bankroll],
  );

  const ror = useMemo(
    () => riskOfRuin(summary.winrate, summary.sd, summary.currentBR),
    [summary],
  );
  const recBR = useMemo(
    () => recommendedBankroll(summary.sd, summary.winrate, settings.ror_threshold / 100),
    [summary, settings.ror_threshold],
  );
  const maxDD = useMemo(() => maxDownswing(summary.sd, summary.winrate), [summary]);
  const ci = useMemo(
    () => confidenceInterval(summary.winrate, summary.sd, summary.tournamentResults.length),
    [summary],
  );

  const cumulative = useMemo(() => {
    const sorted = [...filtered].sort(
      (a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime(),
    );
    let total = settings.starting_bankroll;
    return sorted.map((e) => {
      total += entryNetPL(e);
      return { date: e.entry_date, total };
    });
  }, [filtered, settings.starting_bankroll]);

  const sessionsChart = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime())
        .map((e, i) => ({ idx: i + 1, pl: entryNetPL(e), date: e.entry_date })),
    [filtered],
  );

  const projection = useMemo(() => {
    const horizons = Array.from({ length: 21 }, (_, i) => i * 50);
    const points = projectBankroll(summary.currentBR, summary.winrate, summary.sd, horizons);
    return points.map((p) => ({ n: p.n, mean: p.mean, range: [p.lower, p.upper] }));
  }, [summary]);

  const moveDownAlert =
    summary.tournamentResults.length >= 30 &&
    recBR > 0 &&
    summary.currentBR < recBR;

  const rorColor =
    ror * 100 < 5 ? "text-success" : ror * 100 < 10 ? "text-warning" : "text-destructive";

  const handleDelete = async (id: string) => {
    if (!confirm(t("bankroll.deleteConfirm"))) return;
    const { error } = await supabase.from("bankroll_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("bankroll.deleted"));
    load();
  };

  const exportCSV = () => {
    const header = ["date", "type", "buyin", "rake", "prize", "entries", "stakes", "hours", "profit_loss", "notes"];
    const rows = filtered.map((e) => [
      e.entry_date, e.game_type, e.buyin ?? "", e.rake ?? "", e.prize_won ?? "",
      e.entries ?? "", e.stakes ?? "", e.hours ?? "", e.profit_loss ?? "", (e.notes ?? "").replace(/[\r\n,]/g, " "),
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bankroll-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveSettings = async (next: Settings) => {
    if (!user) return;
    const { error } = await supabase
      .from("bankroll_settings")
      .upsert({ user_id: user.id, ...next });
    if (error) return toast.error(error.message);
    refetch();
    setSettingsOpen(false);
    toast.success(t("bankroll.savedSettings"));
  };

  if (!user) {
    return <p className="text-muted-foreground py-12 text-center">{t("bankroll.loginRequired")}</p>;
  }

  const currency = settings.currency;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        {moveDownAlert && (
          <Card className="p-3 border-warning/40 bg-warning/10 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-warning">{t("bankroll.moveDownTitle")}</p>
              <p className="text-muted-foreground">
                {t("bankroll.moveDownDesc", { current: fmtMoney(summary.currentBR, currency), rec: fmtMoney(recBR, currency) })}
              </p>
            </div>
          </Card>
        )}

        {isError && !data && (
          <Card className="p-3 border-destructive/40 bg-destructive/10 flex items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold text-destructive">{t("bankroll.loadError")}</p>
              <p className="text-muted-foreground text-xs">{t("bankroll.loadErrorHint")}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>{t("bankroll.retry")}</Button>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("bankroll.rangeAll")}</SelectItem>
                <SelectItem value="30">{t("bankroll.range30")}</SelectItem>
                <SelectItem value="90">{t("bankroll.range90")}</SelectItem>
                <SelectItem value="custom">{t("bankroll.rangeCustom")}</SelectItem>
              </SelectContent>
            </Select>
            {range === "custom" && (
              <>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-[140px]" />
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-[140px]" />
              </>
            )}
            <SyncingBadge isFetching={isFetching && !isLoading} isError={isError && !!data} />
          </div>
          <div className="flex gap-2 flex-wrap">
            {isAdmin && (
              <>
                <Button variant="outline" size="sm" onClick={generateSampleData} disabled={genLoading}>
                  {genLoading ? t("bankroll.generating") : t("bankroll.generateSample")}
                </Button>
                <Button variant="outline" size="sm" onClick={clearAllData} className="text-destructive">
                  {t("bankroll.clearAll")}
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="w-4 h-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon className="w-4 h-4" /> {t("bankroll.settings")}
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4" /> {t("bankroll.addSession")}
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard
            icon={<Wallet className="w-4 h-4" />}
            label={t("bankroll.currentBR")}
            value={fmtMoney(summary.currentBR, currency)}
            highlight={summary.currentBR >= 0 ? "success" : "destructive"}
            healthRatio={recBR > 0 ? summary.currentBR / recBR : null}
          />
          <StatCard
            icon={summary.totalPL >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            label={t("bankroll.totalPL")}
            value={fmtMoney(summary.totalPL, currency)}
            highlight={summary.totalPL >= 0 ? "success" : "destructive"}
          />
          <StatCard
            icon={<Percent className="w-4 h-4" />}
            label={t("bankroll.roi")}
            value={fmtPct(summary.roi)}
            highlight={summary.roi >= 0 ? "success" : "destructive"}
          />
          <StatCard
            icon={<Target className="w-4 h-4" />}
            label={t("bankroll.itm")}
            value={fmtPct(summary.itm)}
          />
          <StatCard
            icon={<BarChart3 className="w-4 h-4" />}
            label={t("bankroll.sampleSize")}
            value={summary.n.toString()}
          />
        </div>

        {/* Main grid */}
        <div className="grid lg:grid-cols-5 gap-4">
          {/* Session Log */}
          <Card className="p-4 lg:col-span-3">
            <Collapsible open={logOpen} onOpenChange={setLogOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full mb-3 group">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{t("bankroll.sessionLog")}</h3>
                  <Badge variant="outline">{filtered.length}</Badge>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${logOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">{t("bankroll.loading")}</p>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">{t("bankroll.noSessions")}</p>
                ) : (
                  <>
                    {/* Desktop */}
                    <div className="hidden md:block overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("bankroll.colDate")}</TableHead>
                            <TableHead>{t("bankroll.colType")}</TableHead>
                            <TableHead className="text-right">{t("bankroll.colBuyin")}</TableHead>
                            <TableHead className="text-right">{t("bankroll.colPrize")}</TableHead>
                            <TableHead className="text-right">{t("bankroll.colPL")}</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((e) => {
                            const pl = entryNetPL(e);
                            return (
                              <TableRow key={e.id} className="hover:bg-accent/5">
                                <TableCell>{e.entry_date}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-[10px]">
                                    {e.game_type === "tournament" ? t("bankroll.typeMTT") : t("bankroll.typeCash")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">
                                  {e.game_type === "tournament" ? fmtMoney((e.buyin ?? 0) * (e.entries ?? 1), currency) : (e.stakes || "-")}
                                </TableCell>
                                <TableCell className="text-right tabular-nums font-mono text-sm">
                                  {e.game_type === "tournament" ? fmtMoney(e.prize_won ?? 0, currency) : `${e.hours ?? 0}h`}
                                </TableCell>
                                <TableCell className={`text-right tabular-nums font-mono text-sm font-semibold ${pl >= 0 ? "text-success" : "text-destructive"}`}>
                                  {fmtMoney(pl, currency)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setFormOpen(true); }}>
                                    <Pencil className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" onClick={() => handleDelete(e.id)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {/* Mobile cards */}
                    <div className="md:hidden space-y-2">
                      {filtered.map((e) => {
                        const pl = entryNetPL(e);
                        return (
                          <Card key={e.id} className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs text-muted-foreground">{e.entry_date}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge variant="outline" className="text-[10px]">
                                    {e.game_type === "tournament" ? t("bankroll.typeMTT") : t("bankroll.typeCash")}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground truncate">
                                    {e.game_type === "tournament"
                                      ? `${fmtMoney((e.buyin ?? 0) * (e.entries ?? 1), currency)} → ${fmtMoney(e.prize_won ?? 0, currency)}`
                                      : `${e.stakes || "-"} · ${e.hours ?? 0}h`}
                                  </span>
                                </div>
                              </div>
                              <div className={`tabular-nums font-mono text-sm font-semibold ${pl >= 0 ? "text-success" : "text-destructive"}`}>
                                {fmtMoney(pl, currency)}
                              </div>
                            </div>
                            <div className="flex justify-end gap-1 mt-1">
                              <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setFormOpen(true); }}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => handleDelete(e.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Risk panel */}
          <Card className="p-4 lg:col-span-2">
            <h3 className="font-semibold mb-3">{t("bankroll.riskTitle")}</h3>
            <div className="space-y-3">
              <RiskRow
                label={t("bankroll.sd")}
                value={fmtMoney(summary.sd, currency)}
                tip={t("bankroll.sdTip")}
              />
              <RiskRow
                label={t("bankroll.ci")}
                value={`${fmtMoney(ci.low, currency)} … ${fmtMoney(ci.high, currency)}`}
                tip={t("bankroll.ciTip")}
              />
              <RiskRow
                label={t("bankroll.ror")}
                value={`${(ror * 100).toFixed(2)}%`}
                valueClass={rorColor}
                tip={t("bankroll.rorTip")}
              />
              <RiskRow
                label={t("bankroll.recBR", { threshold: settings.ror_threshold })}
                value={fmtMoney(recBR, currency)}
                tip={t("bankroll.recBRTip")}
              />
              <RiskRow
                label={t("bankroll.maxDD")}
                value={fmtMoney(maxDD, currency)}
                tip={t("bankroll.maxDDTip")}
              />
              <RiskRow
                label={t("bankroll.winrate")}
                value={fmtMoney(summary.winrate, currency)}
                tip={t("bankroll.winrateTip")}
              />
            </div>
          </Card>
        </div>

        {/* Charts */}
        <Card className="p-4">
          <Tabs defaultValue="cum">
            <TabsList>
              <TabsTrigger value="cum">{t("bankroll.tabCum")}</TabsTrigger>
              <TabsTrigger value="sess">{t("bankroll.tabSess")}</TabsTrigger>
              <TabsTrigger value="proj">{t("bankroll.tabProj")}</TabsTrigger>
            </TabsList>

            <TabsContent value="cum">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cumulative}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                    <Line dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            <TabsContent value="sess">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sessionsChart}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="idx" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <Bar dataKey="pl">
                      {sessionsChart.map((d, i) => (
                        <Cell key={i} fill={d.pl >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            <TabsContent value="proj">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projection}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="n" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: t("bankroll.tournamentsAxis"), fontSize: 11, fill: "hsl(var(--muted-foreground))", position: "insideBottom", offset: -2 }} />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }} />
                    <Area dataKey="range" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.15} />
                    <Line dataKey="mean" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} type="monotone" />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center px-3 sm:px-4 leading-relaxed break-words">
                {t("bankroll.projNote")}
              </p>
            </TabsContent>
          </Tabs>
        </Card>

        <SessionFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          userId={user.id}
          editing={editing}
          onSaved={load}
        />

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSave={saveSettings}
        />
      </div>
    </TooltipProvider>
  );
}

function StatCard({
  icon, label, value, highlight, healthRatio,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: "success" | "destructive";
  healthRatio?: number | null;
}) {
  const valueColor =
    highlight === "success" ? "text-success" : highlight === "destructive" ? "text-destructive" : "text-foreground";
  const ringColor =
    healthRatio == null ? "" :
      healthRatio >= 1 ? "text-success" :
      healthRatio >= 0.7 ? "text-warning" : "text-destructive";
  return (
    <Card className="p-3 transition-transform hover:scale-[1.02]">
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        {healthRatio != null && (
          <span className={`w-2 h-2 rounded-full ${ringColor.replace("text-", "bg-")}`} />
        )}
      </div>
      <div className={`mt-1.5 text-lg md:text-xl font-bold tabular-nums font-mono ${valueColor}`}>
        {value}
      </div>
    </Card>
  );
}

function RiskRow({
  label, value, tip, valueClass,
}: { label: string; value: string; tip: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <div className="flex items-center gap-1 text-muted-foreground min-w-0">
        <span className="truncate">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="shrink-0">
              <Info className="w-3.5 h-3.5 text-muted-foreground/60" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{tip}</TooltipContent>
        </Tooltip>
      </div>
      <span className={`font-mono tabular-nums font-semibold ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function SettingsDialog({
  open, onOpenChange, settings, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [start, setStart] = useState(settings.starting_bankroll.toString());
  const [cur, setCur] = useState(settings.currency);
  const [ror, setRor] = useState(settings.ror_threshold.toString());

  useEffect(() => {
    if (open) {
      setStart(settings.starting_bankroll.toString());
      setCur(settings.currency);
      setRor(settings.ror_threshold.toString());
    }
  }, [open, settings]);

  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t("bankroll.settingsTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t("bankroll.startingBR")}</Label>
            <Input type="number" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label>{t("bankroll.currency")}</Label>
            <Select
              value={cur}
              onValueChange={(v) => {
                setCur(v);
                if (v === "VND" && (!start || Number(start) === 0)) {
                  setStart("1000");
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD ($)</SelectItem>
                <SelectItem value="VND">VND (₫)</SelectItem>
                <SelectItem value="CNY">RMB (¥)</SelectItem>
                <SelectItem value="EUR">EUR (€)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("bankroll.rorThreshold")}</Label>
            <Input type="number" inputMode="decimal" value={ror} onChange={(e) => setRor(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("bankroll.cancel")}</Button>
          <Button
            onClick={() =>
              onSave({
                starting_bankroll: Number(start) || 0,
                currency: cur,
                ror_threshold: Number(ror) || 5,
              })
            }
          >
            {t("bankroll.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
