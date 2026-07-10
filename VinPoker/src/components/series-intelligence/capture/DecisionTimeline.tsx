import { cn } from "@/lib/utils";
import { DECISION_HORIZONS, HORIZON_SHORT } from "@/lib/series-intelligence/captureTypes";
import type { DecisionLog, ForecastSnapshot } from "@/lib/series-intelligence/captureTypes";
import { FEATURES } from "@/lib/featureFlags";
import { countShadowDecisions } from "@/lib/series-intelligence/captureScoring";

/**
 * The signature T-minus rail for one event: T-21 · T-7 · T-1 · T-0 · post. Each node counts the forecast
 * snapshots + decisions captured at that horizon (forecasts never sit on 'post'). Read-only — it is the
 * event's decision story at a glance, not a form.
 */
export function DecisionTimeline({
  snapshots,
  decisions,
}: {
  snapshots: ForecastSnapshot[];
  decisions: DecisionLog[];
}) {
  const nodes = DECISION_HORIZONS.map((h) => ({
    h,
    forecasts: snapshots.filter((s) => s.horizon === h).length,
    decisions: decisions.filter((d) => d.decision_horizon === h).length,
  }));
  const shadowCount = FEATURES.seriesShadowDecision ? countShadowDecisions(decisions) : 0; // TP9

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
      <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Diễn tiến theo mốc
      </div>
      <div className="relative flex items-start justify-between gap-1">
        <div className="absolute left-4 right-4 top-[11px] h-px bg-border" aria-hidden />
        {nodes.map((n) => {
          const total = n.forecasts + n.decisions;
          const active = total > 0;
          const isPost = n.h === "post";
          return (
            <div key={n.h} className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-1">
              <div
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-full border-2 text-[9px] font-semibold",
                  active
                    ? isPost
                      ? "border-warning bg-warning/20 text-warning"
                      : "border-primary bg-primary/20 text-primary"
                    : "border-border bg-background text-muted-foreground",
                )}
              >
                {active ? total : ""}
              </div>
              <span className={cn("text-center text-[10px] leading-tight", active ? "text-foreground" : "text-muted-foreground")}>
                {HORIZON_SHORT[n.h] ?? n.h}
              </span>
              {active && (
                <div className="flex flex-col items-center gap-0.5 text-[9px] text-muted-foreground">
                  {n.forecasts > 0 && <span>{n.forecasts} dự đoán</span>}
                  {n.decisions > 0 && <span>{n.decisions} quyết định</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shadowCount > 0 && (
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
          <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning">shadow</span>
          {shadowCount} quyết định "không tổ chức" — ghi để học, không tính điểm.
        </div>
      )}
    </div>
  );
}
