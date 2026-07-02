import { cn } from "@/lib/utils";
import { weekDates, weekdayLabel } from "../shift-planner/ShiftPlanner.utils";
import type { RunStatusDay } from "@/hooks/useScheduleRunStatus";

/**
 * V2 week strip — 7 day chips above the planner (owner: "thêm lịch tuần…
 * dealer control cũng tự động sync để xem có bao nhiêu tour, cần bao nhiêu
 * dealer"). Per day: published/draft/none status + persisted-assignment count +
 * tournament count from the tournaments table. Clicking a day loads it into the
 * day planner below. Floor and Dealer Control read the same DB rows → the strip
 * IS the shared week view.
 */
export function WeekStrip({
  workDate,
  runsByDate,
  assignmentCountByDate,
  tourCountByDate,
  onSelectDate,
}: {
  workDate: string;
  runsByDate: Record<string, RunStatusDay>;
  assignmentCountByDate: Record<string, number>;
  tourCountByDate: Record<string, number>;
  onSelectDate: (d: string) => void;
}) {
  const days = weekDates(workDate);

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {days.map((d, i) => {
        const selected = d === workDate;
        const run = runsByDate[d];
        const nAsg = assignmentCountByDate[d] ?? 0;
        const nTour = tourCountByDate[d];
        const ddmm = `${d.slice(8, 10)}/${d.slice(5, 7)}`;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelectDate(d)}
            className={cn(
              "min-w-[104px] flex-1 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:bg-muted/40"
            )}
          >
            <div className="text-[11px] font-bold">
              {weekdayLabel(i)} {ddmm}
            </div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              {nTour != null && <>{nTour} tour · </>}
              {run?.status === "published" ? (
                <span className="text-primary">✓ đã phát hành{nAsg > 0 ? ` · ${nAsg} ca` : ""}</span>
              ) : run?.status === "draft" ? (
                <span className="text-warning">● nháp{nAsg > 0 ? ` · ${nAsg} ca` : ""}</span>
              ) : selected ? (
                <span className="text-warning">● đang xếp</span>
              ) : (
                <span>chưa có lịch</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
