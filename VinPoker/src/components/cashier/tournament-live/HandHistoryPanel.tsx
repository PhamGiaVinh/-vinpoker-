import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { isRedCard, displayCard } from "@/components/shared/CardSlotPicker";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { HandEditPanel } from "./HandEditPanel";
import { buildEditCompletedHandArgs, type HandEditPatch } from "./handEditDiff";
import { fetchHandPlayerDisplay, handPlayersHasSnapshot } from "@/lib/tracker-poker/handPlayerNames";
import {
  runClientResettle,
  buildApplyResettleArgs,
  resettleChipChanges,
  type ResettleHandRow,
} from "./resettleApply";
import type { EditedTargetHand, ResettleForwardResult, ResettleOk } from "@/lib/tracker-poker/resettleForward";

interface HandRecord {
  id: string;
  hand_number: number;
  hand_time: string;
  community_cards: string[];
  pot_size: number;
  status: string;
  is_voided: boolean;
  created_at: string;
  button_seat?: number;
  players: {
    player_id: string;
    display_name: string;
    seat_number: number;
    starting_stack: number;
    ending_stack: number;
    is_eliminated: boolean;
    hole_cards: string[];
    entry_number: number;
  }[];
  actions: {
    street: string;
    display_name: string;
    seat_number: number;
    action_type: string;
    action_amount: number;
    action_order: number;
    player_id: string;
    entry_number: number;
  }[];
}

const STREET_ORDER = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function formatActionLabel(a: HandRecord["actions"][0]): string {
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

export function HandHistoryPanel({ tournamentId }: { tournamentId: string }) {
  const [hands, setHands] = useState<HandRecord[]>([]);
  const [selectedHandId, setSelectedHandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // F2 — completed-hand editor (flag trackerHandHistoryEdit). editSupported degrades to
  // false on a 42883 (RPC not applied) so the button hides honestly.
  const [editMode, setEditMode] = useState(false);
  const [editSupported, setEditSupported] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>("all");
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);
  // Đợt G3 — resettle-forward (chips). resettleSupported degrades to false on a 42883
  // (apply RPC not applied) so the flow shows "chưa áp dụng" instead of crashing.
  const [resettleSupported, setResettleSupported] = useState(true);
  const [resettleBusy, setResettleBusy] = useState(false);
  const [resettleView, setResettleView] = useState<{
    result: ResettleForwardResult;
    entryByPlayer: Map<string, number>;
    entryByHandPlayer: Map<string, number>;
    patch: HandEditPatch;
    reason: string;
    targetHandId: string;
  } | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    supabase
      .rpc("get_tournament_tables", { p_tournament_id: tournamentId })
      .then(({ data }) => {
        if (data) {
          setTables(
            (Array.isArray(data) ? data : []).map((t: any) => ({
              id: t.table_id,
              name: t.table_name || t.table_id.slice(0, 8),
            }))
          );
        }
      });
  }, [tournamentId]);

  const loadHands = useCallback(async () => {
    if (!tournamentId) return;
    setLoading(true);
    setLoadError(null);

    let query = supabase
      .from("tournament_hands")
      .select("id, hand_number, hand_time, community_cards, pot_size, status, is_voided, created_at, table_id, button_seat")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (selectedTableId !== "all") {
      query = query.eq("table_id", selectedTableId);
    }

    const { data: handRows, error } = await query;
    if (error || !handRows) {
      setLoadError(error?.message ?? "Không tải được dữ liệu");
      setHands([]);
      setLoading(false);
      return;
    }

    const handIds = handRows.map((h: any) => h.id);
    if (handIds.length === 0) {
      setHands([]);
      setLoading(false);
      return;
    }

    // E1: prefer the per-hand snapshot (hand_players.player_name) when the migration is
    // applied; the column is selected only if present (feature-detect). Fall back to the
    // tournament_seats roster only for old rows the snapshot didn't capture.
    const snap = await handPlayersHasSnapshot();
    const baseHpCols = "hand_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, hole_cards";
    const [playersRes, actionsRes] = await Promise.all([
      supabase
        .from("hand_players")
        .select(snap ? `${baseHpCols}, player_name` : baseHpCols)
        .in("hand_id", handIds),
      supabase
        .from("hand_actions")
        .select("hand_id, player_id, entry_number, street, action_type, action_amount, action_order")
        .in("hand_id", handIds)
        .order("action_order"),
    ]);

    const needIds = (playersRes.data || []).filter((p: any) => !p.player_name).map((p: any) => p.player_id);
    const display = await fetchHandPlayerDisplay(tournamentId, needIds);
    const nameMap = new Map<string, string>();
    (playersRes.data || []).forEach((p: any) => {
      nameMap.set(p.player_id, p.player_name || display.get(p.player_id)?.name || p.player_id.slice(0, 6));
    });

    const playerMap = new Map<string, any[]>();
    (playersRes.data || []).forEach((p: any) => {
      if (!playerMap.has(p.hand_id)) playerMap.set(p.hand_id, []);
      playerMap.get(p.hand_id)!.push({
        player_id: p.player_id,
        display_name: nameMap.get(p.player_id) || p.player_id.slice(0, 6),
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        ending_stack: p.ending_stack,
        is_eliminated: p.is_eliminated,
        hole_cards: p.hole_cards || [],
        entry_number: p.entry_number,
      });
    });

    const actionMap = new Map<string, any[]>();
    (actionsRes.data || []).forEach((a: any) => {
      if (!actionMap.has(a.hand_id)) actionMap.set(a.hand_id, []);
      actionMap.get(a.hand_id)!.push({
        street: a.street || "preflop",
        display_name: nameMap.get(a.player_id) || a.player_id.slice(0, 6),
        seat_number: 0,
        action_type: a.action_type,
        action_amount: a.action_amount,
        action_order: a.action_order,
        player_id: a.player_id,
        entry_number: a.entry_number ?? 1,
      });
    });

    const handRecords: HandRecord[] = handRows.map((h: any) => ({
      id: h.id,
      hand_number: h.hand_number,
      hand_time: h.hand_time,
      community_cards: h.community_cards || [],
      pot_size: h.pot_size || 0,
      status: h.status || "completed",
      is_voided: h.is_voided || false,
      created_at: h.created_at,
      button_seat: h.button_seat,
      players: playerMap.get(h.id) || [],
      actions: actionMap.get(h.id) || [],
    }));

    setHands(handRecords);
    setLoading(false);
  }, [tournamentId, selectedTableId]);

  useEffect(() => { loadHands(); }, [loadHands]);
  useEffect(() => { setEditMode(false); setResettleView(null); }, [selectedHandId]);

  const handleSaveEdit = async (patch: HandEditPatch, reason: string) => {
    const hand = hands.find((h) => h.id === selectedHandId);
    if (!hand) return;
    setSavingEdit(true);
    try {
      const args = buildEditCompletedHandArgs({ tournamentId, handId: hand.id, reason, patch });
      const { data, error } = await supabase.rpc("edit_completed_hand" as any, args as any);
      if (error) {
        if ((error as any).code === "42883") {
          setEditSupported(false);
          toast.error("Tính năng sửa hand chưa được áp dụng trên máy chủ.");
        } else {
          toast.error("Lỗi khi lưu: " + error.message);
        }
        return;
      }
      if (data && (data as any).ok === false) {
        toast.error("Không lưu được: " + (data as any).error);
        return;
      }
      toast.success("Đã lưu chỉnh sửa hand.");
      setEditMode(false);
      loadHands();
    } finally {
      setSavingEdit(false);
    }
  };

  // Đợt G3 — run the resettle engine over the full forward chain and preview the result.
  const handleResettle = async (editedTarget: EditedTargetHand, patch: HandEditPatch, reason: string) => {
    const target = hands.find((h) => h.id === selectedHandId);
    if (!target) return;
    setResettleBusy(true);
    setResettleView(null);
    try {
      // Full forward chain: target + every later completed, non-voided hand in the
      // tournament, chronological. The engine needs the whole chain so its final stacks
      // equal the live chip counts (conservation) for players it doesn't move.
      const { data: handRows, error: hErr } = await supabase
        .from("tournament_hands")
        .select("id, hand_number, table_id, button_seat, created_at")
        .eq("tournament_id", tournamentId)
        .eq("status", "completed")
        .eq("is_voided", false)
        .gte("created_at", target.created_at)
        .order("created_at", { ascending: true });
      if (hErr || !handRows) {
        toast.error("Không tải được chuỗi ván để tính lại: " + (hErr?.message ?? ""));
        return;
      }
      const ids = handRows.map((h: any) => h.id);
      const [pRes, aRes] = await Promise.all([
        supabase
          .from("hand_players")
          .select("hand_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated")
          .in("hand_id", ids),
        supabase
          .from("hand_actions")
          .select("hand_id, player_id, street, action_type, action_amount, action_order")
          .in("hand_id", ids)
          .order("action_order"),
      ]);
      const playersByHand = new Map<string, any[]>();
      (pRes.data || []).forEach((p: any) => {
        if (!playersByHand.has(p.hand_id)) playersByHand.set(p.hand_id, []);
        playersByHand.get(p.hand_id)!.push(p);
      });
      const actionsByHand = new Map<string, any[]>();
      (aRes.data || []).forEach((a: any) => {
        if (!actionsByHand.has(a.hand_id)) actionsByHand.set(a.hand_id, []);
        actionsByHand.get(a.hand_id)!.push(a);
      });
      const toRow = (h: any): ResettleHandRow => ({
        id: h.id,
        hand_number: h.hand_number,
        table_id: h.table_id,
        button_seat: h.button_seat ?? 0,
        created_at: h.created_at,
        players: (playersByHand.get(h.id) || []).map((p: any) => ({
          player_id: p.player_id,
          entry_number: p.entry_number ?? 1,
          seat_number: p.seat_number,
          starting_stack: p.starting_stack ?? 0,
          ending_stack: p.ending_stack ?? 0,
          is_eliminated: !!p.is_eliminated,
        })),
        actions: (actionsByHand.get(h.id) || []).map((a: any) => ({
          player_id: a.player_id,
          street: a.street || "preflop",
          action_type: a.action_type,
          action_amount: a.action_amount ?? 0,
          action_order: a.action_order,
        })),
      });
      const targetRaw = handRows.find((h: any) => h.id === target.id);
      if (!targetRaw) {
        toast.error("Không tìm thấy ván gốc trong chuỗi để tính lại.");
        return;
      }
      const laterRows = handRows.filter((h: any) => h.id !== target.id).map(toRow);
      const { result, entryByPlayer, entryByHandPlayer } = runClientResettle({
        target: toRow(targetRaw),
        later: laterRows,
        editedTarget,
      });
      setResettleView({ result, entryByPlayer, entryByHandPlayer, patch, reason, targetHandId: target.id });
    } finally {
      setResettleBusy(false);
    }
  };

  // Đợt G3 — commit: save display edits (F2 edit_completed_hand) THEN apply the chip
  // re-attribution (G2 apply_resettle_forward). Two-tier degrade on 42883; a latest-hand
  // bust flip is refused by the RPC (elimination_change_use_void) → route to void.
  const handleResettleConfirm = async () => {
    if (!resettleView || !resettleView.result.ok) return;
    const rv = resettleView;
    const ok = rv.result as ResettleOk;
    setResettleBusy(true);
    try {
      const editArgs = buildEditCompletedHandArgs({ tournamentId, handId: rv.targetHandId, reason: rv.reason, patch: rv.patch });
      const { data: editData, error: editErr } = await supabase.rpc("edit_completed_hand" as any, editArgs as any);
      if (editErr) {
        if ((editErr as any).code === "42883") {
          setEditSupported(false);
          toast.error("Tính năng sửa hand chưa được áp dụng trên máy chủ.");
        } else {
          toast.error("Lỗi khi lưu hiển thị: " + editErr.message);
        }
        return;
      }
      if (editData && (editData as any).ok === false) {
        toast.error("Không lưu được hiển thị: " + (editData as any).error);
        return;
      }
      const applyArgs = buildApplyResettleArgs({
        tournamentId,
        targetHandId: rv.targetHandId,
        reason: rv.reason,
        result: ok,
        entryByPlayer: rv.entryByPlayer,
        entryByHandPlayer: rv.entryByHandPlayer,
      });
      const { data: applyData, error: applyErr } = await supabase.rpc("apply_resettle_forward" as any, applyArgs as any);
      if (applyErr) {
        if ((applyErr as any).code === "42883") {
          setResettleSupported(false);
          toast.error("Tính lại chip chưa được áp dụng trên máy chủ.");
        } else {
          toast.error("Lỗi khi tính lại chip: " + applyErr.message);
        }
        return;
      }
      const res = applyData as any;
      if (res && res.ok === false) {
        if (res.error === "elimination_change_use_void") {
          toast.error("Đây là thay đổi loại/còn sống ở ván mới nhất — hãy dùng 'Hoàn tác ván' (void) rồi nhập lại, không dùng tính lại chip.");
        } else {
          toast.error("Không tính lại chip được: " + res.error);
        }
        return;
      }
      toast.success(`Đã tính lại chip — ${res?.changed_players ?? 0} người đổi chip.`);
      setResettleView(null);
      setEditMode(false);
      loadHands();
    } finally {
      setResettleBusy(false);
    }
  };

  const selectedHand = hands.find((h) => h.id === selectedHandId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Hand History</div>
          <Button size="sm" variant="outline" onClick={loadHands} disabled={loading} className="h-7 text-xs">
            {loading ? "..." : "Refresh"}
          </Button>
        </div>

        <select
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={selectedTableId}
          onChange={(e) => setSelectedTableId(e.target.value)}
        >
          <option value="all">All Tables</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {loadError && (
          <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1 break-all">Không tải được lịch sử hand: {loadError}</span>
            <Button size="sm" variant="outline" onClick={loadHands} disabled={loading} className="h-6 text-[11px] shrink-0">
              Thử lại
            </Button>
          </div>
        )}

        <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
          {hands.length === 0 && !loading && !loadError && (
            <div className="text-xs text-muted-foreground text-center py-8 italic">No hands recorded yet</div>
          )}
          {hands.map((hand) => (
            <button
              key={hand.id}
              onClick={() => setSelectedHandId(hand.id)}
              className={`w-full text-left p-2 rounded-lg border text-xs transition-all ${
                selectedHandId === hand.id
                  ? "border-emerald-500/50 bg-emerald-950/20"
                  : "border-border/30 bg-card hover:border-border/60"
              } ${hand.is_voided ? "opacity-50" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${hand.is_voided ? "line-through" : ""}`}>
                  #{hand.hand_number}
                </span>
                <div className="flex items-center gap-1.5">
                  {hand.is_voided && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">VOID</span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    hand.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                    hand.status === "in_progress" ? "bg-amber-500/20 text-amber-400" :
                    "bg-red-500/20 text-red-400"
                  }`}>
                    {hand.status}
                  </span>
                </div>
              </div>
              <div className="text-muted-foreground mt-0.5">
                {hand.community_cards.length > 0 && (
                  <span className="font-mono">{hand.community_cards.map(displayCard).join(" ")}</span>
                )}
                {hand.pot_size > 0 && <span className="ml-1.5 text-emerald-400">{formatStack(hand.pot_size)}</span>}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(hand.hand_time || hand.created_at).toLocaleTimeString()}
                {" · "}
                {hand.players.length} players
                {hand.players.filter((p) => p.is_eliminated).length > 0 && (
                  <span className="text-red-400 ml-1">
                    · {hand.players.filter((p) => p.is_eliminated).length} elim
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {selectedHand ? (
          <>
            <div className="flex items-center justify-between p-3 bg-card border border-border/30 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="text-base font-bold">
                  Hand #{selectedHand.hand_number}
                </div>
                {selectedHand.is_voided && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">VOIDED</span>
                )}
                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                  selectedHand.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
                  selectedHand.status === "in_progress" ? "bg-amber-500/20 text-amber-400" :
                  "bg-red-500/20 text-red-400"
                }`}>
                  {selectedHand.status}
                </span>
                {selectedHand.button_seat && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-400">
                    BTN S{selectedHand.button_seat}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {FEATURES.trackerHandHistoryEdit && editSupported && !editMode &&
                  selectedHand.status === "completed" && !selectedHand.is_voided && (
                    <button
                      type="button"
                      onClick={() => setEditMode(true)}
                      className="text-[11px] font-medium text-emerald-300 border border-emerald-500/50 rounded px-2 py-1 hover:bg-emerald-500/10"
                    >
                      Sửa hand
                    </button>
                  )}
                <div className="text-xs text-muted-foreground">
                  {new Date(selectedHand.hand_time || selectedHand.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            {editMode ? (
              <>
              <HandEditPanel
                board={selectedHand.community_cards}
                players={selectedHand.players.map((p) => ({
                  player_id: p.player_id,
                  entry_number: p.entry_number,
                  display_name: p.display_name,
                  hole_cards: p.hole_cards || [],
                }))}
                actions={selectedHand.actions.map((a) => ({
                  player_id: a.player_id,
                  entry_number: a.entry_number,
                  street: a.street,
                  action_type: a.action_type,
                  action_amount: a.action_amount,
                  action_order: a.action_order,
                }))}
                saving={savingEdit || resettleBusy}
                onCancel={() => { setEditMode(false); setResettleView(null); }}
                onSave={handleSaveEdit}
                resettleEnabled={FEATURES.trackerResettleForward && resettleSupported}
                onResettle={handleResettle}
              />
              {resettleView && (
                <ResettlePreview
                  view={resettleView}
                  busy={resettleBusy}
                  players={selectedHand.players.map((p) => ({ player_id: p.player_id, display_name: p.display_name }))}
                  onConfirm={handleResettleConfirm}
                  onClose={() => setResettleView(null)}
                />
              )}
              </>
            ) : (
            <>
            {selectedHand.community_cards.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-br from-emerald-950/50 to-emerald-900/30 border border-emerald-700/30">
                {selectedHand.community_cards.map((card, i) => (
                  <div key={i} className={`w-12 h-[68px] rounded-lg border-2 flex items-center justify-center text-lg font-bold shadow-lg ${
                    isRedCard(card) ? "border-red-400/40 bg-red-950/40 text-red-400" : "border-white/30 bg-white/10 text-white"
                  }`}>
                    {displayCard(card)}
                  </div>
                ))}
                {selectedHand.pot_size > 0 && (
                  <div className="ml-3 text-lg">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest block">Pot</span>
                    <span className="text-emerald-400 font-bold font-mono">{formatStack(selectedHand.pot_size)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {selectedHand.players.map((p) => (
                <div key={`${p.player_id}-${p.entry_number}`} className={`p-2 rounded-lg border text-xs ${
                  p.is_eliminated
                    ? "border-red-500/30 bg-red-950/10"
                    : "border-border/30 bg-card"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{p.display_name}</span>
                    <span className="text-[10px] text-muted-foreground">S{p.seat_number}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-muted-foreground">
                      {formatStack(p.starting_stack)}
                      <span className="mx-0.5">→</span>
                      <span className={p.ending_stack === 0 ? "text-red-400 font-bold" : "text-emerald-400"}>
                        {formatStack(p.ending_stack ?? 0)}
                      </span>
                    </span>
                    {p.is_eliminated && <span className="text-[10px] text-red-400 font-bold">OUT</span>}
                  </div>
                  {p.hole_cards && p.hole_cards.length === 2 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {p.hole_cards.map((card: string, ci: number) => (
                        <span key={ci} className={`text-[11px] font-bold ${isRedCard(card) ? 'text-red-400' : 'text-white'}`}>
                          {displayCard(card)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="bg-card border border-border/30 rounded-lg p-2.5 shadow-sm">
              <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-2 pb-2 border-b border-border/20">
                Action Log
              </div>
              <div className="overflow-y-auto max-h-[300px] space-y-0.5 pr-1">
                {selectedHand.actions.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4 italic">No actions recorded</div>
                )}
                {STREET_ORDER.filter((s) => selectedHand.actions.some((a) => a.street === s)).map((street) => (
                  <div key={street} className="mb-2">
                    <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">
                      {STREET_LABELS[street]}
                    </div>
                    {selectedHand.actions.filter((a) => a.street === street).map((action, idx) => (
                      <div key={idx} className="flex justify-between py-1 px-1.5 border-b border-border/10 last:border-0 text-xs">
                        <span className="text-muted-foreground">{action.display_name}</span>
                        <span className={`font-semibold ${action.action_amount > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                          {formatActionLabel(action)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            </>
            )}
          </>
        ) : (
          <Card className="p-10 text-center">
            <div className="text-muted-foreground text-sm">Select a hand to view details</div>
          </Card>
        )}
      </div>
    </div>
  );
}

// Đợt G3 — chip-change preview shown after "Sửa & tính lại chip". Prop-driven so the
// money-path parent owns the RPC calls; this only renders the engine's decision + the
// per-player current→new chips, or the engine's Vietnamese block reason.
function ResettlePreview({
  view,
  busy,
  players,
  onConfirm,
  onClose,
}: {
  view: { result: ResettleForwardResult };
  busy: boolean;
  players: { player_id: string; display_name: string }[];
  onConfirm: () => void;
  onClose: () => void;
}) {
  const nameOf = (pid: string) => players.find((p) => p.player_id === pid)?.display_name ?? pid.slice(0, 6);
  const result = view.result;

  if (!result.ok) {
    return (
      <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 space-y-1.5">
        <div className="text-xs font-bold text-amber-300">Không thể tự tính lại chip</div>
        <div className="text-xs text-foreground/90">{result.message}</div>
        {result.hand_number != null && (
          <div className="text-[11px] text-muted-foreground">Ván lệch: #{result.hand_number}</div>
        )}
        {result.affected_player_ids.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            Người liên quan: {result.affected_player_ids.map(nameOf).join(", ")}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground border border-border rounded px-2 py-1 hover:text-foreground mt-1"
        >
          Đóng xem trước
        </button>
      </div>
    );
  }

  const ok = result as ResettleOk;
  const changes = resettleChipChanges(ok);
  const noChange = changes.length === 0;
  return (
    <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-950/20 space-y-2">
      <div className="text-xs font-bold text-emerald-300">Xem trước — tính lại chip</div>
      <div className="text-[11px] text-muted-foreground">
        Người thắng ván này:{" "}
        <span className="text-foreground font-medium">{ok.targetWinnerIds.map(nameOf).join(", ") || "(không có)"}</span>
      </div>
      {noChange ? (
        <div className="text-[11px] text-muted-foreground">
          Không có thay đổi chip — dùng “Chỉ lưu hiển thị” nếu chỉ muốn sửa lá/hành động.
        </div>
      ) : (
        <div className="space-y-0.5">
          {changes.map((c) => (
            <div key={c.player_id} className="flex justify-between text-[11px]">
              <span className="text-muted-foreground truncate mr-2">{nameOf(c.player_id)}</span>
              <span className="font-mono whitespace-nowrap">
                {formatStack(c.before)}
                <span className="mx-0.5">→</span>
                <span className={c.after === 0 ? "text-red-400 font-bold" : "text-emerald-400"}>{formatStack(c.after)}</span>
                <span className={`ml-1 ${c.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  ({c.delta >= 0 ? "+" : ""}
                  {formatStack(c.delta)})
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground leading-snug">{ok.summary}</div>
      <div className="flex gap-2 pt-0.5">
        <button
          type="button"
          disabled={busy || noChange}
          onClick={onConfirm}
          className="text-xs font-semibold text-amber-100 border border-amber-500/60 bg-amber-500/15 rounded-lg px-3 py-1.5 hover:bg-amber-500/25 disabled:opacity-40"
        >
          {busy ? "Đang áp dụng…" : "Xác nhận đổi chip"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5 hover:text-foreground disabled:opacity-40"
        >
          Huỷ xem trước
        </button>
      </div>
      <div className="text-[10px] text-amber-300/80">Sẽ lưu hiển thị (lá/hành động) rồi dời chip. Không thay đổi ai bị loại.</div>
    </div>
  );
}
