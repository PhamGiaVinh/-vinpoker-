import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, TrendingUp, TrendingDown, Trophy, Flame } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { useTranslation } from "react-i18next";

interface PlayerStats {
  player_id: string;
  tournaments_played: number;
  tournaments_cashed: number;
  itm_rate: number;
  roi_percentage: number;
  total_profit_loss: number;
  biggest_cash_amount: number;
  current_streak: number;
  avg_finish: number;
  verified: boolean;
  last_20_results: Array<{ position?: number; profit?: number }>;
}

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

export const PerformanceCard = ({ stats, displayName }: { stats: PlayerStats; displayName: string }) => {
  const { t } = useTranslation();
  const roiPositive = stats.roi_percentage >= 0;
  const chartData = (stats.last_20_results ?? []).map((r, i) => ({ i, profit: r.profit ?? 0 }));

  return (
    <Card className="overflow-hidden border-primary/20">
      <div className="bg-gradient-to-br from-primary/10 via-card to-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted-foreground tracking-widest font-semibold">{t("performanceCard.title")}</div>
            <div className="text-xl font-bold mt-1">{displayName}</div>
          </div>
          <div className="flex flex-col gap-1 items-end">
            {stats.verified && (
              <Badge className="bg-[hsl(var(--ds-active)_/_0.2)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.4)]">
                <ShieldCheck className="w-3 h-3 mr-1" /> {t("performanceCard.verified")}
              </Badge>
            )}
            {stats.current_streak >= 3 && (
              <Badge className="bg-warning/20 text-warning border-warning/40">
                <Flame className="w-3 h-3 mr-1" /> {t("performanceCard.streak", { n: stats.current_streak })}
              </Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <Stat label={t("performanceCard.played")} value={stats.tournaments_played.toString()} />
          <Stat label={t("performanceCard.itm")} value={`${stats.itm_rate}%`} accent="text-[hsl(var(--ds-active))]" />
          <Stat
            label={t("performanceCard.roi")}
            value={`${roiPositive ? "+" : ""}${stats.roi_percentage}%`}
            accent={roiPositive ? "text-success" : "text-destructive"}
            icon={roiPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          />
          <Stat label={t("performanceCard.avgFinish")} value={stats.avg_finish ? `#${stats.avg_finish}` : "—"} />
        </div>
      </div>

      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("performanceCard.totalPnl")}</span>
          <span className={`font-bold ${stats.total_profit_loss >= 0 ? "text-success" : "text-destructive"}`}>
            {stats.total_profit_loss >= 0 ? "+" : ""}{fmt(stats.total_profit_loss)} đ
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Trophy className="w-3.5 h-3.5" /> {t("performanceCard.biggestCash")}
          </span>
          <span className="font-bold">{fmt(stats.biggest_cash_amount)} đ</span>
        </div>

        {chartData.length > 1 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t("performanceCard.last20")}</div>
            <div className="h-20">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <YAxis hide domain={["auto", "auto"]} />
                  <Line
                    type="monotone"
                    dataKey="profit"
                    stroke={roiPositive ? "hsl(var(--primary))" : "hsl(0 80% 60%)"}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const Stat = ({ label, value, accent, icon }: { label: string; value: string; accent?: string; icon?: React.ReactNode }) => (
  <div className="rounded-lg bg-card/60 border border-border/40 p-3">
    <div className="text-[10px] tracking-widest text-muted-foreground font-semibold">{label}</div>
    <div className={`text-lg font-bold mt-0.5 flex items-center gap-1 ${accent ?? ""}`}>
      {icon}{value}
    </div>
  </div>
);
