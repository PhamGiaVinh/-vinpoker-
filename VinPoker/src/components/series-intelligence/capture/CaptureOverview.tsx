import { Card } from "@/components/ui/card";
import { summarizeCapture } from "@/lib/series-intelligence/captureScoring";
import type { DecisionLog, ForecastSnapshot } from "@/lib/series-intelligence/captureTypes";

/** Descriptive dashboard across the whole club's capture — measured counts only (Observed Pattern). */
export function CaptureOverview({
  decisions,
  snapshots,
}: {
  decisions: DecisionLog[];
  snapshots: ForecastSnapshot[];
}) {
  const s = summarizeCapture(decisions, snapshots);
  const stats: { label: string; value: string | number }[] = [
    { label: "Giải đã ghi", value: s.events },
    { label: "Quyết định", value: s.decisions },
    { label: "Đã có kết quả", value: s.scoredEvents },
    { label: "Đủ GTD", value: s.scoredEvents ? `${s.gtdCoveredEvents}/${s.scoredEvents}` : "—" },
  ];
  return (
    <Card className="gradient-card border-primary/30 p-3">
      <div className="mb-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Tổng quan</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((st) => (
          <div key={st.label} className="rounded-md border border-border/50 bg-background/40 p-2 text-center">
            <div className="font-display text-xl text-primary">{st.value}</div>
            <div className="text-[10px] text-muted-foreground">{st.label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
