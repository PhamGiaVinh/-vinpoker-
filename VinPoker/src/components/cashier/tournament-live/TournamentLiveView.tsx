import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Coins, Clock, Layers } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { isRedCard, displayCard } from "@/components/shared/CardSlotPicker";

interface SeatInfo {
  player_id: string;
  display_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
  position: string;
  last_action?: string;
  is_folded?: boolean;
  is_all_in?: boolean;
  hole_cards?: string[];
}

interface ActionLog {
  street: string;
  display_name: string;
  seat_number: number;
  action_type: string;
  action_amount: number;
  action_order: number;
}

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

function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

function suitSymbol(s: string): string {
  if (s === "s" || s === "\u2660") return "\u2660";
  if (s === "h" || s === "\u2665") return "\u2665";
  if (s === "d" || s === "\u2666") return "\u2666";
  if (s === "c" || s === "\u2663") return "\u2663";
  return s;
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

function getPosition(seat: number, btnSeat: number, total: number): string {
  if (total <= 2) return seat === btnSeat ? "BTN/SB" : "BB";
  if (seat === btnSeat) return "BTN";
  const sb = ((btnSeat - 2 + total) % total) + 1;
  const bb = ((btnSeat - 3 + total) % total) + 1;
  if (seat === sb) return "SB";
  if (seat === bb) return "BB";
  return "";
}

export function TournamentLiveView({
  tournamentId,
  refreshTrigger,
}: {
  tournamentId: string;
  refreshTrigger?: number;
}) {
  const [seats, setSeats] = useState<SeatInfo[]>([]);
  const [communityCards, setCommunityCards] = useState<string[]>([]);
  const [potSize, setPotSize] = useState(0);
  const [handNumber, setHandNumber] = useState<number | null>(null);
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
  const [localRemaining, setLocalRemaining] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadAllData = useCallback(async () => {
    setLoading(true);

    const [seatsRes, handsRes, clockRes, tournamentRes] = await Promise.all([
      supabase
        .from("tournament_seats")
        .select("player_id, seat_number, chip_count, is_active, player_name")
        .eq("tournament_id", tournamentId)
        .order("seat_number"),
      supabase
        .from("tournament_hands")
        .select("id, hand_number, community_cards, pot_size, is_voided, status")
        .eq("tournament_id", tournamentId)
        .eq("is_voided", false)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase.rpc("get_tournament_clock", { p_tournament_id: tournamentId }),
      supabase.from("tournaments").select("players_remaining, average_stack").eq("id", tournamentId).single(),
    ]);

    if (seatsRes.data && seatsRes.data.length > 0) {
      const activeSeats = seatsRes.data.filter((s: any) => s.is_active);
      const btnSeat = 1;
      const seatInfos: SeatInfo[] = seatsRes.data.map((s: any) => ({
        player_id: s.player_id,
        display_name: s.player_name || s.player_id.slice(0, 6),
        seat_number: s.seat_number,
        chip_count: s.chip_count,
        is_active: s.is_active,
        position: s.is_active ? getPosition(s.seat_number, btnSeat, activeSeats.length) : "",
      }));
      setSeats(seatInfos);
    }

    if (handsRes.data && handsRes.data.length > 0) {
      const hand = handsRes.data[0];
      setHandNumber(hand.hand_number);
      setCommunityCards(hand.community_cards || []);
      setPotSize(hand.pot_size || 0);

      const { data: actionData } = await supabase
        .from("hand_actions")
        .select("street, player_id, action_type, action_amount, action_order")
        .eq("hand_id", hand.id)
        .order("action_order");

      if (actionData && actionData.length > 0) {
        const actionPlayerIds = [...new Set(actionData.map((a: any) => a.player_id))];
        const { data: actionProfiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", actionPlayerIds);
        const actionNameMap = new Map<string, string>();
        (actionProfiles || []).forEach((p: any) =>
          actionNameMap.set(p.user_id, p.display_name || "\u2014")
        );

        const { data: handPlayers } = await supabase
          .from("hand_players")
          .select("player_id, seat_number, hole_cards")
          .eq("hand_id", hand.id);
        const seatMap = new Map<string, number>();
        const holeCardsMap = new Map<string, string[]>();
        (handPlayers || []).forEach((hp: any) => {
          seatMap.set(hp.player_id, hp.seat_number);
          if (hp.hole_cards && hp.hole_cards.length > 0) {
            holeCardsMap.set(hp.player_id, hp.hole_cards);
          }
        });

        const actionLogs: ActionLog[] = actionData.map((a: any) => ({
          street: a.street || "preflop",
          display_name: actionNameMap.get(a.player_id) || a.player_id.slice(0, 6),
          seat_number: seatMap.get(a.player_id) || 0,
          action_type: a.action_type,
          action_amount: a.action_amount,
          action_order: a.action_order,
        }));
        setActions(actionLogs);

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

        setSeats((prev) =>
          prev.map((s) => ({
            ...s,
            is_folded: foldedPlayers.has(s.player_id),
            is_all_in: allInPlayers.has(s.player_id),
            last_action: lastActionMap.get(s.player_id),
            hole_cards: holeCardsMap.get(s.player_id) || s.hole_cards,
          }))
        );
      }
    } else {
      setHandNumber(null);
      setCommunityCards([]);
      setPotSize(0);
      setActions([]);
    }

    if (clockRes.data) {
      const c = clockRes.data;
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
    }

    if (tournamentRes.data) {
      setPlayersRemaining(tournamentRes.data.players_remaining || 0);
      setAverageStack(tournamentRes.data.average_stack || 0);
    }

    setLoading(false);
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    loadAllData();
  }, [tournamentId, refreshTrigger, loadAllData]);

  useEffect(() => {
    if (!tournamentId) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

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
      .subscribe();

    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tournamentId, loadAllData]);

  useEffect(() => {
    if (!isRunning || localRemaining <= 0) return;
    const interval = setInterval(() => {
      setLocalRemaining((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, localRemaining > 0]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)
      .toString()
      .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const displayCards = useMemo(() => {
    const c = communityCards || [];
    return [...c, ...Array(Math.max(0, 5 - c.length)).fill("")];
  }, [communityCards]);

  const activeSeats = useMemo(() => seats.filter((s) => s.is_active), [seats]);

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-gradient-to-r from-card to-card/80 border border-emerald-500/20 rounded-lg border-l-4 border-l-emerald-500 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="text-lg font-bold text-emerald-400 tracking-wide">
            {handNumber ? `Hand #${handNumber}` : "Waiting..."}
          </div>
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
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> {playersRemaining} players
          </span>
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> AVG: {formatStack(averageStack)}
          </span>
          <span className="flex items-center gap-1">
            <Coins className="w-3.5 h-3.5 text-emerald-400" /> Pot:{" "}
            <strong className="text-emerald-400 text-sm">{formatStack(potSize)}</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
        <div
          className="relative bg-gradient-to-b from-emerald-950/40 to-emerald-900/20 rounded-2xl border border-emerald-700/30 shadow-inner overflow-hidden"
          style={{ minHeight: "480px" }}
        >
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 800 600"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <radialGradient id="feltGrad" cx="50%" cy="50%">
                <stop offset="0%" style={{ stopColor: "#1a5f3f", stopOpacity: "0.6" }} />
                <stop offset="100%" style={{ stopColor: "#0d3a2a", stopOpacity: "0.9" }} />
              </radialGradient>
            </defs>
            <ellipse cx="400" cy="300" rx="340" ry="240" fill="url(#feltGrad)" />
            <ellipse
              cx="400"
              cy="300"
              rx="320"
              ry="220"
              fill="none"
              stroke="rgba(16,185,129,0.15)"
              strokeWidth="2"
            />
          </svg>

          {activeSeats.map((seat, idx) => {
            const pos = SEAT_POSITIONS[idx + 1] || SEAT_POSITIONS[1];
            const posStyle: React.CSSProperties = {};
            if (pos.top) posStyle.top = pos.top;
            if (pos.bottom) posStyle.bottom = pos.bottom;
            if (pos.left) posStyle.left = pos.left;
            if (pos.right) posStyle.right = pos.right;
            if (pos.transform) posStyle.transform = pos.transform;

            return (
              <div key={seat.player_id} className="absolute z-10" style={posStyle}>
                <div
                  className={`bg-gradient-to-br from-emerald-900/60 to-slate-900/60 backdrop-blur-sm border rounded-xl p-2.5 w-36 text-center transition-all duration-300 ${
                    seat.is_folded
                      ? "border-border/20 opacity-50 grayscale-[0.5]"
                      : seat.is_all_in
                        ? "border-red-500/40 shadow-[0_0_10px_rgba(239,68,68,0.2)]"
                        : "border-emerald-500/40 hover:border-emerald-400/60"
                  }`}
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-emerald-400 font-semibold text-xs truncate max-w-[80px]">
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
                  <div className="text-white font-bold text-sm font-mono">
                    {formatStack(seat.chip_count)}
                  </div>
                  {seat.is_all_in && (
                    <div className="text-[10px] text-red-400 font-bold mt-1">ALL IN</div>
                  )}
                  {seat.is_folded && (
                    <div className="text-[10px] text-muted-foreground mt-1">FOLDED</div>
                  )}
                  {!seat.is_folded && !seat.is_all_in && seat.last_action && (
                    <div className="text-[10px] text-emerald-300 mt-1 truncate">
                      {seat.last_action}
                    </div>
                  )}
                  {seat.hole_cards && seat.hole_cards.length > 0 && (
                    <div className="flex gap-0.5 justify-center mt-1">
                      {seat.hole_cards.map((card: string, ci: number) => (
                        <span key={ci} className={`text-xs font-bold ${isRedCard(card) ? 'text-red-400' : 'text-white'}`}>
                          {displayCard(card)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div
            className="absolute left-1/2 -translate-x-1/2 flex gap-2 z-20"
            style={{ bottom: "25%" }}
          >
            {displayCards.map((card, i) => (
              <div key={i}>
                {card ? (
                  <div
                    className={`w-12 h-[68px] sm:w-14 sm:h-20 rounded-lg border-2 flex items-center justify-center text-lg sm:text-xl font-bold shadow-lg transition-all duration-300 ${
                      isRedCard(card)
                        ? "border-red-400/40 bg-red-950/40 text-red-400"
                        : "border-white/30 bg-white/10 text-white"
                    }`}
                  >
                    {displayCard(card)}
                  </div>
                ) : (
                  <div className="w-12 h-[68px] sm:w-14 sm:h-20 rounded-lg border-2 border-dashed border-white/15 bg-transparent" />
                )}
              </div>
            ))}
          </div>

          {potSize > 0 && (
            <div
              className="absolute left-1/2 -translate-x-1/2 text-center z-20"
              style={{ bottom: "10%" }}
            >
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Pot
              </div>
              <div className="text-emerald-400 text-2xl font-bold font-mono">
                {formatStack(potSize)}
              </div>
            </div>
          )}

          {!handNumber && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <div className="text-muted-foreground text-sm bg-black/40 px-6 py-3 rounded-lg backdrop-blur-sm">
                Ch\u1EDD dealer b\u1EAFt \u0111\u1EA7u hand...
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="bg-card border border-emerald-500/20 rounded-xl p-3">
            <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2 pb-2 border-b border-emerald-500/10">
              Action Timeline
            </div>
            <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
              {actions.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4 italic">
                  No actions yet
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
              Table Stats
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Players Remaining</span>
                <span className="text-emerald-400 font-semibold">{playersRemaining}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Average Stack</span>
                <span className="text-emerald-400 font-semibold">
                  {formatStack(averageStack)}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Current Pot</span>
                <span className="text-emerald-400 font-semibold">{formatStack(potSize)}</span>
              </div>
              {clockData && (
                <>
                  <div className="flex justify-between text-muted-foreground pt-1.5 border-t border-border/20">
                    <span>Level</span>
                    <span className="text-emerald-400 font-semibold">
                      {clockData.current_level || "\u2014"}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Blinds</span>
                    <span className="text-amber-400 font-semibold">
                      {formatStack(clockData.small_blind)}/{formatStack(clockData.big_blind)}
                    </span>
                  </div>
                  {clockData.ante > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Ante</span>
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
