import { Users, CheckCircle2, AlertTriangle, CalendarOff, Clock, BellRing } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AvailabilityRequest, GenerateDailyDraftResult, ShiftTemplate } from "@/types/shiftPlanner";

interface Props {
  templates: ShiftTemplate[];
  availability: AvailabilityRequest[];
  draft: GenerateDailyDraftResult;
}

interface Metric {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Users;
  tone: string;
}

export default function ShiftSummaryCards({ templates, availability, draft }: Props) {
  const totalNeed = templates.reduce((s, t) => s + t.needCount, 0);
  const assigned = draft.assignments.length;
  const missing = draft.unfilled.reduce((s, u) => s + u.missing, 0);
  const onLeave = availability.filter((r) => r.leaveRequested).length;
  const totalHours = draft.assignments.reduce((s, a) => s + a.durationHours, 0);
  const warnings = draft.warnings.length;

  const metrics: Metric[] = [
    { label: "Tổng nhu cầu", value: `${totalNeed}`, hint: "ca", icon: Users, tone: "text-primary" },
    { label: "Đã xếp", value: `${assigned}`, hint: "dealer", icon: CheckCircle2, tone: "text-emerald-400" },
    { label: "Còn thiếu", value: `${missing}`, hint: "dealer", icon: AlertTriangle, tone: missing > 0 ? "text-amber-400" : "text-muted-foreground" },
    { label: "Xin nghỉ", value: `${onLeave}`, hint: "người", icon: CalendarOff, tone: "text-blue-400" },
    { label: "Tổng giờ dự kiến", value: `${totalHours.toFixed(0)}`, hint: "giờ", icon: Clock, tone: "text-purple-400" },
    { label: "Cảnh báo", value: `${warnings}`, hint: "mục", icon: BellRing, tone: warnings > 0 ? "text-amber-400" : "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <Card key={m.label} className="p-3 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg grid place-items-center bg-muted/50 ${m.tone}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-muted-foreground truncate">{m.label}</div>
              <div className="text-lg font-bold leading-tight">
                {m.value} {m.hint && <span className="text-[11px] font-medium text-muted-foreground">{m.hint}</span>}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
