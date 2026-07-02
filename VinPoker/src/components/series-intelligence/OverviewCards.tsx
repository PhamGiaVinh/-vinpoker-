import { CalendarDays, Users, UserCheck, RefreshCw, Coins, Receipt, Trophy, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVndShort } from "@/lib/clubFinance";
import type { MetricTotal, SeriesEconomics } from "@/lib/series-intelligence/commandCenter";

const countFmt = new Intl.NumberFormat("vi-VN");

/** Overlay-cost totals split BY SOURCE (never summed together): server-confirmed vs entry×buy-in estimate. */
export interface OverlayCostSummary {
  observed: number; // Σ overlay over rows resolved from the server's true prize pool ("thực thu")
  observedRows: number;
  estimated: number; // Σ overlay over rows still on the entry×buy-in estimate
  estimatedRows: number;
}

/** A single KPI tile. `partial` shows an honest "≈ một phần" hint when data was incomplete. */
function Kpi({
  icon: Icon,
  label,
  value,
  metric,
  sub,
  hero = false,
  muted = false,
  danger = false,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  metric?: MetricTotal;
  /** One-line plain-VN qualifier under the value (e.g. pass-through disclaimer). */
  sub?: string;
  /** Hero = the club's REAL revenue tile: wider + bigger + primary accent. */
  hero?: boolean;
  /** Muted = pass-through money, visually subordinate so it never reads as revenue. */
  muted?: boolean;
  /** Danger = a cost (overlay), red-tinted. */
  danger?: boolean;
}) {
  const partial = metric?.partial ?? false;
  return (
    <Card
      className={
        hero
          ? "col-span-2 space-y-1 border-primary/70 bg-primary/10 p-3"
          : danger
            ? "space-y-1 border-destructive/40 bg-destructive/5 p-3"
            : "gradient-card space-y-1 border-primary/40 p-3"
      }
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${danger ? "text-destructive" : "text-primary"}`} aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <div
        className={
          hero
            ? "font-display text-2xl tabular-nums text-primary"
            : muted
              ? "font-display text-xl tabular-nums text-muted-foreground"
              : "font-display text-xl tabular-nums"
        }
      >
        {value}
      </div>
      {sub && <div className="text-[10px] leading-snug text-muted-foreground">{sub}</div>}
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

/**
 * KPI tiles with the money-truth hierarchy (framework rule: buy-in is PASS-THROUGH, not revenue):
 * the club's real revenue (fee/rake) leads; buy-in volume + prize pool trail as clearly-labeled
 * pass-through; the observed/estimated GTD overlay cost shows as a cost, split by source (never mixed).
 */
export function OverviewCards({
  economics,
  overlayCost = null,
}: {
  economics: SeriesEconomics;
  overlayCost?: OverlayCostSummary | null;
}) {
  const e = economics;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      <Kpi
        icon={Receipt}
        label="Doanh thu thật (fee/rake)"
        value={formatVndShort(e.totalRake.value)}
        metric={e.totalRake}
        sub="tiền CLB thật sự giữ lại"
        hero
      />
      <Kpi icon={CalendarDays} label="Tổng sự kiện" value={countFmt.format(e.events)} />
      <Kpi icon={Users} label="Tổng lượt entry" value={countFmt.format(e.totalEntries.value)} metric={e.totalEntries} />
      <Kpi icon={UserCheck} label="Người chơi (unique)" value={countFmt.format(e.uniquePlayers.value)} metric={e.uniquePlayers} />
      <Kpi icon={RefreshCw} label="Re-entry" value={countFmt.format(e.reentries.value)} metric={e.reentries} />
      {overlayCost && overlayCost.observedRows > 0 && (
        <Kpi
          icon={ShieldAlert}
          label="Chi phí bù GTD đã quan sát"
          value={formatVndShort(overlayCost.observed)}
          sub={`thực thu (cashier-confirmed) · ${overlayCost.observedRows} giải`}
          danger
        />
      )}
      {overlayCost && overlayCost.estimatedRows > 0 && (
        <Kpi
          icon={ShieldAlert}
          label="Chi phí bù GTD (ước tính)"
          value={formatVndShort(overlayCost.estimated)}
          sub={`ước tính entry × buy-in · ${overlayCost.estimatedRows} giải — chưa phải thực thu`}
          danger
        />
      )}
      <Kpi
        icon={Coins}
        label="Tổng buy-in"
        value={formatVndShort(e.totalBuyIn.value)}
        metric={e.totalBuyIn}
        sub="tiền chạy qua (pass-through) — không phải doanh thu"
        muted
      />
      <Kpi
        icon={Trophy}
        label="Prize pool đã nhập"
        value={formatVndShort(e.totalPrizePool.value)}
        metric={e.totalPrizePool}
        sub="tiền chạy qua (pass-through) — không phải doanh thu"
        muted
      />
    </div>
  );
}
