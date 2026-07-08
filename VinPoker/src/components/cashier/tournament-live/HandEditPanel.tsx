// F2 — DISPLAY-ONLY editor for a completed hand. Prop-driven (no supabase) so it stays
// testable; the parent (HandHistoryPanel) runs the edit_completed_hand RPC on save.
// v1 action scope: edit type/amount + delete a row. NO add-row, NO reorder — a deleted
// row's action_order gap is kept (never renumbered).
import { useState } from "react";
import { CardSlotPicker, type Card } from "@/components/shared/CardSlotPicker";
import {
  buildHandEditPatch,
  buildHandEditSummary,
  hasHandEdit,
  type EditableHand,
  type EditAction,
  type EditHolePlayer,
  type HandEditPatch,
} from "./handEditDiff";

export interface HandEditPanelPlayer {
  player_id: string;
  entry_number: number;
  display_name: string;
  hole_cards: string[];
}
export interface HandEditPanelProps {
  board: string[];
  players: HandEditPanelPlayer[];
  actions: EditAction[];
  saving?: boolean;
  onCancel: () => void;
  onSave: (patch: HandEditPatch, reason: string, summary: string[]) => void;
}

const toSlots = (cards: string[], n: number): (Card | null)[] =>
  Array.from({ length: n }, (_, i) => (cards[i] as Card) ?? null);
const fromSlots = (slots: (Card | null)[]): string[] => slots.filter((c): c is Card => !!c);

const ACTION_TYPES = ["fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante"];

export function HandEditPanel({ board, players, actions, saving, onCancel, onSave }: HandEditPanelProps) {
  const [boardSlots, setBoardSlots] = useState<(Card | null)[]>(toSlots(board, 5));
  const [holes, setHoles] = useState<Record<string, (Card | null)[]>>(() => {
    const m: Record<string, (Card | null)[]> = {};
    players.forEach((p) => (m[`${p.player_id}:${p.entry_number}`] = toSlots(p.hole_cards, 2)));
    return m;
  });
  const [rows, setRows] = useState<EditAction[]>(actions.map((a) => ({ ...a })));
  const [reason, setReason] = useState("");

  const usedCards = new Set<Card>([
    ...boardSlots.filter((c): c is Card => !!c),
    ...Object.values(holes).flat().filter((c): c is Card => !!c),
  ]);

  const original: EditableHand = {
    community_cards: board,
    pot_size: 0,
    holes: players.map((p) => ({ player_id: p.player_id, entry_number: p.entry_number, hole_cards: p.hole_cards })),
    actions,
  };
  const edited: EditableHand = {
    community_cards: fromSlots(boardSlots),
    pot_size: 0,
    holes: players.map<EditHolePlayer>((p) => ({
      player_id: p.player_id,
      entry_number: p.entry_number,
      hole_cards: fromSlots(holes[`${p.player_id}:${p.entry_number}`] ?? []),
    })),
    actions: rows,
  };
  const patch = buildHandEditPatch(original, edited);
  const dirty = hasHandEdit(patch);
  const canSave = dirty && reason.trim().length >= 3 && !saving;

  const submit = () => {
    if (!canSave) return;
    const summary = buildHandEditSummary(original, edited);
    if (!window.confirm(["Xác nhận sửa hand?", "", ...summary].join("\n"))) return;
    onSave(patch, reason.trim(), summary);
  };

  const nameOf = (a: EditAction) =>
    players.find((p) => p.player_id === a.player_id && p.entry_number === a.entry_number)?.display_name ??
    a.player_id.slice(0, 6);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">Bài chung (0/3/4/5 lá)</div>
        <div className="flex gap-2">
          {boardSlots.map((c, i) => (
            <CardSlotPicker
              key={i}
              value={c}
              used={new Set([...usedCards].filter((x) => x !== c) as Card[])}
              onChange={(nc) => setBoardSlots((prev) => prev.map((p, pi) => (pi === i ? nc : p)))}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">Bài tẩy</div>
        <div className="space-y-1.5">
          {players.map((p) => {
            const key = `${p.player_id}:${p.entry_number}`;
            const slots = holes[key] ?? [null, null];
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs min-w-[96px] truncate">{p.display_name}</span>
                {slots.map((c, i) => (
                  <CardSlotPicker
                    key={i}
                    value={c}
                    used={new Set([...usedCards].filter((x) => x !== c) as Card[])}
                    onChange={(nc) => setHoles((prev) => ({ ...prev, [key]: (prev[key] ?? [null, null]).map((s, si) => (si === i ? nc : s)) }))}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">
          Hành động (sửa loại/số tiền, hoặc xoá dòng)
        </div>
        <div className="space-y-1 max-h-[240px] overflow-y-auto pr-1">
          {rows.map((a, i) => (
            <div key={a.action_order} className="grid grid-cols-[28px_1fr_96px_92px_28px] gap-2 items-center text-xs">
              <span className="text-muted-foreground tabular-nums">#{a.action_order}</span>
              <span className="truncate">{nameOf(a)} · {a.street}</span>
              <select
                className="h-7 rounded border border-border bg-background px-1 text-xs"
                value={a.action_type}
                onChange={(e) => setRows((prev) => prev.map((r, ri) => (ri === i ? { ...r, action_type: e.target.value } : r)))}
              >
                {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input
                type="number"
                min={0}
                className="h-7 rounded border border-border bg-background px-1 text-xs"
                value={a.action_amount}
                onChange={(e) => setRows((prev) => prev.map((r, ri) => (ri === i ? { ...r, action_amount: Math.max(0, parseInt(e.target.value) || 0) } : r)))}
              />
              <button
                type="button"
                aria-label="Xoá dòng"
                className="text-red-400 hover:text-red-300"
                onClick={() => setRows((prev) => prev.filter((_, ri) => ri !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-muted-foreground mb-1">Lý do sửa — bắt buộc</div>
        <textarea
          className="w-full min-h-[48px] rounded border border-border bg-background p-2 text-xs"
          placeholder="Ví dụ: nhập nhầm lá K♦ — thực tế là K♣"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={submit}
          className="text-xs font-medium text-emerald-300 border border-emerald-500/50 rounded-lg px-3 py-1.5 hover:bg-emerald-500/10 disabled:opacity-40"
        >
          {saving ? "Đang lưu…" : "Xem lại & lưu"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-medium text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:text-foreground"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
