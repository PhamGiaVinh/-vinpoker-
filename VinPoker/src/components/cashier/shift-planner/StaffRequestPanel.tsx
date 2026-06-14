import { CalendarOff, Star, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AvailabilityRequest, SchedulerDealer, ShiftTemplate } from "@/types/shiftPlanner";

interface Props {
  availability: AvailabilityRequest[];
  templates: ShiftTemplate[];
  dealers: SchedulerDealer[];
}

export default function StaffRequestPanel({ availability, templates, dealers }: Props) {
  const labelOf = (id: string) => templates.find((t) => t.id === id)?.label ?? id;
  const nameOf = (id: string) => dealers.find((d) => d.id === id)?.fullName ?? id;

  if (availability.length === 0) {
    return <div className="text-sm text-muted-foreground px-1 py-3">Chưa có yêu cầu xin ca / nghỉ phép.</div>;
  }

  return (
    <div className="space-y-2">
      {availability.map((r) => (
        <div key={r.dealerId} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold truncate">{nameOf(r.dealerId)}</span>
            {r.leaveRequested ? (
              <Badge variant="outline" className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px]">
                <CalendarOff className="w-3 h-3 mr-1" /> Xin nghỉ
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-primary/15 text-primary border-primary/30 text-[10px]">
                Xin ca
              </Badge>
            )}
          </div>

          {r.preferredTemplateIds.length > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mt-1.5">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              Ưu tiên: {r.preferredTemplateIds.map(labelOf).join(", ")}
            </div>
          )}
          {r.availableTemplateIds.length > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mt-1">
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              Có thể làm: {r.availableTemplateIds.map(labelOf).join(", ")}
            </div>
          )}
          {r.note && <p className="text-[12px] text-muted-foreground/80 italic mt-1">{r.note}</p>}
        </div>
      ))}
    </div>
  );
}
