import { AlertTriangle, Info, Moon, Gauge, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenerateDailyDraftResult, RejectionRecord, WarningKind } from "@/types/shiftPlanner";

interface Props {
  draft: GenerateDailyDraftResult;
}

const WARNING_META: Record<WarningKind, { icon: typeof Info; className: string }> = {
  coverage_gap: { icon: AlertTriangle, className: "border-red-500/30 bg-red-500/5 text-red-300" },
  night_overload: { icon: Moon, className: "border-blue-500/30 bg-blue-500/5 text-blue-300" },
  near_weekly_limit: { icon: Gauge, className: "border-amber-500/30 bg-amber-500/5 text-amber-300" },
  low_score: { icon: Info, className: "border-amber-500/30 bg-amber-500/5 text-amber-300" },
};

function summariseReasons(rejections: RejectionRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of rejections) counts.set(r.detail, (counts.get(r.detail) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([detail, n]) => `${detail} (${n})`)
    .join(" · ");
}

export default function SuggestionPanel({ draft }: Props) {
  const { warnings, unfilled, rejections } = draft;
  const hasContent = warnings.length > 0 || unfilled.length > 0;

  if (!hasContent) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-400 px-1 py-3">
        <Info className="w-4 h-4" /> Lịch đầy đủ — không có cảnh báo.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unfilled.map((u) => {
        const reasons = summariseReasons(rejections.filter((r) => r.templateId === u.templateId));
        return (
          <div key={u.templateId} className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-red-300">
              <UserX className="w-4 h-4" /> Thiếu {u.missing} dealer · khung {u.templateLabel}
            </div>
            {reasons && (
              <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
                Lý do không xếp được: {reasons}
              </p>
            )}
          </div>
        );
      })}

      {warnings.map((w, i) => {
        const meta = WARNING_META[w.kind];
        const Icon = meta.icon;
        return (
          <div key={`${w.kind}-${i}`} className={cn("rounded-lg border p-3 flex items-start gap-2", meta.className)}>
            <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="text-[12px] leading-relaxed">{w.detail}</p>
          </div>
        );
      })}
    </div>
  );
}
