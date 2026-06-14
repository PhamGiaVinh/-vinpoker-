import type { DraftAssignment, SchedulerDealer, ShiftTemplate } from "@/types/shiftPlanner";
import { buildShiftGroups } from "./ShiftPlanner.utils";
import ShiftGroupRow from "./ShiftGroupRow";

interface Props {
  templates: ShiftTemplate[];
  assignments: DraftAssignment[];
  dealers: SchedulerDealer[];
}

/** "Danh sách ca hôm nay" — grouped by shift start time. */
export default function DailyShiftTable({ templates, assignments, dealers }: Props) {
  const groups = buildShiftGroups(templates, assignments);
  const dealersById = new Map(dealers.map((d) => [d.id, d]));

  if (groups.length === 0) {
    return <div className="text-sm text-muted-foreground px-3 py-6 text-center">Chưa có khung ca nào.</div>;
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="grid grid-cols-[1.6fr_1fr_0.9fr_auto] gap-2 px-3 py-2 bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Dealer</span>
        <span>Kỹ năng</span>
        <span className="hidden sm:block">Loại ca</span>
        <span className="text-right">Điểm · Trạng thái</span>
      </div>
      {groups.map((group) => (
        <ShiftGroupRow key={group.template.id} group={group} dealersById={dealersById} />
      ))}
    </div>
  );
}
