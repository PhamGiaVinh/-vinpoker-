import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserPlus, ExternalLink, Lock, Plus } from "lucide-react";
import { formatVND } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { OpenTableDialog } from "./OpenTableDialog";
import { AddPlayerDialog } from "./AddPlayerDialog";
import { CloseTableDialog } from "./CloseTableDialog";

export interface MapSeat {
  seat_id: string;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string;
  table_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
}

export interface MapTable {
  tt_id: string;          // tournament_tables.id
  table_id: string;       // game_tables.id (seat.table_id)
  table_number: number | null;
  table_name: string;
  max_seats: number;
  status: string;
}

// Floor table-ops (open / add player / close+redraw) ship behind this flag. While
// OFF, the action buttons are disabled "Cần bật RPC" and the dialogs are not mounted —
// they never call the (live) RPCs. Flip the flag after UAT.
const TABLE_OPS_LIVE = FEATURES.floorTableOps;

/**
 * Table-detail sheet. Shows the selected table's seats — occupied (name + chips,
 * tappable → action sheet) and empty slots — plus the table-ops actions: Mở bàn /
 * Thêm người / Đóng bàn (gated behind FEATURES.floorTableOps; seat moves only, no money).
 */
export function FloorTableDetailSheet({
  open, onOpenChange, table, seats, onSeatTap,
  tournamentId, tournamentName, tournamentDate, unlinkedActiveSeatCount = 0, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  table: MapTable | null;
  seats: MapSeat[];
  onSeatTap: (seat: MapSeat) => void;
  tournamentId: string;
  tournamentName: string;
  tournamentDate: string | null;
  unlinkedActiveSeatCount?: number;
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<null | "open" | "add" | "close">(null);
  if (!table) return null;
  const bySeat = new Map<number, MapSeat>();
  for (const s of seats) bySeat.set(s.seat_number, s);
  const occupied = seats.length;
  const occupiedSeatNumbers = seats.map((s) => s.seat_number);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {table.table_name}
              <span className="rounded-md border border-primary/35 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {occupied}/{table.max_seats}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {Array.from({ length: table.max_seats }, (_, i) => i + 1).map((n) => {
              const s = bySeat.get(n);
              if (s) {
                return (
                  <button
                    key={n}
                    onClick={() => onSeatTap(s)}
                    className="rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-primary/50"
                  >
                    <div className="text-[10px] text-muted-foreground">Ghế {n}</div>
                    <div className="truncate text-xs font-medium">{s.player_name || s.player_id.slice(0, 6)}</div>
                    <div className="font-mono text-[11px] text-primary">{formatVND(s.chip_count)}</div>
                  </button>
                );
              }
              return (
                <div
                  key={n}
                  className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 p-2 text-muted-foreground"
                  aria-label={`Ghế ${n} trống`}
                >
                  <div className="text-[10px]">{n}</div>
                  <Plus className="h-4 w-4" />
                </div>
              );
            })}
          </div>

          <div className="mt-5 space-y-2">
            <div className="text-xs text-muted-foreground">Thao tác bàn</div>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton icon={ExternalLink} label="Mở bàn" onClick={() => setDialog("open")} />
              <ActionButton icon={UserPlus} label="Thêm người" onClick={() => setDialog("add")} />
              <ActionButton
                icon={Lock}
                label="Đóng bàn"
                danger
                disabled={unlinkedActiveSeatCount > 0}
                disabledReason="Có ghế đang chơi chưa gắn entry - cần sửa dữ liệu ghế trước khi đóng bàn."
                onClick={() => setDialog("close")}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Chạm một người chơi để Chuyển / Sửa chip / Phiếu / Loại.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {TABLE_OPS_LIVE && (
        <>
          <OpenTableDialog
            open={dialog === "open"}
            onOpenChange={(v) => { if (!v) setDialog(null); }}
            tournamentId={tournamentId}
            defaultMaxSeats={table.max_seats}
            onDone={onChanged}
          />
          <AddPlayerDialog
            open={dialog === "add"}
            onOpenChange={(v) => { if (!v) setDialog(null); }}
            tournamentId={tournamentId}
            tournamentName={tournamentName}
            tournamentDate={tournamentDate}
            tableTtId={table.tt_id}
            maxSeats={table.max_seats}
            occupiedSeats={occupiedSeatNumbers}
            onDone={onChanged}
          />
          <CloseTableDialog
            open={dialog === "close"}
            onOpenChange={(v) => { if (!v) setDialog(null); }}
            tournamentName={tournamentName}
            tournamentDate={tournamentDate}
            tableTtId={table.tt_id}
            tableNumber={table.table_number}
            occupiedCount={occupied}
            unlinkedActiveSeatCount={unlinkedActiveSeatCount}
            onDone={onChanged}
          />
        </>
      )}
    </>
  );
}

/**
 * Table-op button. When FEATURES.floorTableOps is OFF it renders disabled with a
 * "Cần bật RPC" badge (never opens a dialog). When ON it opens the action's dialog.
 */
function ActionButton({
  icon: Icon, label, danger, disabled = false, disabledReason, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  if (!TABLE_OPS_LIVE) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <Button variant="outline" disabled className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}>
                <Icon className="mr-1.5 h-4 w-4" /> {label}
                <span className="ml-auto rounded-full border border-warning/40 px-1.5 py-0.5 text-[10px] text-warning">Cần bật RPC</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Bật cờ floorTableOps để dùng (sau UAT)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <Button variant="outline" disabled className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}>
                <Icon className="mr-1.5 h-4 w-4" /> {label}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}
    >
      <Icon className="mr-1.5 h-4 w-4" /> {label}
    </Button>
  );
}
