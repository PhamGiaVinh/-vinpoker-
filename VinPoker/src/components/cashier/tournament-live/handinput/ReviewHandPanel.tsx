// Review + Submit step (engine mode). Shows the board, per-player start/ending
// stacks, pot, the winner/result, and a CHIP-CONSERVATION check. Submit Hand is
// blocked (and the handler hard-gates) until conservation holds AND a winner is
// determined — i.e. the workflow has reached submit_ready.

import { Input } from "@/components/ui/input";
import { type Card, displayCard } from "@/components/shared/CardSlotPicker";
import { formatStack } from "./format";

export interface ReviewPlayer {
  player_id: string;
  seat_number: number;
  display_name: string;
  starting_stack: number;
  current_stack: number;
  is_folded?: boolean;
}

interface ReviewHandPanelProps {
  players: ReviewPlayer[];
  board: (Card | null)[];
  endingStacks: Record<string, number>;
  onEndingStackChange: (playerId: string, value: number) => void;
  potSize: number;
  /** Σ ending === Σ starting. */
  conservationOk: boolean;
  /** A winner/result has been determined (someone's ending > current, or fold-win). */
  winnerDetermined: boolean;
  /** conservationOk && winnerDetermined (the submit_ready gate). */
  canSubmit: boolean;
  onSubmit: () => void;
  onBack: () => void;
  submitting?: boolean;
}

export function ReviewHandPanel({
  players,
  board,
  endingStacks,
  onEndingStackChange,
  potSize,
  conservationOk,
  winnerDetermined,
  canSubmit,
  onSubmit,
  onBack,
  submitting,
}: ReviewHandPanelProps) {
  const startTotal = players.reduce((s, p) => s + p.starting_stack, 0);
  const endTotal = players.reduce((s, p) => s + (endingStacks[p.player_id] ?? p.current_stack), 0);

  return (
    <div className="space-y-3 rounded-2xl border border-blue-500/40 bg-card p-3.5">
      <h3 className="text-sm font-bold uppercase tracking-wide text-blue-300">Review hand</h3>
      <div className="text-[11px] text-muted-foreground">
        Board: <span className="font-mono text-foreground">{board.filter((c): c is Card => c !== null).map((c) => displayCard(c)).join("  ") || "—"}</span>
        <span className="ml-3">Pot: <strong className="text-emerald-400">{formatStack(potSize)}</strong></span>
      </div>

      <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
        {players.map((p) => {
          const end = endingStacks[p.player_id] ?? p.current_stack;
          const net = end - p.starting_stack;
          return (
            <div key={p.player_id} className="flex items-center gap-2 rounded border border-border/30 bg-card/50 p-2 text-sm">
              <div className="flex-1 min-w-0 truncate">Ghế {p.seat_number} · {p.display_name}{p.is_folded && <span className="ml-1 text-[10px] text-muted-foreground">(fold)</span>}</div>
              <div className="text-[10px] text-muted-foreground">Đầu: {formatStack(p.starting_stack)}</div>
              <Input type="number" className="h-8 w-24 text-right font-mono text-sm" value={end} onChange={(e) => onEndingStackChange(p.player_id, Number(e.target.value) || 0)} />
              <div className={`w-16 text-right text-[11px] font-mono ${net > 0 ? "text-emerald-400" : net < 0 ? "text-rose-400" : "text-muted-foreground"}`}>{net > 0 ? `+${formatStack(net)}` : net < 0 ? `−${formatStack(-net)}` : "0"}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className={conservationOk ? "text-emerald-400" : "text-rose-400"}>
          {conservationOk ? "✓" : "✗"} Bảo toàn chip: {formatStack(startTotal)} → {formatStack(endTotal)}
        </span>
        <span className={winnerDetermined ? "text-emerald-400" : "text-amber-300"}>
          {winnerDetermined ? "✓ Đã có người thắng" : "⚠ Chưa xác định người thắng"}
        </span>
      </div>
      {!canSubmit && (
        <div className="text-[10px] text-amber-300">Chưa thể gửi hand — cần bảo toàn chip và xác định người thắng trước.</div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/20 pt-2">
        <button type="button" onClick={onBack} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">← Quay lại</button>
        <button
          type="button"
          disabled={submitting || !canSubmit}
          onClick={onSubmit}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-black transition active:scale-[0.99] disabled:opacity-40"
        >
          Submit Hand
        </button>
      </div>
    </div>
  );
}
