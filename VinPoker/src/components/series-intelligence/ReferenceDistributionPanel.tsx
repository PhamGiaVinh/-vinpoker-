import { useMemo, useState } from "react";
import { Layers, Users, Info, Combine, RotateCcw, X, Hand } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
 * Reference Distribution. Groups the same tournament across the whole Series Library and shows an
 * honest entries range + a confidence tier that scales with N. Each group lists its member events +
 * source series so a wrong grouping is visible. Descriptive only — "ước tính (N=x)", never a model.
 *
 * PATCH 2.5: when the manual-override callbacks are provided, members can be ticked and merged into
 * one group (or split out) — overrides persist client-side. Without the callbacks it's read-only.
 */
export function ReferenceDistributionPanel({
  series,
  overrideLabels,
  onMerge,
  onReset,
  onResetAll,
  hasOverrides,
}: {
  series: Series[];
  overrideLabels?: Record<string, string>;
  onMerge?: (obsKeys: string[]) => void;
  onReset?: (obsKeys: string[]) => void;
  onResetAll?: () => void;
  hasOverrides?: boolean;
}) {
  const interactive = !!onMerge;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => groupEvents(series, overrideLabels).map((g) => ({ group: g, stats: computeGroupStats(g) })),
    [series, overrideLabels],
  );

  if (series.length === 0 || groups.length === 0) return null;

  const toggle = (obsKey: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(obsKey)) next.delete(obsKey);
      else next.add(obsKey);
      return next;
    });
  };
  const clearSel = (): void => setSelected(new Set());
  const doMerge = (): void => {
    onMerge?.([...selected]);
    clearSel();
  };
  const doResetSel = (): void => {
    onReset?.([...selected]);
    clearSel();
  };

  return (
    <section className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Giải này thường có bao nhiêu khách?
          </h3>
          <p className="text-[11px] text-muted-foreground">
            <span className="text-muted-foreground/80">Phân phối tham chiếu · </span>Gộp các giải cùng tên (đã chuẩn hóa) xuyên toàn thư viện → khoảng entries quan sát được. Là{" "}
            <strong>ước tính theo N giải đã nạp</strong>, không phải dự đoán. N=1 chỉ là giả thuyết.
          </p>
        </div>
        {interactive && hasOverrides && (
          <Button variant="ghost" size="sm" className="shrink-0 gap-1 text-muted-foreground" onClick={onResetAll}>
            <RotateCcw className="h-3.5 w-3.5" /> Tự động lại
          </Button>
        )}
      </div>

      {/* selection toolbar (merge / split / reset) */}
      {interactive && selected.size > 0 && (
        <Card className="p-2 border-primary/40 bg-primary/5 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium">{selected.size} mục đã chọn</span>
          <Button size="sm" className="h-7 gap-1" onClick={doMerge}>
            <Combine className="h-3.5 w-3.5" /> Gộp thành 1 nhóm
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={doResetSel}>
            <RotateCcw className="h-3.5 w-3.5" /> Về tự động
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-muted-foreground" onClick={clearSel}>
            <X className="h-3.5 w-3.5" /> Bỏ chọn
          </Button>
          <span className="basis-full text-[10px] text-muted-foreground">
            Tick các giải rồi “Gộp” để ghép thành một nhóm; tick vài giải trong một nhóm rồi “Gộp” để tách chúng ra.
          </span>
        </Card>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map(({ group, stats }) => {
          const isHypothesis = stats.n <= 1;
          const e = stats.entries;
          return (
            <Card key={group.normalizedName || "(unnamed)"} className="p-3 gradient-card border-primary/30 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {group.displayName}
                    {group.isOverridden && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] leading-none text-primary">
                        <Hand className="h-2.5 w-2.5" /> Gộp thủ công
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    khóa: {group.normalizedName || "(không tên)"}
                  </div>
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

              {/* members — so a wrong grouping is visible (+ tickable for manual override) */}
              <div className="border-t border-border/60 pt-1.5 space-y-0.5">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Users className="h-3 w-3" /> Thành viên ({group.members.length})
                </div>
                <ul className="space-y-0.5">
                  {group.members.map((m) => (
                    <li key={m.obsKey} className="text-[11px] flex items-center gap-2">
                      {interactive && (
                        <input
                          type="checkbox"
                          className="h-3 w-3 shrink-0 accent-primary"
                          checked={selected.has(m.obsKey)}
                          onChange={() => toggle(m.obsKey)}
                          aria-label={`Chọn ${m.event.event_name ?? "sự kiện"}`}
                        />
                      )}
                      <span className="truncate flex-1">
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
        Gộp tự động theo TÊN đã chuẩn hóa (bỏ năm/#N/mùa). Thấy gộp nhầm? Tick thành viên rồi “Gộp/Về tự động” để
        sửa thủ công — lưu trên trình duyệt này, không đụng dữ liệu thật.
      </p>
    </section>
  );
}
