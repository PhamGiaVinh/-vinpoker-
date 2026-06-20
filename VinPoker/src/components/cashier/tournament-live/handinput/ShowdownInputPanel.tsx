// Showdown step (engine mode). Reveal each still-in player's two hole cards (or
// mark a player as mucked), then either AUTO-RANK ("Tự chấm bài" → settleShowdown
// pays each side-pot layer exactly) or SELECT the winner(s) manually (fallback).
// Fold-win never reaches here (it routes straight to Review with the winner prefilled).

import { CardSlotPicker, type Card, displayCard } from "@/components/shared/CardSlotPicker";

export interface ShowdownPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  is_folded: boolean;
}

interface ShowdownInputPanelProps {
  players: ShowdownPlayer[];
  board: (Card | null)[];
  holeCards: Record<string, (Card | null)[]>;
  usedCards: Set<Card>;
  /** Optional: the old embedded HandInputPanel tab renders manual-only (no muck/auto-settle). */
  mucked?: Set<string>;
  onHoleCardChange: (playerId: string, ci: number, card: Card | null) => void;
  onToggleMuck?: (playerId: string) => void;
  onReveal: () => void;
  onAutoSettle?: () => void;
  selectedWinners: string[];
  onToggleWinner: (playerId: string) => void;
  onConfirmResult: () => void;
  submitting?: boolean;
}

export function ShowdownInputPanel({
  players,
  board,
  holeCards,
  usedCards,
  mucked,
  onHoleCardChange,
  onToggleMuck,
  onReveal,
  onAutoSettle,
  selectedWinners,
  onToggleWinner,
  onConfirmResult,
  submitting,
}: ShowdownInputPanelProps) {
  const live = players.filter((p) => !p.is_folded);
  const canConfirm = selectedWinners.length > 0;
  const muckedSet = mucked ?? new Set<string>();

  return (
    <div className="space-y-3 rounded-2xl border border-purple-500/40 bg-card p-3.5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-purple-300">Showdown</h3>
      <div className="text-[11px] text-muted-foreground">
        Board: <span className="font-mono text-foreground">{board.filter((c): c is Card => c !== null).map((c) => displayCard(c)).join("  ") || "—"}</span>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-purple-300">Lật bài / Úp bài</div>
        {live.map((p) => {
          const isMucked = muckedSet.has(p.player_id);
          return (
            <div key={p.player_id} className={`flex items-center gap-2 ${isMucked ? "opacity-45" : ""}`}>
              <div className="w-28 truncate text-sm">Ghế {p.seat_number} · {p.display_name}</div>
              <div className="flex gap-1">
                {[0, 1].map((ci) => (
                  <CardSlotPicker
                    key={ci}
                    value={holeCards[p.player_id]?.[ci] ?? null}
                    used={usedCards}
                    onChange={(c) => onHoleCardChange(p.player_id, ci, c)}
                  />
                ))}
              </div>
              {onToggleMuck && (
                <button
                  type="button"
                  onClick={() => onToggleMuck(p.player_id)}
                  className={`ml-auto rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                    isMucked
                      ? "border-amber-400 bg-amber-500/20 text-amber-200"
                      : "border-border text-muted-foreground hover:border-amber-400/50"
                  }`}
                >
                  {isMucked ? "Đã úp bài" : "Úp bài"}
                </button>
              )}
            </div>
          );
        })}
        <button type="button" disabled={submitting} onClick={onReveal} className="rounded-md bg-purple-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
          Lật bài (gửi lên viewer)
        </button>
      </div>

      {/* AUTO-RANK — pays each side-pot layer exactly via settleShowdown (engine consoles only) */}
      {onAutoSettle && (
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={onAutoSettle}
            className="w-full rounded-xl border-2 border-emerald-400/60 bg-emerald-500/15 px-4 py-2.5 text-sm font-bold text-emerald-200 transition active:scale-[0.99] disabled:opacity-40"
          >
            🎯 Tự chấm bài + chia pot (engine)
          </button>
          <div className="text-[10px] text-muted-foreground">
            Cần đủ 5 lá board + 2 lá tẩy cho mỗi người còn bài (người không lật thì bấm "Úp bài"). Engine chia đúng từng side pot.
          </div>
        </>
      )}

      <div className="space-y-2 rounded-lg border border-border/40 bg-card/40 p-2.5">
        <div className="text-[11px] font-semibold text-muted-foreground">…hoặc chọn người thắng thủ công</div>
        <div className="flex flex-wrap gap-1.5">
          {live.map((p) => {
            const on = selectedWinners.includes(p.player_id);
            return (
              <button
                key={p.player_id}
                type="button"
                onClick={() => onToggleWinner(p.player_id)}
                className={`rounded-full border px-2 py-1 text-xs transition-colors ${on ? "border-emerald-400 bg-emerald-500/20 text-emerald-200" : "border-border text-muted-foreground hover:border-emerald-400/50"}`}
              >
                Ghế {p.seat_number} · {p.display_name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={submitting || !canConfirm}
          onClick={onConfirmResult}
          className="w-full rounded-lg border border-border bg-secondary px-4 py-2 text-xs font-bold text-foreground transition active:scale-[0.99] disabled:opacity-40"
        >
          Xác nhận thủ công → Review
        </button>
      </div>
    </div>
  );
}
