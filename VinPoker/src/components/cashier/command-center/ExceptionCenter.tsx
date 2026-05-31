import { useMemo } from "react";
import { Clock, Table2, UserMinus, HelpCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DealerAssignment, DealerAttendance } from "@/hooks/useDealerSwing";
import type { NextDealerPrediction } from "@/hooks/useDealerSwing";

interface ExceptionItem {
  id: string;
  type: "ot" | "empty_table" | "break_due" | "missing_next_dealer";
  severity: "critical" | "warning";
  title: string;
  subtitle?: string;
  tableId?: string;
  attendanceId?: string;
}

interface Props {
  assignments: DealerAssignment[];
  tables: any[];
  dealers: DealerAttendance[];
  tableAssignmentMap: Record<string, DealerAssignment | null>;
  timelineByTableId: Record<string, { minutesLeft: number; showNextDealerSoon: boolean; isOverdue: boolean }>;
  nextDealerMap: Record<string, NextDealerPrediction> | null;
  nowMs: number;
  onSwing: (attendanceId: string) => void;
  onAssign: (tableId: string) => void;
  onSendToBreak: (attendanceId: string) => void;
}

export default function ExceptionCenter({
  assignments, tables, dealers, tableAssignmentMap,
  timelineByTableId, nextDealerMap, nowMs,
  onSwing, onAssign, onSendToBreak,
}: Props) {
  const exceptions = useMemo<ExceptionItem[]>(() => {
    const items: ExceptionItem[] = [];

    // 1. OT — confirmed by server overtime_started_at
    for (const a of assignments) {
      if (a.status !== "assigned") continue;
      if (!a.overtime_started_at) continue;

      const otSec = Math.floor((nowMs - new Date(a.overtime_started_at).getTime()) / 1000);
      const otMin = Math.floor(otSec / 60);
      const otDisplay = otMin >= 60
        ? `+${Math.floor(otMin / 60)}h${otMin % 60}m`
        : `+${otMin}m`;

      items.push({
        id: `ot-${a.id}`,
        type: "ot",
        severity: "critical",
        title: `${a.game_tables?.table_name ?? "??"} OT ${otDisplay}`,
        subtitle: a.dealer_attendance?.dealers?.full_name ?? undefined,
        tableId: a.table_id,
        attendanceId: a.attendance_id,
      });
    }

    // 2. Empty tables — active tables with no assignment
    for (const t of tables ?? []) {
      if (tableAssignmentMap[t.id]) continue;
      items.push({
        id: `empty-${t.id}`,
        type: "empty_table",
        severity: "warning",
        title: `${t.table_name ?? "??"} bàn trống`,
        subtitle: "Chưa có dealer",
        tableId: t.id,
      });
    }

    // 3. Break due — dealers who urgently need break
    for (const d of dealers) {
      const w = d.worked_minutes_since_last_break ?? 0;
      if (w < 90 && !d.priority_break_flag) continue;
      const name = (d as any).dealers?.full_name ?? "??";
      items.push({
        id: `break-${d.id}`,
        type: "break_due",
        severity: "critical",
        title: `${name} cần nghỉ ngay`,
        subtitle: d.priority_break_flag ? "Priority break" : `Đã làm ${w} phút`,
        attendanceId: d.id,
      });
    }

    // 4. Missing next dealer — swing coming up but no next dealer
    if (nextDealerMap) {
      for (const t of tables ?? []) {
        const tl = timelineByTableId[t.id];
        if (!tl?.showNextDealerSoon) continue;
        const pred = nextDealerMap[t.id];
        if (pred?.nextDealerName) continue;
        items.push({
          id: `next-${t.id}`,
          type: "missing_next_dealer",
          severity: "warning",
          title: `${t.table_name ?? "??"} chưa có dealer kế`,
          subtitle: tl.isOverdue ? "Đã quá giờ swing" : `${tl.minutesLeft} phút còn lại`,
          tableId: t.id,
        });
      }
    }

    // Sort: OT → break_due → empty_table → missing_next_dealer
    const order: Record<string, number> = {
      ot: 0, break_due: 1, empty_table: 2, missing_next_dealer: 3,
    };
    items.sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
    return items;
  }, [assignments, tables, dealers, tableAssignmentMap, timelineByTableId, nextDealerMap, nowMs]);

  if (exceptions.length === 0) return null;

  const criticalCount = exceptions.filter((e) => e.severity === "critical").length;

  const iconMap: Record<string, React.ReactNode> = {
    ot: <Clock className="w-3 h-3" />,
    empty_table: <Table2 className="w-3 h-3" />,
    break_due: <UserMinus className="w-3 h-3" />,
    missing_next_dealer: <HelpCircle className="w-3 h-3" />,
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cần xử lý
          </span>
          <span className="text-[9px] font-mono text-muted-foreground bg-muted/20 px-1 py-0.5">
            {exceptions.length}
          </span>
        </div>
        {criticalCount > 0 && (
          <span className="text-[9px] font-bold text-red-500">{criticalCount} nghiêm trọng</span>
        )}
      </div>

      <div className="space-y-1">
        {exceptions.map((ex) => (
          <div
            key={ex.id}
            className={`border-l-2 pl-2 py-1.5 pr-1 flex items-start gap-1.5 ${
              ex.severity === "critical"
                ? "border-red-500 bg-red-500/5"
                : "border-amber-500 bg-amber-500/5"
            }`}
          >
            <div className="mt-0.5 flex-shrink-0">
              <span className={ex.severity === "critical" ? "text-red-500" : "text-amber-500"}>
                {iconMap[ex.type]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[11px] font-medium leading-tight truncate ${
                ex.severity === "critical" ? "text-red-400" : "text-amber-400"
              }`}>
                {ex.title}
              </div>
              {ex.subtitle && (
                <div className="text-[10px] text-muted-foreground truncate">{ex.subtitle}</div>
              )}
            </div>
            <div className="flex-shrink-0 ml-1">
              {ex.type === "ot" && ex.attendanceId && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5"
                  onClick={() => onSwing(ex.attendanceId!)}>
                  Swing <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
                </Button>
              )}
              {(ex.type === "empty_table" || ex.type === "missing_next_dealer") && ex.tableId && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5"
                  onClick={() => onAssign(ex.tableId!)}>
                  Gán <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
                </Button>
              )}
              {ex.type === "break_due" && ex.attendanceId && (
                <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5"
                  onClick={() => onSendToBreak(ex.attendanceId!)}>
                  Break <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
