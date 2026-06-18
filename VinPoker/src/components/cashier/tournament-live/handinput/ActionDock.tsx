// Bottom action dock — the tablet operator's main input surface. Shows the
// to-act (or selected) player, the numeric keypad, and large GTO-coloured action
// buttons (illegal actions dimmed). All buttons call the parent's existing
// handleAction; the dock holds no game logic.

import { ArrowRight, RotateCcw, Undo2, CheckCircle2, Ban } from "lucide-react";
import { BetKeypad } from "./BetKeypad";
import { formatStack } from "./format";
import type { RailSeat } from "./SeatRail";
import type { ActorView } from "@/lib/tracker-poker/handFlow";

interface ActionDockProps {
  actor: RailSeat | null;
  actorPosition: string;
  view: ActorView | null;
  betAmount: string;
  onBetAmountChange: (v: string) => void;
  bigBlind: number;
  onAction: (type: string) => void;
  needsPostSB: boolean;
  needsPostBB: boolean;
  streetLabel: string;
  nextStreetLabel: string | null;
  onNextStreet: () => void;
  onComplete: () => void;
  canComplete: boolean;
  onUndo: () => void;
  canUndo: boolean;
  onReset: () => void;
  onVoid: () => void;
  hasVoidTarget: boolean;
  /** Hide the keypad + action buttons (e.g. at showdown) — keep header + footer. */
  showActions?: boolean;
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
      className={`flex flex-col items-center justify-center min-h-[52px] rounded-xl border ${tones[tone]} font-medium transition active:scale-[0.98] disabled:opacity-35 disabled:active:scale-100`}
    >
      <span className="text-[15px] tracking-wide">{label}</span>
      {sub && <span className="text-[11px] font-mono opacity-85">{sub}</span>}
    </button>
  );
}

export function ActionDock({
  actor,
  actorPosition,
  view,
  betAmount,
  onBetAmountChange,
  bigBlind,
  onAction,
  needsPostSB,
  needsPostBB,
  streetLabel,
  nextStreetLabel,
  onNextStreet,
  onComplete,
  canComplete,
  onUndo,
  canUndo,
  onReset,
  onVoid,
  hasVoidTarget,
  showActions = true,
  betIsTotal = false,
  disabled,
}: ActionDockProps) {
  const betNum = parseInt(betAmount || "0", 10) || 0;
  const legal = view?.legal;
  const isPosting = needsPostSB || needsPostBB;
  // Min-raise guard. In engine mode the keypad value is the street TOTAL
  // ("Bet to"); in manual mode it is the chips ADDED. A real raise must reach
  // view.minRaiseTo (street total); shoving the whole stack for less is still
  // legal (use ALL-IN), so we only block a non-all-in below-min raise.
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
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">● Đến lượt</span>
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
            {nextStreetLabel ? `Vòng ${streetLabel} xong — sang ${nextStreetLabel}.` : "Chạm một ghế để chọn người hành động."}
          </div>
        )}
      </div>

      {showActions && (
      <div className="p-3.5 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <BetKeypad value={betAmount} onChange={onBetAmountChange} bigBlind={bigBlind} betIsTotal={betIsTotal} disabled={disabled || !actor} />

        <div className="flex flex-col gap-2">
          {isPosting ? (
            <button
              type="button"
              disabled={disabled || betNum <= 0}
              onClick={() => onAction(needsPostSB ? "post_sb" : "post_bb")}
              className="flex-1 min-h-[112px] rounded-xl border border-amber-500/60 bg-amber-500/15 text-amber-200 font-medium text-base flex flex-col items-center justify-center gap-1 transition active:scale-[0.98] disabled:opacity-35"
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
      )}

      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-t border-border/40 bg-popover">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onUndo} disabled={disabled || !canUndo} className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-300 border border-amber-500/50 rounded-lg px-3.5 py-2 hover:bg-amber-500/10 transition disabled:opacity-35" aria-label="Hoàn tác hành động cuối">
            <Undo2 className="w-4 h-4" aria-hidden="true" /> Hoàn tác
          </button>
          <button type="button" onClick={onReset} disabled={disabled} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-lg px-3 py-2 hover:text-foreground transition disabled:opacity-40">
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset
          </button>
          {hasVoidTarget && (
            <button type="button" onClick={onVoid} disabled={disabled} className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive border border-destructive/40 rounded-lg px-3 py-2 hover:bg-destructive/10 transition disabled:opacity-40">
              <Ban className="w-3.5 h-3.5" aria-hidden="true" /> Void
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {nextStreetLabel && (
            <button type="button" onClick={onNextStreet} disabled={disabled} className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground border border-border rounded-lg px-4 py-2 hover:border-amber-400/60 transition disabled:opacity-40">
              Sang {nextStreetLabel} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={onComplete} disabled={disabled || !canComplete} className="inline-flex items-center gap-1.5 text-sm font-medium text-black bg-primary rounded-lg px-4 py-2 transition active:scale-[0.98] disabled:opacity-40">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Hoàn tất
          </button>
        </div>
      </div>
    </div>
  );
}
