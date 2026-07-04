import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TodayTaskCard — 1 "việc kế tiếp" nổi bật; hành động lớn ở thumb-zone.
 * docs/design/ios-operations-components.md §4. Read-only prototype: onPress = no-op mẫu.
 */
export function TodayTaskCard({
  severity = "warning",
  title,
  context,
  actionLabel = "Xử lý ngay",
  onPress,
}: {
  severity?: "warning" | "danger";
  title: string;
  context?: string;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const accent = severity === "danger" ? "border-l-rose-400" : "border-l-amber-400";
  return (
    <div className={cn("rounded-xl border border-border border-l-4 bg-card p-3.5", accent)}>
      <div className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Việc kế tiếp</div>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <div className="text-[15px] font-medium leading-snug text-foreground">{title}</div>
          {context && <div className="mt-0.5 text-xs text-muted-foreground">{context}</div>}
        </div>
      </div>
      <button
        type="button"
        onClick={onPress}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground"
      >
        {actionLabel} <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
