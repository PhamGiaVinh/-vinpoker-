import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { FEATURES } from "@/lib/featureFlags";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users, Coins, Clock, Layers, WifiOff, RefreshCw, AlertTriangle, Volume2, VolumeX, Bot, Radio, History } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { displayCard } from "@/components/shared/CardSlotPicker";
import { getSeatPositions } from "@/lib/tournament/button";
import { useAuth } from "@/hooks/useAuth";
import { TdAiAssistantPanel } from "@/components/td-ai/TdAiAssistantPanel";
import { TrackerVisualStyles } from "./PokerVisuals";
import { playPokerLiveSound, type PokerLiveSound } from "@/lib/pokerLiveSound";
import {
  computePotBreakdown,
  contributionsFromActions,
  type PotBreakdown,
} from "@/lib/tracker-poker/potEngine";
import { nextToAct } from "@/lib/tracker-poker/handFlow";
import {
  LiveFelt,
  formatStack,
  formatActionLabel,
  type SeatInfo,
  type ActionLog,
} from "./LiveFelt";
import { ReplayScrubber } from "./ReplayScrubber";
import { HandSelector } from "./HandSelector";
import { HandBreakdown } from "./viewer-hub/HandBreakdown";
import { ReplayLiveBanner } from "./ReplayLiveBanner";
import {
  detectBigBlind,
  type ReplayHand,
  type ReplayFrame,
} from "@/lib/tracker-poker/replayEngine";
import { deriveReplayPlaybackFx } from "@/lib/tracker-poker/replayFx";
import { useIsMobile } from "@/hooks/use-mobile";

const SOUND_KINDS = new Set<string>([
  "fold", "check", "call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante",
]);

// Actions that push chips into the pot — get a chip-clink layer + the chip-push
// animation (liveTableFx only). Excludes fold/check.
const CHIP_ACTIONS = new Set<string>(["call", "bet", "raise", "all_in", "post_sb", "post_bb", "post_ante"]);

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
// Live Action Engine MVP: faster refresh cadence while a hand is in progress
// (flag-gated). Slow enough to stay cheap, fast enough to feel live.
const LIVE_ACTION_POLL_MS = 2_500;

function formatClockTime(d: Date): string {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

export function TournamentLiveView({
  tournamentId,
  orientationOverride = null,
  spectator = false,
  selectedTableIdOverride = null,
  initialReplayHandNumber = null,
}: {
  tournamentId: string;
  /** Presentational only: force the felt orientation (set by the viewer hub's
      Ngang/Dọc toggle). null → auto by device (existing behaviour). Does NOT
      affect any data path; operator callers omit it and are unchanged. */
  orientationOverride?: "landscape" | "portrait" | null;
  /** Presentational only: public spectator view (set by the viewer hub). Hides
      operator-only chrome (realtime/debug banners, TD-AI, LIVE/Replay toggle,
      the right action-timeline + table-stats sidebar). Operator callers omit it
      → false → all chrome shown, unchanged. No data-path change. */
  spectator?: boolean;
  /** Presentational only: the table the viewer hub's table-map picked (public
      view). When set + valid it wins over the internal selector so the featured
      felt shows that table. Operator callers omit it → null → existing behaviour. */
  selectedTableIdOverride?: string | null;
  /** Deep-link from the spectator hand feed (?hand=N): open this hand in replay.
      ADDITIVE — omit/null keeps live mode (operator callers are unchanged). */
  initialReplayHandNumber?: number | null;
}) {
  const { t } = useTranslation();
  const { isStaffOps, isClubAdmin } = useAuth();
  const canTdAi = isStaffOps || isClubAdmin;
  const [tdAiOpen, setTdAiOpen] = useState(false);
  const isMobile = useIsMobile();
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
  // Live Action Engine MVP: true while the latest hand is in_progress (drives the
  // flag-gated fast-poll so spectators see each action live).
  const [handInProgress, setHandInProgress] = useState(false);
  // Live Action Engine inc2: the player whose turn it is to act (flag-gated
  // spotlight). null when the flag is off / no live hand.
  const [toActId, setToActId] = useState<string | null>(null);
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
  // ----- Replay mode (T2b) — frozen snapshot over the live machinery -----
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [replayHandId, setReplayHandId] = useState<string | null>(null);
  const [replayHand, setReplayHand] = useState<ReplayHand | null>(null);
  const [replayFrame, setReplayFrame] = useState<ReplayFrame | null>(null);
  // Snapshot of the LIVE table the moment replay was entered. The live machinery
  // keeps advancing in the background while the felt is frozen on the replay frame;
  // comparing against this baseline tells us when to surface "live đã có diễn biến
  // mới" so the spectator can jump back instead of silently falling behind.
  const [liveBaseline, setLiveBaseline] = useState<
    { handNumber: number | null; actionCount: number; boardCount: number } | null
  >(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const requestSeqRef = useRef(0);
  const initialLoadedRef = useRef(false);
  const pollingRef = useRef<number | null>(null);
  const zeroRefetchDoneRef = useRef(false);
  const prevActionCountRef = useRef<number | null>(null);
  const prevBoardCountRef = useRef<number | null>(null);
  // liveTableFx chip-push (viewer only): identity nonce so the first action of a
  // NEW hand still fires even though actions.length resets per hand (P2-2).
  const [chipPush, setChipPush] = useState<{ seatNumber: number; nonce: number; kind?: string } | null>(null);
  const lastChipNonceRef = useRef<number | null>(null);
  // liveTableFx replay playback FX: forward-only tracker (frame index + board count)
  // so PLAYING a hand back emits the same sounds + chip-push; scrubbing back is silent.
  const replayFxRef = useRef<{ index: number | null; board: number }>({ index: null, board: 0 });
  const replayChipSeqRef = useRef(0);

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
    let nextInProgress = false;
    let liveToActId: string | null = null;

    if (handsRes.data && handsRes.data.length > 0) {
      const hand = handsRes.data[0] as any;
      nextHandNumber = hand.hand_number;
      nextHandTableId = hand.table_id ?? null;
      nextButtonSeat = hand.button_seat || 1;
      nextCommunity = (hand.community_cards as string[]) || [];
      nextPot = hand.pot_size || 0;
      nextInProgress = hand.status === "in_progress";

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

        // Live Action Engine (flag-gated, inc2): per-street current bets + the
        // to-act player. Restricted to THIS hand's participants (hand_players) so
        // it never mixes tables; advisory display only — no card/server authority.
        if (FEATURES.liveActionEngine && nextInProgress) {
          const boardN = nextCommunity.length;
          const curStreet =
            boardN >= 5 ? "river" : boardN >= 4 ? "turn" : boardN >= 3 ? "flop" : "preflop";
          const CONTRIB = ["bet", "raise", "call", "all_in", "post_sb", "post_bb", "post_ante"];
          const POSTS = ["post_sb", "post_bb", "post_ante"];
          const streetBets: Record<string, number> = {};
          const acted = new Set<string>();
          let lastActorSeat = nextButtonSeat;
          let bbAmt = 0;
          actionData.forEach((a: any) => {
            if (a.action_type === "post_bb") bbAmt = Math.max(bbAmt, a.action_amount || 0);
            if ((a.street || "preflop") !== curStreet) return;
            if (CONTRIB.includes(a.action_type))
              streetBets[a.player_id] = (streetBets[a.player_id] || 0) + (a.action_amount || 0);
            if (!POSTS.includes(a.action_type)) acted.add(a.player_id);
            lastActorSeat = seatMap.get(a.player_id) ?? lastActorSeat;
          });
          seatInfos = seatInfos.map((s) => ({ ...s, current_bet: streetBets[s.player_id] || 0 }));
          const stackOf = new Map(seatInfos.map((s) => [s.player_id, s.chip_count]));
          const flowPlayers = (handPlayers || []).map((hp: any) => ({
            player_id: hp.player_id,
            seat_number: hp.seat_number,
            current_bet: streetBets[hp.player_id] || 0,
            current_stack: stackOf.get(hp.player_id) ?? 0,
            is_folded: foldedPlayers.has(hp.player_id),
            is_all_in: allInPlayers.has(hp.player_id),
          }));
          liveToActId = nextToAct({
            players: flowPlayers,
            buttonSeat: nextButtonSeat,
            actedThisStreet: acted,
            lastActorSeat,
            bigBlind: bbAmt,
          });
        }

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
    setHandInProgress(nextInProgress);
    setToActId(liveToActId);

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

  // Live Action Engine MVP (flag-gated, frontend-only): while a hand is in
  // progress, fast-poll so spectators see each recorded action in near-real-time
  // — `record_action` only writes `hand_actions`, which fires no
  // `tournament_hands` realtime event, so the default path refreshes only when
  // the hand is finalised. Reuses loadAllData (requestSeqRef guard intact).
  // Never runs in replay mode or when the flag is off → zero behaviour change.
  useEffect(() => {
    // VIEWER-ONLY: `spectator` gate keeps the operator's polling cadence unchanged even
    // with the flag ON. Visibility-aware: a backgrounded tab skips the tick, so it stops
    // hitting the DB every 2.5s while not being watched.
    if (!FEATURES.liveActionEngine || !spectator) return;
    if (!tournamentId || mode !== "live" || !handInProgress) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadAllData();
    }, LIVE_ACTION_POLL_MS);
    return () => window.clearInterval(id);
  }, [tournamentId, mode, handInProgress, loadAllData, spectator]);

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
    setHandInProgress(false);
    setToActId(null);
    setMode("live");
    setReplayHandId(null);
    setReplayHand(null);
    setReplayFrame(null);
    setLiveBaseline(null);
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

  // Action sounds + (liveTableFx) chip-push. Sounds fire on count increments after
  // first load (unchanged behavior); the chip-push is VISUAL so it is NOT gated by
  // mute and keys off an identity nonce so it survives the per-hand actions reset.
  useEffect(() => {
    const count = actions.length;
    const prev = prevActionCountRef.current;
    prevActionCountRef.current = count;
    const last = actions[count - 1];

    // Sound — unchanged detection (new action by count, respects mute).
    if (!soundMuted && prev !== null && count > prev && last && SOUND_KINDS.has(last.action_type)) {
      if (FEATURES.liveTableFx && last.action_type === "fold") {
        playPokerLiveSound("fold_muck"); // card-muck swoosh instead of the legacy beep
      } else {
        playPokerLiveSound(last.action_type as PokerLiveSound);
        if (FEATURES.liveTableFx && CHIP_ACTIONS.has(last.action_type)) {
          playPokerLiveSound("chip"); // crisp chip clink layered over the bet mp3
        }
      }
    }

    // Chip-push animation — visual (NOT gated by mute). Composite nonce
    // (handNumber*10000 + count) is unique across hands, so the FX layer's
    // "nonce changed" dedupe fires on the first action of a new hand too (P2-2).
    if (
      FEATURES.liveTableFx &&
      prev !== null &&
      last &&
      CHIP_ACTIONS.has(last.action_type) &&
      (last.seat_number ?? 0) > 0
    ) {
      const nonce = (handNumber ?? 0) * 10000 + count;
      if (lastChipNonceRef.current !== nonce) {
        lastChipNonceRef.current = nonce;
        // kind = the action_type → the viewer colors the flying chip by action (all_in=red, etc.).
        setChipPush({ seatNumber: last.seat_number, nonce, kind: last.action_type });
      }
    }
    // handNumber intentionally omitted from deps: it updates in the same render as
    // `actions`, so the effect's closure already has the fresh value on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, soundMuted]);

  useEffect(() => {
    const count = communityCards.length;
    const prev = prevBoardCountRef.current;
    prevBoardCountRef.current = count;
    if (soundMuted || prev === null || count <= prev) return;
    if (FEATURES.liveTableFx) {
      // flop riffles in (deal_flop = 3 bursts), turn/river = a single card.
      playPokerLiveSound(count >= 5 ? "deal_river" : count === 4 ? "deal_turn" : "deal_flop");
    } else {
      playPokerLiveSound("deal");
    }
  }, [communityCards, soundMuted]);

  // Reset sound baselines on tournament switch so the first load stays silent.
  useEffect(() => {
    prevActionCountRef.current = null;
    prevBoardCountRef.current = null;
    lastChipNonceRef.current = null;
  }, [tournamentId]);

  // liveTableFx replay-playback FX: as a completed hand is PLAYED back, emit the
  // same enriched sounds + chip-push the live feed would. Forward-only (the frame
  // index must increase) so scrubbing backward / jumping around stays silent. The
  // Replay "Phát" button is itself a user gesture, so audio is already unlocked.
  // Flag OFF → no-op (replay stays silent, exactly as today).
  useEffect(() => {
    if (mode !== "replay" || !FEATURES.liveTableFx || !replayFrame) {
      replayFxRef.current = { index: null, board: 0 };
      return;
    }
    const idx = replayFrame.index;
    const board = replayFrame.displayCards.filter(Boolean).length;
    const prev = replayFxRef.current;
    replayFxRef.current = { index: idx, board };

    const la = replayFrame.latestAction;
    const fx = deriveReplayPlaybackFx({
      prevIndex: prev.index,
      prevBoard: prev.board,
      index: idx,
      board,
      actionType: la?.action_type ?? null,
      seatNumber: la?.seat_number ?? 0,
    });

    if (!soundMuted) {
      if (fx.deal) playPokerLiveSound(fx.deal);
      if (fx.action) playPokerLiveSound(fx.action);
      if (fx.chipClink) playPokerLiveSound("chip");
    }
    // Chip-push is visual + viewer-only (spectator); a monotonic seq keeps the nonce
    // unique even when the same hand is replayed twice.
    if (fx.chipPush && spectator && la) {
      replayChipSeqRef.current += 1;
      setChipPush({ seatNumber: la.seat_number, nonce: 1_000_000 + replayChipSeqRef.current, kind: la.action_type });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayFrame, mode, soundMuted, spectator]);

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

  // Replay uses the historical hand's own big blind (the live clock may have moved on).
  const replayBigBlind = replayHand ? detectBigBlind(replayHand) : 0;
  const replayFormatBB = useCallback(
    (n: number) =>
      replayBigBlind > 0 ? `${(n / replayBigBlind).toFixed(1).replace(/\.0$/, "")} BB` : null,
    [replayBigBlind]
  );

  // The most recent actor gets the spotlight ring on the felt.
  const latestAction = actions.length > 0 ? actions[actions.length - 1] : null;
  const lastActorId = latestAction?.player_id ?? null;

  // Entering replay freezes the felt; snapshot the live table so we can detect when
  // it has moved on. Going live clears the baseline (and any "new activity" prompt).
  const enterReplay = useCallback(() => {
    setLiveBaseline({ handNumber, actionCount: actions.length, boardCount: communityCards.length });
    setMode("replay");
  }, [handNumber, actions, communityCards]);

  const goLive = useCallback(() => {
    setMode("live");
    setLiveBaseline(null);
  }, []);

  // Deep-link (?hand=N from the spectator hand feed): jump into replay on that hand.
  // The HandSelector below selects the matching hand via `initialHandNumber`.
  useEffect(() => {
    if (initialReplayHandNumber != null) enterReplay();
  }, [initialReplayHandNumber, enterReplay]);

  // ----- Multi-table resolution: never mix table_ids on one felt -----
  const tableIds = useMemo(
    () => [...new Set(seats.map((s) => s.table_id).filter((t): t is string => !!t))],
    [seats]
  );

  // Hub table-map pick (public) wins, then the operator's internal selection,
  // then the live hand's table, then the single table.
  const effectiveTableId = useMemo(() => {
    if (selectedTableIdOverride && tableIds.includes(selectedTableIdOverride)) return selectedTableIdOverride;
    if (selectedTableId && tableIds.includes(selectedTableId)) return selectedTableId;
    if (handTableId && tableIds.includes(handTableId)) return handTableId;
    if (tableIds.length === 1) return tableIds[0];
    return null;
  }, [selectedTableIdOverride, selectedTableId, handTableId, tableIds]);

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
    // Gap-robust labels: getSeatPositions orders the OCCUPIED seats clockwise
    // from the button, so non-contiguous seats (e.g. 1,3,5,7 after eliminations)
    // still get the correct BTN/SB/BB/UTG… Raw getPosition (seat−btn mod count)
    // mislabels once seats have gaps.
    const posBySeat = getSeatPositions(active.map((s) => s.seat_number), buttonSeat);
    return visibleSeats.map((s) => ({
      ...s,
      position: s.is_active ? posBySeat.get(s.seat_number) ?? "" : "",
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

  const isReplay = mode === "replay";
  // Has the live table advanced since the spectator entered replay? Same-hand new
  // actions get a count; a new hand (or board change) shows the generic prompt.
  const sameLiveHand = liveBaseline != null && handNumber === liveBaseline.handNumber;
  const newLiveActionCount = sameLiveHand
    ? Math.max(0, actions.length - liveBaseline.actionCount)
    : null;
  const hasNewLiveActivity =
    isReplay &&
    liveBaseline != null &&
    (handNumber !== liveBaseline.handNumber ||
      actions.length !== liveBaseline.actionCount ||
      communityCards.length !== liveBaseline.boardCount);
  // The live current hand belongs to one table; only show its breakdown when the
  // viewer is looking at that table (else the felt shows a different table).
  const liveHandOnView =
    handNumber != null && (handTableId == null || handTableId === effectiveTableId);
  // The felt renders either live state or the current replay frame — same props.
  const feltProps = isReplay
    ? replayFrame
      ? {
          seats: replayFrame.seats,
          lastActorId: replayFrame.lastActorId,
          toActId: null,
          displayCards: replayFrame.displayCards,
          potSize: replayFrame.potSize,
          potBreakdown: replayFrame.potBreakdown,
          multiTableUnresolved: false,
          handNumber: replayHand?.hand_number ?? null,
          latestAction: replayFrame.latestAction,
          formatBB: replayFormatBB,
          buttonSeat: replayHand?.button_seat ?? null,
        }
      : {
          seats: [] as SeatInfo[],
          lastActorId: null,
          toActId: null,
          displayCards: ["", "", "", "", ""],
          potSize: 0,
          potBreakdown: null,
          multiTableUnresolved: false,
          handNumber: null,
          latestAction: null as ActionLog | null,
          formatBB: replayFormatBB,
          buttonSeat: null,
        }
    : {
        seats: activeSeatsToRender,
        lastActorId,
        toActId: spectator && FEATURES.liveActionEngine ? toActId : null,
        displayCards,
        potSize,
        potBreakdown,
        multiTableUnresolved,
        handNumber,
        latestAction,
        formatBB,
        buttonSeat,
      };

  return (
    <div className="space-y-3">
      <TrackerVisualStyles />
      {canTdAi && !spectator && (
        <TdAiAssistantPanel open={tdAiOpen} onOpenChange={setTdAiOpen} tournamentId={tournamentId} />
      )}
      {!spectator && realtimeStatus === "offline" && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/15 border border-amber-500/30 rounded-lg text-xs text-amber-400">
          <WifiOff className="w-4 h-4 shrink-0" />
          <span>
            Realtime offline — dữ liệu có thể cũ. Tự động tải lại mỗi 30 giây.
            {lastUpdatedAt && <> Cập nhật cuối: {formatClockTime(lastUpdatedAt)}.</>}
          </span>
        </div>
      )}
      {!spectator && realtimeStatus === "connecting" && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
          <RefreshCw className="w-3 h-3 animate-spin" /> Đang kết nối realtime...
        </div>
      )}
      {!spectator && softErrorAt && (
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
          {canTdAi && !spectator && (
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

      {/* Operator-only inline table picker. Hidden for spectators — the viewer
          hub provides the table-map picker (which drives selectedTableIdOverride). */}
      {!spectator && tableIds.length > 1 && (
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

      {/* Live / Replay mode toggle — available to spectators too, so the public
          viewer can replay past hands (watch what happened). */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs font-bold">
          <button
            onClick={goLive}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
              !isReplay ? "bg-emerald-500/20 text-emerald-300" : "text-muted-foreground hover:text-emerald-300"
            }`}
          >
            <Radio className="w-3.5 h-3.5" /> LIVE
          </button>
          <button
            onClick={enterReplay}
            className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-border ${
              isReplay ? "bg-amber-500/20 text-amber-300" : "text-muted-foreground hover:text-amber-300"
            }`}
          >
            <History className="w-3.5 h-3.5" /> Phát lại
          </button>
        </div>
        {isReplay && (
          <HandSelector
            tournamentId={tournamentId}
            tableId={effectiveTableId}
            selectedHandId={replayHandId}
            initialHandNumber={initialReplayHandNumber}
            onSelectHand={(id, h) => {
              setReplayHandId(id);
              setReplayHand(h);
            }}
          />
        )}
      </div>

      {/* Replay-mode awareness: paused-updates notice, and a jump-back-to-live
          prompt when the live table has moved on while watching a past hand. */}
      {isReplay && (
        <ReplayLiveBanner
          hasNewActivity={hasNewLiveActivity}
          newActionCount={newLiveActionCount}
          onGoLive={goLive}
        />
      )}

      <div className={spectator ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3"}>
        <div>
          <LiveFelt
            {...feltProps}
            portrait={orientationOverride ? orientationOverride === "portrait" : !!isMobile}
            viewerNeon={spectator && FEATURES.liveHandFeed}
            viewerLayout={spectator && FEATURES.liveViewerFeltV2}
            tableFx={spectator && FEATURES.liveTableFx}
            chipPush={spectator && FEATURES.liveTableFx ? chipPush : null}
          />
          {isReplay && replayHand && (
            <ReplayScrubber hand={replayHand} onFrame={setReplayFrame} hud={spectator && FEATURES.liveReplayHud} />
          )}

          {/* Public spectator-only broadcast action breakdown. Spectator-gated →
              the operator render path emits nothing new. */}
          {spectator && isReplay && replayHand && (
            <HandBreakdown
              actions={replayHand.actions}
              players={replayHand.players}
              buttonSeat={replayHand.button_seat}
              bigBlind={replayBigBlind}
              highlightActionOrder={replayFrame?.latestAction?.action_order}
            />
          )}
          {spectator && !isReplay && liveHandOnView && actions.length > 0 && (
            <HandBreakdown
              actions={actions}
              players={activeSeatsToRender.map((s) => ({
                player_id: s.player_id,
                seat_number: s.seat_number,
                display_name: s.display_name,
                avatar_url: s.avatar_url,
              }))}
              buttonSeat={buttonSeat}
              bigBlind={bigBlind}
            />
          )}
        </div>

        {!spectator && (
        <div className="space-y-3">
          {!isReplay && (
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
          )}

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
        )}
      </div>
    </div>
  );
}
