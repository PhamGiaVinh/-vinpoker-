import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserPlus, ExternalLink, Lock, Plus } from "lucide-react";
import { formatVND } from "@/lib/format";

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

/**
 * Presentational table-detail sheet. Shows the selected table's seats — occupied
 * (name + chips, tappable → action sheet) and clean empty slots (dashed circle +
 * seat number + "+", NO "Ghế trống / Thêm" text). Quick actions that have no
 * backend yet are shown disabled "Sắp có" (no dead buttons).
 */
export function FloorTableDetailSheet({
  open, onOpenChange, table, seats, onSeatTap,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  table: MapTable | null;
  seats: MapSeat[];
  onSeatTap: (seat: MapSeat) => void;
}) {
  if (!table) return null;
  const bySeat = new Map<number, MapSeat>();
  for (const s of seats) bySeat.set(s.seat_number, s);
  const occupied = seats.length;

  return (
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
          <TooltipProvider>
            <div className="grid grid-cols-2 gap-2">
              <SoonButton icon={ExternalLink} label="Mở bàn" />
              <SoonButton icon={UserPlus} label="Thêm người" />
              <SoonButton icon={Lock} label="Đóng bàn" danger />
            </div>
          </TooltipProvider>
          <p className="text-[11px] text-muted-foreground">
            Chạm một người chơi để Chuyển / Sửa chip / Phiếu / Loại.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SoonButton({ icon: Icon, label, danger }: { icon: any; label: string; danger?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">
          <Button variant="outline" disabled className={`h-11 w-full justify-start ${danger ? "text-destructive" : ""}`}>
            <Icon className="mr-1.5 h-4 w-4" /> {label}
            <span className="ml-auto rounded-full border border-warning/40 px-1.5 py-0.5 text-[10px] text-warning">Sắp có</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Cần backend — sắp có</TooltipContent>
    </Tooltip>
  );
}
