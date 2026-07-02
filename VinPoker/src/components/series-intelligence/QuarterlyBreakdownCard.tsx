import { CalendarRange } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { QuarterlySummary, MetricTotal } from "@/lib/series-intelligence/commandCenter";
import { InsightLabelBadge } from "./InsightLabelBadge";

const countFmt = new Intl.NumberFormat("vi-VN");

/** "≈" prefix + tooltip when a total only counted part of the quarter's events. */
function ApproxNum({ metric, money = false }: { metric: MetricTotal; money?: boolean }) {
  const text = money ? formatVndShort(metric.value) : countFmt.format(metric.value);
  return (
    <span
      className="tabular-nums"
      title={
        metric.partial
          ? `Chỉ tính từ ${metric.contributingCount}/${metric.totalCount} giải có đủ dữ liệu`
          : undefined
      }
    >
      {metric.partial ? "≈ " : ""}
      {text}
    </span>
  );
}

/**
 * "Giải đã chạy theo quý" — descriptive quarterly counting (Observed Pattern): events, entries,
 * fee revenue, estimated GTD overlay per calendar quarter, newest first. Undated events are
 * reported, never guessed into a quarter. Buy-in stays out — it is pass-through, not revenue.
 */
export function QuarterlyBreakdownCard({ summary }: { summary: QuarterlySummary }) {
  if (!summary.available && summary.undatedCount === 0) return null;

  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-primary" /> Giải đã chạy theo quý
        </h3>
        <InsightLabelBadge label={summary.label} />
      </div>

      {summary.available && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-muted-foreground border-b border-border/60">
                <th className="py-1 pr-2 text-left font-normal">Quý</th>
                <th className="py-1 px-2 text-right font-normal">Giải</th>
                <th className="py-1 px-2 text-right font-normal">Lượt entry</th>
                <th className="py-1 px-2 text-right font-normal">Doanh thu fee</th>
                <th className="py-1 pl-2 text-right font-normal">Bù GTD (ước tính)</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.key} className="border-b border-border/30 last:border-0">
                  <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.eventCount}</td>
                  <td className="py-1.5 px-2 text-right">
                    <ApproxNum metric={r.entries} />
                  </td>
                  <td className="py-1.5 px-2 text-right text-primary">
                    <ApproxNum metric={r.feeRevenue} money />
                  </td>
                  <td className={cn("py-1.5 pl-2 text-right", r.overlayCost.value > 0 ? "text-destructive" : "text-muted-foreground")}>
                    <ApproxNum metric={r.overlayCost} money />
                    {r.gtdMissingCount > 0 && (
                      <span className="ml-1 text-[9px] text-muted-foreground" title={`${r.gtdMissingCount} giải trong quý không đặt GTD — không tính chi phí bù (không đoán)`}>
                        ({r.gtdMissingCount} không GTD)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary.undatedCount > 0 && (
        <p className="text-[10px] text-warning">
          {summary.undatedCount} giải thiếu ngày — không xếp vào quý nào (không đoán).
        </p>
      )}
      <p className="text-[10px] text-muted-foreground/80">
        Doanh thu fee = fee × lượt entry (buy-in là tiền chạy qua, không tính). Bù GTD là ước tính
        entry × buy-in — chưa phải số kế toán.
      </p>
    </Card>
  );
}
