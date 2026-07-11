import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  baselineVerdict,
  TRAILING_WINDOW,
  type BaselineId,
  type BaselineBatteryResult,
  type BaselineVerdict,
  type BaselineVerdictKind,
} from "@/lib/series-intelligence/baselineBattery";

// A3 — plain-Vietnamese names for the baseline family (no quant jargon; window sizes from the lib constants).
export const BASELINE_LABEL: Record<BaselineId, string> = {
  historical_median: "Trung vị lịch sử",
  trailing_mean: `Trung bình ${TRAILING_WINDOW} giải gần nhất`,
  same_weekday: "Cùng thứ trong tuần",
  existing_naive: "Giải cùng loại gần nhất",
};

export const VERDICT_TONE: Record<BaselineVerdictKind, string> = {
  inconclusive: "border-border/60 bg-card/40 text-muted-foreground",
  model_better: "border-primary/40 bg-primary/10 text-primary",
  model_not_ahead: "border-warning/40 bg-warning/10 text-warning",
};

/** The verdict line's Vietnamese copy. Honest by construction: only "model_better" says the model is ahead;
 *  the fallback never claims a win. No causal / guaranteed-accuracy language. */
export function verdictText(v: BaselineVerdict): string {
  if (v.kind === "model_better") {
    return `Trên ${v.foldCount} lần thử cùng điều kiện, mô hình đang tốt hơn mốc đơn giản tốt nhất.`;
  }
  if (v.kind === "model_not_ahead") {
    return `Trên ${v.foldCount} lần thử cùng điều kiện, mốc đơn giản đang ngang hoặc tốt hơn mô hình — mô hình chưa chứng minh được lợi thế.`;
  }
  return "Chưa đủ dữ liệu để kết luận mô hình tốt hơn mốc đơn giản.";
}

/**
 * A3 — "Mốc dự báo đơn giản": the model next to a family of simple baselines, each scored on the SAME
 * walk-forward folds. Only claims "tốt hơn" when the comparison is conclusive; otherwise an honest "chưa đủ
 * dữ liệu". Quiet card matching the TurnoutForecastPanel idiom (tokens, text sizes, tabular-nums).
 */
export function BaselineBatteryCard({
  battery,
  modelBase,
  modelMapePct,
}: {
  battery: BaselineBatteryResult;
  modelBase: number | null;
  modelMapePct: number | null;
}) {
  const round1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);
  const verdict = baselineVerdict(battery);

  return (
    <Card className="space-y-2 border-border/60 bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium">
        <BarChart3 className="h-3 w-3 text-primary" aria-hidden /> Mốc dự báo đơn giản
        <span className="font-normal text-muted-foreground">— so với mô hình</span>
      </div>

      <div className="flex items-center justify-between rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[11px]">
        <span className="font-medium">Mô hình</span>
        <span className="tabular-nums">
          {modelBase !== null && (
            <>
              <b className="text-primary">{modelBase}</b> khách
            </>
          )}
          {modelMapePct !== null && <span className="text-muted-foreground"> · sai số {modelMapePct}%</span>}
        </span>
      </div>

      <ul className="space-y-1">
        {battery.targets.map((t) => {
          const mape = round1(battery.scores.find((s) => s.baselineId === t.baselineId)?.mape ?? null);
          return (
            <li key={t.baselineId} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>{BASELINE_LABEL[t.baselineId]}</span>
              <span className="tabular-nums">
                {t.forecast !== null ? (
                  <>
                    <b className="text-foreground">{Math.round(t.forecast)}</b> khách
                  </>
                ) : (
                  <span className="text-muted-foreground/70">chưa có</span>
                )}
                {" · "}
                {mape !== null ? <>sai số {mape}%</> : <span className="text-muted-foreground/70">sai số —</span>}
              </span>
            </li>
          );
        })}
      </ul>

      <div className={cn("rounded-md border p-2 text-[10px] leading-snug", VERDICT_TONE[verdict.kind])}>
        {verdictText(verdict)}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground/80">
        "Sai số" = kiểm chứng walk-forward (đoán lại từng giải cũ chỉ bằng các giải trước nó). Kết luận chỉ tính
        khi mô hình và mốc đơn giản cùng số lần thử.
      </p>
    </Card>
  );
}
