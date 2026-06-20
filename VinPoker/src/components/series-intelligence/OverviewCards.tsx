import { CalendarDays, Users, UserCheck, RefreshCw, Coins, Receipt, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVndShort } from "@/lib/clubFinance";
import type { MetricTotal, SeriesEconomics } from "@/lib/series-intelligence/commandCenter";

const countFmt = new Intl.NumberFormat("vi-VN");

/** A single KPI tile. `partial` shows an honest "≈ một phần" hint when data was incomplete. */
function Kpi({
  icon: Icon,
  label,
  value,
  metric,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  metric?: MetricTotal;
}) {
  const partial = metric?.partial ?? false;
  return (
    <Card className="p-3 gradient-card border-primary/40 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display text-xl tabular-nums">{value}</div>
      {partial && metric && (
        <div
          className="text-[10px] text-warning"
          title={`Chỉ tính từ ${metric.contributingCount}/${metric.totalCount} giải có đủ dữ liệu`}
        >
          ≈ một phần ({metric.contributingCount}/{metric.totalCount})
        </div>
      )}
    </Card>
  );
}

export function OverviewCards({ economics }: { economics: SeriesEconomics }) {
  const e = economics;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <Kpi icon={CalendarDays} label="Tổng sự kiện" value={countFmt.format(e.events)} />
      <Kpi icon={Users} label="Tổng lượt entry" value={countFmt.format(e.totalEntries.value)} metric={e.totalEntries} />
      <Kpi icon={UserCheck} label="Người chơi (unique)" value={countFmt.format(e.uniquePlayers.value)} metric={e.uniquePlayers} />
      <Kpi icon={RefreshCw} label="Re-entry" value={countFmt.format(e.reentries.value)} metric={e.reentries} />
      <Kpi icon={Coins} label="Tổng buy-in" value={formatVndShort(e.totalBuyIn.value)} metric={e.totalBuyIn} />
      <Kpi icon={Receipt} label="Tổng fee (rake)" value={formatVndShort(e.totalRake.value)} metric={e.totalRake} />
      <Kpi icon={Trophy} label="Prize pool đã nhập" value={formatVndShort(e.totalPrizePool.value)} metric={e.totalPrizePool} />
    </div>
  );
}
