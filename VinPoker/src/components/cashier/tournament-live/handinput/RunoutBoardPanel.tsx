// B2 — all-in runout ONE-SCREEN. During a multi-way all-in runout the outcome is
// already decided by the cards; the operator shouldn't have to enter+send each
// street separately. This panel shows every REMAINING board slot at once and a
// single "Chia hết bài" button → hook.handleRunoutDealAll, which persists the
// streets in staged cumulative calls so the /live viewer still reveals flop → turn
// → river in sequence.
//
// It only enters cards + calls the parent's staged persist. It NEVER decides viewer
// state — the viewer sees the board only from persisted tournament_hands.community_cards.
// Gated by the caller on FEATURES.trackerRunoutOneScreen; the per-street
// BoardEntryPanel remains the fallback when the flag is off.

import { CardSlotPicker, type Card } from "@/components/shared/CardSlotPicker";

const STREET_OF_SLOT = ["Flop", "Flop", "Flop", "Turn", "River"] as const;

interface RunoutBoardPanelProps {
  /** The fixed 5-slot community-card array from the parent. */
  communityCards: (Card | null)[];
  /** Board cards already persisted to the viewer (0/3/4) — those slots are locked. */
  persistedBoardCount: number;
  usedCards: Set<Card>;
  onCardChange: (slotIndex: number, card: Card | null) => void;
  /** Persist every remaining street in staged calls (hook.handleRunoutDealAll). */
  onDealAll: () => void;
  submitting?: boolean;
}

export function RunoutBoardPanel({
  communityCards,
  persistedBoardCount,
  usedCards,
  onCardChange,
  onDealAll,
  submitting,
}: RunoutBoardPanelProps) {
  // Slots the operator still needs to fill (0-based): everything past what's live.
  const remaining = [0, 1, 2, 3, 4].filter((i) => i >= persistedBoardCount);
  const allFilled = remaining.every((i) => communityCards[i] != null);

  return (
    <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-card p-3.5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-amber-300">Chia hết bài (all-in)</h3>
      <div className="text-[11px] text-muted-foreground">
        Mọi người đã all-in — nhập nốt các lá bài chung rồi bấm một lần. Viewer vẫn được lật lần lượt Flop → Turn → River.
      </div>

      <div className="flex flex-wrap items-end justify-center gap-2 rounded-lg border border-amber-700/30 bg-gradient-to-br from-amber-950/40 to-amber-900/20 p-3 shadow-inner">
        {[0, 1, 2, 3, 4].map((i) => {
          const locked = i < persistedBoardCount;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {STREET_OF_SLOT[i]}
              </span>
              {locked ? (
                // Already on the viewer — show it, but don't let the operator change history.
                <div className="flex h-[52px] w-[38px] items-center justify-center rounded-md border border-emerald-600/40 bg-emerald-950/40 text-xs font-bold text-emerald-300">
                  {communityCards[i] ?? "?"}
                </div>
              ) : (
                <CardSlotPicker value={communityCards[i]} used={usedCards} onChange={(c) => onCardChange(i, c)} />
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={submitting || !allFilled}
        onClick={onDealAll}
        className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition active:scale-[0.99] disabled:opacity-40"
      >
        Chia hết bài
      </button>
    </div>
  );
}
