import { Clock, Table2, UserMinus, HelpCircle, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttentionItem as AttentionItemData } from "@/hooks/useAttentionQueue";

interface Props {
  item: AttentionItemData;
  onSwing?: (attendanceId: string) => void;
  onAssign?: (tableId: string) => void;
  onSendToBreak?: (attendanceId: string) => void;
  onFocusTable?: (tableId: string) => void;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  ot: <Clock className="w-3 h-3" />,
  empty_table: <Table2 className="w-3 h-3" />,
  break_due: <UserMinus className="w-3 h-3" />,
  missing_next_dealer: <HelpCircle className="w-3 h-3" />,
  shortage: <AlertTriangle className="w-3 h-3" />,
};

export default function AttentionItem({ item, onSwing, onAssign, onSendToBreak, onFocusTable }: Props) {
  const isCritical = item.severity === "critical";

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-2 lg:py-1.5 rounded-sm cursor-pointer transition-colors ${
        isCritical
          ? "bg-red-500/5 hover:bg-red-500/10"
          : "bg-amber-500/5 hover:bg-amber-500/10"
      }`}
      onClick={() => onFocusTable?.(item.tableId ?? "")}
    >
      <span className={`flex-shrink-0 ${isCritical ? "text-red-500" : "text-amber-500"}`}>
        {ICON_MAP[item.type]}
      </span>

      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className={`text-[11px] font-medium leading-tight truncate ${
          isCritical ? "text-red-400" : "text-amber-400"
        }`}>
          {item.title}
        </span>
        {item.subtitle && (
          <span className="text-[10px] text-muted-foreground truncate hidden sm:inline">
            {item.subtitle}
          </span>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        {item.type === "ot" && item.attendanceId && onSwing && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px] lg:h-6 lg:px-1.5 lg:text-[10px]"
            onClick={() => onSwing(item.attendanceId!)}>
            Swing <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
          </Button>
        )}
        {(item.type === "empty_table" || item.type === "missing_next_dealer") && item.tableId && onAssign && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px] lg:h-6 lg:px-1.5 lg:text-[10px]"
            onClick={() => onAssign(item.tableId!)}>
            Gán <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
          </Button>
        )}
        {item.type === "break_due" && item.attendanceId && onSendToBreak && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px] lg:h-6 lg:px-1.5 lg:text-[10px]"
            onClick={() => onSendToBreak(item.attendanceId!)}>
            Break <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
          </Button>
        )}
        {item.tableId && onFocusTable && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px] lg:h-6 lg:px-1.5 lg:text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => onFocusTable(item.tableId!)}>
            Xem
          </Button>
        )}
      </div>
    </div>
  );
}
