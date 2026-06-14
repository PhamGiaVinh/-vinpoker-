import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2 } from "lucide-react";

interface SwingHistoryEntry {
  id: string;
  dealerName: string;
  dealerTier: string | null;
  status: string;
  swungAt: string | null;
  createdAt: string;
  durationMinutes: number;
  actualMinutes: number;
  wasOT: boolean;
  overtimeMinutes: number;
}

interface TableCardKebabProps {
  tableId: string;
  tableName: string;
  hasActiveAssign: boolean;
  onManualSwing: () => void;
  onForceClose: () => void;
}

export function TableCardKebab({
  tableId,
  tableName,
  hasActiveAssign,
  onManualSwing,
  onForceClose,
}: TableCardKebabProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<SwingHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (history !== null) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "swing-history",
        { body: { table_id: tableId, limit: 8 } }
      );

      if (fnError) throw fnError;
      setHistory((data as any)?.history ?? []);
    } catch (e: any) {
      setError(e.message ?? "Không tải được lịch sử");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [tableId, history]);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) loadHistory();
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none w-9 h-9 flex items-center justify-center rounded-lg hover:bg-muted/20 transition-colors"
          aria-label={`Menu cho bàn ${tableName}`}
          onClick={(e) => e.stopPropagation()}
        >
          ···
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="min-w-[200px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Actions */}
        <DropdownMenuItem
          onClick={onManualSwing}
          disabled={!hasActiveAssign}
          className="cursor-pointer text-xs"
        >
          <span className="mr-2">🔄</span> Manual Swing
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={onForceClose}
          className="cursor-pointer text-xs text-destructive focus:text-destructive focus:bg-destructive/10"
        >
          <span className="mr-2">✕</span> Force Close
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* History header */}
        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Lịch sử swing ({history?.length ?? "..."})
        </div>

        {loading && (
          <div className="px-2 py-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Đang tải...
          </div>
        )}

        {error && (
          <div className="px-2 py-2 text-xs text-destructive">{error}</div>
        )}

        {!loading && !error && history?.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">Chưa có lịch sử</div>
        )}

        {!loading && !error && history?.map((entry) => (
          <div key={entry.id} className="px-2 py-1.5 border-b border-border/30 last:border-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-warning/90">{entry.dealerName}</span>
              {entry.wasOT && (
                <span className="text-[9px] font-bold px-1 py-[1px] rounded-sm bg-destructive/20 text-destructive">OT</span>
              )}
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[10px] text-muted-foreground">
                {entry.swungAt
                  ? new Date(entry.swungAt).toLocaleTimeString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {entry.actualMinutes}ph
                {entry.wasOT && entry.overtimeMinutes > 0 && (
                  <span className="text-destructive ml-1">+{entry.overtimeMinutes}OT</span>
                )}
              </span>
            </div>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
