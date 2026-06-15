// Presentational poker felt for the Tournament Live tracker.
//
// PURE component (no data-fetching / realtime / polling — that stays in the
// parent; PR #12 safety machinery untouched). Shared by the public viewer, the
// operator tracker (TournamentLivePanel) and the replay path, so props stay
// backward-compatible and PokerCard(null) behaviour is never changed.
//
// Layout system (anti-overlap):
//  • A reserved CENTER SAFE-ZONE holds the V mark + board + pot in one stacked
//    group. No seat may enter it.
//  • Seats use a tuned 9-max position MAP per orientation — bottom seats sit low
//    on the rim, side seats stay outside the board zone — so nothing collides.
//  • The action ticker lives in a rail BELOW the felt, not on top of it.
//  • Seats are avatar + name + stack only (no name boxes); position badge is small.

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
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

type Pt = { l: number; t: number };

// Tuned 9-max seat maps. Bottom seats (4–7) sit LOW on the rim; side seats (3,8)
// stay far out — so none of them overlap the centre safe-zone (board + pot).
const PORTRAIT_SEATS: Record<number, Pt> = {
  1: { l: 50, t: 6 },
  2: { l: 82, t: 17 },
  3: { l: 92, t: 40 },
  4: { l: 84, t: 70 },
  5: { l: 63, t: 84 },
  6: { l: 37, t: 84 },
  7: { l: 16, t: 70 },
  8: { l: 8, t: 40 },
  9: { l: 18, t: 17 },
};
const LANDSCAPE_SEATS: Record<number, Pt> = {
  1: { l: 50, t: 6 },
  2: { l: 75, t: 16 },
  3: { l: 91, t: 44 },
  4: { l: 82, t: 80 },
  5: { l: 63, t: 89 },
  6: { l: 37, t: 89 },
  7: { l: 18, t: 80 },
  8: { l: 9, t: 44 },
  9: { l: 25, t: 16 },
};

// Taller ovals (not flat) so 9 seats + a centred board never vertically collide.
const GEO = {
  portrait: { aspect: "5 / 6", seats: PORTRAIT_SEATS, centerTop: "45%", centerW: "60%", vSize: "clamp(28px,10vw,42px)" },
  landscape: { aspect: "7 / 6", seats: LANDSCAPE_SEATS, centerTop: "46%", centerW: "46%", vSize: "clamp(28px,6vw,44px)" },
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
  /** Latest action for the bottom rail (null = no actions yet). */
  latestAction: ActionLog | null;
  formatBB: (n: number) => string | null;
  /** Narrow-phone vertical layout (tall oval + portrait seat map). */
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
  const { t } = useTranslation();
  const geo = portrait ? GEO.portrait : GEO.landscape;
  const boardCardCls = "h-[44px] w-[32px] sm:h-[52px] sm:w-[38px]";

  return (
    <div className="w-full">
      {/* Felt oval — scales with container; seats may straddle the rim so the
          container is overflow-visible (never clips a seat). */}
      <div className="relative mx-auto w-full overflow-visible" style={{ aspectRatio: geo.aspect }}>
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            borderRadius: "50%",
            background:
              "radial-gradient(62% 60% at 50% 38%, hsl(var(--poker-felt)) 0%, hsl(var(--poker-felt)) 50%, hsl(var(--poker-felt-dark)) 100%)",
            boxShadow:
              "inset 0 0 0 5px hsl(var(--poker-gold) / 0.5), inset 0 0 0 7px hsl(var(--poker-felt-dark) / 0.85), inset 0 0 0 8px hsl(var(--poker-gold) / 0.7), inset 0 0 70px rgba(0,0,0,0.5), 0 22px 55px rgba(0,0,0,0.42)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            borderRadius: "50%",
            background: "radial-gradient(52% 42% at 50% 20%, rgba(255,255,255,0.06), transparent 72%)",
          }}
        />

        {/* CENTER SAFE-ZONE — V mark + board + pot, one stacked group. Seats stay
            out of this area. pointer-events-none so it never blocks the felt. */}
        <div
          className="pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ top: geo.centerTop, width: geo.centerW, maxWidth: "244px" }}
        >
          <div
            data-testid="felt-v"
            className="tracker-display mb-2 font-black leading-none"
            style={{ fontSize: geo.vSize, color: "hsl(var(--poker-gold) / 0.55)", textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}
          >
            V
          </div>
          {/* Board — revealed cards face up; unrevealed slots = premium V-logo backs. */}
          <div data-testid="board-cards" className="flex items-center justify-center gap-1.5">
            {displayCards.map((card, i) =>
              card ? (
                <PokerCard key={`${i}-${card}`} card={card} size="md" className={boardCardCls} />
              ) : (
                <CardBack key={`${i}-back`} size="md" className={boardCardCls} />
              )
            )}
          </div>
          {potSize > 0 && (
            <div className="mt-2.5 flex flex-col items-center">
              <div
                className="tracker-pot-pulse inline-flex flex-col items-center rounded-full bg-black/55 px-3.5 py-1"
                style={{ border: "1px solid hsl(var(--poker-gold) / 0.42)" }}
              >
                <div className="tracker-display text-[8px] uppercase tracking-[0.22em]" style={{ color: "hsl(var(--poker-gold) / 0.78)" }}>
                  {t("liveHub.felt.pot", "Pot")}
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
                      className={`tracker-num rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold border ${
                        i === 0
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-[hsl(var(--poker-gold)/0.4)] text-[hsl(var(--poker-gold))]"
                      }`}
                    >
                      {i === 0 ? t("liveHub.felt.main", "Main") : t("liveHub.felt.side", "Side {{i}}", { i })} {formatStack(pot.amount)}
                      <span className="ml-1 font-normal opacity-60">({pot.eligible_player_ids.length})</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {seats.map((seat) => {
          const slot = ((seat.seat_number - 1) % 9) + 1;
          const pos = geo.seats[slot] || geo.seats[1];
          const posStyle: CSSProperties = { left: `${pos.l}%`, top: `${pos.t}%`, transform: "translate(-50%, -50%)" };

          const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
          const isToAct = !seat.is_folded && !seat.is_all_in && toActId === seat.player_id;
          const initials = seat.display_name.slice(0, 2).toUpperCase();

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
              ? "ring-1 ring-[hsl(var(--poker-gold)/0.4)]"
              : "";
          const nameShadow = { textShadow: "0 1px 3px rgba(0,0,0,0.95)" };

          return (
            <div key={seat.player_id} className={`absolute z-10 ${seat.is_folded ? "opacity-50" : ""}`} style={posStyle}>
              <div className="relative flex w-[58px] flex-col items-center text-center sm:w-[70px]">
                {isToAct && (
                  <div
                    className="tracker-display absolute -top-2 z-20 rounded-full px-1.5 py-0.5 text-[7.5px] font-bold uppercase tracking-wide whitespace-nowrap text-white shadow"
                    style={{ background: "hsl(var(--poker-accent))" }}
                  >
                    ◀ {t("liveHub.felt.toAct", "chờ")}
                  </div>
                )}
                <div className="relative">
                  <div
                    className={`grid h-8 w-8 place-items-center overflow-hidden rounded-full border-2 text-[9px] font-bold sm:h-9 sm:w-9 sm:text-[11px] ${avatarBorder} ${avatarRing}`}
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
                      className={`tracker-display absolute -top-1 -right-2 rounded-full px-1 py-px text-[7px] font-semibold uppercase leading-none ${
                        seat.position === "BTN" ? "text-black" : "text-amber-200/85"
                      }`}
                      style={
                        seat.position === "BTN"
                          ? { background: "hsl(var(--poker-gold))" }
                          : { background: "rgba(18,11,7,0.85)", border: "1px solid hsl(var(--poker-gold) / 0.4)" }
                      }
                    >
                      {seat.position}
                    </span>
                  )}
                </div>
                <div className="tracker-display mt-1 max-w-full truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]" style={nameShadow}>
                  {seat.display_name}
                </div>
                <div className="tracker-num text-[10px] font-bold leading-tight" style={{ color: "hsl(var(--poker-stack))", textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}>
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
                    {t("liveHub.felt.bet", "Cược {{amount}}", { amount: formatStack(seat.current_bet) })}
                  </div>
                )}
                {seat.is_all_in && <div className="mt-0.5 text-[8px] font-bold text-red-400" style={nameShadow}>{t("liveHub.felt.allIn", "ALL IN")}</div>}
                {seat.is_folded && <div className="mt-0.5 text-[8px] text-zinc-300" style={nameShadow}>{t("liveHub.felt.folded", "FOLDED")}</div>}
                {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                  <div className="mt-0.5 max-w-full truncate text-[8px] text-amber-300/90" style={nameShadow}>{seat.last_action}</div>
                )}
                <div data-testid="seat-holecards" className="mt-0.5 flex justify-center gap-0.5">
                  {seat.hole_cards && seat.hole_cards.length === 2 ? (
                    seat.hole_cards.map((card, ci) => <PokerCard key={ci} card={card} size="xs" muted={seat.is_folded} />)
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
              {t("liveHub.felt.multiTable", "Giải có nhiều bàn — chọn bàn ở trên để xem live.")}
            </div>
          </div>
        )}

        {!multiTableUnresolved && !handNumber && (
          <div className="absolute inset-0 z-30 flex items-center justify-center">
            <div className="rounded-lg bg-black/45 px-6 py-3 text-sm text-zinc-200 backdrop-blur-sm">
              {t("liveHub.felt.waiting", "Chờ dealer bắt đầu hand...")}
            </div>
          </div>
        )}
      </div>

      {/* Action rail — OUTSIDE the felt so it never collides with the table. */}
      {latestAction && (
        <div className="mt-2.5 px-2">
          <div className="tracker-display mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-amber-500/30 bg-black/65 px-3.5 py-1.5 text-xs">
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-amber-400/80">{t("liveHub.felt.action", "Hành động")}</span>
            <span className="truncate text-amber-100">
              {latestAction.seat_number > 0 && <span className="text-amber-300/70">{t("liveHub.seat", "Ghế {{n}}", { n: latestAction.seat_number })} · </span>}
              <span className="font-semibold text-emerald-300">{latestAction.display_name}</span>{" "}
              <span className="tracker-num">{formatActionLabel(latestAction)}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
