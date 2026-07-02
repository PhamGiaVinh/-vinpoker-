import { ChevronRight, Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChipState, PlannerCta, PlannerStep } from "@/lib/shiftPlanner";

const STEP_LABELS: Record<PlannerStep, string> = {
  1: "Tạo lịch",
  2: "Thêm thủ công",
  3: "Rà soát",
  4: "Phát hành & báo",
};

/**
 * V2 sticky flow header — 4 numbered, clickable step chips + the ONE contextual
 * primary CTA ("làm gì tiếp theo?") + the unsaved/saved chip + the requests bell.
 * Pure presentation; all state derivation lives in lib/shiftPlanner/plannerPhase.
 */
export function PlannerFlowHeader({
  step,
  states,
  cta,
  busy,
  dirtyChip,
  requestCount,
  onStepClick,
  onCta,
  onToggleRequests,
}: {
  step: PlannerStep;
  states: Record<PlannerStep, ChipState>;
  cta: PlannerCta;
  busy: boolean;
  /** null = hidden; otherwise {label, tone}. */
  dirtyChip: { label: string; tone: "warn" | "ok" } | null;
  requestCount: number;
  onStepClick: (s: PlannerStep) => void;
  onCta: () => void;
  onToggleRequests: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2">
      {([1, 2, 3, 4] as PlannerStep[]).map((s, i) => {
        const st = states[s];
        return (
          <div key={s} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <button
              type="button"
              onClick={() => onStepClick(s)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                st === "active"
                  ? "border-primary bg-primary/10 text-foreground"
                  : st === "done"
                    ? "border-border bg-muted/30 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "grid h-4.5 w-4.5 min-h-[18px] min-w-[18px] place-items-center rounded-full text-[10px] font-bold",
                  st === "active"
                    ? "bg-primary text-primary-foreground"
                    : st === "done"
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {st === "done" ? "✓" : s}
              </span>
              {STEP_LABELS[s]}
            </button>
          </div>
        );
      })}

      <span className="flex-1" />

      <button
        type="button"
        onClick={onToggleRequests}
        className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="h-3.5 w-3.5" />
        Yêu cầu
        <span className={cn("font-bold", requestCount > 0 ? "text-warning" : "text-primary")}>{requestCount}</span>
      </button>

      {dirtyChip && (
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px]",
            dirtyChip.tone === "warn"
              ? "border-warning/40 text-warning"
              : "border-success/40 text-success"
          )}
        >
          {dirtyChip.label}
        </span>
      )}

      {cta.action !== "none" && (
        <Button size="sm" className="h-8" onClick={onCta} disabled={busy || cta.disabled}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {cta.label}
        </Button>
      )}
    </div>
  );
}
