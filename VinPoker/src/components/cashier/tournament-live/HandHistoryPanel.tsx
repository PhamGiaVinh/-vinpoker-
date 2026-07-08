import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { isRedCard, displayCard } from "@/components/shared/CardSlotPicker";
import { fetchHandPlayerDisplay } from "@/lib/tracker-poker/handPlayerNames";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string>("all");
  const [tables, setTables] = useState<{ id: string; name: string }[]>([]);

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

    const [playersRes, actionsRes] = await Promise.all([
      supabase
        .from("hand_players")
        .select("hand_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, hole_cards")
        .in("hand_id", handIds),
      supabase
        .from("hand_actions")
        .select("hand_id, player_id, street, action_type, action_amount, action_order")
        .in("hand_id", handIds)
        .order("action_order"),
    ]);

    // Names come from tournament_seats.player_name keyed by player_id (the LIVE source),
    // NOT profiles.user_id — hand_players.player_id is a tournament-entry id, so the old
    // profiles join always missed and history showed short ids for walk-in players.
    const playerIds = [...new Set((playersRes.data || []).map((p: any) => p.player_id))];
    const display = await fetchHandPlayerDisplay(tournamentId, playerIds);
    const nameMap = new Map<string, string>();
    (playersRes.data || []).forEach((p: any) => {
      nameMap.set(p.player_id, display.get(p.player_id)?.name || p.player_id.slice(0, 6));
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
              <div className="text-xs text-muted-foreground">
                {new Date(selectedHand.hand_time || selectedHand.created_at).toLocaleString()}
              </div>
            </div>

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
        ) : (
          <Card className="p-10 text-center">
            <div className="text-muted-foreground text-sm">Select a hand to view details</div>
          </Card>
        )}
      </div>
    </div>
  );
}
