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
import { TrackerVisualStyles } from "./PokerVisuals";
import { playPokerLiveSound, type PokerLiveSound } from "@/lib/pokerLiveSound";
import {
  computePotBreakdown,
  contributionsFromActions,
  type PotBreakdown,
} from "@/lib/tracker-poker/potEngine";
import {
  LiveFelt,
  formatStack,
  formatActionLabel,
  type SeatInfo,
  type ActionLog,
} from "./LiveFelt";

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

const POLL_INTERVAL_MS = 30_000;

function formatClockTime(d: Date): string {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
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
        <LiveFelt
          seats={activeSeatsToRender}
          lastActorId={lastActorId}
          displayCards={displayCards}
          potSize={potSize}
          potBreakdown={potBreakdown}
          multiTableUnresolved={multiTableUnresolved}
          handNumber={handNumber}
          latestAction={latestAction}
          formatBB={formatBB}
        />

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
