// Presentational poker felt for the Tournament Live tracker.
//
// Extracted verbatim from TournamentLiveView's inline felt block (T2a, behaviour-
// neutral refactor) so the same felt can later be driven by either LIVE state or
// a REPLAY frame (T2b) without duplicating render logic. This component is PURE:
// it holds no data-fetching, realtime, or polling logic — those stay in the
// parent (the PR #12 safety machinery is untouched).

import type { CSSProperties } from "react";
import { PokerCard, CardBack } from "./PokerVisuals";
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
  /** Chips committed on the CURRENT street (Live Action Engine overlay; 0/undef → no chip shown). */
  current_bet?: number;
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

type SeatPos = { top?: string; left?: string; right?: string; bottom?: string; transform?: string };

const SEAT_POSITIONS: Record<number, SeatPos> = {
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

// Portrait (narrow phone) layout — seats spread around a TALL oval, leaving the
// vertical centre band clear for the board + pot.
const SEAT_POSITIONS_PORTRAIT: Record<number, SeatPos> = {
  1: { top: "1.5%", left: "50%", transform: "translateX(-50%)" },
  2: { top: "13%", right: "2%" },
  6: { top: "13%", left: "2%" },
  3: { top: "27%", right: "1.5%" },
  5: { top: "27%", left: "1.5%" },
  7: { top: "66%", right: "2%" },
  10: { top: "66%", left: "2%" },
  8: { bottom: "14%", right: "4%" },
  9: { bottom: "14%", left: "4%" },
  4: { bottom: "1.5%", left: "50%", transform: "translateX(-50%)" },
};

// Felt oval + board/pot anchor geometry per orientation.
const LANDSCAPE_FELT = {
  minHeight: "500px",
  viewBox: "0 0 820 560",
  cx: 410, cy: 280, rx: 372, ry: 244, rx2: 370, ry2: 242, rx3: 346, ry3: 218,
  boardBottom: "27%", potBottom: "12%", vTop: "26%",
};
const PORTRAIT_FELT = {
  minHeight: "560px",
  viewBox: "0 0 420 600",
  cx: 210, cy: 300, rx: 198, ry: 290, rx2: 196, ry2: 288, rx3: 176, ry3: 268,
  boardBottom: "48%", potBottom: "38%", vTop: "20%",
};

export interface LiveFeltProps {
  /** Active seats already positioned for the table on view. */
  seats: SeatInfo[];
  /** The most recent actor — gets the gold spotlight ring. */
  lastActorId: string | null;
  /** The player whose turn it is to act next (Live Action Engine); null → no spotlight. */
  toActId?: string | null;
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
  /** Narrow-phone vertical layout (tall oval + portrait seat ring). */
  portrait?: boolean;
}

export function LiveFelt({
  seats,
  lastActorId,
  toActId = null,
  displayCards,
  potSize,
  potBreakdown,
  multiTableUnresolved,
  handNumber,
  latestAction,
  formatBB,
  portrait = false,
}: LiveFeltProps) {
  const felt = portrait ? PORTRAIT_FELT : LANDSCAPE_FELT;
  const seatPositions = portrait ? SEAT_POSITIONS_PORTRAIT : SEAT_POSITIONS;
  return (
    <div
      className="relative rounded-2xl border bg-card shadow-inner overflow-hidden"
      style={{ minHeight: felt.minHeight, borderColor: "hsl(var(--poker-gold) / 0.3)" }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={felt.viewBox}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <radialGradient id="feltGrad" cx="50%" cy="42%">
            <stop offset="0%" style={{ stopColor: "hsl(var(--poker-felt))", stopOpacity: "0.97" }} />
            <stop offset="62%" style={{ stopColor: "hsl(var(--poker-felt-dark))", stopOpacity: "0.98" }} />
            <stop offset="100%" style={{ stopColor: "hsl(var(--poker-felt-dark))", stopOpacity: "1" }} />
          </radialGradient>
        </defs>
        <ellipse cx={felt.cx} cy={felt.cy} rx={felt.rx} ry={felt.ry} fill="url(#feltGrad)" />
        {/* Thick brass rim + thin inner accent line for depth. */}
        <ellipse
          cx={felt.cx}
          cy={felt.cy}
          rx={felt.rx2}
          ry={felt.ry2}
          fill="none"
          stroke="hsl(var(--poker-gold) / 0.7)"
          strokeWidth="7"
        />
        <ellipse
          cx={felt.cx}
          cy={felt.cy}
          rx={felt.rx3}
          ry={felt.ry3}
          fill="none"
          stroke="hsl(var(--poker-gold) / 0.22)"
          strokeWidth="2"
        />
      </svg>

      {/* Gold "V" felt mark (center, behind cards). No animal/crest. */}
      <div
        aria-hidden="true"
        data-testid="felt-v"
        className="pointer-events-none absolute left-1/2 z-[1] -translate-x-1/2 font-serif font-black leading-none"
        style={{
          top: felt.vTop,
          fontSize: portrait ? "42px" : "54px",
          color: "hsl(var(--poker-gold) / 0.9)",
          textShadow: "0 2px 22px hsl(var(--poker-gold) / 0.35)",
        }}
      >
        V
      </div>

      {seats.map((seat) => {
        // Anchor by physical seat number so players never shift when others bust.
        const posKey = ((seat.seat_number - 1) % 10) + 1;
        const pos = seatPositions[posKey] || seatPositions[1] || SEAT_POSITIONS[1];
        const posStyle: CSSProperties = {};
        if (pos.top) posStyle.top = pos.top;
        if (pos.bottom) posStyle.bottom = pos.bottom;
        if (pos.left) posStyle.left = pos.left;
        if (pos.right) posStyle.right = pos.right;
        if (pos.transform) posStyle.transform = pos.transform;

        const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
        // To-act spotlight (Live Action Engine): who the table is waiting on.
        const isToAct = !seat.is_folded && !seat.is_all_in && toActId === seat.player_id;
        const initials = seat.display_name.slice(0, 2).toUpperCase();

        // Accent by state: gold spotlight (to-act) > red (all-in) > gold glow
        // (last actor) > resting gold rim. Folded dims the whole seat.
        const avatarBorder = seat.is_folded
          ? "border-border/30"
          : seat.is_all_in
            ? "border-red-400/70"
            : isToAct
              ? "border-amber-300"
              : isLastActor
                ? "border-amber-400/80"
                : "border-[hsl(var(--poker-gold)/0.6)]";
        const plaqueAccent = seat.is_folded
          ? ""
          : isToAct
            ? "ring-1 ring-amber-300/70 shadow-[0_0_16px_rgba(245,179,64,0.6)]"
            : seat.is_all_in
              ? "shadow-[0_0_12px_rgba(239,68,68,0.35)]"
              : isLastActor
                ? "shadow-[0_0_12px_rgba(245,179,64,0.3)]"
                : "";
        const widthCls = portrait ? "w-[62px]" : "w-[70px] sm:w-[84px]";
        const avatarCls = portrait
          ? "w-8 h-8 text-[10px]"
          : "w-9 h-9 sm:w-10 sm:h-10 text-[11px] sm:text-xs";

        return (
          <div
            key={seat.player_id}
            className={`absolute z-10 ${seat.is_folded ? "opacity-50" : ""}`}
            style={posStyle}
          >
            {/* Mockup seat: round avatar OVERLAPPING a slim dark plaque (name +
                cyan stack + position chip), with exactly 2 cards BELOW. */}
            <div className={`relative flex flex-col items-center transition-all duration-300 ${widthCls}`}>
              {isToAct && (
                <div className="absolute -top-2 z-20 px-1.5 py-0.5 rounded-full bg-amber-400 text-black text-[8px] font-bold uppercase tracking-wide whitespace-nowrap shadow">
                  ◀ chờ
                </div>
              )}
              <div
                className={`relative z-10 grid place-items-center overflow-hidden rounded-full border-2 font-bold ${avatarBorder} ${avatarCls}`}
                style={{
                  background: "linear-gradient(180deg,#2a141a,#0b090d)",
                  color: "hsl(var(--poker-gold))",
                }}
              >
                {seat.avatar_url ? (
                  <img src={seat.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              {/* Plaque stays dark/near-black in BOTH themes for poker contrast. */}
              <div
                className={`relative -mt-3 w-full rounded-lg border px-1 pt-3.5 pb-1 text-center ${plaqueAccent}`}
                style={{
                  background: "linear-gradient(180deg, rgba(20,12,8,0.94), rgba(8,6,5,0.94))",
                  borderColor: "hsl(var(--poker-gold) / 0.34)",
                }}
              >
                {seat.position && (
                  <span
                    className={`absolute -top-1.5 right-0 rounded-full px-1 py-px text-[7px] font-bold leading-none ${
                      seat.position === "BTN" ? "text-black" : "text-amber-300"
                    }`}
                    style={
                      seat.position === "BTN"
                        ? { background: "hsl(var(--poker-gold))" }
                        : { background: "hsl(var(--poker-gold) / 0.22)" }
                    }
                  >
                    {seat.position}
                  </span>
                )}
                <div className="truncate text-[8.5px] font-semibold leading-tight text-zinc-100 sm:text-[10px]">
                  {seat.display_name}
                </div>
                <div
                  className="font-mono text-[10px] font-bold leading-tight sm:text-xs"
                  style={{ color: "hsl(var(--poker-stack))" }}
                >
                  {formatStack(seat.chip_count)}
                </div>
              </div>
              {!seat.is_folded && seat.current_bet != null && seat.current_bet > 0 && (
                // key = current_bet so the one-shot chip pulse replays whenever the
                // seat commits more chips this street (Increment 3, cosmetic only;
                // CSS-only, reduced-motion respected, no JS timers).
                <div
                  key={`bet-${seat.current_bet}`}
                  className="tracker-bet-pulse mt-0.5 inline-flex items-center rounded-full border border-amber-400/40 bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-mono font-bold text-amber-300"
                >
                  Cược {formatStack(seat.current_bet)}
                </div>
              )}
              {seat.is_all_in && <div className="mt-0.5 text-[8px] font-bold text-red-400">ALL IN</div>}
              {seat.is_folded && <div className="mt-0.5 text-[8px] text-muted-foreground">FOLDED</div>}
              {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                <div className="mt-0.5 max-w-full truncate text-[8px] text-amber-300/90">
                  {seat.last_action}
                </div>
              )}
              {/* Always exactly 2 hole-card elements: face-up ONLY when the dealer
                  has revealed exactly 2 (Triton-style); otherwise 2 backs. Never
                  invent values. Folded seats keep 2 dimmed backs (stable layout). */}
              <div data-testid="seat-holecards" className="mt-0.5 flex justify-center gap-0.5">
                {seat.hole_cards && seat.hole_cards.length === 2 ? (
                  seat.hole_cards.map((card, ci) => (
                    <PokerCard key={ci} card={card} size="xs" muted={seat.is_folded} />
                  ))
                ) : (
                  [0, 1].map((ci) => <CardBack key={ci} size="xs" muted={seat.is_folded} />)
                )}
              </div>
            </div>
          </div>
        );
      })}

      <div
        className="absolute left-1/2 -translate-x-1/2 flex gap-1.5 sm:gap-2 z-20"
        style={{ bottom: felt.boardBottom }}
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
          style={{ bottom: felt.potBottom }}
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
