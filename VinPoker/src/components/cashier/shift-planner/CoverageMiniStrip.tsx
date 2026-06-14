import { cn } from "@/lib/utils";
import { coverageSeverity } from "@/lib/shiftPlanner";
import type { CoverageBucket } from "@/types/shiftPlanner";
import { coverageChipClass, hourLabel } from "./ShiftPlanner.utils";

interface Props {
  coverage: CoverageBucket[];
}

/** have/need chips per hour-of-day (only hours that need coverage). */
export default function CoverageMiniStrip({ coverage }: Props) {
  const active = coverage.filter((b) => b.required > 0);
  if (active.length === 0) {
    return <div className="text-xs text-muted-foreground">Chưa cấu hình nhu cầu theo giờ.</div>;
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-12 gap-1.5">
        {active.map((b) => {
          const sev = coverageSeverity(b);
          return (
            <div key={b.hour} className="text-center">
              <div className="text-[10px] text-muted-foreground mb-1">{hourLabel(b.hour)}</div>
              <div
                className={cn(
                  "h-7 rounded-md border grid place-items-center text-[11px] font-bold tabular-nums",
                  coverageChipClass(sev)
                )}
                title={`Cần ${b.required}, đã xếp ${b.assigned}`}
              >
                {b.assigned}/{b.required}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Đủ</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Thiếu nhẹ</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-red-400 inline-block" />Thiếu nặng</span>
      </div>
    </div>
  );
}
