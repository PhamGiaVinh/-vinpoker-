// Guided action step for Tracker Engine Mode (Operator UX v2). Replaces the
// ActionDock in engine action states: ONE actor, ONE task — show who must act and
// only the legal actions, with the keypad sized "Bet to" (street total). It holds
// NO game logic: legality comes straight from the engine-derived `view.legal`
// (never re-derived here) and bet sizing flows through the parent's handleAction
// (betToAdded / "Bet to" semantics). The hand never advances streets from here —
// the workflow state machine does that — so there is no "Sang …" / "Hoàn tất"
// footer; Undo / Reset / Void live in the shared HandControlsStrip.

import { BetKeypad } from "./BetKeypad";
import { formatStack } from "./format";
import type { RailSeat } from "./SeatRail";
import type { ActorView } from "@/lib/tracker-poker/handFlow";

interface ActionStepPanelProps {
  actor: RailSeat | null;
  actorPosition: string;
  view: ActorView | null;
  betAmount: string;
  onBetAmountChange: (v: string) => void;
  bigBlind: number;
  onAction: (type: string) => void;
  needsPostSB: boolean;
  needsPostBB: boolean;
  /** Engine mode: the keypad value is the street TOTAL ("Bet to"), not added chips. */
  betIsTotal?: boolean;
  disabled?: boolean;
}

function ActBtn({
  label,
  sub,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  sub?: string;
  tone: "fold" | "check" | "call" | "raise" | "allin";
  disabled?: boolean;
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    fold: "border-blue-500/60 text-blue-300 bg-blue-500/10",
    check: "border-emerald-500/50 text-emerald-300 bg-emerald-500/10",
    call: "border-emerald-500 text-emerald-200 bg-emerald-500/20",
    raise: "border-red-500/60 text-red-300 bg-red-500/15",
    allin: "border-red-800 text-red-300 bg-red-900/40",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-h-[52px] max-lg:landscape:min-h-[46px] rounded-xl border ${tones[tone]} font-medium transition active:scale-[0.98] disabled:opacity-35 disabled:active:scale-100`}
    >
      <span className="text-[15px] tracking-wide">{label}</span>
      {sub && <span className="text-[11px] font-mono opacity-85">{sub}</span>}
    </button>
  );
}

export function ActionStepPanel({
  actor,
  actorPosition,
  view,
  betAmount,
  onBetAmountChange,
  bigBlind,
  onAction,
  needsPostSB,
  needsPostBB,
  betIsTotal = false,
  disabled,
}: ActionStepPanelProps) {
  const betNum = parseInt(betAmount || "0", 10) || 0;
  const legal = view?.legal;
  const isPosting = needsPostSB || needsPostBB;
  // Same min-raise guard as the ActionDock (display/disable only — legality is
  // never re-derived here; it is read straight from `view.legal`). In engine mode
  // the keypad value is the street TOTAL ("Bet to").
  const addedChips = betIsTotal ? (actor ? Math.max(0, betNum - actor.current_bet) : betNum) : betNum;
  const raiseToTotal = betIsTotal ? betNum : actor ? actor.current_bet + betNum : betNum;
  const minRaiseAdd = actor && view ? Math.max(0, view.minRaiseTo - actor.current_bet) : 0;
  const isAllInRaise = !!actor && addedChips >= actor.current_stack && addedChips > 0;
  const belowMinRaise = !!view && view.minRaiseTo > 0 && raiseToTotal < view.minRaiseTo;

  return (
    <div className="bg-card border border-amber-500/40 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-3.5 py-2.5 bg-gradient-to-r from-amber-500/10 to-transparent">
        {actor ? (
          <>
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/15 border-2 border-amber-400 text-amber-300 text-sm font-medium shrink-0">
              {actor.display_name.slice(0, 2).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">● Đến lượt — chọn 1 hành động</span>
                <span className="text-sm font-medium text-foreground truncate">
                  Ghế {actor.seat_number} · {actor.display_name}
                </span>
                {actorPosition && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                    {actorPosition}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Stack <span className="font-mono text-foreground">{formatStack(actor.current_stack)}</span>
                {view && view.toCall > 0 && (
                  <> · cần theo <span className="font-mono text-amber-300">{formatStack(view.toCall)}</span></>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 text-sm text-muted-foreground py-1.5">
            Chạm một ghế để chọn người hành động.
          </div>
        )}
      </div>

      <div className="p-3.5 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BetKeypad value={betAmount} onChange={onBetAmountChange} bigBlind={bigBlind} betIsTotal={betIsTotal} disabled={disabled || !actor} />

          <div className="flex flex-col gap-2">
            {isPosting ? (
              <button
                type="button"
                disabled={disabled || betNum <= 0}
                onClick={() => onAction(needsPostSB ? "post_sb" : "post_bb")}
                className="flex-1 min-h-[112px] max-lg:landscape:min-h-[64px] rounded-xl border border-amber-500/60 bg-amber-500/15 text-amber-200 font-medium text-base flex flex-col items-center justify-center gap-1 transition active:scale-[0.98] disabled:opacity-35"
              >
                <span>Post {needsPostSB ? "SB" : "BB"}</span>
                <span className="font-mono text-sm">{formatStack(betNum)}</span>
              </button>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <ActBtn label="FOLD" tone="fold" disabled={disabled || !legal?.fold} onClick={() => onAction("fold")} />
                  <ActBtn label="CHECK" tone="check" disabled={disabled || !legal?.check} onClick={() => onAction("check")} />
                  <ActBtn
                    label="CALL"
                    sub={view && view.toCall > 0 ? formatStack(view.toCall) : undefined}
                    tone="call"
                    disabled={disabled || !legal?.call}
                    onClick={() => onAction("call")}
                  />
                  {legal?.bet ? (
                    <ActBtn label="BET" sub={betNum > 0 ? formatStack(betNum) : undefined} tone="raise" disabled={disabled || betNum <= 0} onClick={() => onAction("bet")} />
                  ) : (
                    <ActBtn label="RAISE" sub={betNum > 0 ? formatStack(betNum) : undefined} tone="raise" disabled={disabled || !legal?.raise || betNum <= 0 || (belowMinRaise && !isAllInRaise)} onClick={() => onAction("raise")} />
                  )}
                </div>
                <ActBtn
                  label="ALL-IN"
                  sub={actor ? formatStack(actor.current_stack) : undefined}
                  tone="allin"
                  disabled={disabled || !legal?.allIn}
                  onClick={() => onAction("all_in")}
                />
              </>
            )}
          </div>
        </div>
        {!isPosting && legal?.raise && view && view.minRaiseTo > 0 && (
          <div className={`text-[11px] ${belowMinRaise && !isAllInRaise && betNum > 0 ? "text-red-300" : "text-muted-foreground"}`}>
            Raise tối thiểu thêm <span className="font-mono">{formatStack(minRaiseAdd)}</span> (tới {formatStack(view.minRaiseTo)})
            {belowMinRaise && !isAllInRaise && betNum > 0 && " — số đang nhập thấp hơn mức tối thiểu"}
          </div>
        )}
      </div>
    </div>
  );
}
