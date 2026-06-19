import { BookCheck, Eye, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsightLabel } from "@/lib/series-intelligence/commandCenter";

/**
 * Renders the honesty label for an insight. Only the three allowed labels exist
 * (Known Rule / Observed Pattern / Hypothesis) — there is no `Model Estimate` /
 * `Tested Finding` here by design (Club Intelligence safety contract).
 */
const STYLE: Record<InsightLabel, { cls: string; Icon: typeof Eye; help: string }> = {
  "Known Rule": {
    cls: "border-primary/40 text-primary bg-primary/10",
    Icon: BookCheck,
    help: "Quy tắc vận hành đã biết",
  },
  "Observed Pattern": {
    cls: "border-border text-foreground bg-secondary",
    Icon: Eye,
    help: "Đo trực tiếp từ dữ liệu của CLB",
  },
  Hypothesis: {
    cls: "border-warning/40 text-warning bg-warning/10",
    Icon: FlaskConical,
    help: "Giả thuyết — cần kiểm chứng, không phải kết luận",
  },
};

export function InsightLabelBadge({ label, className }: { label: InsightLabel; className?: string }) {
  const s = STYLE[label];
  return (
    <span
      title={s.help}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none",
        s.cls,
        className,
      )}
    >
      <s.Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
