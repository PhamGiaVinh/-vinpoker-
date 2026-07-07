import { HelpCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * W2 — consistent "why is this block empty?" explainer. Every self-hidden / empty Series Intelligence
 * block should say the same three things: WHAT it is, WHY it's empty right now, and HOW to unlock it —
 * so an empty block never reads as "the app is broken". Presentational only; no data, no logic.
 */
export function EmptyExplainer({
  what,
  why,
  how,
  progress,
  tone = "muted",
  className,
}: {
  /** One line: what this block would show. */
  what: string;
  /** One line: why it's empty right now. */
  why: string;
  /** One line: the concrete action that fills it. */
  how: string;
  /** Optional progress toward unlocking, e.g. { current: 3, target: 10 }. */
  progress?: { current: number; target: number };
  tone?: "muted" | "warning";
  className?: string;
}) {
  const warn = tone === "warning";
  return (
    <Card
      className={cn(
        "space-y-1.5 border-dashed p-3 text-[11px]",
        warn ? "border-warning/40 bg-warning/5" : "border-border/70 bg-card/30",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <HelpCircle className={cn("h-3.5 w-3.5 shrink-0", warn ? "text-warning" : "text-primary")} aria-hidden />
        {what}
      </div>
      {progress && (
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.min(100, progress.target > 0 ? (progress.current / progress.target) * 100 : 0)}%` }}
            />
          </div>
          <span className="tabular-nums text-muted-foreground">{progress.current}/{progress.target}</span>
        </div>
      )}
      <div className="text-muted-foreground">
        <span className="text-foreground/80">Vì sao trống:</span> {why}
      </div>
      <div className="text-muted-foreground">
        <span className="text-foreground/80">Cách mở khóa:</span> {how}
      </div>
    </Card>
  );
}
