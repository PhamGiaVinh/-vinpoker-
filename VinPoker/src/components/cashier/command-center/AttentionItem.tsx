import { Clock, Table2, UserMinus, HelpCircle, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttentionItem as AttentionItemData } from "@/hooks/useAttentionQueue";

interface Props {
  item: AttentionItemData;
  onSwing?: (tableId: string) => void;
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
      className={`flex items-center gap-2 pl-2.5 pr-2 py-2 border-l-2 rounded-none cursor-pointer transition-colors ${
        isCritical
          ? "border-destructive bg-destructive/5 hover:bg-destructive/10"
          : "border-warning bg-warning/5 hover:bg-warning/10"
      }`}
      onClick={() => onFocusTable?.(item.tableId ?? "")}
    >
      <span className={`flex-shrink-0 ${isCritical ? "text-destructive" : "text-warning"}`}>
        {ICON_MAP[item.type]}
      </span>

      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className={`text-[11px] font-medium leading-tight truncate ${
          isCritical ? "text-destructive" : "text-warning"
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
        {item.type === "ot" && item.tableId && onSwing && (
          <Button size="sm" variant="ghost" className="h-11 px-3 text-xs"
            onClick={() => onSwing(item.tableId!)}>
            Swing <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
          </Button>
        )}
        {(item.type === "empty_table" || item.type === "missing_next_dealer") && item.tableId && onAssign && (
          <Button size="sm" variant="ghost" className="h-11 px-3 text-xs"
            onClick={() => onAssign(item.tableId!)}>
            Gán <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
          </Button>
        )}
        {item.type === "break_due" && item.attendanceId && onSendToBreak && (
          <Button size="sm" variant="ghost" className="h-11 px-3 text-xs"
            onClick={() => onSendToBreak(item.attendanceId!)}>
            Break <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
          </Button>
        )}
        {item.tableId && onFocusTable && (
          <Button size="sm" variant="ghost" className="h-11 px-3 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onFocusTable(item.tableId!)}>
            Xem
          </Button>
        )}
      </div>
    </div>
  );
}
