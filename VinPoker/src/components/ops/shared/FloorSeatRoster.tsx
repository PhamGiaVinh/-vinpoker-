import { AlertTriangle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildFloorSeatRoster,
  type FloorRosterSeat,
} from "./floorTablePresentation";

export function FloorSeatRoster({
  seats,
  onSeatTap,
  onEmptySeatTap,
  className,
}: {
  seats: readonly FloorRosterSeat[];
  onSeatTap?: (seatNumber: number) => void;
  onEmptySeatTap?: (seatNumber: number) => void;
  className?: string;
}) {
  const roster = buildFloorSeatRoster(seats);
  const hasIntegrityIssue = (
    roster.duplicateSeatNumbers.length > 0
    || roster.outOfRangeSeatNumbers.length > 0
  );
  const occupiedCount = roster.slots.filter((slot) => slot.seat != null).length;

  return (
    <section className={className} aria-labelledby="floor-seat-roster-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="floor-seat-roster-heading" className="text-sm font-semibold text-foreground">
            Danh sách người chơi
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {occupiedCount}/9 ghế · chạm một ghế để thao tác
          </p>
        </div>
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 font-mono text-xs text-primary">
          9 MAX
        </span>
      </div>

      {hasIntegrityIssue && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {roster.duplicateSeatNumbers.length > 0
              ? `Trùng dữ liệu ghế ${roster.duplicateSeatNumbers.join(", ")}. `
              : ""}
            {roster.outOfRangeSeatNumbers.length > 0
              ? `Có ghế ngoài phạm vi 1–9: ${roster.outOfRangeSeatNumbers.join(", ")}. `
              : ""}
            Hãy tải lại và không thao tác cho tới khi dữ liệu được kiểm tra.
          </span>
        </div>
      )}

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/55">
        {roster.slots.map(({ seatNumber, seat }) => {
          const interactive = seat ? Boolean(onSeatTap) : Boolean(onEmptySeatTap);
          return (
            <button
              key={seatNumber}
              type="button"
              data-testid={`floor-seat-row-${seatNumber}`}
              disabled={!interactive || hasIntegrityIssue}
              onClick={() => {
                if (seat) onSeatTap?.(seatNumber);
                else onEmptySeatTap?.(seatNumber);
              }}
              className={cn(
                "flex min-h-[62px] w-full items-center gap-3 border-b border-border/70 px-3 py-2.5 text-left last:border-b-0",
                interactive && "transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/45",
                !interactive && "cursor-default",
              )}
              aria-label={seat ? `Ghế ${seatNumber}, ${seat.playerName}` : `Ghế ${seatNumber}, Empty`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-background/80 font-mono text-sm text-muted-foreground">
                {seatNumber}
              </span>

              {seat ? (
                <>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden="true">
                    {playerInitials(seat.playerName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {seat.playerName}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-primary">
                      {seat.chipsLabel}
                      {seat.entryNumber != null ? ` · Entry ${seat.entryNumber}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">Đang ngồi</span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium italic text-muted-foreground">Empty</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground/75">Ghế trống</span>
                  </span>
                  {onEmptySeatTap && (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                      <Plus className="h-3.5 w-3.5" /> Thêm người
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(-2).map((part) => part.charAt(0).toUpperCase()).join("");
}
