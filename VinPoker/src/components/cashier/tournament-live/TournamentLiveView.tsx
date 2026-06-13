import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, Coins, Clock, Layers, WifiOff, RefreshCw, AlertTriangle, Volume2, VolumeX, Bot } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { displayCard } from "@/components/shared/CardSlotPicker";
import { getPosition } from "@/lib/tournament/button";
import { useAuth } from "@/hooks/useAuth";
import { TdAiAssistantPanel } from "@/components/td-ai/TdAiAssistantPanel";
import { PokerCard, TrackerVisualStyles } from "./PokerVisuals";
import { playPokerLiveSound, type PokerLiveSound } from "@/lib/pokerLiveSound";
import {
  computePotBreakdown,
  contributionsFromActions,
  type PotBreakdown,
} from "@/lib/tracker-poker/potEngine";

interface SeatInfo {
  player_id: string;
  display_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  table_id: string | null;
  position: string;
  avatar_url?: string | null;
  last_action?: string;
  is_folded?: boolean;
  is_all_in?: boolean;
  hole_cards?: string[];
}

interface ActionLog {
  street: string;
  player_id: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  action_amount: number;
  action_order: number;
}

const SOUND_KINDS = new Set<string>([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);

const SOUND_MUTE_KEY = "tracker_sound_muted";

type RealtimeStatus = "connecting" | "online" | "offline";

const STREET_ORDER = ["preflop", "flop", "turn", "river"];
const STREET_LABELS: Record<string, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const SEAT_POSITIONS: Record<
  number,
  { top?: string; left?: string; right?: string; bottom?: string; transform?: string }
> = {
  1: { top: "2%", left: "50%", transform: "translateX(-50%)" },
  2: { top: "15%", right: "5%" },
  3: { top: "55%", right: "5%" },
  4: { bottom: "2%", left: "50%", transform: "translateX(-50%)" },
  5: { top: "55%", left: "5%" },
  6: { top: "15%", left: "5%" },
  7: { top: "35%", right: "3%" },
  8: { bottom: "15%", right: "15%" },
  9: { bottom: "15%", left: "15%" },
  10: { top: "35%", left: "3%" },
};

const POLL_INTERVAL_MS = 30_000;

function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function formatClockTime(d: Date): string {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

function formatActionLabel(a: ActionLog): string {
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

export function TournamentLiveView({ tournamentId }: { tournamentId: string }) {
  const { t } = useTranslation();
  const { isStaffOps, isClubAdmin } = useAuth();
  const canTdAi = isStaffOps || isClubAdmin;
  const [tdAiOpen, setTdAiOpen] = useState(false);
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [communityCards, setCommunityCards] = useState<string[]>([]);
  const [potSize, setPotSize] = useState(0);
  const [potBreakdown, setPotBreakdown] = useState<PotBreakdown | null>(null);
  const [handNumber, setHandNumber] = useState<number | null>(null);
  const [handTableId, setHandTableId] = useState<string | null>(null);
  const [buttonSeat, setButtonSeat] = useState(1);
  const [actions, setActions] = useState<ActionLog[]>([]);
  const [clockData, setClockData] = useState<{
    is_running: boolean;
    remaining_seconds: number;
    current_level: number | null;
    small_blind: number;
    big_blind: number;
    ante: number;
  } | null>(null);
  const [playersRemaining, setPlayersRemaining] = useState(0);
  const [averageStack, setAverageStack] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [softErrorAt, setSoftErrorAt] = useState<Date | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [localRemaining, setLocalRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [soundMuted, setSoundMuted] = useState(() => {
    try {
      return localStorage.getItem(SOUND_MUTE_KEY) === "1";
    } catch {
      return true;
    }
  });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const requestSeqRef = useRef(0);
  const initialLoadedRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const zeroRefetchDoneRef = useRef(false);
  const prevActionCountRef = useRef<number | null>(null);
  const prevBoardCountRef = useRef<number | null>(null);

  const loadAllData = useCallback(async () => {
    const seq = ++requestSeqRef.current;

    const [seatsRes, handsRes, clockRes, tournamentRes] = await Promise.all([
      supabase
        .from("tournament_seats")
        .select("player_id, seat_number, chip_count, is_active, player_name, table_id")
        .eq("tournament_id", tournamentId)
        .order("seat_number"),
      supabase
        .from("tournament_hands")
        .select("id, hand_number, community_cards, pot_size, is_voided, status, button_seat, table_id")
        .eq("tournament_id", tournamentId)
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId }),
      supabase.from("tournaments").select("players_remaining, average_stack").eq("id", tournamentId).single(),
    ]);

    if (seq !== requestSeqRef.current) return; // stale request after tournament switch

    // Two-tier error handling: clock RPC errors are non-fatal (clock may be unconfigured).
    const coreError = seatsRes.error || handsRes.error || tournamentRes.error;
    if (coreError) {
      if (!initialLoadedRef.current) {
        setFatalError(coreError.message);
        setLoading(false);
      } else {
        setSoftErrorAt(new Date());
      }
      return;
    }

    const seatRows = seatsRes.data ?? [];
    let seatInfos: SeatInfo[] = seatRows.map((s: any) => ({
      player_id: s.player_id,
      display_name: s.player_name || s.player_id.slice(0, 6),
      seat_number: s.seat_number,
      chip_count: s.chip_count,
      is_active: s.is_active,
      table_id: s.table_id ?? null,
      position: "",
    }));

    // Avatars for everyone seated (display_name keeps the operator-entered player_name).
    if (seatInfos.length > 0) {
      const seatPlayerIds = [...new Set(seatInfos.map((s) => s.player_id))];
      const { data: seatProfiles } = await supabase
        .from("profiles")
        .select("user_id, avatar_url")
        .in("user_id", seatPlayerIds);

      if (seq !== requestSeqRef.current) return;

      const avatarMap = new Map<string, string | null>();
      (seatProfiles || []).forEach((p: any) => avatarMap.set(p.user_id, p.avatar_url ?? null));
      seatInfos = seatInfos.map((s) => ({ ...s, avatar_url: avatarMap.get(s.player_id) ?? null }));
    }

    let nextHandNumber: number | null = null;
    let nextHandTableId: string | null = null;
    let nextButtonSeat = 1;
    let nextCommunity: string[] = [];
    let nextPot = 0;
    let nextActions: ActionLog[] = [];
    let nextBreakdown: PotBreakdown | null = null;

    if (handsRes.data && handsRes.data.length > 0) {
      const hand = handsRes.data[0] as any;
      nextHandNumber = hand.hand_number;
      nextHandTableId = hand.table_id ?? null;
      nextButtonSeat = hand.button_seat || 1;
      nextCommunity = (hand.community_cards as string[]) || [];
      nextPot = hand.pot_size || 0;

      const { data: actionData } = await supabase
        .from("hand_actions")
        .select("street, player_id, action_type, action_amount, action_order")
        .eq("hand_id", hand.id)
        .order("action_order");

      if (seq !== requestSeqRef.current) return;

      if (actionData && actionData.length > 0) {
        const actionPlayerIds = [...new Set(actionData.map((a: any) => a.player_id))];
        const [{ data: actionProfiles }, { data: handPlayers }] = await Promise.all([
          supabase.from("profiles").select("user_id, display_name").in("user_id", actionPlayerIds),
          supabase.from("hand_players").select("player_id, seat_number, hole_cards").eq("hand_id", hand.id),
        ]);

        if (seq !== requestSeqRef.current) return;

        const actionNameMap = new Map<string, string>();
        (actionProfiles || []).forEach((p: any) =>
          actionNameMap.set(p.user_id, p.display_name || "—")
        );

        const seatMap = new Map<string, number>();
        const holeCardsMap = new Map<string, string[]>();
        (handPlayers || []).forEach((hp: any) => {
          seatMap.set(hp.player_id, hp.seat_number);
          if (hp.hole_cards && hp.hole_cards.length > 0) {
            holeCardsMap.set(hp.player_id, hp.hole_cards);
          }
        });

        nextActions = actionData.map((a: any) => ({
          street: a.street || "preflop",
          player_id: a.player_id,
          display_name: actionNameMap.get(a.player_id) || a.player_id.slice(0, 6),
          seat_number: seatMap.get(a.player_id) || 0,
          action_type: a.action_type,
          action_amount: a.action_amount,
          action_order: a.action_order,
        }));

        const foldedPlayers = new Set<string>();
        const allInPlayers = new Set<string>();
        const lastActionMap = new Map<string, string>();
        actionData.forEach((a: any) => {
          if (a.action_type === "fold") foldedPlayers.add(a.player_id);
          if (a.action_type === "all_in") allInPlayers.add(a.player_id);
          lastActionMap.set(
            a.player_id,
            formatActionLabel({
              street: a.street,
              display_name: "",
              seat_number: 0,
              action_type: a.action_type,
              action_amount: a.action_amount,
              action_order: a.action_order,
            })
          );
        });

        seatInfos = seatInfos.map((s) => ({
          ...s,
          is_folded: foldedPlayers.has(s.player_id),
          is_all_in: allInPlayers.has(s.player_id),
          last_action: lastActionMap.get(s.player_id),
          hole_cards: holeCardsMap.get(s.player_id),
        }));

        nextBreakdown = computePotBreakdown(contributionsFromActions(actionData as any));
      }
    }

    setSeats(seatInfos);
    setHandNumber(nextHandNumber);
    setHandTableId(nextHandTableId);
    setButtonSeat(nextButtonSeat);
    setCommunityCards(nextCommunity);
    setPotSize(nextPot);
    setActions(nextActions);
    setPotBreakdown(nextBreakdown);

    if (clockRes.data && !clockRes.error) {
      const c = clockRes.data as any;
      setClockData({
        is_running: c.is_running || false,
        remaining_seconds: c.remaining_seconds || 0,
        current_level: c.current_level?.level_number || null,
        small_blind: c.current_level?.small_blind || 0,
        big_blind: c.current_level?.big_blind || 0,
        ante: c.current_level?.ante || 0,
      });
      setLocalRemaining(c.remaining_seconds || 0);
      setIsRunning(c.is_running || false);
      if ((c.remaining_seconds || 0) > 0) zeroRefetchDoneRef.current = false;
    }

    if (tournamentRes.data) {
      const tournament = tournamentRes.data as any;
      setPlayersRemaining(tournament.players_remaining || 0);
      setAverageStack(tournament.average_stack || 0);
    }

    initialLoadedRef.current = true;
    setFatalError(null);
    setSoftErrorAt(null);
    setLastUpdatedAt(new Date());
    setLoading(false);
  }, [tournamentId]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current != null) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current != null) return; // single interval, no leak
    pollingRef.current = window.setInterval(() => {
      loadAllData();
    }, POLL_INTERVAL_MS);
  }, [loadAllData]);

  // Reset all state when switching tournaments, then load.
  useEffect(() => {
    if (!tournamentId) return;
    requestSeqRef.current += 1;
    initialLoadedRef.current = false;
    zeroRefetchDoneRef.current = false;
    setSeats([]);
    setHandNumber(null);
    setHandTableId(null);
    setButtonSeat(1);
    setCommunityCards([]);
    setPotSize(0);
    setActions([]);
    setSelectedTableId(null);
    setTableNames({});
    setFatalError(null);
    setSoftErrorAt(null);
    setLastUpdatedAt(null);
    setLoading(true);
    loadAllData();
  }, [tournamentId, loadAllData]);

  useEffect(() => {
    if (!tournamentId) return;
    if (channelRef.current) {
      const prev = channelRef.current;
      channelRef.current = null;
      supabase.removeChannel(prev);
    }

    setRealtimeStatus("connecting");
    const channel = supabase.channel(`live-view:${tournamentId}`);
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_hands", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "hand_players", filter: `tournament_id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        () => loadAllData()
      )
      .subscribe((status) => {
        // Ignore status callbacks from a channel we already replaced/removed.
        if (channelRef.current !== channel) return;
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("online");
          stopPolling();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus("offline");
          startPolling();
        }
      });

    channelRef.current = channel;
    return () => {
      const ch = channelRef.current;
      channelRef.current = null;
      if (ch) supabase.removeChannel(ch);
      stopPolling();
    };
  }, [tournamentId, loadAllData, startPolling, stopPolling]);

  useEffect(() => {
    if (!isRunning || localRemaining <= 0) return;
    const interval = setInterval(() => {
      setLocalRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, localRemaining > 0]);

  // Debounced refetch when the level clock hits 0 — once per zero crossing.
  useEffect(() => {
    if (isRunning && localRemaining <= 0 && initialLoadedRef.current && !zeroRefetchDoneRef.current) {
      zeroRefetchDoneRef.current = true;
      loadAllData();
    }
  }, [isRunning, localRemaining, loadAllData]);

  // Action/deal sounds — only on increments after first load, never on tournament switch.
  useEffect(() => {
    const count = actions.length;
    const prev = prevActionCountRef.current;
    prevActionCountRef.current = count;
    if (soundMuted || prev === null || count <= prev) return;
    const last = actions[count - 1];
    if (last && SOUND_KINDS.has(last.action_type)) {
      playPokerLiveSound(last.action_type as PokerLiveSound);
    }
  }, [actions, soundMuted]);

  useEffect(() => {
    const count = communityCards.length;
    const prev = prevBoardCountRef.current;
    prevBoardCountRef.current = count;
    if (soundMuted || prev === null || count <= prev) return;
    playPokerLiveSound("deal");
  }, [communityCards, soundMuted]);

  // Reset sound baselines on tournament switch so the first load stays silent.
  useEffect(() => {
    prevActionCountRef.current = null;
    prevBoardCountRef.current = null;
  }, [tournamentId]);

  const toggleSoundMuted = useCallback(() => {
    setSoundMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(SOUND_MUTE_KEY, next ? "1" : "0");
      } catch {
        // localStorage may be unavailable (private mode) — toggle still works for the session.
      }
      return next;
    });
  }, []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const displayCards = useMemo(() => {
    const c = communityCards || [];
    return [...c, ...Array(Math.max(0, 5 - c.length)).fill("")];
  }, [communityCards]);

  // Street derived from board size; showdown once any hole cards are revealed.
  const currentStreet = useMemo(() => {
    if (!handNumber) return null;
    if (seats.some((s) => s.hole_cards && s.hole_cards.length > 0)) return "showdown";
    const n = communityCards.length;
    if (n >= 5) return "river";
    if (n === 4) return "turn";
    if (n >= 3) return "flop";
    return "preflop";
  }, [handNumber, seats, communityCards]);

  const bigBlind = clockData?.big_blind ?? 0;
  const formatBB = useCallback(
    (n: number) => (bigBlind > 0 ? `${(n / bigBlind).toFixed(1).replace(/\.0$/, "")} BB` : null),
    [bigBlind]
  );

  // The most recent actor gets the spotlight ring on the felt.
  const latestAction = actions.length > 0 ? actions[actions.length - 1] : null;
  const lastActorId = latestAction?.player_id ?? null;

  // ----- Multi-table resolution: never mix table_ids on one felt -----
  const tableIds = useMemo(
    () => [...new Set(seats.map((s) => s.table_id).filter((t): t is string => !!t))],
    [seats]
  );

  // Operator selection wins, then the live hand's table, then the single table.
  const effectiveTableId = useMemo(() => {
    if (selectedTableId && tableIds.includes(selectedTableId)) return selectedTableId;
    if (handTableId && tableIds.includes(handTableId)) return handTableId;
    if (tableIds.length === 1) return tableIds[0];
    return null;
  }, [selectedTableId, handTableId, tableIds]);

  const multiTableUnresolved = tableIds.length > 1 && !effectiveTableId;

  const visibleSeats = useMemo(() => {
    if (effectiveTableId) return seats.filter((s) => s.table_id === effectiveTableId);
    // No table_id info at all (legacy single-table data) → safe to show everything.
    if (tableIds.length <= 1) return seats;
    // Multiple tables, none resolved → render nothing rather than mixing tables.
    return [];
  }, [seats, effectiveTableId, tableIds]);

  // Positions are only meaningful when we're showing the table the current hand is on.
  const positionedSeats = useMemo(() => {
    const active = visibleSeats.filter((s) => s.is_active);
    const handMatchesView =
      handNumber != null && (handTableId == null || handTableId === effectiveTableId);
    if (!handMatchesView || active.length === 0) return visibleSeats;
    return visibleSeats.map((s) => ({
      ...s,
      position: s.is_active ? getPosition(s.seat_number, buttonSeat, active.length) : "",
    }));
  }, [visibleSeats, handNumber, handTableId, effectiveTableId, buttonSeat]);

  const activeSeatsToRender = useMemo(
    () => positionedSeats.filter((s) => s.is_active),
    [positionedSeats]
  );

  // Lazy table names for the selector — read-only RPC already used by other tracker panels.
  const tableIdsKey = tableIds.join(",");
  useEffect(() => {
    if (tableIds.length <= 1) return;
    let cancelled = false;
    supabase
      .rpc("get_tournament_tables", { p_tournament_id: tournamentId })
      .then(({ data }) => {
        if (cancelled || !data || !Array.isArray(data)) return;
        const m: Record<string, string> = {};
        data.forEach((t: any) => {
          if (t.table_id) m[t.table_id] = t.table_name || "";
        });
        setTableNames(m);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableIdsKey, tournamentId]);

  if (loading) {
    return (
      <Card className="p-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  if (fatalError) {
    return (
      <Card className="p-8 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
        <div className="font-semibold">Không tải được dữ liệu live tracker</div>
        <p className="text-xs text-muted-foreground break-all">{fatalError}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setFatalError(null);
            setLoading(true);
            loadAllData();
          }}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Thử lại
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <TrackerVisualStyles />
      {canTdAi && (
        <TdAiAssistantPanel open={tdAiOpen} onOpenChange={setTdAiOpen} tournamentId={tournamentId} />
      )}
      {realtimeStatus === "offline" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/15 border border-amber-500/30 rounded-lg text-xs text-amber-400">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            Realtime offline — dữ liệu có thể cũ. Tự động tải lại mỗi 30 giây.
            {lastUpdatedAt && <> Cập nhật cuối: {formatClockTime(lastUpdatedAt)}.</>}
          </span>
        </div>
      )}
      {realtimeStatus === "connecting" && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" /> Đang kết nối realtime...
        </div>
      )}
      {softErrorAt && (
        <div className="flex items-center gap-2 px-3 py-2 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            Không tải được dữ liệu mới nhất ({formatClockTime(softErrorAt)}) — đang hiển thị lần cập
            nhật cuối{lastUpdatedAt && <> lúc {formatClockTime(lastUpdatedAt)}</>}.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-gradient-to-r from-card to-card/80 border border-emerald-500/20 rounded-lg border-l-4 border-l-emerald-500 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-lg font-bold text-emerald-400 tracking-wide">
            {handNumber ? `Hand #${handNumber}` : "Waiting..."}
          </div>
          {currentStreet && (
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border ${
                currentStreet === "showdown"
                  ? "bg-red-500/15 text-red-400 border-red-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              {currentStreet}
            </span>
          )}
          {clockData && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-md text-sm font-mono font-bold border border-amber-500/20">
              <Clock className="w-4 h-4" />
              {formatTime(Math.max(0, localRemaining))}
            </span>
          )}
          {clockData?.current_level && (
            <span className="text-xs text-muted-foreground font-mono">
              Lv.{clockData.current_level} &middot; {formatStack(clockData.small_blind)}/
              {formatStack(clockData.big_blind)}
              {clockData.ante > 0 && (
                <span className="text-amber-400">
                  {" "}
                  &middot; A {formatStack(clockData.ante)}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {canTdAi && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-emerald-500/40 text-emerald-300 hover:text-emerald-200"
              onClick={() => setTdAiOpen(true)}
            >
              <Bot className="w-3.5 h-3.5 mr-1" /> {t("tdAi.entry")}
            </Button>
          )}
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> {playersRemaining} {t("tournamentLive.liveView.players")}
          </span>
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> AVG: {formatStack(averageStack)}
          </span>
          <span className="flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-emerald-400" /> Pot:{" "}
            <strong className="text-emerald-400 text-sm">{formatStack(potSize)}</strong>
            {potSize > 0 && formatBB(potSize) && (
              <span className="text-[10px] text-muted-foreground">({formatBB(potSize)})</span>
            )}
          </span>
          {lastUpdatedAt && (
            <span className="text-[10px] text-muted-foreground/70" title="Lần cập nhật dữ liệu thành công gần nhất">
              ↻ {formatClockTime(lastUpdatedAt)}
            </span>
          )}
          <button
            onClick={toggleSoundMuted}
            title={soundMuted ? "Bật âm thanh hành động" : "Tắt âm thanh hành động"}
            className={`p-1.5 rounded-md border transition-colors ${
              soundMuted
                ? "text-muted-foreground border-border hover:border-amber-500/40"
                : "text-amber-400 border-amber-500/40 bg-amber-500/10"
            }`}
          >
            {soundMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {tableIds.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-card border border-emerald-500/20 rounded-lg text-xs">
          <span className="text-muted-foreground">
            Giải có nhiều bàn — chọn bàn để xem live:
          </span>
          {tableIds.map((tid) => (
            <button
              key={tid}
              onClick={() => setSelectedTableId(tid)}
              className={`px-2.5 py-1 rounded-md border font-semibold transition-colors ${
                effectiveTableId === tid
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : "bg-transparent text-muted-foreground border-border hover:border-emerald-500/40"
              }`}
            >
              {tableNames[tid] || tid.slice(0, 6)}
              {handTableId === tid && <span className="ml-1 text-[9px] text-amber-400">● hand</span>}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
        <div
          className="relative bg-gradient-to-b from-[#16090d] to-[#0c0d10] rounded-2xl border border-amber-700/30 shadow-inner overflow-hidden"
          style={{ minHeight: "480px" }}
        >
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 800 600"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <radialGradient id="feltGrad" cx="50%" cy="42%">
                <stop offset="0%" style={{ stopColor: "#581723", stopOpacity: "0.96" }} />
                <stop offset="62%" style={{ stopColor: "#2b0b13", stopOpacity: "0.98" }} />
                <stop offset="100%" style={{ stopColor: "#1a070c", stopOpacity: "0.98" }} />
              </radialGradient>
            </defs>
            <ellipse cx="400" cy="300" rx="340" ry="240" fill="url(#feltGrad)" />
            <ellipse
              cx="400"
              cy="300"
              rx="338"
              ry="238"
              fill="none"
              stroke="rgba(245,179,64,0.4)"
              strokeWidth="4"
            />
            <ellipse
              cx="400"
              cy="300"
              rx="316"
              ry="216"
              fill="none"
              stroke="rgba(245,179,64,0.14)"
              strokeWidth="1.5"
            />
          </svg>

          {activeSeatsToRender.map((seat) => {
            // Anchor by physical seat number so players never shift when others bust.
            const posKey = ((seat.seat_number - 1) % 10) + 1;
            const pos = SEAT_POSITIONS[posKey] || SEAT_POSITIONS[1];
            const posStyle: React.CSSProperties = {};
            if (pos.top) posStyle.top = pos.top;
            if (pos.bottom) posStyle.bottom = pos.bottom;
            if (pos.left) posStyle.left = pos.left;
            if (pos.right) posStyle.right = pos.right;
            if (pos.transform) posStyle.transform = pos.transform;

            const isLastActor = !seat.is_folded && lastActorId === seat.player_id;
            const seatBB = !seat.is_folded ? formatBB(seat.chip_count) : null;

            return (
              <div key={seat.player_id} className="absolute z-10" style={posStyle}>
                <div
                  className={`bg-gradient-to-br from-[#241015]/80 to-slate-900/70 backdrop-blur-sm border rounded-xl p-1.5 w-24 sm:p-2.5 sm:w-32 md:w-36 text-center transition-all duration-300 ${
                    seat.is_folded
                      ? "border-border/20 opacity-50 grayscale-[0.5]"
                      : seat.is_all_in
                        ? "border-red-500/40 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                        : isLastActor
                          ? "border-amber-400/80 shadow-[0_0_14px_rgba(245,179,64,0.35)]"
                          : "border-emerald-500/40 hover:border-emerald-400/60"
                  }`}
                >
                  <div className="flex justify-center mb-1">
                    {seat.avatar_url ? (
                      <img
                        src={seat.avatar_url}
                        alt=""
                        loading="lazy"
                        className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover border ${
                          isLastActor ? "border-amber-400/80" : "border-emerald-500/40"
                        }`}
                      />
                    ) : (
                      <div
                        className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-[10px] sm:text-xs font-bold bg-emerald-900/60 border ${
                          isLastActor ? "border-amber-400/80 text-amber-300" : "border-emerald-500/40 text-emerald-300"
                        }`}
                      >
                        {seat.display_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-emerald-400 font-semibold text-xs truncate max-w-[52px] sm:max-w-[80px]">
                      {seat.display_name}
                    </span>
                    {seat.position && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                          seat.position === "BTN"
                            ? "bg-amber-500 text-black"
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}
                      >
                        {seat.position}
                      </span>
                    )}
                  </div>
                  <div className="text-white font-bold text-xs sm:text-sm font-mono">
                    {formatStack(seat.chip_count)}
                    {seatBB && (
                      <span className="block text-[9px] font-normal text-muted-foreground">
                        {seatBB}
                      </span>
                    )}
                  </div>
                  {seat.is_all_in && (
                    <div className="text-[10px] text-red-400 font-bold mt-1">ALL IN</div>
                  )}
                  {seat.is_folded && (
                    <div className="text-[10px] text-muted-foreground mt-1">FOLDED</div>
                  )}
                  {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                    <div className="text-[10px] text-amber-300 mt-1 truncate">
                      {seat.last_action}
                    </div>
                  )}
                  {seat.hole_cards && seat.hole_cards.length > 0 && (
                    <div className="flex gap-0.5 justify-center mt-1">
                      {seat.hole_cards.map((card: string, ci: number) => (
                        <PokerCard key={ci} card={card} size="xs" muted={seat.is_folded} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div
            className="absolute left-1/2 -translate-x-1/2 flex gap-1.5 sm:gap-2 z-20"
            style={{ bottom: "25%" }}
          >
            {displayCards.map((card, i) => (
              <PokerCard
                key={`${i}-${card || "empty"}`}
                card={card || null}
                size="md"
                className="w-12 h-[68px] sm:w-14 sm:h-20"
              />
            ))}
          </div>

          {potSize > 0 && (
            <div
              className="absolute left-1/2 -translate-x-1/2 text-center z-20"
              style={{ bottom: "10%" }}
            >
              <div className="tracker-pot-pulse inline-flex flex-col items-center px-4 py-1.5 rounded-full bg-black/45 border border-amber-400/40">
                <div className="text-[9px] text-amber-200/70 uppercase tracking-widest">Pot</div>
                <div className="text-amber-300 text-xl sm:text-2xl font-bold font-mono leading-tight">
                  {formatStack(potSize)}
                  {formatBB(potSize) && (
                    <span className="ml-1.5 text-[10px] font-normal text-amber-200/60">
                      ({formatBB(potSize)})
                    </span>
                  )}
                </div>
              </div>
              {potBreakdown && potBreakdown.sidePots.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-center gap-1">
                  {potBreakdown.pots.map((pot, i) => (
                    <span
                      key={i}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-black/45 border ${
                        i === 0
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-amber-400/40 text-amber-300"
                      }`}
                    >
                      {i === 0 ? "Main" : `Side ${i}`} {formatStack(pot.amount)}
                      <span className="ml-1 font-normal opacity-60">
                        ({pot.eligible_player_ids.length})
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {multiTableUnresolved && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <div className="text-muted-foreground text-sm bg-black/40 px-6 py-3 rounded-lg backdrop-blur-sm text-center">
                Giải có nhiều bàn — chọn bàn ở trên để xem live.
              </div>
            </div>
          )}

          {!multiTableUnresolved && !handNumber && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <div className="text-muted-foreground text-sm bg-black/40 px-6 py-3 rounded-lg backdrop-blur-sm">
                Chờ dealer bắt đầu hand...
              </div>
            </div>
          )}

          {latestAction && (
            <div className="absolute bottom-0 inset-x-0 z-20 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-sm border-t border-amber-500/20 text-xs">
              <span className="text-[9px] font-bold text-amber-400/80 uppercase tracking-widest shrink-0">
                Hành động
              </span>
              <span className="truncate text-amber-100">
                {latestAction.seat_number > 0 && (
                  <span className="text-amber-300/70">Ghế {latestAction.seat_number} · </span>
                )}
                <span className="font-semibold text-emerald-300">{latestAction.display_name}</span>{" "}
                {formatActionLabel(latestAction)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="bg-card border border-emerald-500/20 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2 pb-2 border-b border-emerald-500/10">
              {t("tournamentLive.liveView.actionTimeline")}
            </div>
            <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
              {actions.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4 italic">
                  {t("tournamentLive.liveView.noActions")}
                </div>
              )}
              {STREET_ORDER.filter((s) => actions.some((a) => a.street === s)).map((street) => (
                <div key={street} className="mb-2">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">
                    {STREET_LABELS[street]}
                    {street === "flop" &&
                      displayCards[0] && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({displayCards
                            .slice(0, 3)
                            .filter(Boolean)
                            .map(displayCard)
                            .join(" ")})
                        </span>
                      )}
                    {street === "turn" &&
                      displayCards[3] && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({displayCard(displayCards[3])})
                        </span>
                      )}
                    {street === "river" &&
                      displayCards[4] && (
                        <span className="text-muted-foreground font-normal ml-1">
                          ({displayCard(displayCards[4])})
                        </span>
                      )}
                  </div>
                  {actions
                    .filter((a) => a.street === street)
                    .map((action, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between py-1 px-1.5 border-b border-border/10 last:border-0 text-xs"
                      >
                        <span className="text-muted-foreground">
                          <span className="text-emerald-400 font-semibold">
                            {action.display_name}
                          </span>
                        </span>
                        <span
                          className={`font-semibold ${action.action_amount > 0 ? "text-amber-400" : "text-muted-foreground"}`}
                        >
                          {formatActionLabel(action)}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-emerald-500/20 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2 pb-2 border-b border-emerald-500/10">
              {t("tournamentLive.liveView.tableStats")}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{t("tournamentLive.liveView.playersRemaining")}</span>
                <span className="text-emerald-400 font-semibold">{playersRemaining}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t("tournamentLive.liveView.averageStack")}</span>
                <span className="text-emerald-400 font-semibold">
                  {formatStack(averageStack)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t("tournamentLive.liveView.currentPot")}</span>
                <span className="text-emerald-400 font-semibold">{formatStack(potSize)}</span>
              </div>
              {clockData && (
                <>
                  <div className="flex justify-between text-muted-foreground pt-1.5 border-t border-border/20">
                    <span>{t("tournamentLive.liveView.level")}</span>
                    <span className="text-emerald-400 font-semibold">
                      {clockData.current_level || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{t("tournamentLive.liveView.blinds")}</span>
                    <span className="text-amber-400 font-semibold">
                      {formatStack(clockData.small_blind)}/{formatStack(clockData.big_blind)}
                    </span>
                  </div>
                  {clockData.ante > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{t("tournamentLive.liveView.ante")}</span>
                      <span className="text-amber-400 font-semibold">
                        {formatStack(clockData.ante)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
