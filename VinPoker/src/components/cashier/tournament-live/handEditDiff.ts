// F2 — pure diff/patch builder for the completed-hand editor. No supabase, no actor:
// the RPC edit_completed_hand binds auth.uid() itself, so nothing here carries an actor.
import {
  contributionsFromActions,
  computePotBreakdown,
  toSidePotsJson,
} from "@/lib/tracker-poker/potEngine";

export interface EditHolePlayer {
  player_id: string;
  entry_number: number;
  hole_cards: string[];
}
export interface EditAction {
  player_id: string;
  entry_number: number;
  street: string;
  action_type: string;
  action_amount: number;
  action_order: number;
}
export interface EditableHand {
  community_cards: string[];
  pot_size: number;
  holes: EditHolePlayer[]; // one per hand player
  actions: EditAction[];
}

const sameCards = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);

const sameHoles = (a: EditHolePlayer[], b: EditHolePlayer[]) =>
  a.length === b.length &&
  a.every((p, i) => p.player_id === b[i].player_id && p.entry_number === b[i].entry_number && sameCards(p.hole_cards, b[i].hole_cards));

const sameActions = (a: EditAction[], b: EditAction[]) =>
  a.length === b.length &&
  a.every((x, i) =>
    x.action_order === b[i].action_order &&
    x.action_type === b[i].action_type &&
    x.action_amount === b[i].action_amount &&
    x.player_id === b[i].player_id &&
    x.street === b[i].street);

/** Display pot recomputed from the edited action stream (same semantics as record_hand's
 *  submit path). Display-only — never a settlement. */
export function recomputeDisplayPot(actions: EditAction[]): { pot_size: number; side_pots: unknown[] } {
  const breakdown = computePotBreakdown(
    contributionsFromActions(actions.map((a) => ({ player_id: a.player_id, action_type: a.action_type, action_amount: a.action_amount }))),
  );
  return { pot_size: breakdown.totalPot, side_pots: toSidePotsJson(breakdown) };
}

export interface HandEditPatch {
  p_community_cards: string[] | null;
  p_hole_cards: EditHolePlayer[] | null;
  p_actions: EditAction[] | null;
  p_pot_size: number | null;
  p_side_pots: unknown[] | null;
}

/** PATCH-minimised: null for every section the operator left unchanged. When the actions
 *  change, the display pot + side pots are recomputed and sent alongside them. */
export function buildHandEditPatch(original: EditableHand, edited: EditableHand): HandEditPatch {
  const boardChanged = !sameCards(original.community_cards, edited.community_cards);
  const holesChanged = !sameHoles(original.holes, edited.holes);
  const actionsChanged = !sameActions(original.actions, edited.actions);
  const pot = actionsChanged ? recomputeDisplayPot(edited.actions) : null;
  return {
    p_community_cards: boardChanged ? edited.community_cards : null,
    p_hole_cards: holesChanged ? edited.holes : null,
    p_actions: actionsChanged ? edited.actions : null,
    p_pot_size: pot ? pot.pot_size : null,
    p_side_pots: pot ? pot.side_pots : null,
  };
}

export function hasHandEdit(patch: HandEditPatch): boolean {
  return patch.p_community_cards !== null || patch.p_hole_cards !== null || patch.p_actions !== null;
}

/** The exact rpc("edit_completed_hand", …) arg object (pinned by test). NO actor arg. */
export function buildEditCompletedHandArgs(input: {
  tournamentId: string;
  handId: string;
  reason: string;
  patch: HandEditPatch;
}) {
  return {
    p_tournament_id: input.tournamentId,
    p_hand_id: input.handId,
    p_reason: input.reason,
    p_community_cards: input.patch.p_community_cards,
    p_hole_cards: input.patch.p_hole_cards,
    p_actions: input.patch.p_actions,
    p_pot_size: input.patch.p_pot_size,
    p_side_pots: input.patch.p_side_pots,
  };
}

const nameOf = (id: string, holes: EditHolePlayer[]) => id.slice(0, 6); // display fallback; caller can map

/** Plain-VN diff lines for the confirm dialog — always ends with the display-only warning. */
export function buildHandEditSummary(original: EditableHand, edited: EditableHand): string[] {
  const lines: string[] = [];
  // Board
  const n = Math.max(original.community_cards.length, edited.community_cards.length);
  for (let i = 0; i < n; i++) {
    const o = original.community_cards[i] ?? "—";
    const e = edited.community_cards[i] ?? "—";
    if (o !== e) lines.push(`Board: ${o} → ${e} (lá ${i + 1})`);
  }
  // Holes
  edited.holes.forEach((h) => {
    const o = original.holes.find((x) => x.player_id === h.player_id && x.entry_number === h.entry_number);
    if (o && !sameCards(o.hole_cards, h.hole_cards)) {
      lines.push(`Bài tẩy ${nameOf(h.player_id, edited.holes)}: ${o.hole_cards.join(" ") || "—"} → ${h.hole_cards.join(" ") || "—"}`);
    }
  });
  // Actions
  if (!sameActions(original.actions, edited.actions)) {
    const editedByOrder = new Map(edited.actions.map((a) => [a.action_order, a]));
    original.actions.forEach((o) => {
      const e = editedByOrder.get(o.action_order);
      if (!e) {
        lines.push(`Xoá hành động #${o.action_order} (${o.action_type} ${o.action_amount || ""})`);
      } else if (e.action_type !== o.action_type || e.action_amount !== o.action_amount) {
        lines.push(`Hành động #${o.action_order}: ${o.action_type} ${o.action_amount} → ${e.action_type} ${e.action_amount}`);
      }
    });
    const pot = recomputeDisplayPot(edited.actions);
    if (pot.pot_size !== original.pot_size) {
      lines.push(`Pot hiển thị: ${original.pot_size} → ${pot.pot_size} (tính lại từ hành động)`);
    }
  }
  lines.push("Chỉ thay đổi HIỂN THỊ — chip và kết quả đã lưu KHÔNG đổi.");
  return lines;
}
