import { useState, useMemo, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Undo2, RotateCcw, SkipForward, CheckCircle2, XCircle,
  ChevronRight, Users, Clock, Coins,
} from "lucide-react";

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

function getPosition(seat: number, btnSeat: number, total: number): string {
  if (total <= 2) return seat === btnSeat ? "BTN/SB" : "BB";
  if (seat === btnSeat) return "BTN";
  const sb = ((btnSeat - 2 + total) % total) + 1;
  const bb = ((btnSeat - 3 + total) % total) + 1;
  if (seat === sb) return "SB";
  if (seat === bb) return "BB";
  return "";
}

function formatStack(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

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

function isRedCard(card: string): boolean {
  if (!card) return false;
  const last = card.slice(-1);
  return last === "h" || last === "d" || last === "♥" || last === "♦";
}

function suitSymbol(s: string): string {
  if (s === "s" || s === "♠") return "♠";
  if (s === "h" || s === "♥") return "♥";
  if (s === "d" || s === "♦") return "♦";
  if (s === "c" || s === "♣") return "♣";
  return s;
}

function displayCard(card: string): string {
  if (!card || card.length < 2) return "";
  const rank = card.slice(0, -1);
  const suit = suitSymbol(card.slice(-1));
  return rank + suit;
}

export function HandInputPanel({ tournamentId }: { tournamentId: string }) {
  const [tableId, setTableId] = useState("");
  const [tableName, setTableName] = useState("");
  const [handNumber, setHandNumber] = useState<number | "">("");
  const [availableTables, setAvailableTables] = useState<{ id: string; name: string }[]>([]);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [currentStreet, setCurrentStreet] = useState<Street>("preflop");
  const [actions, setActions] = useState<ActionRecord[]>([]);
  const [communityCards, setCommunityCards] = useState<string[]>(["", "", "", "", ""]);
  const [betAmount, setBetAmount] = useState("");
  const [buttonSeat, setButtonSeat] = useState<number>(1);
  const [submitting, setSubmitting] = useState(false);
  const [lastHandId, setLastHandId] = useState<string | null>(null);
  const [cardInput, setCardInput] = useState("");
  const [cardInputIdx, setCardInputIdx] = useState<number | null>(null);
  const [endingStacks, setEndingStacks] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!tournamentId) return;
    const loadTables = async () => {
      const { data } = await supabase
        .from("tournament_seats")
        .select("table_id, game_tables(table_name)")
        .eq("tournament_id", tournamentId)
        .eq("is_active", true);
      if (data) {
        const map = new Map<string, string>();
        (data as any[]).forEach((d) => {
          if (!map.has(d.table_id)) {
            map.set(d.table_id, d.game_tables?.table_name || d.table_id.slice(0, 8));
          }
        });
        setAvailableTables(Array.from(map.entries()).map(([id, name]) => ({ id, name })));
      }
    };
    loadTables();
  }, [tournamentId]);

  const handleTableChange = async (newTableId: string) => {
    setTableId(newTableId);
    const tbl = availableTables.find((t) => t.id === newTableId);
    setTableName(tbl?.name || newTableId.slice(0, 8));

    if (!newTableId) { setPlayers([]); return; }

    const { data: seats, error } = await supabase
      .from("tournament_seats")
      .select("player_id, entry_number, seat_number, chip_count")
      .eq("tournament_id", tournamentId)
      .eq("table_id", newTableId)
      .eq("is_active", true)
      .order("seat_number");

    if (error || !seats?.length) {
      toast.error("Không thể tải danh sách người chơi");
      setPlayers([]);
      return;
    }

    const playerIds = seats.map((s) => s.player_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", playerIds);

    const nameMap = new Map<string, string>();
    (profiles || []).forEach((p: any) => nameMap.set(p.user_id, p.display_name || p.user_id.slice(0, 6)));

    const seatCount = seats.length;
    const newPlayers: PlayerState[] = seats.map((s, i) => ({
      player_id: s.player_id,
      entry_number: s.entry_number,
      seat_number: s.seat_number,
      display_name: nameMap.get(s.player_id) || s.player_id.slice(0, 6),
      starting_stack: s.chip_count,
      current_stack: s.chip_count,
      is_active: true,
      position: getPosition(s.seat_number, 1, seatCount),
      current_bet: 0,
      total_bet: 0,
      is_folded: false,
      is_all_in: false,
    }));

    setPlayers(newPlayers);
    setButtonSeat(1);
    setCurrentStreet("preflop");
    setActions([]);
    setCommunityCards(["", "", "", "", ""]);
    setBetAmount("");

    const { data: nextHand } = await supabase.rpc("get_next_hand_number", {
      p_tournament_id: tournamentId,
      p_table_id: newTableId,
    });
    if (nextHand) setHandNumber(nextHand);
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

  const activePlayers = useMemo(() => players.filter((p) => !p.is_folded && !p.is_all_in), [players]);

  const handleAction = (playerId: string, actionType: string) => {
    const player = players.find((p) => p.player_id === playerId);
    if (!player) return;

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
        const totalBet = actionType === "bet" ? amount : player.current_bet + amount;
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
        newPlayers[idx] = { ...newPlayers[idx], current_stack: player.current_stack - amount, current_bet: amount, total_bet: player.total_bet + amount };
        break;
      }
      case "post_bb": {
        amount = parseInt(betAmount) || 0;
        if (amount <= 0) { toast.error("Nhập BB"); return; }
        newPlayers[idx] = { ...newPlayers[idx], current_stack: player.current_stack - amount, current_bet: amount, total_bet: player.total_bet + amount };
        break;
      }
    }

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
        action_order: prev.length + 1,
      },
    ]);
    setBetAmount("");
  };

  const nextStreet = () => {
    const idx = STREET_ORDER.indexOf(currentStreet);
    if (idx < STREET_ORDER.length - 1) {
      setPlayers((prev) => prev.map((p) => ({ ...p, current_bet: 0 })));
      setCurrentStreet(STREET_ORDER[idx + 1]);
    }
  };

  const applyCard = () => {
    if (cardInputIdx === null || !cardInput) return;
    const newCards = [...communityCards];
    newCards[cardInputIdx] = cardInput;
    setCommunityCards(newCards);
    setCardInput("");
    setCardInputIdx(null);
  };

  const completeHand = () => {
    const stacks: Record<string, number> = {};
    players.forEach((p) => {
      stacks[p.player_id] = p.is_folded ? 0 : p.current_stack;
    });
    setEndingStacks(stacks);
  };

  const handleSubmitHand = async () => {
    if (!tableId || !handNumber) return;
    setSubmitting(true);
    try {
      const finalPlayers = players.map((p) => ({
        player_id: p.player_id,
        entry_number: p.entry_number,
        seat_number: p.seat_number,
        starting_stack: p.starting_stack,
        ending_stack: endingStacks[p.player_id] ?? p.current_stack,
        is_eliminated: (endingStacks[p.player_id] ?? p.current_stack) === 0,
      }));

      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: {
          tournament_id: tournamentId,
          action: "record_hand",
          table_id: tableId,
          hand_number: Number(handNumber),
          hand_time: new Date().toISOString(),
          community_cards: communityCards.filter(Boolean),
          pot_size: potSize,
          players: finalPlayers,
          actions: actions.map((a) => ({
            player_id: a.player_id,
            entry_number: players.find((p) => p.player_id === a.player_id)?.entry_number || 1,
            action_type: a.action_type,
            action_amount: a.amount,
            action_order: a.action_order,
            street: a.street,
          })),
        },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message); return; }
      toast.success("Đã ghi nhận hand");
      setLastHandId(data?.data?.hand_id ?? null);
      resetHand();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async () => {
    if (!lastHandId) { toast.error("Không có hand để void"); return; }
    if (!confirm("VOID hand này? Chip sẽ hoàn về trước hand.")) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-update", {
        body: { tournament_id: tournamentId, action: "void_hand", hand_id: lastHandId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      toast.success("Hand đã VOID");
      setLastHandId(null);
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
    setCommunityCards(["", "", "", "", ""]);
    setBetAmount("");
    setEndingStacks({});
    if (tableId) handleTableChange(tableId);
  };

  const cardSlotIndex = (street: Street): number[] => {
    if (street === "flop") return [0, 1, 2];
    if (street === "turn") return [3];
    if (street === "river") return [4];
    return [];
  };

  const isSummary = Object.keys(endingStacks).length > 0;

  return (
    <div className="space-y-3">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 bg-card border border-border/30 rounded-lg border-l-4 border-l-amber-500">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-medium text-amber-400">
            {tableId ? `Hand #${handNumber} · ${tableName}` : "Hand Input"}
          </h3>
          {tableId && !isSummary && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-xs font-medium">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
              {STREET_LABELS[currentStreet]}
            </span>
          )}
          {isSummary && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-medium">
              Review
            </span>
          )}
        </div>
        {tableId && !isSummary && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {activePlayers.length}/{players.length}</span>
            <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5 text-emerald-400" /> Pot: <strong className="text-emerald-400">{formatStack(potSize)}</strong></span>
          </div>
        )}
      </div>

      {/* SETUP: Table selector */}
      {!tableId && (
        <Card className="p-6 text-center space-y-4">
          <div className="text-muted-foreground">Chọn bàn để bắt đầu ghi nhận hand</div>
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
            <div className="space-y-1">
              <label className="text-xs font-medium">Chọn Bàn</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={tableId}
                onChange={(e) => handleTableChange(e.target.value)}
              >
                <option value="">-- Chọn Bàn --</option>
                {availableTables.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Hand Number</label>
              <Input placeholder="Auto" type="number" value={handNumber} onChange={(e) => setHandNumber(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
          </div>
          {lastHandId && (
            <Button size="sm" variant="destructive" onClick={handleVoid} disabled={submitting}>
              <Undo2 className="w-3.5 h-3.5 mr-1" /> Void Last Hand
            </Button>
          )}
        </Card>
      )}

      {/* ACTIVE: Hand tracking */}
      {tableId && !isSummary && (
        <>
          {/* COMMUNITY CARDS */}
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-gradient-to-br from-emerald-950/50 to-emerald-900/30 border border-emerald-700/30">
            {communityCards.map((card, i) => (
              <div key={i} className="relative">
                {card ? (
                  <div className={`w-11 h-15 sm:w-12 sm:h-16 rounded border-2 flex items-center justify-center text-base sm:text-lg font-bold shadow-lg ${isRedCard(card) ? "border-red-500/50 text-red-400 bg-red-950/30" : "border-white/30 text-white bg-white/10"}`}>
                    {displayCard(card)}
                  </div>
                ) : (
                  <div
                    className="w-11 h-15 sm:w-12 sm:h-16 rounded border-2 border-dashed border-white/20 flex items-center justify-center text-muted-foreground cursor-pointer hover:border-amber-500/50 hover:bg-amber-950/20 transition-colors"
                    onClick={() => {
                      if (cardSlotIndex(currentStreet).includes(i)) setCardInputIdx(i);
                    }}
                  >
                    —
                  </div>
                )}
                {card && (
                  <button
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[8px] flex items-center justify-center hover:bg-red-600"
                    onClick={() => { const c = [...communityCards]; c[i] = ""; setCommunityCards(c); }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {cardInputIdx !== null && (
              <div className="flex items-center gap-1 ml-2">
                <Input
                  className="w-16 h-8 text-xs"
                  placeholder="Ks"
                  value={cardInput}
                  onChange={(e) => setCardInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applyCard(); }}
                  autoFocus
                />
                <Button size="sm" className="h-8 px-2 text-xs" onClick={applyCard}>OK</Button>
              </div>
            )}
          </div>

          {/* STREET TABS */}
          <div className="flex gap-1 p-1.5 bg-card border border-border/30 rounded-lg overflow-x-auto">
            {STREET_ORDER.map((street) => (
              <button
                key={street}
                className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                  currentStreet === street
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "text-muted-foreground hover:text-amber-400 border border-transparent"
                }`}
                onClick={() => setCurrentStreet(street)}
              >
                {STREET_LABELS[street]}
              </button>
            ))}
            <button
              className="ml-auto px-3 py-1.5 rounded text-xs font-medium text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 transition-colors"
              onClick={nextStreet}
              disabled={currentStreet === "showdown"}
            >
              Next <ChevronRight className="w-3 h-3 inline" />
            </button>
          </div>

          {/* SEATS GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {players.map((player) => {
              const isOut = player.is_folded || player.is_all_in;
              return (
                <div
                  key={player.player_id}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    player.is_folded
                      ? "border-border/20 bg-card/30 opacity-50"
                      : player.is_all_in
                      ? "border-red-500/30 bg-red-950/10"
                      : "border-border/30 bg-card hover:border-amber-500/30"
                  }`}
                >
                  {/* Seat header */}
                  <div className="flex items-start justify-between mb-1.5">
                    <div>
                      <div className="text-[10px] text-muted-foreground font-medium">S{player.seat_number}</div>
                      <div className="text-sm font-medium truncate max-w-[120px]">{player.display_name}</div>
                    </div>
                    {player.position && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">
                        {player.position}
                      </span>
                    )}
                  </div>

                  {/* Chip count */}
                  <div className="text-sm font-semibold text-emerald-400 mb-2">
                    {formatStack(player.current_stack)}
                    {player.current_bet > 0 && (
                      <span className="text-xs text-amber-400 ml-2">Bet: {formatStack(player.current_bet)}</span>
                    )}
                    {player.is_all_in && <span className="text-xs text-red-400 ml-1">ALL-IN</span>}
                  </div>

                  {/* Action buttons */}
                  {!isOut && (
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        className="px-1 py-1.5 text-[10px] font-medium border border-border/30 rounded hover:border-red-500/50 hover:text-red-400 hover:bg-red-950/20 transition-colors"
                        onClick={() => handleAction(player.player_id, "fold")}
                      >
                        Fold
                      </button>
                      <button
                        className="px-1 py-1.5 text-[10px] font-medium border border-border/30 rounded hover:border-border/60 hover:bg-secondary transition-colors disabled:opacity-30"
                        onClick={() => handleAction(player.player_id, "check")}
                        disabled={highestBet > player.current_bet}
                      >
                        Check
                      </button>
                      <button
                        className="px-1 py-1.5 text-[10px] font-medium border border-blue-500/30 text-blue-400 rounded hover:bg-blue-950/20 transition-colors disabled:opacity-30"
                        onClick={() => handleAction(player.player_id, "call")}
                        disabled={highestBet <= player.current_bet}
                      >
                        Call
                      </button>
                      {currentStreet === "preflop" && player.position === "SB" && (
                        <button
                          className="px-1 py-1.5 text-[10px] font-medium border border-amber-500/30 text-amber-400 rounded hover:bg-amber-950/20 transition-colors"
                          onClick={() => handleAction(player.player_id, "post_sb")}
                        >
                          Post SB
                        </button>
                      )}
                      {currentStreet === "preflop" && player.position === "BB" && (
                        <button
                          className="px-1 py-1.5 text-[10px] font-medium border border-amber-500/30 text-amber-400 rounded hover:bg-amber-950/20 transition-colors"
                          onClick={() => handleAction(player.player_id, "post_bb")}
                        >
                          Post BB
                        </button>
                      )}
                      {highestBet === 0 ? (
                        <button
                          className="px-1 py-1.5 text-[10px] font-medium border border-blue-500/30 text-blue-400 rounded hover:bg-blue-950/20 transition-colors"
                          onClick={() => handleAction(player.player_id, "bet")}
                        >
                          Bet
                        </button>
                      ) : (
                        <button
                          className="px-1 py-1.5 text-[10px] font-medium border border-blue-500/30 text-blue-400 rounded hover:bg-blue-950/20 transition-colors"
                          onClick={() => handleAction(player.player_id, "raise")}
                        >
                          Raise
                        </button>
                      )}
                      <button
                        className="px-1 py-1.5 text-[10px] font-medium border border-red-500/30 text-red-400 rounded hover:bg-red-950/20 transition-colors"
                        onClick={() => handleAction(player.player_id, "all_in")}
                      >
                        All-In
                      </button>
                    </div>
                  )}
                  {player.is_folded && <div className="text-xs text-muted-foreground text-center py-1">Folded</div>}
                  {player.is_all_in && !player.is_folded && <div className="text-xs text-red-400 text-center py-1 font-medium">ALL-IN</div>}
                </div>
              );
            })}
          </div>

          {/* CONTROLS */}
          <div className="flex gap-2 p-2.5 bg-card border border-border/30 rounded-lg">
            <Input
              type="number"
              placeholder="Bet / Raise amount..."
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              className="flex-1 h-9 text-sm"
            />
            <div className="flex gap-1">
              {["1000", "5000", "10000", "25000"].map((v) => (
                <button
                  key={v}
                  className="px-2 py-1 text-[10px] border border-border/30 rounded hover:border-amber-500/50 hover:text-amber-400 transition-colors"
                  onClick={() => setBetAmount(v)}
                >
                  {formatStack(Number(v))}
                </button>
              ))}
            </div>
          </div>

          {/* ACTION LOG */}
          <div className="bg-card border border-border/30 rounded-lg p-2.5">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Action Log</div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {actions.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-3">Chưa có action</div>
              )}
              {STREET_ORDER.filter((s) => actions.some((a) => a.street === s)).map((street) => (
                <div key={street}>
                  <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mt-2 mb-1">
                    {STREET_LABELS[street]}
                    {street === "flop" && communityCards[0] && ` (${communityCards.slice(0, 3).map(displayCard).join(" ")})`}
                    {street === "turn" && communityCards[3] && ` (${displayCard(communityCards[3])})`}
                    {street === "river" && communityCards[4] && ` (${displayCard(communityCards[4])})`}
                  </div>
                  {actions
                    .filter((a) => a.street === street)
                    .map((action, idx) => (
                      <div key={idx} className="flex justify-between py-1 px-1 border-b border-border/20 text-xs">
                        <span className="text-muted-foreground">
                          S{action.seat_number} {action.display_name}
                        </span>
                        <span className={action.amount > 0 ? "text-emerald-400 font-semibold" : "text-muted-foreground"}>
                          {formatActionLabel(action)}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>

          {/* FOOTER */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={resetHand} disabled={submitting}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
              </Button>
              {lastHandId && (
                <Button size="sm" variant="destructive" onClick={handleVoid} disabled={submitting}>
                  <Undo2 className="w-3.5 h-3.5 mr-1" /> Void
                </Button>
              )}
            </div>
            <Button size="sm" onClick={completeHand} disabled={submitting || actions.length === 0} className="bg-amber-500 hover:bg-amber-600 text-black">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Complete Hand
            </Button>
          </div>
        </>
      )}

      {/* SUMMARY: Review ending stacks */}
      {isSummary && (
        <Card className="p-4 space-y-4">
          <div className="text-sm font-semibold text-amber-400">Review Ending Stacks</div>
          <div className="text-xs text-muted-foreground mb-2">
            Pot: <strong className="text-emerald-400">{formatStack(potSize)}</strong> · Community: {communityCards.filter(Boolean).map(displayCard).join(" ") || "—"}
          </div>
          <div className="space-y-2">
            {players.map((player) => (
              <div key={player.player_id} className="flex items-center gap-3 border rounded p-2">
                <div className="text-sm font-medium flex-1">
                  S{player.seat_number} {player.display_name}
                  {player.is_folded && <span className="text-xs text-muted-foreground ml-1">(Folded)</span>}
                </div>
                <div className="text-xs text-muted-foreground">Start: {formatStack(player.starting_stack)}</div>
                <Input
                  type="number"
                  className="w-28 h-8 text-sm"
                  value={endingStacks[player.player_id] ?? player.current_stack}
                  onChange={(e) =>
                    setEndingStacks((prev) => ({ ...prev, [player.player_id]: Number(e.target.value) }))
                  }
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button size="sm" variant="outline" onClick={() => setEndingStacks({})}>
              <XCircle className="w-3.5 h-3.5 mr-1" /> Back
            </Button>
            <Button size="sm" onClick={handleSubmitHand} disabled={submitting} className="bg-amber-500 hover:bg-amber-600 text-black">
              <Send className="w-3.5 h-3.5 mr-1" /> Submit Hand
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Send(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}
