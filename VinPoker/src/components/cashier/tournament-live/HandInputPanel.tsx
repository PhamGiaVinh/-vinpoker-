import { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card as UiCard } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Undo2, XCircle,
  ChevronRight, Users, Coins, Send, Play, Eye, Radio
} from "lucide-react";
import { CardSlotPicker, type Card, RANKS, SUIT_SYMBOL, SUIT_COLOR, isRedCard, displayCard } from "@/components/shared/CardSlotPicker";
import { nextButton, getSeatPositions } from "@/lib/tournament/button";
import { computePotBreakdown, toSidePotsJson } from "@/lib/tracker-poker/potEngine";
import { nextToAct, actorView } from "@/lib/tracker-poker/handFlow";
import { SeatRail, type RailSeat } from "./handinput/SeatRail";
import { ActionDock } from "./handinput/ActionDock";
import { formatStack } from "./handinput/format";
import { friendlyValidationError, isValidationCode } from "./handinput/validationMessages";
import type { User } from "@supabase/supabase-js";

type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

interface PlayerState {
  player_id: string;
  entry_number: number;
  seat_number: number;
  display_name: string;
  starting_stack: number;
  current_stack: number;
  is_active: boolean;
  position: string;
  current_bet: number;
  total_bet: number;
  is_folded: boolean;
  is_all_in: boolean;
}

interface ActionRecord {
  street: Street;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  amount: number;
  action_order: number;
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABELS: Record<Street, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
  showdown: "Showdown",
};

function formatActionLabel(a: ActionRecord): string {
  const type = a.action_type;
  if (type === "fold") return "Fold";
  if (type === "check") return "Check";
  if (type === "call") return `Call ${formatStack(a.amount)}`;
  if (type === "bet") return `Bet ${formatStack(a.amount)}`;
  if (type === "raise") return `Raise ${formatStack(a.amount)}`;
  if (type === "all_in") return `All-In ${formatStack(a.amount)}`;
  if (type === "post_sb") return `SB ${formatStack(a.amount)}`;
  if (type === "post_bb") return `BB ${formatStack(a.amount)}`;
  if (type === "post_ante") return `Ante ${formatStack(a.amount)}`;
  return `${type} ${formatStack(a.amount)}`;
}

export function HandInputPanel({ tournamentId }: { tournamentId: string }) {
  const [tableId, setTableId] = useState("");
  const [tableName, setTableName] = useState("");
  const [handNumber, setHandNumber] = useState<number | "">("");
  const [availableTables, setAvailableTables] = useState<{ id: string; name: string }[]>([]);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [currentStreet, setCurrentStreet] = useState<Street>("preflop");
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [communityCards, setCommunityCards] = useState<(Card | null)[]>([null, null, null, null, null]);
  const [betAmount, setBetAmount] = useState("");
  const [buttonSeat, setButtonSeat] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [handId, setHandId] = useState<string | null>(null);
  const [handStarted, setHandStarted] = useState(false);
  const [nextActionOrder, setNextActionOrder] = useState(1);
  const [lastHandId, setLastHandId] = useState<string | null>(null);
  const [endingStacks, setEndingStacks] = useState<Record<string, number>>({});
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [playerHoleCards, setPlayerHoleCards] = useState<Record<string, (Card | null)[]>>({});
  const [orphanHand, setOrphanHand] = useState<{ id: string; hand_number: number } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Tablet redesign: the seat the operator is entering an action for. Defaults
  // to the auto-detected to-act player; tapping a seat overrides it.
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  // Per-action undo: snapshot of the local state before each recorded action,
  // so "Hoàn tác" restores it (and the server row is removed via delete_last_action).
  const [undoStack, setUndoStack] = useState<
    { players: PlayerState[]; actions: ActionRecord[]; currentStreet: Street; nextActionOrder: number }[]
  >([]);
  // Streets whose community cards were already sent — used to confirm overwrites.
  const [sentCommunityStreets, setSentCommunityStreets] = useState<Set<Street>>(new Set());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  useEffect(() => {
    if (!tournamentId) return;
    const loadTables = async () => {
      const { data } = await supabase
        .rpc("get_tournament_tables", { p_tournament_id: tournamentId });
      if (data) {
        const tables = (Array.isArray(data) ? data : []).map((t: any) => ({
          id: t.table_id,
          name: t.table_name || t.table_id.slice(0, 8),
        }));
        setAvailableTables(tables);
      }
    };
    loadTables();
  }, [tournamentId]);

  useEffect(() => {
    if (!handId || !handStarted || !user?.id) return;
    let failCount = 0;
    const MAX_FAILS = 2;
    const interval = setInterval(async () => {
      try {
        const { error } = await supabase.rpc("heartbeat_lock", {
          p_hand_id: handId,
          p_user_id: user.id,
        });
        if (error) {
          const isAuthError = error.message?.includes("Unauthorized") || error.message?.includes("locked by another");
          failCount++;
          if (isAuthError) {
            toast.error("Phiên làm việc đã hết hạn. Vui lòng tải lại trang.");
            setIsReadOnly(true);
            clearInterval(interval);
            return;
          }
          if (failCount >= MAX_FAILS) {
            toast.warning("Mất kết nối phiên làm việc. Vui lòng kiểm tra lại trạng thái bàn.");
            setIsReadOnly(true);
          }
        } else {
          failCount = 0;
        }
      } catch {
        failCount++;
        if (failCount >= MAX_FAILS) {
          toast.warning("Mất kết nối phiên làm việc.");
          setIsReadOnly(true);
        }
      }
    }, 120000);
    return () => clearInterval(interval);
  }, [handId, handStarted, user?.id]);

  const handleTableChange = async (newTableId: string) => {
    setTableId(newTableId);
    const tbl = availableTables.find((t) => t.id === newTableId);
    setTableName(tbl?.name || newTableId.slice(0, 8));
    if (!newTableId) { setPlayers([]); return; }

    const { data: loadedSeats, error } = await supabase
      .from("tournament_seats")
      .select("player_id, entry_number, seat_number, chip_count, player_name")
      .eq("tournament_id", tournamentId)
      .eq("table_id", newTableId)
      .eq("is_active", true)
      .order("seat_number");

    if (error) { toast.error("Không thể tải danh sách người chơi"); setPlayers([]); return; }
    if (!loadedSeats?.length) { setPlayers([]); return; }

    const newPlayers: PlayerState[] = loadedSeats.map((s) => ({
      player_id: s.player_id,
      entry_number: s.entry_number,
      seat_number: s.seat_number,
      display_name: (s as any).player_name || s.player_id.slice(0, 6),
      starting_stack: s.chip_count,
      current_stack: s.chip_count,
      is_active: true,
      position: "",
      current_bet: 0,
      total_bet: 0,
      is_folded: false,
      is_all_in: false,
    }));
    setPlayers(newPlayers);
    resetHand();

    const activeNums = loadedSeats
      .filter((s) => s.player_id)
      .map((s) => s.seat_number)
      .sort((a, b) => a - b);

    const { data: lastHand } = await supabase
      .from("tournament_hands")
      .select("button_seat")
      .eq("tournament_id", tournamentId)
      .eq("table_id", newTableId)
      .order("hand_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastHand?.button_seat) {
      setButtonSeat(nextButton(activeNums, lastHand.button_seat));
    } else {
      setButtonSeat(activeNums[0] ?? 1);
    }

    const { data: nextHand } = await supabase.rpc("get_next_hand_number", {
      p_tournament_id: tournamentId,
      p_table_id: newTableId,
    });
    if (nextHand) setHandNumber(nextHand);

    const { data: orphan } = await supabase
      .from("tournament_hands")
      .select("id, hand_number")
      .eq("tournament_id", tournamentId)
      .eq("table_id", newTableId)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();
    if (orphan) setOrphanHand(orphan);
  };

  const potSize = useMemo(() => {
    return actions.reduce((sum, a) => {
      if (["bet", "raise", "call", "all_in", "post_sb", "post_bb", "post_ante"].includes(a.action_type)) {
        return sum + a.amount;
      }
      return sum;
    }, 0);
  }, [actions]);

  const highestBet = useMemo(() => {
    return Math.max(0, ...players.filter((p) => !p.is_folded).map((p) => p.current_bet));
  }, [players]);

  const potBreakdown = useMemo(
    () =>
      computePotBreakdown(
        players.map((p) => ({
          player_id: p.player_id,
          total_bet: p.total_bet,
          is_folded: p.is_folded,
        }))
      ),
    [players]
  );

  const playerName = useCallback(
    (id: string) => players.find((p) => p.player_id === id)?.display_name || id.slice(0, 6),
    [players]
  );

  const activePlayers = useMemo(() => players.filter((p) => !p.is_folded && !p.is_all_in), [players]);

  const usedCards = useMemo(() => {
    const s = new Set<Card>();
    communityCards.filter((c): c is Card => c !== null).forEach((c) => s.add(c));
    Object.values(playerHoleCards).flat().filter((c): c is Card => c !== null).forEach((c) => s.add(c));
    return s;
  }, [communityCards, playerHoleCards]);

  const positionsBySeat = useMemo(
    () => getSeatPositions(players.map((p) => p.seat_number), buttonSeat),
    [players, buttonSeat]
  );

  const bigBlind = useMemo(
    () => actions.find((a) => a.action_type === "post_bb")?.amount ?? 0,
    [actions]
  );

  // Operator hand-flow: who is to act + which actions are legal (advisory only).
  const flowInput = useMemo(() => {
    const streetActions = actions.filter((a) => a.street === currentStreet);
    const acted = new Set(
      streetActions
        .filter((a) => !["post_sb", "post_bb", "post_ante"].includes(a.action_type))
        .map((a) => a.player_id)
    );
    const lastActorSeat = streetActions.length
      ? streetActions[streetActions.length - 1].seat_number
      : buttonSeat;
    return {
      players: players.map((p) => ({
        player_id: p.player_id,
        seat_number: p.seat_number,
        current_bet: p.current_bet,
        current_stack: p.current_stack,
        is_folded: p.is_folded,
        is_all_in: p.is_all_in,
      })),
      buttonSeat,
      actedThisStreet: acted,
      lastActorSeat,
      bigBlind,
    };
  }, [actions, currentStreet, players, buttonSeat, bigBlind]);

  const toActId = useMemo(() => nextToAct(flowInput), [flowInput]);

  // Selected actor wins if still live, else fall back to the auto to-act player.
  const effectiveActorId = useMemo(() => {
    if (selectedActorId) {
      const p = players.find((x) => x.player_id === selectedActorId);
      if (p && !p.is_folded && !p.is_all_in) return selectedActorId;
    }
    return toActId;
  }, [selectedActorId, players, toActId]);

  const actorPlayer = useMemo(
    () => players.find((p) => p.player_id === effectiveActorId) ?? null,
    [players, effectiveActorId]
  );
  const actorViewData = useMemo(
    () => actorView(flowInput, effectiveActorId ?? undefined),
    [flowInput, effectiveActorId]
  );
  const actorPos = actorPlayer ? positionsBySeat.get(actorPlayer.seat_number) || "" : "";
  const sbPosted = useMemo(() => actions.some((a) => a.action_type === "post_sb"), [actions]);
  const bbPosted = useMemo(() => actions.some((a) => a.action_type === "post_bb"), [actions]);
  const needsPostSB =
    currentStreet === "preflop" && !!actorPlayer && actorPos.includes("SB") && !sbPosted;
  const needsPostBB =
    currentStreet === "preflop" && !!actorPlayer && actorPos === "BB" && !bbPosted;

  const nextStreetLabel = useMemo(() => {
    const idx = STREET_ORDER.indexOf(currentStreet);
    return idx >= 0 && idx < STREET_ORDER.length - 1 ? STREET_LABELS[STREET_ORDER[idx + 1]] : null;
  }, [currentStreet]);

  const handleStartHand = async () => {
    if (!tableId || !handNumber || !user?.id) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: {
          tournament_id: tournamentId,
          action: "start_hand",
          table_id: tableId,
          hand_number: Number(handNumber),
          hand_time: new Date().toISOString(),
          button_seat: buttonSeat,
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Failed to start hand");
      const handData = data?.data || data;
      setHandId(handData?.hand_id);
      setHandStarted(true);
      setNextActionOrder(1);
      toast.success("Hand started");
    } catch (e: any) {
      toast.error(e.message || "Failed to start hand");
      if (orphanHand) setOrphanHand(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueOrphan = async () => {
    if (!orphanHand) return;
    setHandId(orphanHand.id);
    setHandStarted(true);
    setOrphanHand(null);
    toast.success("Resuming hand #" + orphanHand.hand_number);
  };

  const handleVoidOrphan = async () => {
    if (!orphanHand) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: { tournament_id: tournamentId, action: "void_hand", hand_id: orphanHand.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Orphan hand voided");
      setOrphanHand(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (playerId: string, actionType: string) => {
    const player = players.find((p) => p.player_id === playerId);
    if (!player) return;
    if (isReadOnly) { toast.error("Phiên làm việc đã hết hạn"); return; }

    let amount = 0;
    const newPlayers = [...players];
    const idx = newPlayers.findIndex((p) => p.player_id === playerId);

    switch (actionType) {
      case "fold": newPlayers[idx] = { ...newPlayers[idx], is_folded: true }; break;
      case "check": break;
      case "call": {
        amount = Math.min(highestBet - player.current_bet, player.current_stack);
        if (amount >= player.current_stack) {
          newPlayers[idx] = { ...newPlayers[idx], current_stack: 0, current_bet: player.current_bet + amount, total_bet: player.total_bet + amount, is_all_in: true };
        } else {
          newPlayers[idx] = { ...newPlayers[idx], current_stack: player.current_stack - amount, current_bet: player.current_bet + amount, total_bet: player.total_bet + amount };
        }
        break;
      }
      case "bet":
      case "raise": {
        amount = parseInt(betAmount) || 0;
        if (amount <= 0) { toast.error("Nhập số chip"); return; }
        const actual = Math.min(amount, player.current_stack);
        if (actual >= player.current_stack) {
          newPlayers[idx] = { ...newPlayers[idx], current_stack: 0, current_bet: player.current_bet + actual, total_bet: player.total_bet + actual, is_all_in: true };
          amount = actual;
        } else {
          newPlayers[idx] = { ...newPlayers[idx], current_stack: player.current_stack - actual, current_bet: player.current_bet + actual, total_bet: player.total_bet + actual };
        }
        break;
      }
      case "all_in": {
        amount = player.current_stack;
        newPlayers[idx] = { ...newPlayers[idx], current_stack: 0, current_bet: player.current_bet + amount, total_bet: player.total_bet + amount, is_all_in: true };
        break;
      }
      case "post_sb": {
        amount = parseInt(betAmount) || 0;
        if (amount <= 0) { toast.error("Nhập SB"); return; }
        const actual = Math.min(amount, player.current_stack);
        newPlayers[idx] = { ...newPlayers[idx], current_stack: player.current_stack - actual, current_bet: actual, total_bet: player.total_bet + actual };
        amount = actual;
        break;
      }
      case "post_bb": {
        amount = parseInt(betAmount) || 0;
        if (amount <= 0) { toast.error("Nhập BB"); return; }
        const actual = Math.min(amount, player.current_stack);
        newPlayers[idx] = { ...newPlayers[idx], current_stack: player.current_stack - actual, current_bet: actual, total_bet: player.total_bet + actual };
        amount = actual;
        break;
      }
    }

    // Snapshot the pre-action state so the operator can undo this exact step.
    setUndoStack((prev) => [...prev, { players, actions, currentStreet, nextActionOrder }]);

    const currentOrder = nextActionOrder;
    setNextActionOrder((prev) => prev + 1);
    setPlayers(newPlayers);
    setActions((prev) => [...prev, {
      street: currentStreet, player_id: playerId, display_name: player.display_name,
      seat_number: player.seat_number, action_type: actionType, amount, action_order: currentOrder,
    }]);
    setBetAmount("");

    if (handId) {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: {
          tournament_id: tournamentId, action: "record_action", hand_id: handId,
          player_id: playerId, entry_number: player.entry_number,
          street: currentStreet, action_type: actionType, action_amount: amount, action_order: currentOrder,
        },
      });
      // Server-side validation (T4). In "enforce" mode the Edge returns 422 →
      // supabase-js sets `error` (FunctionsHttpError) and the JSON body lives on
      // error.context (a Response we must read). In "warn" mode the action is
      // recorded (200) with only an advisory `validation` field.
      let rejCode: string | undefined;
      let rejMsg: string | undefined;
      if (error) {
        try {
          const errBody = await (error as any)?.context?.json?.();
          rejCode = errBody?.code ?? errBody?.validation?.code;
          rejMsg = errBody?.error;
        } catch { /* body was not JSON */ }
        if (!rejMsg) rejMsg = (error as any)?.message;
      } else if ((data as any)?.error) {
        rejCode = (data as any)?.code;
        rejMsg = (data as any)?.error;
      }

      if (isValidationCode(rejCode)) {
        // The server rejected an illegal action (enforce) — it was NOT recorded.
        // Roll the optimistic local step back so the operator's view matches the
        // server, and explain why in plain Vietnamese (raw code kept as detail).
        restoreLastSnapshot();
        toast.error(friendlyValidationError(rejCode, rejMsg), { description: `Mã lỗi: ${rejCode}` });
      } else if (rejMsg) {
        toast.error(rejMsg);
      } else if ((data as any)?.validation?.code) {
        toast.warning(
          `Cảnh báo luật: ${friendlyValidationError((data as any).validation.code, (data as any).validation.message)}`
        );
      }
    }
  };

  // Dock buttons act on the selected/to-act player, then let auto to-act resume.
  const handleDockAction = (type: string) => {
    if (!effectiveActorId) {
      toast.error("Chạm một ghế để chọn người hành động");
      return;
    }
    // High-risk action: confirm an all-in (whole stack into the pot) before recording.
    if (type === "all_in") {
      const who = players.find((p) => p.player_id === effectiveActorId);
      const msg = `Xác nhận ALL-IN ${who ? formatStack(who.current_stack) : ""}${who ? ` của ${who.display_name}` : ""}? Toàn bộ stack sẽ vào pot.`;
      if (!confirm(msg)) return;
    }
    handleAction(effectiveActorId, type);
    setSelectedActorId(null);
  };

  // Tap a seat: set the button before the hand starts, else select the actor.
  const handleSeatTap = (seat: RailSeat) => {
    if (!handStarted) {
      setButtonSeat(seat.seat_number);
      return;
    }
    if (isReadOnly) return;
    setSelectedActorId(seat.player_id);
  };

  // Undo the last recorded action: remove the server row (delete_last_action),
  // then restore the snapshot of local state from before that action.
  const restoreLastSnapshot = () => {
    const snap = undoStack[undoStack.length - 1];
    if (!snap) return;
    setPlayers(snap.players);
    setActions(snap.actions);
    setCurrentStreet(snap.currentStreet);
    setNextActionOrder(snap.nextActionOrder);
    setUndoStack((prev) => prev.slice(0, -1));
    setBetAmount("");
    setSelectedActorId(null);
  };

  const handleUndo = async () => {
    if (isReadOnly) { toast.error("Phiên làm việc đã hết hạn"); return; }
    if (undoStack.length === 0) { toast.error("Không có hành động nào để hoàn tác"); return; }
    // No server hand yet (rare) → just restore local.
    if (!handId) { restoreLastSnapshot(); return; }
    const { data, error } = await supabase.functions.invoke("tournament-live-update", {
      body: { tournament_id: tournamentId, action: "delete_last_action", hand_id: handId },
    });
    const rejection = (error as any)?.context?.body?.error || (data as any)?.error;
    if (rejection) {
      toast.error(typeof rejection === "string" ? rejection : "Không hoàn tác được hành động");
      return;
    }
    restoreLastSnapshot();
    toast.success("Đã hoàn tác hành động cuối");
  };

  const handleUpdateCommunityCards = async () => {
    if (!handId || isReadOnly) return;
    const cards = communityCards.filter((c): c is Card => c !== null);
    if (cards.length === 0) return;
    // High-risk: confirm before overwriting community cards already sent for this street.
    if (sentCommunityStreets.has(currentStreet) &&
      !confirm(`Bài ${STREET_LABELS[currentStreet]} đã được gửi. Ghi đè lại?`)) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: { tournament_id: tournamentId, action: "update_community_cards", hand_id: handId, community_cards: cards },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setSentCommunityStreets((prev) => new Set(prev).add(currentStreet));
      toast.success(`Community cards updated (${cards.length} cards)`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleShowHoleCards = async () => {
    if (!handId || isReadOnly) return;
    const cardsPayload = [];
    for (const [playerId, holeCards] of Object.entries(playerHoleCards)) {
      const filtered = holeCards.filter((c): c is Card => c !== null);
      if (filtered.length === 2) {
        const player = players.find((p) => p.player_id === playerId);
        cardsPayload.push({ player_id: playerId, entry_number: player?.entry_number || 1, hole_cards: filtered });
      }
    }
    if (cardsPayload.length === 0) { toast.error("Chưa nhập bài lỗ cho ai"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: { tournament_id: tournamentId, action: "show_hole_cards", hand_id: handId, player_hole_cards: cardsPayload },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Hole cards revealed");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const nextStreet = () => {
    const idx = STREET_ORDER.indexOf(currentStreet);
    if (idx < STREET_ORDER.length - 1) {
      setPlayers((prev) => prev.map((p) => ({ ...p, current_bet: 0 })));
      setCurrentStreet(STREET_ORDER[idx + 1]);
    }
  };

  const completeHand = () => {
    const stacks: Record<string, number> = {};
    players.forEach((p) => { stacks[p.player_id] = p.current_stack; });
    setEndingStacks(stacks);
  };

  const handleSubmitHand = async () => {
    if (!tableId || !handNumber) return;
    // High-risk: confirm when ending stacks were manually corrected away from the
    // tracked values before committing them to the record.
    const stacksEdited = players.some(
      (p) => endingStacks[p.player_id] !== undefined && endingStacks[p.player_id] !== p.current_stack
    );
    if (stacksEdited && !confirm("Bạn đã chỉnh sửa stack kết thúc thủ công. Xác nhận lưu các số đã chỉnh?")) return;
    setSubmitting(true);
    try {
      const finalPlayers = players.map((p) => ({
        player_id: p.player_id, entry_number: p.entry_number, seat_number: p.seat_number,
        starting_stack: p.starting_stack, ending_stack: endingStacks[p.player_id] ?? p.current_stack,
        is_eliminated: (endingStacks[p.player_id] ?? p.current_stack) === 0,
        hole_cards: playerHoleCards[p.player_id] ? playerHoleCards[p.player_id].filter((c): c is Card => c !== null) : [],
      }));
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: {
          tournament_id: tournamentId, action: "record_hand", table_id: tableId,
          hand_number: Number(handNumber), hand_time: new Date().toISOString(),
          community_cards: communityCards.filter((c): c is Card => c !== null),
          pot_size: potSize, players: finalPlayers,
          side_pots: toSidePotsJson(potBreakdown),
          actions: actions.map((a) => ({
            player_id: a.player_id, entry_number: players.find((p) => p.player_id === a.player_id)?.entry_number || 1,
            action_type: a.action_type, action_amount: a.amount, action_order: a.action_order, street: a.street,
          })),
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Hand recorded successfully");
      setLastHandId(data?.data?.hand_id ?? null);
      // Advance button to next active seat
      const { data: refreshedSeats } = await supabase
        .from("tournament_seats")
        .select("seat_number, player_id, is_active")
        .eq("tournament_id", tournamentId)
        .eq("table_id", tableId)
        .eq("is_active", true)
        .order("seat_number");
      const activeNums = (refreshedSeats ?? [])
        .filter((s) => s.player_id && s.is_active !== false)
        .map((s) => s.seat_number)
        .sort((a, b) => a - b);
      setButtonSeat(nextButton(activeNums, buttonSeat));
      resetHand();
    } catch (e: any) {
      toast.error(e.message || "Failed to record hand");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async () => {
    const voidId = handId || lastHandId;
    if (!voidId) { toast.error("No hand to void"); return; }
    if (!confirm("CONFIRM VOID: Toàn bộ chip sẽ hoàn về trạng thái trước hand?")) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: { tournament_id: tournamentId, action: "void_hand", hand_id: voidId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Hand VOIDED successfully");
      setLastHandId(null);
      setHandId(null);
      setHandStarted(false);
      resetHand();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetHand = () => {
    setCurrentStreet("preflop");
    setActions([]);
    setCommunityCards([null, null, null, null, null]);
    setBetAmount("");
    setEndingStacks({});
    setPlayerHoleCards({});
    setNextActionOrder(1);
    setUndoStack([]);
    setSelectedActorId(null);
    setSentCommunityStreets(new Set());
    if (tableId) {
      supabase.rpc("get_next_hand_number", { p_tournament_id: tournamentId, p_table_id: tableId }).then(({ data }) => {
        if (data) setHandNumber(data);
      });
    }
  };

  const cardSlotsForStreet = (street: Street): number[] => {
    if (street === "flop") return [0, 1, 2];
    if (street === "turn") return [3];
    if (street === "river") return [4];
    return [];
  };

  const isSummary = Object.keys(endingStacks).length > 0;

  return (
    <div className="space-y-3">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-card border border-border/30 rounded-lg border-l-4 border-l-amber-500 shadow-sm">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-medium text-amber-400">
            {tableId ? `Hand #${handNumber} · ${tableName}` : "Select Table to Start"}
          </h3>
          {tableId && !isSummary && (
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border ${handStarted ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/20" : "bg-amber-500/20 text-amber-400 border-amber-500/20"}`}>
              {handStarted ? <><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" /> Live</> : STREET_LABELS[currentStreet]}
            </span>
          )}
          {isSummary && <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-medium border border-blue-500/20">Review Mode</span>}
          {isReadOnly && <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs font-medium border border-red-500/20">Read-Only</span>}
        </div>
        {tableId && !isSummary && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {activePlayers.length}/{players.length} Active</span>
            <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5 text-emerald-400" /> Pot: <strong className="text-emerald-400 text-sm">{formatStack(potSize)}</strong></span>
          </div>
        )}
      </div>

      {/* Persistent read-only banner — existing isReadOnly state, display only */}
      {isReadOnly && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          <span className="w-1.5 h-1.5 bg-red-400 rounded-full shrink-0" />
          <span>
            Phiên nhập hand đã bị khoá (mất quyền điều khiển bàn). Chỉ xem — tải lại trang để tiếp tục nhập.
          </span>
        </div>
      )}

      {/* SETUP: Table selector */}
      {!tableId && (
        <UiCard className="p-6 text-center space-y-4 border-dashed">
          <div className="text-muted-foreground">Chọn bàn để bắt đầu ghi nhận hand</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Chọn Bàn</label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={tableId} onChange={(e) => handleTableChange(e.target.value)}>
                <option value="">-- Chọn Bàn --</option>
                {availableTables.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Hand Number</label>
              <Input placeholder="Auto" type="number" value={handNumber} onChange={(e) => setHandNumber(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </div>
        </UiCard>
      )}

      {/* ORPHAN HAND DETECTION */}
      {orphanHand && !handStarted && (
        <UiCard className="p-4 border-amber-500/50 bg-amber-950/20 space-y-3">
          <div className="text-sm font-medium text-amber-400">Hand #{orphanHand.hand_number} đang diễn ra</div>
          <div className="text-xs text-muted-foreground">Bàn này có hand chưa hoàn tất. Bạn muốn tiếp tục hay hủy?</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleContinueOrphan} className="bg-amber-500 hover:bg-amber-600 text-black font-bold"><Play className="w-3.5 h-3.5 mr-1" /> Tiếp tục</Button>
            <Button size="sm" variant="destructive" onClick={handleVoidOrphan} disabled={submitting}><Undo2 className="w-3.5 h-3.5 mr-1" /> Hủy hand</Button>
          </div>
        </UiCard>
      )}

      {/* START HAND BUTTON */}
      {tableId && !handStarted && !orphanHand && (
        <UiCard className="p-6 text-center space-y-4 border-dashed">
          <div className="flex items-center gap-3 justify-center">
            <label className="text-xs font-medium text-muted-foreground">Hand Number</label>
            <Input className="w-24" type="number" value={handNumber} onChange={(e) => setHandNumber(e.target.value === "" ? "" : Number(e.target.value))} />
          </div>
          {players.length > 0 && (
            <div className="text-left max-w-xl mx-auto">
              <SeatRail
                seats={players}
                positions={positionsBySeat}
                buttonSeat={buttonSeat}
                toActId={null}
                selectedActorId={null}
                setupMode
                onTapSeat={handleSeatTap}
              />
            </div>
          )}
          <Button onClick={handleStartHand} disabled={submitting || !handNumber} className="bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/20">
            <Play className="w-4 h-4 mr-2" /> Bắt đầu Hand
          </Button>
          {lastHandId && (
            <div className="pt-2">
              <Button size="sm" variant="destructive" onClick={handleVoid} disabled={submitting}>
                <Undo2 className="w-3.5 h-3.5 mr-1" /> Void Last Hand ({lastHandId.slice(0, 8)})
              </Button>
            </div>
          )}
        </UiCard>
      )}

      {/* ACTIVE: Hand tracking */}
      {tableId && handStarted && !isSummary && (
        <>
          {/* COMMUNITY CARDS with CardSlotPicker */}
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-br from-emerald-950/50 to-emerald-900/30 border border-emerald-700/30 shadow-inner">
            {communityCards.map((card, i) => {
              const isEditable = cardSlotsForStreet(currentStreet).includes(i) || (currentStreet === "showdown" && !handStarted);
              return (
                <CardSlotPicker
                  key={i}
                  value={card}
                  used={usedCards}
                  onChange={(c) => {
                    const newCards = [...communityCards];
                    newCards[i] = c;
                    setCommunityCards(newCards);
                  }}
                />
              );
            })}
            {(currentStreet === "flop" || currentStreet === "turn" || currentStreet === "river") && (
              <Button size="sm" onClick={handleUpdateCommunityCards} disabled={submitting || communityCards.filter(Boolean).length === 0} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-500/20 ml-2">
                <Radio className="w-3.5 h-3.5 mr-1" /> Gửi {STREET_LABELS[currentStreet]}
              </Button>
            )}
          </div>

          {/* STREET TABS */}
          <div className="flex gap-1 p-1.5 bg-card border border-border/30 rounded-lg overflow-x-auto shadow-sm">
            {STREET_ORDER.map((street) => (
              <button key={street} className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all ${currentStreet === street ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm" : "text-muted-foreground hover:text-amber-400 border border-transparent hover:bg-secondary/50"}`} onClick={() => setCurrentStreet(street)}>
                {STREET_LABELS[street]}
              </button>
            ))}
            <button className="ml-auto px-3 py-1.5 rounded text-xs font-medium text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" onClick={nextStreet} disabled={currentStreet === "showdown"}>
              Next <ChevronRight className="w-3 h-3 inline" />
            </button>
          </div>

          {/* INFO STRIP — Vietnamese operator context (street · actor/next · cần theo · pot · last action) */}
          {currentStreet !== "showdown" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-card border border-border/30 rounded-lg text-[11px] shadow-sm">
              <span className="text-muted-foreground">Vòng <strong className="text-amber-300">{STREET_LABELS[currentStreet]}</strong></span>
              <span className="text-border">·</span>
              {actorPlayer ? (
                <span className="text-muted-foreground">Đang chờ <strong className="text-foreground">Ghế {actorPlayer.seat_number} · {actorPlayer.display_name}</strong>{actorPos && <span className="text-emerald-300"> ({actorPos})</span>}</span>
              ) : (
                <span className="text-emerald-300 font-medium">Vòng cược xong — sang vòng kế</span>
              )}
              {actorViewData && actorViewData.toCall > 0 && (
                <>
                  <span className="text-border">·</span>
                  <span className="text-muted-foreground">Cần theo <strong className="font-mono text-amber-300">{formatStack(actorViewData.toCall)}</strong></span>
                </>
              )}
              <span className="text-border">·</span>
              <span className="text-muted-foreground">Pot <strong className="font-mono text-emerald-400">{formatStack(potSize)}</strong>{potBreakdown.sidePots.length > 0 && <span className="text-amber-300"> +{potBreakdown.sidePots.length} side</span>}</span>
              {actions.length > 0 && (
                <>
                  <span className="text-border">·</span>
                  <span className="text-muted-foreground">Cuối: <strong className="text-foreground">S{actions[actions.length - 1].seat_number} {formatActionLabel(actions[actions.length - 1])}</strong></span>
                </>
              )}
            </div>
          )}

          {/* POT BREAKDOWN — only when an all-in splits the pot or a bet is uncalled */}
          {(potBreakdown.sidePots.length > 0 || potBreakdown.uncalled) && (
            <div className="p-3 bg-card border border-amber-500/30 rounded-lg space-y-2 shadow-sm">
              <div className="text-[10px] font-bold text-amber-400/80 uppercase tracking-widest">
                Pot Breakdown
              </div>
              <div className="flex flex-wrap gap-2">
                {potBreakdown.pots.map((pot, i) => (
                  <div
                    key={i}
                    className={`px-2.5 py-1.5 rounded-md border text-xs ${
                      i === 0
                        ? "border-emerald-500/40 bg-emerald-950/20"
                        : "border-amber-500/40 bg-amber-950/20"
                    }`}
                  >
                    <span className={`font-bold ${i === 0 ? "text-emerald-400" : "text-amber-400"}`}>
                      {i === 0 ? "Main Pot" : `Side Pot ${i}`}: {formatStack(pot.amount)}
                    </span>
                    <span className="ml-1.5 text-muted-foreground">
                      {pot.eligible_player_ids.length === 0
                        ? "— không ai đủ điều kiện"
                        : `· ${pot.eligible_player_ids.map(playerName).join(", ")}`}
                    </span>
                  </div>
                ))}
              </div>
              {potBreakdown.uncalled && (
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-orange-500/40 bg-orange-950/20 text-xs text-orange-300">
                  <span className="font-bold">⚠ Cược chưa được theo:</span>
                  <span>
                    {formatStack(potBreakdown.uncalled.amount)} của{" "}
                    <strong>{playerName(potBreakdown.uncalled.player_id)}</strong> — sẽ hoàn lại nếu
                    không ai theo thêm
                  </span>
                </div>
              )}
            </div>
          )}

          {/* SHOWDOWN: Hole cards input */}
          {currentStreet === "showdown" && (
            <div className="space-y-3 p-3 bg-card border border-purple-500/30 rounded-lg">
              <div className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Hole Cards (Lật bài)</div>
              {players.filter((p) => !p.is_folded).map((player) => (
                <div key={player.player_id} className="flex items-center gap-3">
                  <div className="text-sm font-medium w-32 truncate">{player.display_name}</div>
                  <div className="flex gap-1">
                    {[0, 1].map((ci) => (
                      <CardSlotPicker
                        key={`${player.player_id}-${ci}`}
                        value={playerHoleCards[player.player_id]?.[ci] ?? null}
                        used={usedCards}
                        onChange={(c) => {
                          setPlayerHoleCards((prev) => {
                            const current = prev[player.player_id] || [null, null];
                            const updated = [...current] as (Card | null)[];
                            updated[ci] = c;
                            return { ...prev, [player.player_id]: updated };
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <Button size="sm" onClick={handleShowHoleCards} disabled={submitting} className="bg-purple-500 hover:bg-purple-600 text-white font-bold">
                <Eye className="w-3.5 h-3.5 mr-1" /> Lật bài
              </Button>
            </div>
          )}

          {/* SEAT RAIL — tap to select the acting player */}
          <SeatRail
            seats={players}
            positions={positionsBySeat}
            buttonSeat={buttonSeat}
            toActId={toActId}
            selectedActorId={selectedActorId}
            onTapSeat={handleSeatTap}
          />

          {/* ACTION DOCK — to-act player + keypad + GTO action buttons */}
          <ActionDock
            actor={currentStreet === "showdown" ? null : actorPlayer}
            actorPosition={actorPos}
            view={actorViewData}
            betAmount={betAmount}
            onBetAmountChange={setBetAmount}
            bigBlind={bigBlind}
            onAction={handleDockAction}
            needsPostSB={needsPostSB}
            needsPostBB={needsPostBB}
            streetLabel={STREET_LABELS[currentStreet]}
            nextStreetLabel={nextStreetLabel}
            onNextStreet={nextStreet}
            onComplete={completeHand}
            canComplete={actions.length > 0}
            onUndo={handleUndo}
            canUndo={undoStack.length > 0}
            onReset={resetHand}
            onVoid={handleVoid}
            hasVoidTarget={!!(handId || lastHandId)}
            showActions={currentStreet !== "showdown"}
            disabled={submitting || isReadOnly}
          />

          {/* ACTION LOG */}
          <div className="bg-card border border-border/30 rounded-lg p-2.5 shadow-sm max-h-60 flex flex-col">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 sticky top-0 bg-card pb-2 border-b border-border/20">Action Log</div>
            <div className="overflow-y-auto space-y-0.5 flex-1 pr-1">
              {actions.length === 0 && (<div className="text-xs text-muted-foreground text-center py-4 italic">Chưa có action nào được ghi nhận</div>)}
              {STREET_ORDER.filter((s) => actions.some((a) => a.street === s)).map((street) => (
                <div key={street} className="mb-3">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1 sticky top-0 bg-card/50 backdrop-blur-sm py-1">
                    {STREET_LABELS[street]}
                    {street === "flop" && communityCards[0] && <span className="text-muted-foreground font-normal ml-2">({communityCards.slice(0, 3).filter(Boolean).map(displayCard).join(" ")})</span>}
                    {street === "turn" && communityCards[3] && <span className="text-muted-foreground font-normal ml-2">({displayCard(communityCards[3]!)})</span>}
                    {street === "river" && communityCards[4] && <span className="text-muted-foreground font-normal ml-2">({displayCard(communityCards[4]!)})</span>}
                  </div>
                  {actions.filter((a) => a.street === street).map((action, idx) => (
                    <div key={idx} className="flex justify-between py-1.5 px-2 border-b border-border/10 last:border-0 text-xs hover:bg-secondary/30 rounded transition-colors">
                      <span className="text-muted-foreground font-medium"><span className="text-[10px] text-foreground bg-border/30 px-1 rounded mr-1">S{action.seat_number}</span>{action.display_name}</span>
                      <span className={`font-bold ${action.amount > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{formatActionLabel(action)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

        </>
      )}

      {/* SUMMARY: Review ending stacks */}
      {isSummary && (
        <UiCard className="p-4 space-y-4 border-blue-500/30 bg-blue-950/10">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-blue-400 uppercase tracking-wide">Review Ending Stacks</div>
            <div className="text-xs text-muted-foreground">Pot: <strong className="text-emerald-400">{formatStack(potSize)}</strong></div>
          </div>
          <div className="text-xs text-muted-foreground mb-2 bg-black/20 p-2 rounded">Community: {communityCards.filter(Boolean).map(displayCard).join(" ") || "—"}</div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {players.map((player) => (
              <div key={player.player_id} className="flex items-center gap-3 border border-border/30 rounded p-2 bg-card/50">
                <div className="text-sm font-medium flex-1 min-w-0">
                  <div className="truncate">S{player.seat_number} {player.display_name}</div>
                  {player.is_folded && <span className="text-[10px] text-muted-foreground">(Folded)</span>}
                  {player.is_all_in && <span className="text-[10px] text-red-400 font-bold">(All-In)</span>}
                </div>
                <div className="text-[10px] text-muted-foreground text-right">Start: {formatStack(player.starting_stack)}</div>
                <Input type="number" className="w-24 h-8 text-sm font-mono text-right" value={endingStacks[player.player_id] ?? player.current_stack} onChange={(e) => setEndingStacks((prev) => ({ ...prev, [player.player_id]: Number(e.target.value) }))} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/20">
            <Button size="sm" variant="ghost" onClick={() => setEndingStacks({})}><XCircle className="w-3.5 h-3.5 mr-1" /> Back</Button>
            <Button size="sm" onClick={handleSubmitHand} disabled={submitting} className="bg-amber-500 hover:bg-amber-600 text-black font-bold shadow-lg shadow-amber-500/20">
              <Send className="w-3.5 h-3.5 mr-1" /> Submit Hand
            </Button>
          </div>
        </UiCard>
      )}
    </div>
  );
}
