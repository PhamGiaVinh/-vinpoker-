import { AlertTriangle, CheckCircle2, CircleHelp, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduleHealthStateV1, ScheduleHealthV1 } from "@/lib/series-intelligence/scheduleHealthV1";

const STATE_META: Record<ScheduleHealthStateV1, { label: string; className: string; iconClassName: string; icon: typeof CheckCircle2 }> = {
  good: { label: "Tốt", className: "border-primary/30 bg-primary/10 text-primary", iconClassName: "text-primary", icon: CheckCircle2 },
  needs_review: { label: "Cần xem lại", className: "border-warning/40 bg-warning/10 text-warning", iconClassName: "text-warning", icon: AlertTriangle },
  blocked: { label: "Bị chặn", className: "border-destructive/40 bg-destructive/10 text-destructive", iconClassName: "text-destructive", icon: ShieldX },
  insufficient_data: { label: "Thiếu dữ liệu", className: "border-border bg-muted/40 text-muted-foreground", iconClassName: "text-muted-foreground", icon: CircleHelp },
};

export function ScheduleHealthPanel({ health }: { health: ScheduleHealthV1 }) {
  return (
    <section aria-labelledby="schedule-health-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="schedule-health-title" className="text-sm font-semibold text-foreground">Sức khỏe lịch</h3>
          <p className="text-xs text-muted-foreground">Sáu kiểm tra độc lập, không gộp thành một điểm số.</p>
        </div>
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium", STATE_META[health.overallState].className)}>
          {STATE_META[health.overallState].label}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {health.dimensions.map((dimension) => {
          const meta = STATE_META[dimension.state];
          const Icon = meta.icon;
          return (
            <div key={dimension.key} className="min-h-24 rounded-md border border-border/70 bg-background/35 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-foreground">{dimension.labelVi}</p>
                <Icon className={cn("h-4 w-4 shrink-0", meta.iconClassName)} aria-hidden />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{dimension.detailVi}</p>
              <span className={cn("mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px]", meta.className)}>{meta.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
