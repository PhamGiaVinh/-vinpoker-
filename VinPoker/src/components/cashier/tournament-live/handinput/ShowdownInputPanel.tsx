// Showdown step (engine mode). A dedicated workflow phase: reveal each still-in
// player's two hole cards, then SELECT the winner(s) manually (no hand evaluator
// yet — labelled clearly), before moving to Review. Fold-win never reaches here
// (it routes straight to Review with the winner prefilled).

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
  onHoleCardChange: (playerId: string, ci: number, card: Card | null) => void;
  onReveal: () => void;
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
  onHoleCardChange,
  onReveal,
  selectedWinners,
  onToggleWinner,
  onConfirmResult,
  submitting,
}: ShowdownInputPanelProps) {
  const live = players.filter((p) => !p.is_folded);
  const canConfirm = selectedWinners.length > 0;

  return (
    <div className="space-y-3 rounded-2xl border border-purple-500/40 bg-card p-3.5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-purple-300">Showdown</h3>
      <div className="text-[11px] text-muted-foreground">
        Board: <span className="font-mono text-foreground">{board.filter((c): c is Card => c !== null).map((c) => displayCard(c)).join("  ") || "—"}</span>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-purple-300">Lật bài (tuỳ chọn)</div>
        {live.map((p) => (
          <div key={p.player_id} className="flex items-center gap-2">
            <div className="w-32 truncate text-sm">Ghế {p.seat_number} · {p.display_name}</div>
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
          </div>
        ))}
        <button type="button" disabled={submitting} onClick={onReveal} className="rounded-md bg-purple-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
          Lật bài (gửi lên viewer)
        </button>
      </div>

      <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-2.5">
        <div className="text-[11px] font-semibold text-emerald-300">Chọn người thắng</div>
        <div className="text-[10px] text-amber-300/90">
          Chọn người thắng thủ công — hệ thống chưa tự đánh giá bài trong phiên bản này.
        </div>
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
      </div>

      <button
        type="button"
        disabled={submitting || !canConfirm}
        onClick={onConfirmResult}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition active:scale-[0.99] disabled:opacity-40"
      >
        Xác nhận kết quả → Review
      </button>
    </div>
  );
}
