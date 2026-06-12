import { useAttentionQueue, type AttentionItem as AttentionItemData } from "@/hooks/useAttentionQueue";
import type { DealerAssignment, DealerAttendance, NextDealerPrediction } from "@/hooks/useDealerSwing";
import type { RotationTableSlots } from "@/hooks/useRotationSchedule";
import AttentionItem from "./AttentionItem";

interface Props {
  assignments: DealerAssignment[];
  tables: any[];
  dealers: DealerAttendance[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  timelineByTableId: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  scheduleByTableId?: Record<string, RotationTableSlots> | null;
  nowMs: number;
  autoSwingEnabled: boolean;
  onSwing: (tableId: string) => void;
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
  onFocusTable?: (tableId: string) => void;
}

export default function AttentionQueue({
  assignments, tables, dealers, tableAssignmentMap,
  timelineByTableId, nextDealerMap, scheduleByTableId, nowMs, autoSwingEnabled,
  onSwing, onAssign, onSendToBreak, onFocusTable,
}: Props) {
  const { criticalItems, warningItems, totalCount } = useAttentionQueue({
    assignments, tables, dealers, tableAssignmentMap,
    timelineByTableId, nextDealerMap, scheduleByTableId, nowMs,
  });

  // ── Empty state ──
  if (totalCount === 0) {
    const activeTables = tables?.length ?? 0;
    const assignedTables = assignments.filter((a) => a.status === "assigned").length;
    const otZero = !assignments.some((a) => a.status === "assigned" && a.overtime_started_at);

    return (
      <div className="border border-emerald-500/30 bg-emerald-950/10 rounded-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-sm">✅</span>
          <span className="text-[11px] font-semibold text-emerald-500">Hệ thống ổn định</span>
        </div>
        <div className="text-[10px] text-muted-foreground space-y-0.5">
          <div>{assignedTables}/{activeTables} bàn có dealer</div>
          {autoSwingEnabled && <div>Auto-Swing đang hoạt động</div>}
          {otZero && <div>Không có OT</div>}
        </div>
      </div>
    );
  }

  // ── Render groups ──
  const renderGroup = (items: AttentionItemData[], label: string, icon: string, borderColor: string, textColor: string) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${textColor}`}>
          <span>{icon}</span>
          <span>{label}</span>
          <span className="ml-auto font-mono text-[9px] opacity-60">{items.length}</span>
        </div>
        <div className="space-y-0.5">
          {items.map((item) => (
            <AttentionItem
              key={item.id}
              item={item}
              onSwing={onSwing}
              onAssign={onAssign}
              onSendToBreak={onSendToBreak}
              onFocusTable={onFocusTable}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Cần xử lý
        </span>
        <span className="text-[9px] font-mono text-muted-foreground bg-muted/20 px-1 py-0.5">
          {totalCount}
        </span>
      </div>

      {renderGroup(criticalItems, "Cần xử lý ngay", "🔴", "border-red-500", "text-red-500")}
      {renderGroup(warningItems, "Cảnh báo", "⚠️", "border-amber-500", "text-amber-500")}
    </div>
  );
}
