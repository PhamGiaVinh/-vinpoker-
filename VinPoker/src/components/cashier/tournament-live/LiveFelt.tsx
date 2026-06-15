// Presentational poker felt for the Tournament Live tracker.
//
// PURE component (no data-fetching / realtime / polling — that stays in the
// parent; PR #12 safety machinery untouched). Shared by the public viewer, the
// operator tracker (TournamentLivePanel) and the replay path, so props stay
// backward-compatible and PokerCard(null) behaviour is never changed.
//
// Layout: an aspect-ratio oval that SCALES to its container (whole table always
// visible on phone + desktop, portrait + landscape), seats spread EVENLY on a
// trig ring (anchored by physical seat number so they never shift / overlap),
// the 5 community cards CENTERED on the felt, and unrevealed board slots shown
// as premium face-down V-logo cards (never empty placeholders). Seats are
// avatar + name + stack directly on the felt — no name boxes.

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

// Felt geometry per orientation. ringX/ringY = seat-centre radius (% of the
// container); the oval is drawn to those radii so avatars straddle the rim.
// Tuned so 9 seats never overlap each other / the board / the ticker at ~360–460px.
const LANDSCAPE = {
  aspect: "16 / 11",
  ringX: 43,
  ringY: 36,
  vTop: "30%",
  boardTop: "50%",
  potTop: "72%",
  vSize: "clamp(34px, 9vw, 58px)",
};
const PORTRAIT = {
  aspect: "10 / 14",
  ringX: 41,
  ringY: 41,
  vTop: "27%",
  boardTop: "49%",
  potTop: "64%",
  vSize: "clamp(34px, 12vw, 52px)",
};

export interface LiveFeltProps {
  /** Active seats already positioned for the table on view. */
  seats: SeatInfo[];
  /** The most recent actor — gets the gold spotlight ring. */
  lastActorId: string | null;
  /** The player whose turn it is to act next (Live Action Engine); null → no spotlight. */
  toActId?: string | null;
  /** Community cards padded to 5 slots ("" = empty → face-down V back). */
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
  const geo = portrait ? PORTRAIT : LANDSCAPE;
  const maxSeat = seats.reduce((m, s) => Math.max(m, s.seat_number), 0);
  const ringCount = Math.max(9, maxSeat);
  const boardCardCls = "h-[52px] w-9 sm:h-[64px] sm:w-11";

  return (
    <div className="relative mx-auto w-full" style={{ aspectRatio: geo.aspect }}>
      {/* Burgundy oval + subtle brass rim (scales with container). Depth from
          inset rings + vignette, not a neon outer-glow. Gold kept subtle. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          borderRadius: "50%",
          background:
            "radial-gradient(62% 60% at 50% 38%, hsl(var(--poker-felt)) 0%, hsl(var(--poker-felt)) 50%, hsl(var(--poker-felt-dark)) 100%)",
          boxShadow:
            "inset 0 0 0 5px hsl(var(--poker-gold) / 0.5), inset 0 0 0 7px hsl(var(--poker-felt-dark) / 0.85), inset 0 0 0 8px hsl(var(--poker-gold) / 0.72), inset 0 0 70px rgba(0,0,0,0.5), 0 22px 55px rgba(0,0,0,0.42)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          borderRadius: "50%",
          background: "radial-gradient(52% 42% at 50% 20%, rgba(255,255,255,0.07), transparent 72%)",
        }}
      />

      {/* Gold "V" felt watermark, behind cards. No animal/crest, no "Full Ring". */}
      <div
        aria-hidden="true"
        data-testid="felt-v"
        className="tracker-display pointer-events-none absolute left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 font-black leading-none"
        style={{
          top: geo.vTop,
          fontSize: geo.vSize,
          color: "hsl(var(--poker-gold) / 0.72)",
          textShadow: "0 1px 2px rgba(0,0,0,0.5)",
        }}
      >
        V
      </div>

      {/* Community board — CENTERED. Revealed cards face up; unrevealed slots are
          premium face-down V-logo backs (never empty). Rendered before the seats
          so per-seat hole-card counting stays clean. */}
      <div
        data-testid="board-cards"
        className="absolute left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 gap-1 sm:gap-1.5"
        style={{ top: geo.boardTop }}
      >
        {displayCards.map((card, i) =>
          card ? (
            <PokerCard key={`${i}-${card}`} card={card} size="md" className={boardCardCls} />
          ) : (
            <CardBack key={`${i}-back`} size="md" className={boardCardCls} />
          )
        )}
      </div>

      {potSize > 0 && (
        <div
          className="absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-center"
          style={{ top: geo.potTop }}
        >
          <div
            className="tracker-pot-pulse inline-flex flex-col items-center rounded-full bg-black/55 px-3.5 py-1"
            style={{ border: "1px solid hsl(var(--poker-gold) / 0.42)" }}
          >
            <div className="tracker-display text-[8px] uppercase tracking-[0.2em]" style={{ color: "hsl(var(--poker-gold) / 0.78)" }}>
              Pot
            </div>
            <div className="tracker-num text-lg font-bold leading-tight sm:text-xl" style={{ color: "hsl(var(--poker-gold))" }}>
              {formatStack(potSize)}
              {formatBB(potSize) && (
                <span className="ml-1.5 text-[10px] font-normal" style={{ color: "hsl(var(--poker-gold) / 0.6)" }}>
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
                  className={`tracker-num rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold border ${
                    i === 0
                      ? "border-emerald-400/40 text-emerald-300"
                      : "border-[hsl(var(--poker-gold)/0.4)] text-[hsl(var(--poker-gold))]"
                  }`}
                >
                  {i === 0 ? "Main" : `Side ${i}`} {formatStack(pot.amount)}
                  <span className="ml-1 font-normal opacity-60">({pot.eligible_player_ids.length})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {seats.map((seat) => {
        // Even angle around the ring, anchored by seat number (top-centre,
        // clockwise) → stable + non-overlapping.
        const angle = ((-90 + ((seat.seat_number - 1) * 360) / ringCount) * Math.PI) / 180;
        const leftPct = 50 + geo.ringX * Math.cos(angle);
        const topPct = 50 + geo.ringY * Math.sin(angle);
        const posStyle: CSSProperties = {
          left: `${leftPct}%`,
          top: `${topPct}%`,
          transform: "translate(-50%, -50%)",
        };

        const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
        const isToAct = !seat.is_folded && !seat.is_all_in && toActId === seat.player_id;
        const initials = seat.display_name.slice(0, 2).toUpperCase();

        // No name box — the avatar ring carries the state accent: to-act =
        // terracotta (the one accent) > all-in red > last-actor gold > resting gold.
        const avatarBorder = seat.is_folded
          ? "border-border/30"
          : seat.is_all_in
            ? "border-red-400/70"
            : isToAct
              ? "border-[hsl(var(--poker-accent))]"
              : isLastActor
                ? "border-[hsl(var(--poker-gold)/0.85)]"
                : "border-[hsl(var(--poker-gold)/0.5)]";
        const avatarRing = isToAct
          ? "ring-2 ring-[hsl(var(--poker-accent)/0.55)]"
          : isLastActor
            ? "ring-1 ring-[hsl(var(--poker-gold)/0.45)]"
            : "";
        const widthCls = portrait ? "w-[56px]" : "w-[62px] sm:w-[82px]";
        const avatarCls = portrait
          ? "w-8 h-8 text-[10px]"
          : "w-9 h-9 sm:w-11 sm:h-11 text-[11px] sm:text-sm";
        const nameShadow = { textShadow: "0 1px 3px rgba(0,0,0,0.95)" };
        const stackShadow = { color: "hsl(var(--poker-stack))", textShadow: "0 1px 2px rgba(0,0,0,0.9)" };

        return (
          <div
            key={seat.player_id}
            className={`absolute z-10 ${seat.is_folded ? "opacity-50" : ""}`}
            style={posStyle}
          >
            <div className={`relative flex flex-col items-center transition-all duration-300 ${widthCls}`}>
              {isToAct && (
                <div
                  className="tracker-display absolute -top-2 z-20 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide whitespace-nowrap text-white shadow"
                  style={{ background: "hsl(var(--poker-accent))" }}
                >
                  ◀ chờ
                </div>
              )}
              <div className="relative">
                <div
                  className={`grid place-items-center overflow-hidden rounded-full border-2 font-bold ${avatarBorder} ${avatarRing} ${avatarCls}`}
                  style={{ background: "linear-gradient(180deg,#2c151b,#0b090d)", color: "hsl(var(--poker-gold))" }}
                >
                  {seat.avatar_url ? (
                    <img src={seat.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    initials
                  )}
                </div>
                {seat.position && (
                  <span
                    className={`tracker-display absolute -top-1 -right-1 rounded-full px-1 py-px text-[7px] font-bold leading-none shadow ${
                      seat.position === "BTN" ? "text-black" : "text-amber-200"
                    }`}
                    style={
                      seat.position === "BTN"
                        ? { background: "hsl(var(--poker-gold))" }
                        : { background: "rgba(20,12,8,0.9)", border: "1px solid hsl(var(--poker-gold) / 0.5)" }
                    }
                  >
                    {seat.position}
                  </span>
                )}
              </div>
              <div className="tracker-display mt-1 max-w-full truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]" style={nameShadow}>
                {seat.display_name}
              </div>
              <div className="tracker-num text-[10px] font-bold leading-tight sm:text-[11px]" style={stackShadow}>
                {formatStack(seat.chip_count)}
              </div>
              {!seat.is_folded && seat.current_bet != null && seat.current_bet > 0 && (
                <div
                  key={`bet-${seat.current_bet}`}
                  className="tracker-bet-pulse tracker-num mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                  style={{
                    background: "hsl(var(--poker-gold) / 0.15)",
                    border: "1px solid hsl(var(--poker-gold) / 0.4)",
                    color: "hsl(var(--poker-gold))",
                  }}
                >
                  Cược {formatStack(seat.current_bet)}
                </div>
              )}
              {seat.is_all_in && <div className="mt-0.5 text-[8px] font-bold text-red-400" style={nameShadow}>ALL IN</div>}
              {seat.is_folded && <div className="mt-0.5 text-[8px] text-zinc-300" style={nameShadow}>FOLDED</div>}
              {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                <div className="mt-0.5 max-w-full truncate text-[8px] text-amber-300/90" style={nameShadow}>
                  {seat.last_action}
                </div>
              )}
              {/* Always exactly 2 hole-card elements: face-up ONLY when the dealer
                  revealed exactly 2 (Triton-style); otherwise 2 backs. Never invent
                  values. Folded seats keep 2 dimmed backs (stable layout). */}
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

      {multiTableUnresolved && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="rounded-lg bg-black/45 px-6 py-3 text-center text-sm text-zinc-200 backdrop-blur-sm">
            Giải có nhiều bàn — chọn bàn ở trên để xem live.
          </div>
        </div>
      )}

      {!multiTableUnresolved && !handNumber && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="rounded-lg bg-black/45 px-6 py-3 text-sm text-zinc-200 backdrop-blur-sm">
            Chờ dealer bắt đầu hand...
          </div>
        </div>
      )}

      {latestAction && (
        <div className="tracker-display absolute inset-x-0 bottom-0 z-20 mx-auto flex w-fit max-w-[92%] items-center gap-2 rounded-full border border-amber-500/25 bg-black/65 px-3 py-1 text-xs backdrop-blur-sm">
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-amber-400/80">Hành động</span>
          <span className="truncate text-amber-100">
            {latestAction.seat_number > 0 && (
              <span className="text-amber-300/70">Ghế {latestAction.seat_number} · </span>
            )}
            <span className="font-semibold text-emerald-300">{latestAction.display_name}</span>{" "}
            <span className="tracker-num">{formatActionLabel(latestAction)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
