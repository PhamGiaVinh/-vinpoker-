import { useMemo } from "react";
import { Layers, Users, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { Series } from "@/lib/series-intelligence/seriesLibrary";
import {
  groupEvents,
  computeGroupStats,
  type ConfidenceTier,
} from "@/lib/series-intelligence/referenceDistribution";

const TIER_CLASS: Record<ConfidenceTier["level"], string> = {
  thấp: "border-border text-muted-foreground bg-secondary",
  "trung bình": "border-warning/40 text-warning bg-warning/10",
  cao: "border-primary/40 text-primary bg-primary/10",
};

/**
 * Reference Distribution (READ-ONLY). Groups the same tournament across the whole Series Library by
 * normalized name and shows an honest entries range + a confidence tier that scales with N. Every
 * group lists its member events + source series so the owner can SEE (and catch) a wrong grouping.
 * Descriptive only — "ước tính (N=x)" from observed CSVs, never a model/prediction.
 */
export function ReferenceDistributionPanel({ series }: { series: Series[] }) {
  const groups = useMemo(() => groupEvents(series).map((g) => ({ group: g, stats: computeGroupStats(g) })), [series]);

  if (series.length === 0 || groups.length === 0) return null;

  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Phân phối tham chiếu
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Gộp các giải cùng tên (đã chuẩn hóa) xuyên toàn thư viện → khoảng entries quan sát được. Là{" "}
          <strong>ước tính theo N giải đã nạp</strong>, không phải dự đoán. N=1 chỉ là giả thuyết.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map(({ group, stats }) => {
          const isHypothesis = stats.n <= 1;
          const e = stats.entries;
          return (
            <Card key={group.normalizedName || "(unnamed)"} className="p-3 gradient-card border-primary/30 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{group.displayName}</div>
                  <div className="text-[10px] text-muted-foreground">khóa: {group.normalizedName || "(không tên)"}</div>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-none",
                    TIER_CLASS[stats.tier.level],
                  )}
                >
                  {stats.tier.basis} · N={stats.n}
                </span>
              </div>

              {/* entries range */}
              <div className="text-xs">
                {e.base === null ? (
                  <span className="text-muted-foreground">Chưa có dữ liệu entries.</span>
                ) : isHypothesis ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Giả thuyết (N=1)</span>
                    <span className="tabular-nums">{e.base} entry</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Entries (ước tính, {stats.method === "p20p80" ? "p20–p80" : "min–max"})
                    </span>
                    <span className="tabular-nums font-medium">
                      {e.low}<span className="text-muted-foreground"> – </span>
                      <span className="text-primary">{e.base}</span>
                      <span className="text-muted-foreground"> – </span>{e.high}
                    </span>
                  </div>
                )}
              </div>

              {/* money medians */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
                <span>buy-in (median): {stats.medianBuyIn === null ? "—" : formatVndShort(stats.medianBuyIn)}</span>
                <span>fee (median): {stats.medianFee === null ? "—" : formatVndShort(stats.medianFee)}</span>
              </div>

              {/* members — so a wrong grouping is visible */}
              <div className="border-t border-border/60 pt-1.5 space-y-0.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Users className="h-3 w-3" /> Thành viên ({group.members.length})
                </div>
                <ul className="space-y-0.5">
                  {group.members.map((m, i) => (
                    <li key={i} className="text-[11px] flex items-center justify-between gap-2">
                      <span className="truncate">
                        {m.event.event_name?.trim() || "(không tên)"}
                        <span className="text-muted-foreground"> · {m.seriesName}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {m.event.total_entries === null ? "—" : `${m.event.total_entries} entry`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground/80 flex items-start gap-1">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        Gộp theo TÊN đã chuẩn hóa (bỏ năm/#N/mùa). Nếu thấy giải bị gộp nhầm trong danh sách thành viên, đổi tên ở
        file CSV rồi nạp lại. Chưa hỗ trợ gộp/tách thủ công (bản sau).
      </p>
    </section>
  );
}
