import { useMemo } from "react";
import { TrendingDown, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FEATURES } from "@/lib/featureFlags";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import {
  computeWithinSeriesElasticity,
  ELASTICITY_DISCLAIMER,
  MIN_EDITIONS,
  MIN_BUYIN_LEVELS,
} from "@/lib/series-intelligence/withinSeries";
import { InsightLabelBadge } from "./InsightLabelBadge";
import { ExplainHint } from "./ExplainHint";
import { EmptyExplainer } from "./EmptyExplainer";

const fmtGamma = (g: number) => (g >= 0 ? "" : "−") + Math.abs(g).toFixed(2);

/**
 * "Độ nhạy giá — so cùng giải qua các kỳ" (TP4, P0-1). For each brand with enough editions and price
 * variation, shows the within-series own-price sensitivity γ (from withinSeries.computeWithinSeriesElasticity)
 * plus a pooled median. STRICTLY descriptive: Observed Pattern label + an always-on bold endogeneity
 * disclaimer — this is a correlation over the club's own history, never a causal "raise price → lose players".
 */
export function WithinSeriesElasticityCard({ events }: { events: SeriesEvent[] }) {
  const result = useMemo(
    () => computeWithinSeriesElasticity(events, { censoring: FEATURES.seriesCensoring }),
    [events],
  );

  return (
    <Card className="p-4 gradient-card border-primary/40 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary" /> Độ nhạy giá
          <span className="text-[10px] font-sans font-normal text-muted-foreground">(so cùng giải qua các kỳ)</span>
        </h3>
        <InsightLabelBadge label="Observed Pattern" />
      </div>

      {/* Endogeneity disclaimer — ALWAYS shown, in bold, whether or not there is data. */}
      <p className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px] font-semibold text-warning">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>{ELASTICITY_DISCLAIMER}</span>
      </p>

      {!result.enough ? (
        FEATURES.seriesEmptyExplainer ? (
          <EmptyExplainer
            what="Độ nhạy giá theo từng thương hiệu giải"
            why={`chưa có giải nào chạy đủ ≥${MIN_EDITIONS} kỳ với ≥${MIN_BUYIN_LEVELS} mức buy-in khác nhau.`}
            how="Tổ chức thêm các kỳ của cùng một giải (và thử các mức giá khác nhau) — hệ thống sẽ tự đo tương quan giá ↔ lượng khách."
          />
        ) : (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
            Chưa đủ dữ liệu: cần một thương hiệu giải chạy ≥{MIN_EDITIONS} kỳ với ≥{MIN_BUYIN_LEVELS} mức buy-in khác nhau.
          </p>
        )
      ) : (
        <>
          <div className="rounded-md border border-primary/30 bg-card/40 p-2">
            <div className="text-[10px] text-muted-foreground">
              {result.perBrand.length > 1
                ? `Độ nhạy giá gộp (trung vị ${result.perBrand.length} thương hiệu)`
                : `Độ nhạy giá — thương hiệu ${result.perBrand[0].displayName}`}
            </div>
            <div className="font-display text-2xl tabular-nums text-primary">γ ≈ {fmtGamma(result.pooledGamma as number)}</div>
          </div>

          <div className="space-y-1">
            {result.perBrand.map((b) => (
              <div key={b.key} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/30 px-2 py-1.5 text-[11px]">
                <span className="truncate font-medium">
                  {b.displayName}
                  {b.thin && <span className="ml-1 text-[9px] font-normal text-warning">· ít kỳ, số liệu còn thô</span>}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  γ <b className="tabular-nums text-foreground">{fmtGamma(b.gamma)}</b> · {b.editions} kỳ · {b.buyinLevels} mức giá
                </span>
              </div>
            ))}
          </div>

          {result.dropped.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {result.dropped.length} thương hiệu chưa đủ điều kiện để tính (thiếu kỳ hoặc giá không đổi) — đã bỏ qua.
            </p>
          )}

          <ExplainHint term="độ nhạy giá (γ)">
            γ đo <b>lượng khách thay đổi bao nhiêu khi buy-in đổi</b>, đã tách xu hướng tăng/giảm qua các kỳ. γ dương ≈ 1
            nghĩa là giá tăng 10% thì lượng khách <b>quan sát</b> giảm ~10%. γ âm nghĩa là kỳ giá cao lại đông hơn —
            thường vì giải lớn cố tình treo giá cao. Đây là <b>tương quan quan sát được, KHÔNG phải nhân quả.</b>
          </ExplainHint>
        </>
      )}
    </Card>
  );
}
