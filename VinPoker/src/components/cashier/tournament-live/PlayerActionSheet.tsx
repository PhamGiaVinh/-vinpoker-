import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, ArrowRightLeft, Armchair, UserMinus, Loader2 } from "lucide-react";
import { formatVND } from "@/lib/format";

export interface ActionSeat {
  seat_id: string;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string;
  table_name: string;
  seat_number: number;
  chip_count: number;
}

/**
 * Kholdem-style player action sheet (bottom sheet). Wires the EXISTING functions:
 * - Chuyển → opens the move number-stepper (move_player_seat); hidden/disabled for
 *   non-entry seats or viewers who aren't owner/cashier.
 * - Loại (bust) → flips is_active=false via the floor save path.
 * - Đổi ghế trống (Free sit) → DISABLED "Sắp có" (needs tournament_waitlist backend).
 * - Thông tin → inline player detail.
 */
export function PlayerActionSheet({
  open, onOpenChange, seat, entryId, canMove, busting, onMove, onBust,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seat: ActionSeat | null;
  entryId: string | undefined;
  canMove: boolean;
  busting: boolean;
  onMove: () => void;
  onBust: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  if (!seat) return null;
  const moveAllowed = !!entryId && canMove;
  const moveReason = !entryId
    ? "Người chơi chưa có entry/phiếu — không chuyển được"
    : !canMove
      ? "Cần quyền chủ CLB / thu ngân để chuyển ghế"
      : "";

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) setShowInfo(false); onOpenChange(v); }}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="text-center">
          <SheetTitle>
            {seat.table_name} · Ghế {seat.seat_number} — {seat.player_name || seat.player_id.slice(0, 8)}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-2 divide-y divide-border">
          {/* Thông tin */}
          <button
            className="flex w-full items-center gap-3 py-3.5 text-left"
            onClick={() => setShowInfo((v) => !v)}
          >
            <Info className="h-5 w-5 text-muted-foreground" />
            <span className="text-[15px]">Thông tin người chơi</span>
          </button>
          {showInfo && (
            <div className="space-y-1 bg-muted/20 px-3 py-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Bàn / Ghế</span><span>{seat.table_name} · {seat.seat_number}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Chip</span><span className="font-mono">{formatVND(seat.chip_count)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Lượt vào</span><span>#{seat.entry_number}</span></div>
            </div>
          )}

          {/* Chuyển */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <button
                    className="flex w-full items-center gap-3 py-3.5 text-left disabled:opacity-50"
                    disabled={!moveAllowed}
                    onClick={() => { onMove(); onOpenChange(false); }}
                  >
                    <ArrowRightLeft className={`h-5 w-5 ${moveAllowed ? "text-primary" : "text-muted-foreground"}`} />
                    <span className={`text-[15px] ${moveAllowed ? "font-medium text-primary" : ""}`}>Chuyển ghế</span>
                  </button>
                </span>
              </TooltipTrigger>
              {!moveAllowed && <TooltipContent>{moveReason}</TooltipContent>}
            </Tooltip>
          </TooltipProvider>

          {/* Đổi ghế trống (Free sit) — Sắp có */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <button className="flex w-full items-center gap-3 py-3.5 text-left opacity-50" disabled>
                    <Armchair className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[15px]">Đổi ghế trống</span>
                    <span className="ml-auto rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning">Sắp có</span>
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Cần backend hàng chờ (waitlist) — sắp có</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Loại / Bust */}
          <button
            className="flex w-full items-center gap-3 py-3.5 text-left text-destructive disabled:opacity-50"
            disabled={busting}
            onClick={onBust}
          >
            {busting ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserMinus className="h-5 w-5" />}
            <span className="text-[15px]">Loại (bust)</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
