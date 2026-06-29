import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ArrowRightLeft, Receipt, UserMinus, Loader2, User } from "lucide-react";
import { formatVND } from "@/lib/format";
import type { ActionSeat } from "./PlayerActionSheet";

/**
 * Kholdem-style player info bottom-sheet (read reference). Shows a clean info card
 * for floor/cashier reference + the same primary actions (Chuyển / Phiếu / Loại).
 * Reuses the seat data already loaded; fields not in the current model render "—"
 * (never fabricated). No business logic here — actions call parent handlers.
 */
export function PlayerInfoSheet({
  open, onOpenChange, seat, ticketNumber, canMove, busting, onMove, onReceipt, onBust,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  seat: ActionSeat | null;
  ticketNumber?: string;
  canMove: boolean;
  busting: boolean;
  onMove: () => void;
  onReceipt?: () => void;
  onBust: () => void;
}) {
  if (!seat) return null;
  const name = seat.player_name || seat.player_id.slice(0, 8);
  const parts = name.trim().split(" ");
  const ini = ((parts[0]?.[0] ?? "?") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
  // Close THIS sheet first, then open the next dialog on the NEXT frame — opening it
  // in the same commit as the close makes Radix swap two modal layers at once, which
  // on touch leaves the new sheet with pointer-events:none (its X became untappable).
  const act = (fn?: () => void) => {
    if (!fn) return;
    onOpenChange(false);
    requestAnimationFrame(fn);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] overflow-y-auto sm:mx-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="sr-only">Thông tin người chơi — {name}</SheetTitle>
        </SheetHeader>

        {/* Identity */}
        <div className="flex flex-col items-center pt-1 pb-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-xl font-semibold text-primary">
            {ini || <User className="h-7 w-7" />}
          </span>
          <div className="mt-2 text-lg font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground">— · —</div>
        </div>

        {/* Info rows */}
        <div className="rounded-xl border border-border/60 bg-card/60 px-3">
          <InfoRow label="Phiếu / Ticket" value={ticketNumber ?? "—"} />
          <InfoRow label="Ngồi" value={`${seat.table_name} · Ghế ${seat.seat_number}`} />
          <InfoRow label="Lượt vào" value={`#${seat.entry_number}`} />
          <InfoRow label="Vị trí" value="—" />
          <InfoRow label="Chip / Stack" value={formatVND(seat.chip_count)} highlight />
          <InfoRow label="Payout" value="—" />
          <InfoRow label="Thẻ thành viên" value="—" />
          <InfoRow label="Hết hạn" value="—" last />
        </div>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Button
            className="h-12"
            disabled={!canMove}
            onClick={() => act(onMove)}
          >
            <ArrowRightLeft className="mr-1.5 h-4 w-4" /> Chuyển
          </Button>
          <Button variant="outline" className="h-12" disabled={!onReceipt} onClick={() => act(onReceipt)}>
            <Receipt className="mr-1.5 h-4 w-4 text-sky-400" /> Phiếu
          </Button>
          <Button
            variant="outline"
            className="h-12 border-destructive/45 text-destructive hover:bg-destructive/10"
            disabled={busting}
            onClick={onBust}
          >
            {busting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserMinus className="mr-1.5 h-4 w-4" />} Loại
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ label, value, highlight, last }: { label: string; value?: ReactNode; highlight?: boolean; last?: boolean }) {
  return (
    <div className={`grid grid-cols-2 items-center py-3 ${last ? "" : "border-b border-border/40"}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={highlight ? "text-right text-lg font-bold text-primary" : "text-right text-sm font-semibold text-foreground"}>
        {value ?? "—"}
      </div>
    </div>
  );
}
