// Controller hook for the STANDALONE operator console (`/tracker/hand-input`).
//
// It is the ENGINE-ONLY subset of HandInputPanel's orchestration: the console is
// mounted only when `FEATURES.trackerEngineMode` is on (the page gates it), so the
// manual-mode branches (advisory nextToAct, manual bet sizing, manual board/street
// jump) are dropped here — the engine path is unconditional. The embedded
// HandInputPanel is NOT touched; this hook reuses the SAME pure libraries
// (trackerEngine, trackerWorkflow, button, resumeHand, potEngine, handFlow) and the
// SAME 7 Edge payloads (built in handInputEdge.ts), so "write-path unchanged" is
// provable, not just asserted.
//
// URL keys are DISTINCT from the panel's `hiTable`: `table` is the authoritative
// resume key; `hand`/`street`/`actor` are write-only mirrors (never read back, so
// no resume loops) for the mockup's refresh-safe context.

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Card } from "@/components/shared/CardSlotPicker";
import { nextButton, getSeatPositions } from "@/lib/tournament/button";
import { nextButtonTournament } from "@/lib/tournament/deadButton";
import {
  replayActions,
  deriveResumeStreet,
  nextActionOrderFrom,
  type ResumeActionRow,
} from "./resumeHand";
import { computePotBreakdown, toSidePotsJson } from "@/lib/tracker-poker/potEngine";
import { actorView } from "@/lib/tracker-poker/handFlow";
import {
  actorToAct,
  isRoundComplete,
  betToAdded,
  foldWinner,
  settleFoldWin,
  settleSelectedWinners,
  blindSeats,
  firstPreflopActor,
  snapshotBlindLevel,
  hasLevelChangedDuringHand,
  isRunout,
  showdownRevealOrder,
  type EngineState,
  type BlindLevelSnapshot,
  type ClockLevel,
} from "@/lib/tracker-poker/trackerEngine";
import { FEATURES } from "@/lib/featureFlags";
import { settleShowdown, type ShowdownLayerResult } from "@/lib/tracker-poker/trackerShowdown";
import { computeRankShifts } from "@/lib/tracker-poker/rankShift";
import { survivorsAfterHand } from "./postHand";
import {
  deriveTrackerWorkflowState,
  isActionState,
  isBoardEntryState,
  boardEntryStreet,
  REQUIRED_BOARD_COUNT,
} from "./trackerWorkflow";
import type { RailSeat } from "./SeatRail";
import type { InputTableSummary } from "./InputTableMap";
import { formatStack } from "./format";
import { friendlyValidationError, isValidationCode } from "./validationMessages";
import type { SyncPhase } from "./ViewerSyncStatus";
import type { User } from "@supabase/supabase-js";
import {
  buildStartHandBody,
  buildRecordActionBody,
  buildUpdateCommunityCardsBody,
  buildShowHoleCardsBody,
  buildRecordHandBody,
  buildVoidHandBody,
  buildDeleteLastActionBody,
  readEdgeError,
  type EdgePlayer,
} from "./handInputEdge";

type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface PlayerState {
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
  avatar_url?: string | null;
}

export interface ActionRecord {
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

const STREET_LABELS_EXPORT = STREET_LABELS;
export { STREET_LABELS_EXPORT as STANDALONE_STREET_LABELS };

export function useStandaloneHandInput(tournamentId: string) {
  const [tableId, setTableId] = useState("");
  const [tableName, setTableName] = useState("");
  const [handNumber, setHandNumber] = useState<number | "">("");
  const [availableTables, setAvailableTables] = useState<InputTableSummary[]>([]);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [currentStreet, setCurrentStreet] = useState<Street>("preflop");
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [communityCards, setCommunityCards] = useState<(Card | null)[]>([null, null, null, null, null]);
  const [betAmount, setBetAmount] = useState("");
  const [buttonSeat, setButtonSeat] = useState<number>(1);
  const [buttonConfirmed, setButtonConfirmed] = useState(false);
  // P2-5 dead-button: physical seat capacity of the table (tournament_tables.max_seats),
  // the previous hand's posted-BB seat (in-memory, drives the BB-anchored suggestion),
  // and whether the operator has manually overridden the suggested button this hand.
  const [maxSeats, setMaxSeats] = useState<number>(9);
  const [lastBbSeat, setLastBbSeat] = useState<number | null>(null);
  const [buttonOverridden, setButtonOverridden] = useState(false);
  const [selectedWinners, setSelectedWinners] = useState<string[]>([]);
  const [muckedPlayerIds, setMuckedPlayerIds] = useState<Set<string>>(new Set());
  const [showdownLayers, setShowdownLayers] = useState<ShowdownLayerResult[]>([]);
  // P2-2: the operator has flipped hole cards for an all-in runout this hand.
  const [revealDone, setRevealDone] = useState(false);
  // UAT wave 2 (P1 undo rule): hole cards were actually BROADCAST (persisted) this
  // hand — an undo then preserves revealDone; a never-broadcast reveal/skip is
  // cleared when the restored snapshot is no longer a runout.
  const holeCardsBroadcastRef = useRef(false);
  const [blindLevelSnapshot, setBlindLevelSnapshot] = useState<BlindLevelSnapshot | null>(null);
  const [blindsConfirmedLocal, setBlindsConfirmedLocal] = useState(false);
  // P2-3: operator marks this hand as having a dead small blind (no SB posted).
  const [deadSb, setDeadSb] = useState(false);
  const [sbAmount, setSbAmount] = useState(0);
  const [bbAmount, setBbAmount] = useState(0);
  const [liveLevelNumber, setLiveLevelNumber] = useState<number | null>(null);
  // A1 (trackerBlindAutoSeed): the FULL live level from the 25s poll (amounts, not just
  // the number) so the stale-level banner can show next-hand SB/BB, + when the blind
  // snapshot was fetched (provenance shown in BlindSetupPanel). Both are inert extra
  // state unless the flag-gated UI consumes them.
  const [liveLevel, setLiveLevel] = useState<ClockLevel | null>(null);
  const [blindFetchedAt, setBlindFetchedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncPhase, setSyncPhase] = useState<SyncPhase>("idle");
  const [syncLabel, setSyncLabel] = useState<string | null>(null);
  const [handId, setHandId] = useState<string | null>(null);
  const [handStarted, setHandStarted] = useState(false);
  const [nextActionOrder, setNextActionOrder] = useState(1);
  const [lastHandId, setLastHandId] = useState<string | null>(null);
  const [endingStacks, setEndingStacks] = useState<Record<string, number>>({});
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [playerHoleCards, setPlayerHoleCards] = useState<Record<string, (Card | null)[]>>({});
  const [orphanHand, setOrphanHand] = useState<{ id: string; hand_number: number } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [selectedActorId, setSelectedActorId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<
    { players: PlayerState[]; actions: ActionRecord[]; currentStreet: Street; nextActionOrder: number }[]
  >([]);
  const [sentCommunityStreets, setSentCommunityStreets] = useState<Set<Street>>(new Set());
  const [persistedBoardCount, setPersistedBoardCount] = useState(0);
  // trackerSeatSetup: false once we learn tournament_seats.avatar_url is absent (migration
  // not applied) → the roster panel disables the avatar control ("chưa áp dụng") but keeps
  // name/chip. Stays true when the flag is off (irrelevant).
  const [avatarSupported, setAvatarSupported] = useState(true);
  // A5 resilience: the orphan hand id armed to auto-resume once its table's seats
  // have loaded (self-clears after firing once — see the effect near handleVoidOrphan).
  const [autoResumeArmed, setAutoResumeArmed] = useState<string | null>(null);
  // A3 preview: tournament-wide leaderboard snapshot fetched when Review is reached,
  // used ONLY to compute the "rank after this hand" strip (never persisted, never
  // blocks submit — best-effort decoration, see `rankShifts` below).
  const [leaderboardBefore, setLeaderboardBefore] = useState<{ player_id: string; chip_count: number }[] | null>(
    null
  );

  // ----- URL params -------------------------------------------------------
  // `table` is authoritative (drives the resume-on-return flow). hand/street/actor
  // are write-only mirrors. Distinct from the panel's `hiTable` so the two screens
  // never fight over the same query key.
  const [searchParams, setSearchParams] = useSearchParams();
  const spRef = useRef(searchParams);
  spRef.current = searchParams;
  const resumedTableRef = useRef<string | null>(null);

  const setTableParam = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(spRef.current);
      if (id) next.set("table", id);
      else next.delete("table");
      setSearchParams(next, { replace: true });
    },
    [setSearchParams]
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // ----- Load tables (read-only enrichment, no new RPC) -------------------
  useEffect(() => {
    if (!tournamentId) return;
    let cancelled = false;
    const loadTables = async () => {
      const { data } = await supabase.rpc("get_tournament_tables", { p_tournament_id: tournamentId });
      const base = (Array.isArray(data) ? data : []).map((t: any) => ({
        id: t.table_id,
        name: t.table_name || t.table_id.slice(0, 8),
      }));
      const [{ data: seatRows }, { data: liveHands }] = await Promise.all([
        supabase
          .from("tournament_seats")
          .select("table_id, player_id")
          .eq("tournament_id", tournamentId)
          .eq("is_active", true),
        supabase
          .from("tournament_hands")
          .select("table_id")
          .eq("tournament_id", tournamentId)
          .eq("status", "in_progress"),
      ]);
      if (cancelled) return;
      const countByTable = new Map<string, number>();
      (seatRows ?? []).forEach((s: any) => {
        if (s.player_id) countByTable.set(s.table_id, (countByTable.get(s.table_id) || 0) + 1);
      });
      const liveSet = new Set<string>((liveHands ?? []).map((h: any) => h.table_id));
      setAvailableTables(
        base.map((t) => ({
          ...t,
          playerCount: countByTable.get(t.id) || 0,
          hasLiveHand: liveSet.has(t.id),
        }))
      );
    };
    loadTables();
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  // ----- Heartbeat lock ---------------------------------------------------
  useEffect(() => {
    if (!handId || !handStarted || !user?.id) return;
    let failCount = 0;
    const MAX_FAILS = 2;
    const interval = setInterval(async () => {
      try {
        const { error } = await supabase.rpc("heartbeat_lock", { p_hand_id: handId, p_user_id: user.id });
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

  const markSync = useCallback((phase: SyncPhase, label?: string) => {
    setSyncPhase(phase);
    if (label !== undefined) setSyncLabel(label);
  }, []);

  const resetHand = useCallback(() => {
    setCurrentStreet("preflop");
    setActions([]);
    setCommunityCards([null, null, null, null, null]);
    setBetAmount("");
    setEndingStacks({});
    setPlayerHoleCards({});
    setNextActionOrder(1);
    setUndoStack([]);
    setSelectedActorId(null);
    setSelectedWinners([]);
    setMuckedPlayerIds(new Set());
    setShowdownLayers([]);
    setRevealDone(false);
    holeCardsBroadcastRef.current = false;
    setBlindLevelSnapshot(null);
    setBlindsConfirmedLocal(false);
    setDeadSb(false);
    setButtonOverridden(false); // P2-5: new hand → the dead-button suggestion drives the button again
    setSentCommunityStreets(new Set());
    setPersistedBoardCount(0);
    setSyncPhase("idle");
    setSyncLabel(null);
    if (tableId) {
      supabase
        .rpc("get_next_hand_number", { p_tournament_id: tournamentId, p_table_id: tableId })
        .then(({ data }) => {
          if (data) setHandNumber(data);
        });
    }
  }, [tableId, tournamentId]);

  // A3: apply the server-confirmed stack from ChipQuickEditPanel. It becomes the base
  // for the NEXT hand too (this only ever runs between hands), so both starting_stack
  // and current_stack move together — no optimistic write happens before this; the
  // panel calls it only after `update_seats` succeeds and it re-fetched the row.
  const handleChipQuickEdit = useCallback((playerId: string, newStack: number) => {
    setPlayers((prev) =>
      prev.map((p) => (p.player_id === playerId ? { ...p, current_stack: newStack, starting_stack: newStack } : p))
    );
  }, []);

  // trackerSeatSetup: the SINGLE roster write. One atomic SECURITY DEFINER RPC sets the
  // seat's name + chip (+ tournament_chip_counts, so start_hand seeds correctly) and,
  // when p_touch_avatar, the avatar — guarding tracker/floor/owner/super_admin itself.
  // No client dual-write. On success the server-confirmed row is merged into `players`
  // (id/entry_number authoritative for later edits + start_hand). Returns the RPC result.
  const handleSetRosterSeat = useCallback(
    async (args: {
      seatNumber: number;
      playerName: string;
      chipCount: number;
      existingPlayerId?: string | null;
      touchAvatar?: boolean;
      avatarUrl?: string | null;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (isReadOnly) {
        toast.error("Phiên làm việc đã hết hạn");
        return { ok: false };
      }
      if (!tableId) return { ok: false };
      const { data, error } = await supabase.rpc("set_tracker_table_roster_seat" as any, {
        p_tournament_id: tournamentId,
        p_table_id: tableId,
        p_seat_number: args.seatNumber,
        p_player_name: args.playerName,
        p_chip_count: args.chipCount,
        p_existing_player_id: args.existingPlayerId ?? null,
        p_touch_avatar: args.touchAvatar ?? false,
        p_avatar_url: args.avatarUrl ?? null,
        p_actor_user_id: user?.id ?? null,
      });
      if (error) {
        // 42883 = function not applied yet → degrade (two-tier gate).
        if ((error as any).code === "42883") {
          setAvatarSupported(false);
          toast.error("Tính năng setup bàn chưa được áp dụng trên máy chủ.");
          return { ok: false, error: "not_applied" };
        }
        toast.error(error.message || "Lỗi setup ghế");
        return { ok: false, error: error.message };
      }
      const res = data as { ok: boolean; error?: string; seat?: any } | null;
      if (!res?.ok) {
        const map: Record<string, string> = {
          actor_not_allowed: "Phiên đăng nhập không hợp lệ — hãy tải lại trang.",
          actor_not_authorized: "Bạn không có quyền setup bàn này (cần tracker/floor/owner của club).",
          hand_in_progress: "Đang có ván trên bàn — không sửa roster được.",
          table_mismatch: "Bàn không thuộc giải này.",
          seat_gone: "Ghế này vừa thay đổi — hãy tải lại bàn.",
          seat_conflict: "Ghế vừa có người khác ngồi — hãy tải lại bàn.",
          bad_avatar_url: "Ảnh avatar không hợp lệ.",
          bad_player_name: "Tên không hợp lệ (1–40 ký tự).",
          bad_chip_count: "Số chip không hợp lệ.",
          bad_seat_number: "Số ghế không hợp lệ.",
          tournament_not_found: "Không tìm thấy giải.",
        };
        toast.error(map[res?.error ?? ""] ?? res?.error ?? "Lỗi setup ghế");
        return { ok: false, error: res?.error };
      }
      const seat = res.seat;
      setPlayers((prev) => {
        const merged: PlayerState = {
          player_id: seat.player_id,
          entry_number: seat.entry_number,
          seat_number: seat.seat_number,
          display_name: seat.player_name || String(seat.player_id).slice(0, 6),
          starting_stack: seat.chip_count,
          current_stack: seat.chip_count,
          is_active: true,
          position: prev.find((p) => p.seat_number === seat.seat_number)?.position ?? "",
          current_bet: 0,
          total_bet: 0,
          is_folded: false,
          is_all_in: false,
          avatar_url: seat.avatar_url ?? null,
        };
        const exists = prev.some((p) => p.seat_number === seat.seat_number);
        const next = exists
          ? prev.map((p) => (p.seat_number === seat.seat_number ? merged : p))
          : [...prev, merged];
        return next.sort((a, b) => a.seat_number - b.seat_number);
      });
      return { ok: true };
    },
    [tournamentId, tableId, isReadOnly, user]
  );

  // B1 — mid-hand DISPLAY-ONLY edit (name + avatar). Separate narrow RPC that never
  // touches chips and has no hand_in_progress guard, so a typo can be fixed live
  // without VOIDing the hand. The state merge is deliberately PATCH-ONLY: it changes
  // ONLY display_name + avatar_url and must NEVER rebuild PlayerState the way
  // handleSetRosterSeat does — a full rebuild would reset current_stack/current_bet/
  // is_folded/total_bet mid-hand and corrupt the client's running pot math.
  const handleSetSeatDisplay = useCallback(
    async (args: {
      seatNumber: number;
      playerName: string;
      touchAvatar?: boolean;
      avatarUrl?: string | null;
    }): Promise<{ ok: boolean; error?: string }> => {
      if (isReadOnly) {
        toast.error("Phiên làm việc đã hết hạn");
        return { ok: false };
      }
      if (!tableId) return { ok: false };
      const { data, error } = await supabase.rpc("set_tracker_seat_display" as any, {
        p_tournament_id: tournamentId,
        p_table_id: tableId,
        p_seat_number: args.seatNumber,
        p_player_name: args.playerName,
        p_touch_avatar: args.touchAvatar ?? false,
        p_avatar_url: args.avatarUrl ?? null,
        p_actor_user_id: user?.id ?? null,
      });
      if (error) {
        // 42883 = RPC not applied yet → degrade (two-tier gate, mirrors seat setup).
        if ((error as any).code === "42883") {
          setAvatarSupported(false);
          toast.error("Tính năng sửa tên/ảnh giữa ván chưa được áp dụng trên máy chủ.");
          return { ok: false, error: "not_applied" };
        }
        toast.error(error.message || "Lỗi sửa tên/ảnh");
        return { ok: false, error: error.message };
      }
      const res = data as { ok: boolean; error?: string; seat?: any } | null;
      if (!res?.ok) {
        const map: Record<string, string> = {
          actor_not_allowed: "Phiên đăng nhập không hợp lệ — hãy tải lại trang.",
          actor_not_authorized: "Bạn không có quyền sửa bàn này (cần tracker/floor/owner của club).",
          seat_not_found: "Ghế không tồn tại — hãy tải lại bàn.",
          table_mismatch: "Bàn không thuộc giải này.",
          bad_avatar_url: "Ảnh avatar không hợp lệ.",
          bad_player_name: "Tên không hợp lệ (1–40 ký tự).",
          tournament_not_found: "Không tìm thấy giải.",
        };
        toast.error(map[res?.error ?? ""] ?? res?.error ?? "Lỗi sửa tên/ảnh");
        return { ok: false, error: res?.error };
      }
      const seat = res.seat;
      setPlayers((prev) =>
        prev.map((p) =>
          p.seat_number === seat.seat_number
            ? { ...p, display_name: seat.player_name || p.display_name, avatar_url: seat.avatar_url ?? p.avatar_url }
            : p
        )
      );
      return { ok: true };
    },
    [tournamentId, tableId, isReadOnly, user]
  );

  // ----- Table select -----------------------------------------------------
  const handleTableChange = useCallback(
    async (newTableId: string) => {
      setTableId(newTableId);
      setButtonConfirmed(false);
      // P2-5: a fresh table load resets the dead-button anchor → the first hand has no
      // suggestion (operator sets the button); subsequent hands auto-suggest.
      setLastBbSeat(null);
      setButtonOverridden(false);
      // A5: a stale orphan from the PREVIOUS table must never leak into this one —
      // re-armed below only if the NEW table actually has one in progress.
      setOrphanHand(null);
      setAutoResumeArmed(null);
      const tbl = availableTables.find((t) => t.id === newTableId);
      setTableName(tbl?.name || newTableId.slice(0, 8));
      if (!newTableId) {
        setPlayers([]);
        return;
      }

      // P2-5: physical seat capacity for the dead-button ring (read-only; default 9).
      supabase
        .from("tournament_tables")
        .select("max_seats")
        .eq("tournament_id", tournamentId)
        .eq("table_id", newTableId)
        .maybeSingle()
        .then(({ data }) => setMaxSeats((data as any)?.max_seats ?? 9));

      // trackerSeatSetup: pull the per-seat avatar_url under the flag. If the migration
      // isn't applied yet the column is missing → 42703 → mark unsupported + retry
      // without it (roster still loads; avatars fall back to profiles). Flag OFF → the
      // select is the current column list, byte-identical.
      const baseCols = "player_id, entry_number, seat_number, chip_count, player_name";
      const wantAvatar = FEATURES.trackerSeatSetup;
      let loadedSeats: any[] | null = null;
      let error: any = null;
      if (wantAvatar) {
        const r = await supabase
          .from("tournament_seats")
          .select(`${baseCols}, avatar_url`)
          .eq("tournament_id", tournamentId)
          .eq("table_id", newTableId)
          .eq("is_active", true)
          .order("seat_number");
        if (r.error && (r.error as any).code === "42703") {
          setAvatarSupported(false);
        } else {
          loadedSeats = r.data as any[] | null;
          error = r.error;
        }
      }
      if (loadedSeats === null && error === null) {
        const r = await supabase
          .from("tournament_seats")
          .select(baseCols)
          .eq("tournament_id", tournamentId)
          .eq("table_id", newTableId)
          .eq("is_active", true)
          .order("seat_number");
        loadedSeats = r.data as any[] | null;
        error = r.error;
      }

      if (error) {
        toast.error("Không thể tải danh sách người chơi");
        setPlayers([]);
        return;
      }
      if (!loadedSeats?.length) {
        setPlayers([]);
        return;
      }

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
      const seatPlayerIds = [...new Set(newPlayers.map((p) => p.player_id))];
      const avatarByUser = new Map<string, string | null>();
      if (seatPlayerIds.length) {
        const { data: seatProfiles } = await supabase
          .from("profiles")
          .select("user_id, avatar_url")
          .in("user_id", seatPlayerIds);
        (seatProfiles ?? []).forEach((p: any) => avatarByUser.set(p.user_id, p.avatar_url ?? null));
      }
      // Avatar priority: operator-set per-seat avatar wins over the player's profile pic;
      // a walk-in with no profile uses the seat avatar (or initials).
      setPlayers(
        newPlayers.map((p, i) => ({
          ...p,
          avatar_url: (loadedSeats![i] as any)?.avatar_url ?? avatarByUser.get(p.player_id) ?? null,
        }))
      );
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

      if (lastHand?.button_seat) setButtonSeat(nextButton(activeNums, lastHand.button_seat));
      else setButtonSeat(activeNums[0] ?? 1);

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
      if (orphan) {
        setOrphanHand(orphan);
        setAutoResumeArmed(orphan.id); // A5: fires once seats for THIS table have loaded
      }
    },
    [availableTables, tournamentId, resetHand]
  );

  const handlePickTable = useCallback(
    (id: string) => {
      setTableParam(id);
      void handleTableChange(id);
    },
    [setTableParam, handleTableChange]
  );

  const backToTableMap = useCallback(() => {
    setTableId("");
    setTableName("");
    setPlayers([]);
    setOrphanHand(null);
    resumedTableRef.current = null;
    setTableParam(null);
  }, [setTableParam]);

  // Resume the table from the URL once, when the list is ready and nothing selected.
  useEffect(() => {
    const tableFromUrl = searchParams.get("table");
    if (!tableFromUrl || tableId || availableTables.length === 0) return;
    if (resumedTableRef.current === tableFromUrl) return;
    resumedTableRef.current = tableFromUrl;
    if (!availableTables.some((t) => t.id === tableFromUrl)) {
      setTableParam(null);
      return;
    }
    void handleTableChange(tableFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTables, searchParams, tableId]);

  // ----- Derived ----------------------------------------------------------
  const potSize = useMemo(
    () =>
      actions.reduce((sum, a) => {
        if (["bet", "raise", "call", "all_in", "post_sb", "post_bb", "post_ante"].includes(a.action_type)) {
          return sum + a.amount;
        }
        return sum;
      }, 0),
    [actions]
  );

  const highestBet = useMemo(
    () => Math.max(0, ...players.filter((p) => !p.is_folded).map((p) => p.current_bet)),
    [players]
  );

  const potBreakdown = useMemo(
    () =>
      computePotBreakdown(
        players.map((p) => ({ player_id: p.player_id, total_bet: p.total_bet, is_folded: p.is_folded }))
      ),
    [players]
  );

  const playerName = useCallback(
    (id: string) => players.find((p) => p.player_id === id)?.display_name || id.slice(0, 6),
    [players]
  );

  const activePlayers = useMemo(() => players.filter((p) => !p.is_folded && !p.is_all_in), [players]);

  // trackerShowdownRevealOrder (operator hint): player_ids of the still-in players in
  // the order they'd table at showdown (last aggressor on the final street first, else
  // first-to-act from the SB, then clockwise). Purely informational — the showdown
  // panel lists players in this order with a ①②③ badge so the operator enters them in
  // the same sequence the viewer reveals. Flag OFF → undefined → panel unchanged.
  const showdownOrderIds = useMemo<string[] | undefined>(() => {
    if (!FEATURES.trackerShowdownRevealOrder) return undefined;
    const shown = players.filter((p) => !p.is_folded);
    if (shown.length <= 1) return undefined;
    const STREET_IDX: Record<string, number> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 4 };
    const AGGR = new Set(["bet", "raise", "all_in"]);
    const maxStreet = actions.reduce((m, a) => Math.max(m, STREET_IDX[a.street] ?? 0), 0);
    const shownSeats = new Set(shown.map((p) => p.seat_number));
    const lastAggr = [...actions]
      .filter((a) => (STREET_IDX[a.street] ?? 0) === maxStreet && AGGR.has(a.action_type))
      .sort((a, b) => a.action_order - b.action_order)
      .pop();
    const finalAggressorSeat = lastAggr && shownSeats.has(lastAggr.seat_number) ? lastAggr.seat_number : null;
    const seatToPid = new Map(shown.map((p) => [p.seat_number, p.player_id]));
    return showdownRevealOrder({ shownSeatNumbers: shown.map((p) => p.seat_number), buttonSeat, finalAggressorSeat })
      .map((sn) => seatToPid.get(sn))
      .filter((x): x is string => !!x);
  }, [players, actions, buttonSeat]);

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

  const bigBlind = useMemo(() => actions.find((a) => a.action_type === "post_bb")?.amount ?? 0, [actions]);

  const activeSeatNums = useMemo(() => players.map((p) => p.seat_number), [players]);
  // P2-5 dead-button SUGGESTION (BB-anchored on the PREVIOUS hand's BB). Pre-hand
  // default; stays active until the operator overrides the button by tapping a seat.
  const deadButtonSuggestion = useMemo(
    () => nextButtonTournament({ maxSeats, occupiedSeats: activeSeatNums, prevBbSeat: lastBbSeat }),
    [maxSeats, activeSeatNums, lastBbSeat]
  );
  const suggestionActive = !!deadButtonSuggestion && !buttonOverridden;
  const rawBlinds = useMemo(() => blindSeats(activeSeatNums, buttonSeat), [activeSeatNums, buttonSeat]);
  // 🔴 CARRY-FORWARD: when the suggestion is active the SB/BB shown to the operator
  // come from the dead-button suggestion (correct under empty seats), NOT blindSeats —
  // which would mislabel the SB when the button/SB sit on empty seats.
  const blindSbSeat = suggestionActive ? deadButtonSuggestion!.sbSeat : rawBlinds.sbSeat;
  const blindBbSeat = suggestionActive ? deadButtonSuggestion!.bbSeat : rawBlinds.bbSeat;
  // The suggestion auto-applies its dead SB; the operator can still toggle deadSb on.
  const effectiveDeadSb = (suggestionActive && deadButtonSuggestion!.deadSb) || deadSb;
  // The engine honors the dead-button BB only while the suggestion is active.
  const bbSeatOverride = suggestionActive ? deadButtonSuggestion!.bbSeat : undefined;
  const firstActorSeat = useMemo(() => {
    if (blindBbSeat == null) return firstPreflopActor(activeSeatNums, buttonSeat);
    const ring = [...activeSeatNums].sort((a, b) => a - b);
    return ring.find((s) => s > blindBbSeat) ?? ring[0] ?? null; // first live seat left of the (effective) BB
  }, [activeSeatNums, buttonSeat, blindBbSeat]);

  // P2-5: pre-fill the suggested button (incl. a dead/empty seat) pre-hand, until the
  // operator overrides by tapping a seat. Suggestion depends on prevBb/occupancy, not
  // buttonSeat → no loop.
  useEffect(() => {
    if (suggestionActive && !handStarted && deadButtonSuggestion) {
      setButtonSeat(deadButtonSuggestion.buttonSeat);
      setButtonConfirmed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionActive, handStarted, deadButtonSuggestion?.buttonSeat]);

  const engineState = useMemo<EngineState>(
    () => ({
      seats: players.map((p) => ({
        player_id: p.player_id,
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        stack: p.current_stack,
        street_committed: p.current_bet,
        total_committed: p.total_bet,
        folded: p.is_folded,
        all_in: p.is_all_in,
      })),
      buttonSeat,
      street: currentStreet,
      streetActions: actions
        .filter((a) => a.street === currentStreet)
        .map((a) => ({ player_id: a.player_id, seat_number: a.seat_number, action_type: a.action_type })),
      bigBlind,
      deadSb: effectiveDeadSb,
      bbSeatOverride,
      // UAT wave 2 (Fix 1): cover-call runout waiver — module const, no dep needed.
      // Flag OFF ⇒ field false ⇒ engine behavior byte-identical to today.
      coverCallWaiver: FEATURES.trackerCoverCallRunout,
    }),
    [players, buttonSeat, currentStreet, actions, bigBlind, effectiveDeadSb, bbSeatOverride]
  );
  const engineActor = useMemo(() => actorToAct(engineState), [engineState]);

  // ----- Blind-setup snapshot (Layer 1, read-only RPC, never persisted) ---
  useEffect(() => {
    if (!handStarted || blindLevelSnapshot != null) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
      if (cancelled) return;
      const snap = snapshotBlindLevel((data as any)?.current_level ?? null);
      setBlindLevelSnapshot(snap);
      setLiveLevelNumber(snap.level_number);
      setBlindFetchedAt(new Date());
      // A1 zero-guard (flag ON): a failed/empty clock (BB 0) must NOT auto-fill —
      // leave the inputs manual (the levelMissing warning shows) instead of seeding 0.
      // Flag OFF → today's exact behavior (set whatever the snapshot holds).
      if (!FEATURES.trackerBlindAutoSeed || snap.big_blind > 0) {
        setSbAmount(snap.small_blind);
        setBbAmount(snap.big_blind);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handStarted, blindLevelSnapshot, tournamentId]);

  useEffect(() => {
    if (!handStarted) return;
    const id = setInterval(async () => {
      const { data } = await supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId });
      const cl = ((data as any)?.current_level ?? null) as ClockLevel | null;
      setLiveLevelNumber(cl?.level_number ?? null);
      setLiveLevel(cl); // A1: keep the full level so the banner can show next-hand SB/BB
    }, 25000);
    return () => clearInterval(id);
  }, [handStarted, tournamentId]);


  const flowInput = useMemo(() => {
    const streetActions = actions.filter((a) => a.street === currentStreet);
    const acted = new Set(
      streetActions
        .filter((a) => !["post_sb", "post_bb", "post_ante"].includes(a.action_type))
        .map((a) => a.player_id)
    );
    const lastActorSeat = streetActions.length ? streetActions[streetActions.length - 1].seat_number : buttonSeat;
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

  const toActId = engineActor?.player_id ?? null;

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
  // P2-3: a dead-SB hand needs only the BB posted.
  const blindsConfirmed = blindsConfirmedLocal || (bbPosted && (deadSb || sbPosted));
  const isHeadsUp = players.length === 2;
  const blindLevelMissing = !blindLevelSnapshot || blindLevelSnapshot.level_number == null;
  const blindLevelChanged = hasLevelChangedDuringHand(blindLevelSnapshot, { level_number: liveLevelNumber });

  const isReview = Object.keys(endingStacks).length > 0;
  const isSummary = isReview;
  const conservationOk = useMemo(() => {
    const start = players.reduce((s, p) => s + p.starting_stack, 0);
    const end = players.reduce((s, p) => s + (endingStacks[p.player_id] ?? p.current_stack), 0);
    return start === end;
  }, [players, endingStacks]);
  const winnerDetermined = useMemo(
    () => players.some((p) => (endingStacks[p.player_id] ?? p.current_stack) > p.current_stack),
    [players, endingStacks]
  );
  const reviewValid = isReview && conservationOk && winnerDetermined;
  const allInRunout = isRunout(engineState.seats);
  const workflowState = deriveTrackerWorkflowState({
    handStarted,
    blindsConfirmed,
    currentStreet,
    persistedBoardCount,
    isReview,
    reviewValid,
    submitted: false,
    // P2-2 all-in runout reveal-first
    isRunout: allInRunout,
    bettingClosed: isRoundComplete(engineState),
    revealDone,
  });
  const showBlindSetup = workflowState === "setup_blinds" && players.length >= 2;
  const showBoardEntry = isBoardEntryState(workflowState);
  const boardEntryStreetNow = boardEntryStreet(workflowState);
  const showShowdownInput = workflowState === "showdown_input";
  const showRunoutReveal = workflowState === "runout_reveal";
  const showActionStep = isActionState(workflowState);

  const needsPostSB = engineActor?.needsPost === "post_sb";
  const needsPostBB = engineActor?.needsPost === "post_bb";

  // ----- Write-only URL mirror (hand/street/actor). Never read back. ------
  useEffect(() => {
    if (!handStarted) return;
    const next = new URLSearchParams(spRef.current);
    if (handNumber !== "") next.set("hand", String(Number(handNumber)));
    next.set("street", currentStreet);
    if (actorPlayer) next.set("actor", String(actorPlayer.seat_number));
    else next.delete("actor");
    const cur = spRef.current.toString();
    if (next.toString() !== cur) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handStarted, handNumber, currentStreet, actorPlayer?.seat_number]);

  // ----- Handlers ---------------------------------------------------------
  // A2 re-entry guard: `submitting` disables the button, but a fast double-tap can fire
  // twice before React flushes state — the ref blocks the second call synchronously so a
  // duplicate/orphan hand can never be started.
  const startingRef = useRef(false);
  const handleStartHand = async () => {
    if (startingRef.current) return;
    if (!tableId || !handNumber || !user?.id) return;
    if (!buttonConfirmed) {
      toast.error("Chọn ghế nút chia bài (BTN) trước khi bắt đầu hand");
      return;
    }
    // Guard: a seated player with 0 chips makes start_hand seed starting_stack = 0,
    // which breaks the server's blind/bet reconstruction (every Call shows "không có
    // cược để call"). Block start with a clear message instead of a broken hand.
    const noChips = players.filter((p) => p.is_active && p.current_stack <= 0);
    if (noChips.length > 0) {
      toast.error(
        `Chưa nạp chip cho ${noChips.length} ghế (${noChips
          .map((p) => `Ghế ${p.seat_number}`)
          .join(", ")}). Hãy nạp chip cho người chơi trước khi bắt đầu hand.`
      );
      return;
    }
    startingRef.current = true; // set AFTER every early-return guard (released in finally)
    setSubmitting(true);
    markSync("sending", `Bắt đầu Hand #${Number(handNumber)}`);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildStartHandBody({
          tournamentId,
          tableId,
          handNumber,
          handTime: new Date().toISOString(),
          buttonSeat,
        }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      const handData = data?.data || data;
      setHandId(handData?.hand_id);
      setHandStarted(true);
      setNextActionOrder(1);
      toast.success("Hand started");
      markSync("sent", `Hand #${Number(handNumber)} đã bắt đầu`);
    } catch (e: any) {
      toast.error(e.message || "Failed to start hand");
      markSync("error");
      if (orphanHand) setOrphanHand(null);
    } finally {
      startingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleContinueOrphan = async (opts?: { silent?: boolean }) => {
    if (!orphanHand) return;
    setSubmitting(true);
    try {
      const { data: hand, error: handErr } = await supabase
        .from("tournament_hands")
        .select("button_seat, community_cards")
        .eq("id", orphanHand.id)
        .single();
      if (handErr || !hand) throw new Error(handErr?.message || "Không tải được hand đang diễn ra");

      const { data: actionRows, error: actErr } = await supabase
        .from("hand_actions")
        .select("player_id, action_type, action_amount, action_order, street")
        .eq("hand_id", orphanHand.id)
        .order("action_order", { ascending: true });
      if (actErr) throw new Error(actErr.message);
      const rows = (actionRows ?? []) as ResumeActionRow[];

      const stored = Array.isArray(hand.community_cards) ? (hand.community_cards as unknown[]) : [];
      const communitySlots: (Card | null)[] = [0, 1, 2, 3, 4].map((i) => (stored[i] as Card) ?? null);
      const communityCount = stored.filter(Boolean).length;

      const rebuiltPlayers = replayActions(players, rows);
      const rebuiltActions: ActionRecord[] = rows.map((r) => {
        const pl = players.find((p) => p.player_id === r.player_id);
        return {
          street: (r.street ?? "preflop") as Street,
          player_id: r.player_id,
          display_name: pl?.display_name || r.player_id.slice(0, 6),
          seat_number: pl?.seat_number ?? 0,
          action_type: r.action_type,
          amount: r.action_amount ?? 0,
          action_order: r.action_order,
        };
      });

      const sent = new Set<Street>();
      if (communityCount >= 3) sent.add("flop");
      if (communityCount >= 4) sent.add("turn");
      if (communityCount >= 5) sent.add("river");

      setButtonSeat(hand.button_seat ?? buttonSeat);
      setCommunityCards(communitySlots);
      setPlayers(rebuiltPlayers);
      setActions(rebuiltActions);
      setCurrentStreet(deriveResumeStreet(rows, communityCount));
      setNextActionOrder(nextActionOrderFrom(rows));
      setSentCommunityStreets(sent);
      setPersistedBoardCount(communityCount);
      setUndoStack([]);
      setSelectedActorId(null);
      setHandId(orphanHand.id);
      setHandStarted(true);
      setOrphanHand(null);
      if (!opts?.silent) toast.success("Resuming hand #" + orphanHand.hand_number);
    } catch (e: any) {
      toast.error(e.message || "Không thể tiếp tục hand");
    } finally {
      setSubmitting(false);
    }
  };

  // A5 resilience: an orphan hand on this table resumes AUTOMATICALLY once its seats
  // are loaded — no manual "Tiếp tục" tap for the overwhelmingly common case. The
  // inline banner (console JSX) stays mounted as a fallback for the rare miss (e.g.
  // an empty table whose `players` never populates), and a toast confirms what
  // happened with a "Huỷ ván treo" secondary via a ref so it always calls the LATEST
  // handleVoid — never a stale closure captured back when this effect fired.
  useEffect(() => {
    if (!autoResumeArmed) return;
    if (!orphanHand || orphanHand.id !== autoResumeArmed) return;
    if (!players.length) return;
    const orphanNumber = orphanHand.hand_number;
    setAutoResumeArmed(null);
    void handleContinueOrphan({ silent: true }).then(() => {
      toast.success(`Đã tự động tiếp tục Hand #${orphanNumber}`, {
        duration: 8000,
        action: { label: "Huỷ ván treo", onClick: () => handleVoidRef.current() },
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResumeArmed, orphanHand, players]);

  const handleVoidOrphan = async () => {
    if (!orphanHand) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildVoidHandBody({ tournamentId, handId: orphanHand.id }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      toast.success("Orphan hand voided");
      setOrphanHand(null);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Returns whether the action was ACCEPTED (recorded locally + not rejected by the
  // server). Existing callers ignore the return; the A1 one-tap blind flow uses it so a
  // rejected SB stops the sequence instead of blindly posting the BB + confirming.
  const handleAction = async (
    playerId: string,
    actionType: string,
    amountOverride?: number,
    betToOverride?: number, // racetrack ActionDock forwards the "bet to" street TOTAL directly
  ): Promise<boolean> => {
    const player = players.find((p) => p.player_id === playerId);
    if (!player) return false;
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return false;
    }
    // Workflow v2 HARD-GATE: blind posts only during setup_blinds; betting actions
    // only during an action state. Never bypass the state machine.
    const isPost = actionType.startsWith("post_");
    if (isPost && workflowState !== "setup_blinds") {
      toast.error("Chưa tới bước đặt blind");
      return false;
    }
    if (!isPost && !isActionState(workflowState)) {
      toast.error("Chưa tới bước hành động của vòng này");
      return false;
    }

    // amountOverride is post-only (Guard 3): never reaches bet/raise sizing.
    const postOverride = actionType.startsWith("post_") ? amountOverride : undefined;

    let amount = 0;
    const newPlayers = [...players];
    const idx = newPlayers.findIndex((p) => p.player_id === playerId);

    switch (actionType) {
      case "fold":
        newPlayers[idx] = { ...newPlayers[idx], is_folded: true };
        break;
      case "check":
        break;
      case "call": {
        amount = Math.min(highestBet - player.current_bet, player.current_stack);
        if (amount >= player.current_stack) {
          newPlayers[idx] = {
            ...newPlayers[idx],
            current_stack: 0,
            current_bet: player.current_bet + amount,
            total_bet: player.total_bet + amount,
            is_all_in: true,
          };
        } else {
          newPlayers[idx] = {
            ...newPlayers[idx],
            current_stack: player.current_stack - amount,
            current_bet: player.current_bet + amount,
            total_bet: player.total_bet + amount,
          };
        }
        break;
      }
      case "bet":
      case "raise": {
        // Engine "Bet to" (street total) → chips ADDED; all-in only when it
        // consumes the whole stack. action_amount stays = chips added below.
        // The racetrack ActionDock forwards the total via betToOverride; the
        // LiveFelt console uses the betAmount keypad state (same value, same payload).
        const betTo = betToOverride ?? (parseInt(betAmount) || 0);
        const { added, allIn } = betToAdded(betTo, player.current_bet, player.current_stack);
        if (added <= 0) {
          toast.error("Mức cược phải lớn hơn cược hiện tại của ghế");
          return false;
        }
        amount = added;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: player.current_stack - added,
          current_bet: player.current_bet + added,
          total_bet: player.total_bet + added,
          is_all_in: allIn,
        };
        break;
      }
      case "all_in": {
        amount = player.current_stack;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: 0,
          current_bet: player.current_bet + amount,
          total_bet: player.total_bet + amount,
          is_all_in: true,
        };
        break;
      }
      case "post_sb": {
        amount = postOverride ?? (parseInt(betAmount) || 0);
        if (amount <= 0) {
          toast.error("Nhập SB");
          return false;
        }
        const actual = Math.min(amount, player.current_stack);
        const allIn = actual >= player.current_stack;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: player.current_stack - actual,
          current_bet: actual,
          total_bet: player.total_bet + actual,
          is_all_in: allIn,
        };
        amount = actual;
        break;
      }
      case "post_bb": {
        amount = postOverride ?? (parseInt(betAmount) || 0);
        if (amount <= 0) {
          toast.error("Nhập BB");
          return false;
        }
        const actual = Math.min(amount, player.current_stack);
        const allIn = actual >= player.current_stack;
        newPlayers[idx] = {
          ...newPlayers[idx],
          current_stack: player.current_stack - actual,
          current_bet: actual,
          total_bet: player.total_bet + actual,
          is_all_in: allIn,
        };
        amount = actual;
        break;
      }
    }

    const preSnapshot = { players, actions, currentStreet, nextActionOrder };
    setUndoStack((prev) => [...prev, preSnapshot]);

    const currentOrder = nextActionOrder;
    setNextActionOrder((prev) => prev + 1);
    setPlayers(newPlayers);
    setActions((prev) => [
      ...prev,
      {
        street: currentStreet,
        player_id: playerId,
        display_name: player.display_name,
        seat_number: player.seat_number,
        action_type: actionType,
        amount,
        action_order: currentOrder,
      },
    ]);
    setBetAmount("");

    if (handId) {
      markSync("sending", `S${player.seat_number} ${actionType}`);
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildRecordActionBody({
          tournamentId,
          handId,
          playerId,
          entryNumber: player.entry_number,
          street: currentStreet,
          actionType,
          actionAmount: amount,
          actionOrder: currentOrder,
        }),
      });
      let rejCode: string | undefined;
      let rejMsg: string | undefined;
      if (error) {
        try {
          const errBody = await (error as any)?.context?.json?.();
          rejCode = errBody?.code ?? errBody?.validation?.code;
          rejMsg = errBody?.error;
        } catch {
          /* body was not JSON */
        }
        if (!rejMsg) rejMsg = (error as any)?.message;
      } else if ((data as any)?.error) {
        rejCode = (data as any)?.code;
        rejMsg = (data as any)?.error;
      }

      if (isValidationCode(rejCode)) {
        setPlayers(preSnapshot.players);
        setActions(preSnapshot.actions);
        setCurrentStreet(preSnapshot.currentStreet);
        setNextActionOrder(preSnapshot.nextActionOrder);
        setUndoStack((prev) => prev.slice(0, -1));
        setBetAmount("");
        setSelectedActorId(null);
        toast.error(friendlyValidationError(rejCode, rejMsg), { description: `Mã lỗi: ${rejCode}` });
        markSync("error");
        return false;
      } else if (rejMsg) {
        toast.error(rejMsg);
        markSync("error");
        return false;
      } else {
        if ((data as any)?.validation?.code) {
          toast.warning(
            `Cảnh báo luật: ${friendlyValidationError((data as any).validation.code, (data as any).validation.message)}`
          );
        }
        markSync(
          "sent",
          `S${player.seat_number} ${formatActionLabel({
            street: currentStreet,
            player_id: playerId,
            display_name: player.display_name,
            seat_number: player.seat_number,
            action_type: actionType,
            amount,
            action_order: currentOrder,
          })}`
        );
      }
    }
    return true;
  };

  const handleDockAction = (type: string, betTo?: number) => {
    if (!effectiveActorId) {
      toast.error("Chạm một ghế để chọn người hành động");
      return;
    }
    if (type === "all_in") {
      const who = players.find((p) => p.player_id === effectiveActorId);
      const msg = `Xác nhận ALL-IN ${who ? formatStack(who.current_stack) : ""}${who ? ` của ${who.display_name}` : ""}? Toàn bộ stack sẽ vào pot.`;
      if (!confirm(msg)) return;
    }
    handleAction(effectiveActorId, type, undefined, betTo); // racetrack forwards the bet-to total
    setSelectedActorId(null);
  };

  const handlePostBlind = (type: "post_sb" | "post_bb", playerId: string, amount: number) => {
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return;
    }
    void handleAction(playerId, type, amount);
  };
  const handleConfirmBlinds = () => {
    if (!bbPosted || (!deadSb && !sbPosted)) {
      toast.error(
        deadSb ? "Hãy post Big Blind trước khi xác nhận" : "Hãy post Small Blind và Big Blind trước khi xác nhận"
      );
      return;
    }
    setBlindsConfirmedLocal(true);
  };
  // A1 (trackerBlindAutoSeed) one-tap blind posting: post SB (unless dead) + BB with the
  // CONFIRMED on-screen amounts, then confirm — 3 taps → 1. A confirm assist, never a
  // silent mutate: the operator sees (and can edit) the amounts before tapping, and the
  // zero-guard blocks posting a 0 blind.
  //
  // IMPORTANT: the two posts must NOT run as sequential awaits in one closure —
  // handleAction reads players/actions/nextActionOrder from ITS render's closure, so a
  // second call before a re-render would reuse the same action_order and overwrite the
  // SB's setPlayers update. Instead this is a tiny step machine: the tap posts the SB;
  // an effect posts the BB on the NEXT render (fresh closure); a second step confirms.
  // A rejected step stops the chain (an accepted SB stays — it WAS recorded).
  const [autoBlindStep, setAutoBlindStep] = useState<null | "bb" | "confirm">(null);
  const handlePostBothBlinds = async () => {
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return;
    }
    if (autoBlindStep !== null) return; // chain already running (double-tap guard)
    const sbPlayer = players.find((p) => p.seat_number === blindSbSeat);
    const bbPlayer = players.find((p) => p.seat_number === blindBbSeat);
    if (!bbPlayer || bbAmount <= 0 || (!effectiveDeadSb && (!sbPlayer || sbAmount <= 0))) {
      toast.error("Chưa đủ thông tin blind (ghế/số tiền) — kiểm tra lại SB/BB");
      return;
    }
    if (effectiveDeadSb || sbPosted || !sbPlayer) {
      setAutoBlindStep("bb"); // nothing to post for SB → go straight to the BB step
      return;
    }
    const ok = await handleAction(sbPlayer.player_id, "post_sb", sbAmount);
    if (ok) setAutoBlindStep("bb");
  };
  // Step "bb": runs on the render AFTER the SB post flushed → fresh closure.
  useEffect(() => {
    if (autoBlindStep !== "bb") return;
    if (bbPosted) {
      setAutoBlindStep("confirm");
      return;
    }
    const bbPlayer = players.find((p) => p.seat_number === blindBbSeat);
    if (!bbPlayer || bbAmount <= 0) {
      setAutoBlindStep(null);
      return;
    }
    let cancelled = false;
    void handleAction(bbPlayer.player_id, "post_bb", bbAmount).then((ok) => {
      if (!cancelled) setAutoBlindStep(ok ? "confirm" : null);
    });
    return () => {
      cancelled = true;
    };
    // players/blindBbSeat/bbAmount/bbPosted are read from THIS render's fresh closure;
    // the effect only fires on step changes by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBlindStep]);
  // Step "confirm": both blinds accepted → confirm (the derived sbPosted/bbPosted are
  // fresh here, but confirm directly — this step only runs after accepted posts).
  useEffect(() => {
    if (autoBlindStep !== "confirm") return;
    setBlindsConfirmedLocal(true);
    setAutoBlindStep(null);
  }, [autoBlindStep]);
  // P2-3: toggle "dead small blind" (no SB this hand). Clearing it after an SB was
  // already posted is harmless — sbPosted then drives the normal requirement again.
  const handleToggleDeadSb = () => setDeadSb((v) => !v);

  const handleSeatTap = (seat: RailSeat) => {
    if (!handStarted) {
      setButtonSeat(seat.seat_number);
      setButtonConfirmed(true);
      setButtonOverridden(true); // P2-5: manual button → drop the dead-button suggestion
      return;
    }
    if (isReadOnly) return;
    if (engineActor && seat.player_id !== engineActor.player_id) {
      toast.warning(`Ghế ${seat.seat_number} chưa tới lượt (đang chờ ghế ${engineActor.seat_number}) — vẫn chọn để chỉnh.`);
    }
    setSelectedActorId(seat.player_id);
  };

  // Felt tap → resolve the seat number to a player, then reuse the rail-tap logic.
  const handleSeatNumberTap = (seatNumber: number) => {
    if (!handStarted) {
      setButtonSeat(seatNumber);
      setButtonConfirmed(true);
      setButtonOverridden(true); // P2-5: manual button (incl. an empty seat → dead button)
      return;
    }
    if (isReadOnly) return;
    const p = players.find((x) => x.seat_number === seatNumber);
    if (!p) return;
    if (engineActor && p.player_id !== engineActor.player_id) {
      toast.warning(`Ghế ${seatNumber} chưa tới lượt (đang chờ ghế ${engineActor.seat_number}) — vẫn chọn để chỉnh.`);
    }
    setSelectedActorId(p.player_id);
  };

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
    // UAT wave 2 (P1 undo rule): restoring a snapshot that is NOT a runout anymore
    // (e.g. undoing the cover-call) invalidates a reveal/skip that was never
    // broadcast — clear revealDone so runout_reveal can fire again. Once hole cards
    // were actually broadcast (persisted server-side) revealDone is preserved.
    if (revealDone && !holeCardsBroadcastRef.current) {
      const live = snap.players.filter((p) => !p.is_folded);
      const elig = live.filter((p) => !p.is_all_in && p.current_stack > 0);
      if (!(live.length >= 2 && elig.length <= 1)) setRevealDone(false);
    }
  };

  const handleUndo = async () => {
    if (isReadOnly) {
      toast.error("Phiên làm việc đã hết hạn");
      return;
    }
    if (undoStack.length === 0) {
      toast.error("Không có hành động nào để hoàn tác");
      return;
    }
    if (!handId) {
      restoreLastSnapshot();
      return;
    }
    const { data, error } = await supabase.functions.invoke("tournament-live-update", {
      body: buildDeleteLastActionBody({ tournamentId, handId }),
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
    // Workflow v2 HARD-GATE: only in the matching enter_* state, count COMPLETE
    // (3/1/1), no duplicate, street must match.
    if (!isBoardEntryState(workflowState)) {
      toast.error("Chưa tới bước nhập bài board");
      return;
    }
    const need =
      currentStreet === "flop" || currentStreet === "turn" || currentStreet === "river"
        ? REQUIRED_BOARD_COUNT[currentStreet]
        : 0;
    if (cards.length < need) {
      toast.error(`Cần nhập đủ ${need} lá ${STREET_LABELS[currentStreet]}`);
      return;
    }
    if (new Set(cards).size !== cards.length) {
      toast.error("Có lá bài trùng nhau");
      return;
    }
    if (cards.length === 0) return;
    if (
      sentCommunityStreets.has(currentStreet) &&
      !confirm(`Bài ${STREET_LABELS[currentStreet]} đã được gửi. Ghi đè lại?`)
    )
      return;
    setSubmitting(true);
    markSync("sending", `Gửi ${STREET_LABELS[currentStreet]}`);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildUpdateCommunityCardsBody({ tournamentId, handId, communityCards: cards }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      setSentCommunityStreets((prev) => new Set(prev).add(currentStreet));
      setPersistedBoardCount(cards.length);
      toast.success(`Đã gửi ${STREET_LABELS[currentStreet]} lên viewer (${cards.length} lá)`);
      markSync("sent", `${STREET_LABELS[currentStreet]} (${cards.length} lá)`);
    } catch (e: any) {
      toast.error(`Lỗi gửi bài, thử lại: ${e.message}`);
      markSync("error");
    } finally {
      setSubmitting(false);
    }
  };

  // B2 — all-in runout ONE-SCREEN: persist EVERY remaining board street in one
  // operator gesture. Sends the SAME cumulative update_community_cards payload as
  // handleUpdateCommunityCards, but staged (flop → turn → river, ~0.9s apart) so the
  // /live viewer still gets a street-by-street reveal instead of all cards at once.
  // Only meaningful during a runout (betting closed); the per-street panel stays the
  // fallback. Advances currentStreet as it goes, then to "showdown" so the workflow
  // lands on showdown_input. Gated by the caller on FEATURES.trackerRunoutOneScreen.
  const RUNOUT_STAGE_MS = 900;
  const handleRunoutDealAll = async () => {
    if (!handId || isReadOnly) return;
    if (!isBoardEntryState(workflowState)) {
      toast.error("Chưa tới bước chia bài board");
      return;
    }
    // Every one of the 5 board slots must be filled before a one-shot runout.
    if (communityCards.some((c) => c === null)) {
      toast.error("Nhập đủ 5 lá bài chung trước khi chia hết");
      return;
    }
    const all = communityCards.filter((c): c is Card => c !== null);
    if (new Set(all).size !== all.length) {
      toast.error("Có lá bài trùng nhau");
      return;
    }
    // Stage only the street boundaries not already persisted (a runout can start on
    // the turn — flop already on the board — so [3,4,5] filtered by what's live).
    const stages: { count: number; street: Street }[] = [
      { count: 3, street: "flop" as Street },
      { count: 4, street: "turn" as Street },
      { count: 5, street: "river" as Street },
    ].filter((s) => s.count > persistedBoardCount);
    if (stages.length === 0) return;
    setSubmitting(true);
    try {
      for (let k = 0; k < stages.length; k++) {
        const { count, street } = stages[k];
        const slice = communityCards.slice(0, count).filter((c): c is Card => c !== null);
        markSync("sending", `Chia ${STREET_LABELS[street]}`);
        const { data, error } = await supabase.functions.invoke("tournament-live-update", {
          body: buildUpdateCommunityCardsBody({ tournamentId, handId, communityCards: slice }),
        });
        if (error || data?.error) throw new Error(await readEdgeError(error, data));
        setPersistedBoardCount(count);
        setSentCommunityStreets((prev) => new Set(prev).add(street));
        setCurrentStreet(street);
        setPlayers((prev) => prev.map((p) => ({ ...p, current_bet: 0 })));
        markSync("sent", `${STREET_LABELS[street]} (${count} lá)`);
        // Space the reveals so the viewer sees flop → turn → river, not all-at-once.
        if (k < stages.length - 1) await new Promise((r) => setTimeout(r, RUNOUT_STAGE_MS));
      }
      setCurrentStreet("showdown");
      toast.success("Đã chia hết bài — chuyển sang chấm kết quả");
    } catch (e: any) {
      toast.error(`Lỗi chia bài, thử lại: ${e.message}`);
      markSync("error");
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
    if (cardsPayload.length === 0) {
      toast.error("Chưa nhập bài lỗ cho ai");
      return;
    }
    setSubmitting(true);
    markSync("sending", "Lật bài");
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildShowHoleCardsBody({ tournamentId, handId, playerHoleCards: cardsPayload }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      holeCardsBroadcastRef.current = true; // persisted server-side → undo keeps revealDone
      toast.success("Hole cards revealed");
      markSync("sent", `Đã lật ${cardsPayload.length} tay bài`);
    } catch (e: any) {
      toast.error(e.message);
      markSync("error");
    } finally {
      setSubmitting(false);
    }
  };

  // P2-2: all-in runout reveal-first — broadcast the flipped hole cards to the
  // viewer (best-effort), then mark reveal done so the remaining board streets can
  // be entered. The physical flip has happened; the viewer broadcast is cosmetic,
  // so `revealDone` is set regardless of broadcast outcome. The final auto-settle
  // (settleShowdown) still enforces "all contenders revealed-or-mucked", so a
  // partial reveal here can never produce a phantom settlement.
  const handleRevealRunout = async () => {
    await handleShowHoleCards();
    setRevealDone(true);
  };

  // UAT wave 2 (Fix 1 escape): the operator has NO hole-card info (e.g. cards not
  // shown to the floor) — continue the runout WITHOUT broadcasting. Deliberately
  // does NOT call handleShowHoleCards (it errors on zero cards). The viewer keeps
  // face-down cards for this hand; settlement still requires revealed-or-mucked at
  // the Showdown step, so this can never produce a phantom settle.
  const handleSkipRevealRunout = () => {
    setRevealDone(true);
    toast.warning(
      "Tiếp tục không lật — bài sẽ không hiển thị trên viewer. Bạn vẫn phải chấm kết quả thủ công ở Showdown."
    );
  };

  const nextStreet = () => {
    const idx = STREET_ORDER.indexOf(currentStreet);
    if (idx < STREET_ORDER.length - 1) {
      setPlayers((prev) => prev.map((p) => ({ ...p, current_bet: 0 })));
      setCurrentStreet(STREET_ORDER[idx + 1]);
    }
  };

  const handleToggleWinner = (playerId: string) => {
    setSelectedWinners((prev) => (prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]));
  };
  const handleHoleCardChange = (playerId: string, ci: number, card: Card | null) => {
    setPlayerHoleCards((prev) => {
      const cur = prev[playerId] || [null, null];
      const upd = [...cur] as (Card | null)[];
      upd[ci] = card;
      return { ...prev, [playerId]: upd };
    });
  };
  // Guardrail 3 — muck = forfeit but the chips stay in the pot (dead money):
  // settleShowdown drops a mucked player from the rank but keeps their committed
  // chips as a pot contributor (they just can't win).
  const handleToggleMuck = (playerId: string) => {
    setMuckedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  // P2-1 auto-settle: rank revealed hands + pay each side-pot layer exactly.
  // settleShowdown returns null until every live contender has revealed or is mucked
  // → we tell the operator exactly what's missing instead of guessing (no phantom stacks).
  const handleAutoSettle = () => {
    const board = communityCards.filter((c): c is Card => c !== null);
    const settlement = settleShowdown(engineState.seats, playerHoleCards, board, muckedPlayerIds);
    if (!settlement) {
      toast.error("Chưa tự chấm được — cần đủ 5 lá board + 2 lá tẩy cho mỗi người còn bài (hoặc bấm Úp bài cho người không lật).");
      return;
    }
    const map: Record<string, number> = {};
    settlement.results.forEach((r) => {
      map[r.player_id] = r.ending_stack;
    });
    setShowdownLayers(settlement.layers);
    setEndingStacks(map);
    toast.success("Đã tự chấm bài + chia pot theo từng layer");
  };

  const handleConfirmShowdownResult = () => {
    if (selectedWinners.length === 0) {
      toast.error("Chọn người thắng trước");
      return;
    }
    // Guardrail 2 — a whole-pot manual split re-introduces the side-pot imprecision
    // auto-settle fixes; WARN (don't block) when side pots exist.
    if (potBreakdown.sidePots.length > 0) {
      toast.warning("Hand có side pot — chia nguyên pot thủ công có thể sai. Nên bấm 'Tự chấm bài', hoặc kiểm tra từng stack.");
    }
    const map: Record<string, number> = {};
    settleSelectedWinners(engineState.seats, selectedWinners).forEach((r) => {
      map[r.player_id] = r.ending_stack;
    });
    setShowdownLayers([]);
    setEndingStacks(map);
  };
  const handleEndingStackChange = (playerId: string, value: number) => {
    setEndingStacks((prev) => ({ ...prev, [playerId]: value }));
  };

  const handleSubmitHand = async () => {
    if (!tableId || !handNumber) return;
    // Workflow v2 HARD-GATE: only submit from submit_ready.
    if (workflowState !== "submit_ready") {
      toast.error("Chưa thể gửi hand — cần hoàn tất đúng quy trình trước.");
      return;
    }
    // 🔴 P1-2 HARD-BLOCK (re-verify at the edge): never persist a phantom or
    // non-conserving result. `submit_ready` already requires reviewValid
    // (conservationOk + a winner), but re-check here so an EMPTY result (auto-settle
    // returned null and the operator never entered manually) or any Σ-mismatch can
    // NEVER reach record_hand.
    if (Object.keys(endingStacks).length === 0) {
      toast.error("Chưa có kết quả ván — bấm 'Tự chấm bài' hoặc chọn người thắng trước khi lưu.");
      return;
    }
    if (!conservationOk) {
      toast.error("Tổng chip vào ≠ ra — không thể lưu. Kiểm tra lại stack kết thúc / người thắng.");
      return;
    }
    const stacksEdited = players.some(
      (p) => endingStacks[p.player_id] !== undefined && endingStacks[p.player_id] !== p.current_stack
    );
    if (stacksEdited && !confirm("Bạn đã chỉnh sửa stack kết thúc thủ công. Xác nhận lưu các số đã chỉnh?")) return;
    setSubmitting(true);
    markSync("sending", `Gửi Hand #${Number(handNumber)}`);
    try {
      const edgePlayers: EdgePlayer[] = players.map((p) => ({
        player_id: p.player_id,
        entry_number: p.entry_number,
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        current_stack: p.current_stack,
      }));
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildRecordHandBody({
          tournamentId,
          tableId,
          handNumber,
          handTime: new Date().toISOString(),
          communityCards: communityCards.filter((c): c is Card => c !== null),
          potSize,
          players: edgePlayers,
          endingStacks,
          playerHoleCards,
          sidePots: toSidePotsJson(potBreakdown),
          actions: actions.map((a) => ({
            player_id: a.player_id,
            action_type: a.action_type,
            amount: a.amount,
            action_order: a.action_order,
            street: a.street,
          })),
        }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
      toast.success("Hand recorded successfully");
      markSync("sent", `Hand #${Number(handNumber)} đã lưu`);
      setLastHandId(data?.data?.hand_id ?? null);
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
      // P2-5: anchor the next hand's dead-button suggestion on THIS hand's posted BB,
      // and clear the manual override so the suggestion drives the next button.
      setLastBbSeat(actions.find((a) => a.action_type === "post_bb")?.seat_number ?? null);
      setButtonOverridden(false);
      // P2-4: drop busted (now-inactive) players from the felt + show survivors'
      // new stacks immediately — no manual table reswitch. `endingStacks` is still
      // the operator-confirmed map here (resetHand clears it just below). Guard on a
      // successful re-query so a transient DB error never empties the felt.
      if (refreshedSeats) {
        setPlayers((prev) => survivorsAfterHand(prev, activeNums, endingStacks));
      }
      setHandId(null);
      setHandStarted(false);
      resetHand();
    } catch (e: any) {
      toast.error(e.message || "Failed to record hand");
      markSync("error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async () => {
    const voidId = handId || lastHandId;
    if (!voidId) {
      toast.error("No hand to void");
      return;
    }
    if (!confirm("CONFIRM VOID: Toàn bộ chip sẽ hoàn về trạng thái trước hand?")) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: buildVoidHandBody({ tournamentId, handId: voidId }),
      });
      if (error || data?.error) throw new Error(await readEdgeError(error, data));
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

  // A5: always call the LATEST handleVoid, never one captured by an effect/toast
  // closure from an earlier render (same stale-closure class as the A1 blind fix).
  const handleVoidRef = useRef(handleVoid);
  handleVoidRef.current = handleVoid;

  // A3: tournament-wide leaderboard snapshot, fetched once Review is reached — purely
  // to compute `rankShifts` below. Best-effort: a failed/slow fetch just means the
  // strip stays empty; it never blocks or affects conservationOk/canSubmit.
  useEffect(() => {
    if (!FEATURES.trackerChipQuickEdit || !isSummary || !tournamentId) {
      setLeaderboardBefore(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("get_tournament_leaderboard", { p_tournament_id: tournamentId })
      .then(({ data }) => {
        if (cancelled) return;
        const lb = (data as any)?.players;
        if (Array.isArray(lb)) {
          setLeaderboardBefore(lb.map((p: any) => ({ player_id: p.player_id, chip_count: p.chip_count })));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isSummary, tournamentId]);

  // A3: seats whose projected RANK (not just stack) changes once this hand's
  // endingStacks are applied — the "sau ván này" strip. Pure math lives in
  // rankShift.ts (unit-tested there); ranks come from the same leaderboard ordering
  // LeaderboardPanel uses (chip_count desc).
  const rankShifts = useMemo(() => {
    if (!leaderboardBefore || !isSummary) return [];
    return computeRankShifts(leaderboardBefore, players, endingStacks);
  }, [leaderboardBefore, players, endingStacks, isSummary]);

  // ----- Engine auto-advance (local state only; viewer driven by persisted path) --
  useEffect(() => {
    if (!handStarted || isSummary || isReadOnly) return;
    if (currentStreet === "showdown") return;
    const winner = foldWinner(engineState.seats);
    if (winner && actions.length > 0) {
      const map: Record<string, number> = {};
      settleFoldWin(engineState.seats).forEach((r) => {
        map[r.player_id] = r.ending_stack;
      });
      setEndingStacks(map);
      return;
    }
    const boardReady = currentStreet === "preflop" ? blindsConfirmed : sentCommunityStreets.has(currentStreet);
    const streetActed = actions.some(
      (a) => a.street === currentStreet && !["post_sb", "post_bb", "post_ante"].includes(a.action_type)
    );
    if (boardReady && isRoundComplete(engineState) && (streetActed || isRunout(engineState.seats))) {
      nextStreet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handStarted, isSummary, isReadOnly, currentStreet, players, actions, engineState, blindsConfirmed, sentCommunityStreets]);

  return {
    // identity / status
    tournamentId,
    tableId,
    tableName,
    handNumber,
    setHandNumber,
    availableTables,
    players,
    activePlayers,
    showdownOrderIds,
    submitting,
    isReadOnly,
    handStarted,
    orphanHand,
    lastHandId,
    // street / board / pot
    currentStreet,
    streetLabel: STREET_LABELS[currentStreet],
    actions,
    communityCards,
    setCommunityCards,
    usedCards,
    potSize,
    potBreakdown,
    bigBlind,
    positionsBySeat,
    // actor
    buttonSeat,
    buttonConfirmed,
    maxSeats,
    deadButtonSuggestion,
    engineActor,
    toActId,
    effectiveActorId,
    selectedActorId,
    actorPlayer,
    actorViewData,
    actorPos,
    betAmount,
    setBetAmount,
    needsPostSB,
    needsPostBB,
    // workflow
    workflowState,
    allInRunout,
    showBlindSetup,
    showBoardEntry,
    boardEntryStreetNow,
    showShowdownInput,
    showRunoutReveal,
    showActionStep,
    // sync
    syncPhase,
    syncLabel,
    // blind setup
    blindSbSeat,
    blindBbSeat,
    firstActorSeat,
    isHeadsUp,
    blindLevelSnapshot,
    blindLevelMissing,
    blindLevelChanged,
    sbAmount,
    setSbAmount,
    bbAmount,
    setBbAmount,
    liveLevelNumber,
    liveLevel,
    blindFetchedAt,
    handlePostBothBlinds,
    sbPosted,
    bbPosted,
    blindsConfirmed,
    deadSb: effectiveDeadSb,
    // showdown / review
    selectedWinners,
    muckedPlayerIds,
    showdownLayers,
    playerHoleCards,
    setPlayerHoleCards,
    isSummary,
    isReview,
    endingStacks,
    setEndingStacks,
    conservationOk,
    winnerDetermined,
    reviewValid,
    rankShifts,
    // undo
    canUndo: undoStack.length > 0,
    // helpers
    playerName,
    // handlers
    handlePickTable,
    backToTableMap,
    handleTableChange,
    handleStartHand,
    handleContinueOrphan,
    handleVoidOrphan,
    handleDockAction,
    handlePostBlind,
    handleConfirmBlinds,
    handleToggleDeadSb,
    handleSeatTap,
    handleSeatNumberTap,
    handleUndo,
    handleUpdateCommunityCards,
    handleRunoutDealAll,
    persistedBoardCount,
    handleShowHoleCards,
    handleRevealRunout,
    handleSkipRevealRunout,
    handleToggleWinner,
    handleToggleMuck,
    handleAutoSettle,
    handleHoleCardChange,
    handleConfirmShowdownResult,
    handleEndingStackChange,
    handleSubmitHand,
    handleVoid,
    handleChipQuickEdit,
    handleSetRosterSeat,
    handleSetSeatDisplay,
    avatarSupported,
    resetHand,
  };
}

export type StandaloneHandInput = ReturnType<typeof useStandaloneHandInput>;
