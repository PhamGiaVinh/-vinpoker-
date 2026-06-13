// Presentational poker felt for the Tournament Live tracker.
//
// Extracted verbatim from TournamentLiveView's inline felt block (T2a, behaviour-
// neutral refactor) so the same felt can later be driven by either LIVE state or
// a REPLAY frame (T2b) without duplicating render logic. This component is PURE:
// it holds no data-fetching, realtime, or polling logic — those stay in the
// parent (the PR #12 safety machinery is untouched).

import type { CSSProperties } from "react";
import { PokerCard } from "./PokerVisuals";
import type { PotBreakdown } from "@/lib/tracker-poker/potEngine";

export interface SeatInfo {
  player_id: string;
  display_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  table_id: string | null;
  position: string;
  avatar_url?: string | null;
  last_action?: string;
  is_folded?: boolean;
  is_all_in?: boolean;
  hole_cards?: string[];
}

export interface ActionLog {
  street: string;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  action_amount: number;
  action_order: number;
}

export function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

export function formatActionLabel(a: ActionLog): string {
  const t = a.action_type;
  if (t === "fold") return "Fold";
  if (t === "check") return "Check";
  if (t === "call") return `Call ${formatStack(a.action_amount)}`;
  if (t === "bet") return `Bet ${formatStack(a.action_amount)}`;
  if (t === "raise") return `Raise ${formatStack(a.action_amount)}`;
  if (t === "all_in") return `All-In ${formatStack(a.action_amount)}`;
  if (t === "post_sb") return `SB ${formatStack(a.action_amount)}`;
  if (t === "post_bb") return `BB ${formatStack(a.action_amount)}`;
  if (t === "post_ante") return `Ante ${formatStack(a.action_amount)}`;
  return `${t} ${formatStack(a.action_amount)}`;
}

const SEAT_POSITIONS: Record<
  number,
  { top?: string; left?: string; right?: string; bottom?: string; transform?: string }
> = {
  1: { top: "2%", left: "50%", transform: "translateX(-50%)" },
  2: { top: "15%", right: "5%" },
  3: { top: "55%", right: "5%" },
  4: { bottom: "2%", left: "50%", transform: "translateX(-50%)" },
  5: { top: "55%", left: "5%" },
  6: { top: "15%", left: "5%" },
  7: { top: "35%", right: "3%" },
  8: { bottom: "15%", right: "15%" },
  9: { bottom: "15%", left: "15%" },
  10: { top: "35%", left: "3%" },
};

export interface LiveFeltProps {
  /** Active seats already positioned for the table on view. */
  seats: SeatInfo[];
  /** The most recent actor — gets the gold spotlight ring. */
  lastActorId: string | null;
  /** Community cards padded to 5 slots ("" = empty). */
  displayCards: string[];
  potSize: number;
  potBreakdown: PotBreakdown | null;
  /** Multiple tables exist and none is resolved — show the picker hint instead. */
  multiTableUnresolved: boolean;
  handNumber: number | null;
  /** Latest action for the bottom ticker (null = no actions yet). */
  latestAction: ActionLog | null;
  formatBB: (n: number) => string | null;
}

export function LiveFelt({
  seats,
  lastActorId,
  displayCards,
  potSize,
  potBreakdown,
  multiTableUnresolved,
  handNumber,
  latestAction,
  formatBB,
}: LiveFeltProps) {
  return (
    <div
      className="relative bg-gradient-to-b from-[#16090d] to-[#0c0d10] rounded-2xl border border-amber-700/30 shadow-inner overflow-hidden"
      style={{ minHeight: "480px" }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="feltGrad" cx="50%" cy="42%">
            <stop offset="0%" style={{ stopColor: "#581723", stopOpacity: "0.96" }} />
            <stop offset="62%" style={{ stopColor: "#2b0b13", stopOpacity: "0.98" }} />
            <stop offset="100%" style={{ stopColor: "#1a070c", stopOpacity: "0.98" }} />
          </radialGradient>
        </defs>
        <ellipse cx="400" cy="300" rx="340" ry="240" fill="url(#feltGrad)" />
        <ellipse
          cx="400"
          cy="300"
          rx="338"
          ry="238"
          fill="none"
          stroke="rgba(245,179,64,0.4)"
          strokeWidth="4"
        />
        <ellipse
          cx="400"
          cy="300"
          rx="316"
          ry="216"
          fill="none"
          stroke="rgba(245,179,64,0.14)"
          strokeWidth="1.5"
        />
      </svg>

      {seats.map((seat) => {
        // Anchor by physical seat number so players never shift when others bust.
        const posKey = ((seat.seat_number - 1) % 10) + 1;
        const pos = SEAT_POSITIONS[posKey] || SEAT_POSITIONS[1];
        const posStyle: CSSProperties = {};
        if (pos.top) posStyle.top = pos.top;
        if (pos.bottom) posStyle.bottom = pos.bottom;
        if (pos.left) posStyle.left = pos.left;
        if (pos.right) posStyle.right = pos.right;
        if (pos.transform) posStyle.transform = pos.transform;

        const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
        const seatBB = !seat.is_folded ? formatBB(seat.chip_count) : null;

        return (
          <div key={seat.player_id} className="absolute z-10" style={posStyle}>
            <div
              className={`bg-gradient-to-br from-[#241015]/80 to-slate-900/70 backdrop-blur-sm border rounded-xl p-1.5 w-24 sm:p-2.5 sm:w-32 md:w-36 text-center transition-all duration-300 ${
                seat.is_folded
                  ? "border-border/20 opacity-50 grayscale-[0.5]"
                  : seat.is_all_in
                    ? "border-red-500/40 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                    : isLastActor
                      ? "border-amber-400/80 shadow-[0_0_14px_rgba(245,179,64,0.35)]"
                      : "border-emerald-500/40 hover:border-emerald-400/60"
              }`}
            >
              <div className="flex justify-center mb-1">
                {seat.avatar_url ? (
                  <img
                    src={seat.avatar_url}
                    alt=""
                    loading="lazy"
                    className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover border ${
                      isLastActor ? "border-amber-400/80" : "border-emerald-500/40"
                    }`}
                  />
                ) : (
                  <div
                    className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold bg-emerald-900/60 border ${
                      isLastActor ? "border-amber-400/80 text-amber-300" : "border-emerald-500/40 text-emerald-300"
                    }`}
                  >
                    {seat.display_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-emerald-400 font-semibold text-xs truncate max-w-[52px] sm:max-w-[80px]">
                  {seat.display_name}
                </span>
                {seat.position && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      seat.position === "BTN"
                        ? "bg-amber-500 text-black"
                        : "bg-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    {seat.position}
                  </span>
                )}
              </div>
              <div className="text-white font-bold text-xs sm:text-sm font-mono">
                {formatStack(seat.chip_count)}
                {seatBB && (
                  <span className="block text-[9px] font-normal text-muted-foreground">
                    {seatBB}
                  </span>
                )}
              </div>
              {seat.is_all_in && (
                <div className="text-[10px] text-red-400 font-bold mt-1">ALL IN</div>
              )}
              {seat.is_folded && (
                <div className="text-[10px] text-muted-foreground mt-1">FOLDED</div>
              )}
              {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                <div className="text-[10px] text-amber-300 mt-1 truncate">
                  {seat.last_action}
                </div>
              )}
              {seat.hole_cards && seat.hole_cards.length > 0 && (
                <div className="flex gap-0.5 justify-center mt-1">
                  {seat.hole_cards.map((card: string, ci: number) => (
                    <PokerCard key={ci} card={card} size="xs" muted={seat.is_folded} />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div
        className="absolute left-1/2 -translate-x-1/2 flex gap-1.5 sm:gap-2 z-20"
        style={{ bottom: "25%" }}
      >
        {displayCards.map((card, i) => (
          <PokerCard
            key={`${i}-${card || "empty"}`}
            card={card || null}
            size="md"
            className="w-12 h-[68px] sm:w-14 sm:h-20"
          />
        ))}
      </div>

      {potSize > 0 && (
        <div
          className="absolute left-1/2 -translate-x-1/2 text-center z-20"
          style={{ bottom: "10%" }}
        >
          <div className="tracker-pot-pulse inline-flex flex-col items-center px-4 py-1.5 rounded-full bg-black/45 border border-amber-400/40">
            <div className="text-[9px] text-amber-200/70 uppercase tracking-widest">Pot</div>
            <div className="text-amber-300 text-xl sm:text-2xl font-bold font-mono leading-tight">
              {formatStack(potSize)}
              {formatBB(potSize) && (
                <span className="ml-1.5 text-[10px] font-normal text-amber-200/60">
                  ({formatBB(potSize)})
                </span>
              )}
            </div>
          </div>
          {potBreakdown && potBreakdown.sidePots.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-center gap-1">
              {potBreakdown.pots.map((pot, i) => (
                <span
                  key={i}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/45 border ${
                    i === 0
                      ? "border-emerald-400/40 text-emerald-300"
                      : "border-amber-400/40 text-amber-300"
                  }`}
                >
                  {i === 0 ? "Main" : `Side ${i}`} {formatStack(pot.amount)}
                  <span className="ml-1 font-normal opacity-60">
                    ({pot.eligible_player_ids.length})
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {multiTableUnresolved && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="text-muted-foreground text-sm bg-black/40 px-6 py-3 rounded-lg backdrop-blur-sm text-center">
            Giải có nhiều bàn — chọn bàn ở trên để xem live.
          </div>
        </div>
      )}

      {!multiTableUnresolved && !handNumber && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="text-muted-foreground text-sm bg-black/40 px-6 py-3 rounded-lg backdrop-blur-sm">
            Chờ dealer bắt đầu hand...
          </div>
        </div>
      )}

      {latestAction && (
        <div className="absolute bottom-0 inset-x-0 z-20 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-sm border-t border-amber-500/20 text-xs">
          <span className="text-[9px] font-bold text-amber-400/80 uppercase tracking-widest shrink-0">
            Hành động
          </span>
          <span className="truncate text-amber-100">
            {latestAction.seat_number > 0 && (
              <span className="text-amber-300/70">Ghế {latestAction.seat_number} · </span>
            )}
            <span className="font-semibold text-emerald-300">{latestAction.display_name}</span>{" "}
            {formatActionLabel(latestAction)}
          </span>
        </div>
      )}
    </div>
  );
}
