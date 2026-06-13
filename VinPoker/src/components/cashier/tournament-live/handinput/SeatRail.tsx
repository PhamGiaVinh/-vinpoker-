// Compact seat rail for the operator: every dealt seat in one row, anchored by
// seat_number, showing the full poker position, stack, current bet and state
// (to-act = gold, selected = emerald ring, folded = dim, all-in = red). Tapping
// a seat sets the button (setup mode) or selects the acting player (live).

import { formatStack } from "./format";

export interface RailSeat {
  player_id: string;
  seat_number: number;
  display_name: string;
  current_stack: number;
  current_bet: number;
  is_folded?: boolean;
  is_all_in?: boolean;
}

interface SeatRailProps {
  seats: RailSeat[];
  /** seat_number → full position label (from getSeatPositions). */
  positions: Map<number, string>;
  buttonSeat: number;
  toActId: string | null;
  selectedActorId: string | null;
  setupMode?: boolean;
  onTapSeat: (seat: RailSeat) => void;
}

function positionBadge(pos: string, isButton: boolean) {
  if (!pos) return null;
  const cls = isButton
    ? "bg-amber-500 text-black"
    : pos === "SB" || pos === "BB"
      ? "bg-emerald-500/20 text-emerald-300"
      : "bg-secondary text-muted-foreground";
  return (
    <span className={`text-[9px] leading-none font-bold px-1.5 py-0.5 rounded-full ${cls}`}>{pos}</span>
  );
}

export function SeatRail({
  seats,
  positions,
  buttonSeat,
  toActId,
  selectedActorId,
  setupMode = false,
  onTapSeat,
}: SeatRailProps) {
  const ordered = [...seats].sort((a, b) => a.seat_number - b.seat_number);

  return (
    <div className="space-y-1.5">
      {setupMode && (
        <div className="text-[11px] text-amber-300/80 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" /> Chạm ghế để đặt nút chia bài (BTN)
        </div>
      )}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {ordered.map((s) => {
          const pos = positions.get(s.seat_number) || "";
          const isButton = s.seat_number === buttonSeat;
          const isToAct = !setupMode && toActId === s.player_id && !s.is_folded && !s.is_all_in;
          const isSelected = !setupMode && selectedActorId === s.player_id;
          const setupHi = setupMode && isButton;

          const border = s.is_folded
            ? "border-border/30"
            : s.is_all_in
              ? "border-red-500/50"
              : setupHi
                ? "border-amber-400"
                : isToAct
                  ? "border-amber-400"
                  : isSelected
                    ? "border-emerald-400"
                    : "border-border";
          const ring = (isToAct || setupHi) ? "ring-2 ring-amber-400/60" : isSelected ? "ring-2 ring-emerald-400/50" : "";

          return (
            <button
              key={s.player_id}
              type="button"
              onClick={() => onTapSeat(s)}
              className={`shrink-0 w-[78px] text-center rounded-xl border ${border} ${ring} p-1.5 transition ${
                s.is_folded ? "opacity-55 bg-card/40" : s.is_all_in ? "bg-red-950/20" : "bg-card hover:border-amber-400/60"
              }`}
            >
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <span className="text-[9px] font-mono text-muted-foreground">{s.seat_number}</span>
                {positionBadge(pos, isButton)}
              </div>
              <div className="text-[11px] font-medium text-foreground truncate">{s.display_name}</div>
              <div className="text-[11px] font-mono font-medium text-emerald-400">
                {formatStack(s.current_stack)}
              </div>
              {s.is_all_in ? (
                <div className="text-[8.5px] font-bold text-red-400">ALL IN</div>
              ) : s.is_folded ? (
                <div className="text-[8.5px] text-muted-foreground">FOLD</div>
              ) : isToAct ? (
                <div className="text-[8.5px] font-bold text-amber-300">◀ lượt</div>
              ) : s.current_bet > 0 ? (
                <div className="text-[8.5px] font-mono text-amber-300/90">{formatStack(s.current_bet)}</div>
              ) : (
                <div className="text-[8.5px] text-muted-foreground">·</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
