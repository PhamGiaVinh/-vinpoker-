import { Compass, Play, ChevronRight, Repeat, AlertTriangle, ClipboardCheck, LineChart, Eye, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { useSeriesCapture } from "@/lib/series-intelligence/useSeriesCapture";
import {
  deriveAssistantTasks,
  activeWorkflowStep,
  stepTargetAvailable,
  WORKFLOW_STEPS,
  type AssistantEvent,
  type AssistantTaskKind,
  type AssistantSeverity,
} from "@/lib/series-intelligence/seriesAssistant";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";

const KIND_ICON: Record<AssistantTaskKind, typeof Compass> = {
  "load-data": Upload,
  "forecast-upcoming": LineChart,
  "confirm-result": ClipboardCheck,
  "fill-gtd": AlertTriangle,
  "weekly-review": Eye,
};
const SEVERITY_ICON_CLASS: Record<AssistantSeverity, string> = {
  info: "text-primary",
  action: "text-primary",
  warning: "text-warning",
};

const scrollTo = (id: string): void => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/**
 * W1 "Trợ lý Series" — turns the page from a dashboard-to-read into an assistant-that-guides. Shows the
 * fixed 8-step workflow ring (with the next step highlighted) + up to 3 concrete "hôm nay cần làm gì"
 * tasks derived from the loaded data (pure `deriveAssistantTasks`). Descriptive only — no prediction,
 * no DB write. Self-gates on FEATURES.seriesAssistant.
 */
export function SeriesAssistant({ csvEvents, onLoadSample }: { csvEvents?: SeriesEvent[] | null; onLoadSample: () => void }) {
  const native = useNativeSeriesEvents();
  const capture = useSeriesCapture();
  if (!FEATURES.seriesAssistant) return null;

  const isCsv = (csvEvents?.length ?? 0) > 0;
  const source: SeriesEvent[] = isCsv ? (csvEvents as SeriesEvent[]) : native.events;
  const events: AssistantEvent[] = source.map((e) => ({
    event_id: e.event_id,
    name: e.event_name,
    date: e.event_date,
    hasGtd: e.gtd !== null,
  }));

  // Forecast/result status only exists in native mode with the capture console live.
  const captureLive = !isCsv && FEATURES.seriesDecisionLog;
  const forecastEventIds = new Set(captureLive ? capture.snapshots.map((s) => s.event_id) : []);
  const resultEventIds = new Set(
    captureLive
      ? capture.decisions
          .filter((d) => d.actual_entries != null || d.actual_prize_pool != null || d.actual_overlay_amount != null)
          .map((d) => d.event_id)
      : [],
  );

  // Only steer to steps that are actually rendered (③④⑤ ride forwardLayerMonteCarlo, ⑥ rides seriesDecisionLog).
  const avail = { forwardLayerAvailable: FEATURES.forwardLayerMonteCarlo, captureAvailable: FEATURES.seriesDecisionLog };
  const tasks = deriveAssistantTasks({ events, isCsv, forecastEventIds, resultEventIds, ...avail, now: new Date() });
  const currentStep = activeWorkflowStep(tasks);

  return (
    <Card className="p-4 gradient-card border-primary/50 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base flex items-center gap-2">
          <Compass className="h-4 w-4 text-primary" /> Trợ lý Series
        </h2>
        <Button variant="outline" size="sm" className="gap-1.5 h-7 text-[11px]" onClick={onLoadSample}>
          <Play className="h-3 w-3" /> Tập dượt với dữ liệu mẫu
        </Button>
      </div>

      {/* workflow ring */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Vòng công việc của một giải</div>
        <div className="flex flex-wrap items-center gap-1">
          {WORKFLOW_STEPS.map((s, i) => {
            const active = s.n === currentStep;
            const clickable = stepTargetAvailable(s.targetId, avail);
            return (
              <div key={s.key} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => s.targetId && scrollTo(s.targetId)}
                  title={s.hint}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    active
                      ? "border-primary bg-primary/15 text-primary font-medium"
                      : "border-border bg-muted/20 text-muted-foreground",
                    clickable ? "hover:border-primary/50 cursor-pointer" : "cursor-default opacity-80",
                  )}
                >
                  {s.n} · {s.label}
                </button>
                {i < WORKFLOW_STEPS.length - 1 &&
                  (i === WORKFLOW_STEPS.length - 2 ? (
                    <Repeat className="h-3 w-3 text-primary shrink-0" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" aria-hidden />
                  ))}
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground/80 mt-1">Bước đang sáng = việc kế tiếp trợ lý gợi ý bên dưới.</p>
      </div>

      {/* today's tasks */}
      <div className="space-y-2 border-t border-border/60 pt-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Hôm nay cần làm gì · {tasks.length} việc
        </div>
        {tasks.map((t) => {
          const Icon = KIND_ICON[t.kind];
          return (
            <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-card/40 p-2.5">
              <Icon className={cn("h-4 w-4 shrink-0", SEVERITY_ICON_CLASS[t.severity])} aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-foreground">{t.title}</div>
                <div className="text-[11px] text-muted-foreground">{t.detail}</div>
              </div>
              <Button
                variant={t.severity === "action" ? "default" : "outline"}
                size="sm"
                className="h-7 shrink-0 text-[11px]"
                onClick={() => (t.loadsSample ? onLoadSample() : scrollTo(t.targetId))}
              >
                {t.ctaLabel}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
