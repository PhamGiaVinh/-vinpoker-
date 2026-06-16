import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { UserPlus, X } from "lucide-react";
import type { SchedulerDealer } from "@/types/shiftPlanner";
import {
  shiftWindowLabel,
  skillBadgeClass,
  statusMeta,
  tierLabel,
  type ShiftGroup,
} from "./ShiftPlanner.utils";

interface Props {
  group: ShiftGroup;
  dealersById: Map<string, SchedulerDealer>;
  /** When provided, each assigned dealer row gets a remove (✕) control. */
  onRemove?: (templateId: string, dealerId: string) => void;
}

export default function ShiftGroupRow({ group, dealersById, onRemove }: Props) {
  const { template, assignments } = group;
  const short = assignments.length < template.needCount;
  const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Group header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold tabular-nums">{template.label}</span>
          <span className="text-[11px] text-muted-foreground">{shiftWindowLabel(template)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-[11px] font-semibold tabular-nums", short ? "text-warning" : "text-muted-foreground")}>
            {assignments.length}/{template.needCount}
          </span>
          {short && (
            <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 text-[10px]">
              Thiếu {template.needCount - assignments.length}
            </Badge>
          )}
          {template.needsLead && (
            <Badge variant="outline" className="bg-[hsl(var(--ds-preassign)_/_0.15)] text-[hsl(var(--ds-preassign))] border-[hsl(var(--ds-preassign)_/_0.3)] text-[10px]">
              Lead
            </Badge>
          )}
        </div>
      </div>

      {/* Assigned dealers */}
      {assignments.map((a) => {
        const dealer = dealersById.get(a.dealerId);
        const st = statusMeta(a.status);
        return (
          <div
            key={`${a.templateId}-${a.dealerId}`}
            className="grid grid-cols-[1.6fr_1fr_0.9fr_auto] items-center gap-2 px-3 py-2 border-t border-border/60"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-muted to-muted-foreground/30 grid place-items-center text-xs font-bold shrink-0">
                {initials(a.dealerName)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{a.dealerName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {dealer ? tierLabel(dealer.tier) : a.role}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {(dealer?.skills ?? []).slice(0, 3).map((skill) => (
                <span
                  key={skill}
                  className={cn("px-1.5 py-0.5 rounded-md border text-[10px] font-semibold", skillBadgeClass(skill))}
                >
                  {skill}
                </span>
              ))}
            </div>

            <div className="text-[11px] text-muted-foreground hidden sm:block">
              {a.isNightShift ? "Ca đêm" : "Ca ngày"} · {a.durationHours}h
            </div>

            <div className="flex items-center gap-2 justify-end">
              <span
                className="text-[11px] font-semibold tabular-nums text-muted-foreground"
                title={a.reasons.join(" · ")}
              >
                {a.score}đ
              </span>
              <Badge variant="outline" className={cn("text-[10px]", st.className)}>
                {st.label}
              </Badge>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(a.templateId, a.dealerId)}
                  title={`Xoá ${a.dealerName} khỏi ca ${template.label}`}
                  aria-label={`Xoá ${a.dealerName}`}
                  className="grid place-items-center w-6 h-6 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Shortage hint (read-only in Phase 1) */}
      {short && (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-dashed border-warning/30 text-[12px] text-warning/90">
          <UserPlus className="w-3.5 h-3.5" />
          Cần thêm {template.needCount - assignments.length} dealer cho khung {template.label}
        </div>
      )}
    </div>
  );
}
