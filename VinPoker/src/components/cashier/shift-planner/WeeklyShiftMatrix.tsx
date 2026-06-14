import { cn } from "@/lib/utils";
import type {
  AvailabilityRequest,
  DraftAssignment,
  SchedulerDealer,
} from "@/types/shiftPlanner";
import { weekDates, weekdayLabel } from "./ShiftPlanner.utils";

interface Props {
  workDate: string;
  dealers: SchedulerDealer[];
  assignments: DraftAssignment[];
  availability: AvailabilityRequest[];
}

/**
 * Phase 1: weekly grid (row = dealer, col = 7 days). Only the selected work date
 * column is populated from the current draft; other days show "—" because Phase 1
 * has a single day's plan. Phase 2 fills the whole week from dealer_shift_assignments.
 */
export default function WeeklyShiftMatrix({ workDate, dealers, assignments, availability }: Props) {
  const days = weekDates(workDate);
  const assignmentByDealer = new Map(assignments.map((a) => [a.dealerId, a]));
  const onLeave = new Set(availability.filter((r) => r.leaveRequested).map((r) => r.dealerId));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="text-left font-semibold px-2 py-2 sticky left-0 bg-card">Dealer</th>
            {days.map((d, i) => (
              <th
                key={d}
                className={cn("px-2 py-2 font-semibold text-center", d === workDate && "text-primary")}
              >
                {weekdayLabel(i)}
                <div className="text-[10px] font-normal text-muted-foreground">{d.slice(8, 10)}/{d.slice(5, 7)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dealers.map((dealer) => {
            const a = assignmentByDealer.get(dealer.id);
            const leave = onLeave.has(dealer.id);
            return (
              <tr key={dealer.id} className="border-t border-border/60">
                <td className="px-2 py-2 font-medium whitespace-nowrap sticky left-0 bg-card">{dealer.fullName}</td>
                {days.map((d) => {
                  const isWork = d === workDate;
                  let cell: { label: string; className: string };
                  if (isWork && a) {
                    cell = { label: a.templateLabel, className: "bg-success/15 text-success border-success/30" };
                  } else if (isWork && leave) {
                    cell = { label: "Nghỉ", className: "bg-[hsl(var(--ds-active)_/_0.15)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.3)]" };
                  } else if (isWork) {
                    cell = { label: "Off", className: "bg-muted text-muted-foreground border-border" };
                  } else {
                    cell = { label: "—", className: "text-muted-foreground/40 border-transparent" };
                  }
                  return (
                    <td key={d} className="px-1.5 py-1.5 text-center">
                      <span className={cn("inline-flex min-w-[3rem] justify-center px-2 py-1 rounded-md border text-[11px] font-semibold", cell.className)}>
                        {cell.label}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground mt-2">
        Phase 1: chỉ cột ngày đang chọn được điền từ bản nháp. Lịch tuần đầy đủ sẽ có khi áp dụng DB (Phase 2).
      </p>
    </div>
  );
}
