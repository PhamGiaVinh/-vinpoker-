import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { RefreshCw, Save, Plus, UserPlus } from "lucide-react";

interface SeatData {
  seat_id: string;
  player_id: string;
  player_name: string;
  entry_number: number;
  table_id: string;
  table_name: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
}

interface TableInfo {
  table_id: string;
  table_name: string;
}

interface PlayerResult {
  source: "club_member" | "profile";
  id: string;
  display_name: string;
  phone?: string;
  member_card_id?: string;
}

export function TableDrawPanel({
  tournamentId,
  clubId,
  refreshTrigger,
}: {
  tournamentId: string;
  clubId: string;
  refreshTrigger?: number;
}) {
  const [seats, setSeats] = useState<SeatData[] | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [availableTables, setAvailableTables] = useState<TableInfo[]>([]);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [playerResults, setPlayerResults] = useState<PlayerResult[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null);
  const [newPlayerSeat, setNewPlayerSeat] = useState(1);
  const [newPlayerChips, setNewPlayerChips] = useState(0);
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [addingTable, setAddingTable] = useState(false);

  const loadSeats = useCallback(async () => {
    setLoading(true);
    try {
      const [seatsRes, tablesRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", {
          body: { tournament_id: tournamentId, action: "get_seats" },
        }),
        supabase.rpc("get_tournament_tables", { p_tournament_id: tournamentId }),
      ]);
      if (seatsRes.error || seatsRes.data?.error) {
        toast.error(seatsRes.data?.error || seatsRes.error?.message);
        setSeats([]);
      } else {
        setSeats(seatsRes.data?.data ?? []);
      }
      if (tablesRes.data) {
        const tInfo = Array.isArray(tablesRes.data)
          ? tablesRes.data.map((t: any) => ({ table_id: t.table_id, table_name: t.table_name }))
          : [];
        setTables(tInfo);
      }
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadSeats();
  }, [loadSeats, refreshTrigger]);

  const loadAvailableTables = async () => {
    const { data } = await supabase
      .from("game_tables")
      .select("id, table_name")
      .eq("club_id", clubId)
      .eq("status", "active");
    const existingIds = new Set(tables.map((t) => t.table_id));
    setAvailableTables(
      (data ?? []).filter((t) => !existingIds.has(t.id)).map((t) => ({ table_id: t.id, table_name: t.table_name }))
    );
  };

  const handleAddTable = async (tableId: string) => {
    setAddingTable(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: { tournament_id: tournamentId, action: "add_table", table_id: tableId },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message);
        return;
      }
      toast.success("Đã thêm bàn");
      setAddTableOpen(false);
      loadSeats();
    } catch (e: any) {
      toast.error(e.message || "Lỗi thêm bàn");
    } finally {
      setAddingTable(false);
    }
  };

  const searchPlayers = async (query: string) => {
    if (!query || query.length < 2) {
      setPlayerResults([]);
      return;
    }
    const like = `%${query}%`;

    const { data: cmHits } = await supabase
      .from("club_members")
      .select("id, club_id, member_card_id, full_name, phone, player_user_id")
      .eq("club_id", clubId)
      .or(`member_card_id.ilike.${like},full_name.ilike.${like},phone.ilike.${like}`)
      .limit(20);

    const { data: profHits } = await supabase
      .from("profiles")
      .select("user_id, display_name, phone")
      .or(`display_name.ilike.${like},phone.ilike.${like}`)
      .limit(10);

    const linkedUserIds = new Set((cmHits ?? []).map((m) => m.player_user_id).filter(Boolean));
    const results: PlayerResult[] = [
      ...(cmHits ?? []).map((m) => ({
        source: "club_member" as const,
        id: m.player_user_id || m.id,
        display_name: m.full_name || `Thẻ ${m.member_card_id}`,
        phone: m.phone,
        member_card_id: m.member_card_id,
      })),
      ...(profHits ?? [])
        .filter((p) => !linkedUserIds.has(p.user_id))
        .map((p) => ({
          source: "profile" as const,
          id: p.user_id,
          display_name: p.display_name,
          phone: p.phone,
        })),
    ];
    setPlayerResults(results);
  };

  const handleAddPlayer = async () => {
    if (!selectedPlayer || !selectedTableId) {
      toast.error("Chọn player và bàn");
      return;
    }

    if (newPlayerChips < 0) {
      toast.error("Chip count phải >= 0");
      return;
    }

    setAddingPlayer(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "add_player",
          player_id: selectedPlayer.id,
          table_id: selectedTableId,
          seat_number: newPlayerSeat,
          chip_count: newPlayerChips,
        },
      });

      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Lỗi thêm player");
        return;
      }

      const entryNum = data?.data?.entry_number ?? 1;
      toast.success(`Đã thêm ${selectedPlayer.display_name}${entryNum > 1 ? ` (entry #${entryNum})` : ""}`);
      setAddPlayerOpen(false);
      setPlayerSearch("");
      setSelectedPlayer(null);
      setNewPlayerSeat(1);
      setNewPlayerChips(0);
      setPlayerResults([]);
      loadSeats();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setAddingPlayer(false);
    }
  };

  const handleSave = async () => {
    if (!seats) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: seats.map((s) => ({
            player_id: s.player_id,
            entry_number: s.entry_number,
            table_id: s.table_id,
            seat_number: s.seat_number,
            chip_count: s.chip_count,
            is_active: s.is_active,
          })),
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message);
        return;
      }
      toast.success("Đã cập nhật seating");
      loadSeats();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setSaving(false);
    }
  };

  const updateSeat = (index: number, field: keyof SeatData, value: any) => {
    if (!seats) return;
    const next = [...seats];
    next[index] = { ...next[index], [field]: value };
    setSeats(next);
  };

  const tableNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    tables.forEach((t) => {
      m[t.table_id] = t.table_name;
    });
    return m;
  }, [tables]);

  const groupedByTable = useMemo(() => {
    if (!seats) return {};
    const map: Record<string, SeatData[]> = {};
    seats.forEach((s) => {
      if (!map[s.table_id]) map[s.table_id] = [];
      map[s.table_id].push(s);
    });
    return map;
  }, [seats]);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold">Table Draw</div>
        <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={addTableOpen} onOpenChange={setAddTableOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" onClick={loadAvailableTables}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Thêm bàn
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Thêm bàn vào tournament</DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {availableTables.map((t) => (
                  <Button
                    key={t.table_id}
                    variant="outline"
                    className="w-full justify-start"
                    disabled={addingTable}
                    onClick={() => handleAddTable(t.table_id)}
                  >
                    {t.table_name}
                  </Button>
                ))}
                {availableTables.length === 0 && (
                  <div className="text-muted-foreground text-sm">Không có bàn khả dụng</div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" onClick={loadSeats} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !seats}>
            <Save className="w-3.5 h-3.5 mr-1" />
            Lưu
          </Button>
        </div>
      </div>

      {seats == null ? (
        <div className="text-muted-foreground">Đang tải...</div>
      ) : seats.length === 0 ? (
        <div className="text-muted-foreground">Không có người chơi đang active.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByTable).map(([tableId, tableSeats]) => (
            <div key={tableId} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  {tableNameMap[tableId] || `Bàn ${tableId.slice(0, 6)}`}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedTableId(tableId);
                    setNewPlayerSeat(
                      Math.max(0, ...tableSeats.map((s) => s.seat_number)) + 1
                    );
                    setAddPlayerOpen(true);
                  }}
                >
                  <UserPlus className="w-3.5 h-3.5 mr-1" /> Thêm player
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {tableSeats.map((seat) => {
                  const globalIndex = seats.findIndex((s) => s.seat_id === seat.seat_id);
                  return (
                    <div key={seat.seat_id} className="border rounded p-2 space-y-1">
                      <div className="text-xs text-muted-foreground">
                        Seat {seat.seat_number}
                        {seat.entry_number > 1 && (
                          <span className="ml-1 text-amber-500">R#{seat.entry_number}</span>
                        )}
                      </div>
                      <div className="text-sm font-medium truncate">
                        {seat.player_name || seat.player_id.slice(0, 8)}
                      </div>
                      <div className="text-xs font-mono">{seat.chip_count.toLocaleString()}</div>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={seat.is_active}
                          onChange={(e) => updateSeat(globalIndex, "is_active", e.target.checked)}
                        />
                        Active
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm player vào bàn {tableNameMap[selectedTableId] || selectedTableId.slice(0, 6)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Tìm tên, SĐT, hoặc mã thẻ..."
              value={playerSearch}
              onChange={(e) => {
                setPlayerSearch(e.target.value);
                setSelectedPlayer(null);
                searchPlayers(e.target.value);
              }}
            />
            {playerResults.length > 0 && !selectedPlayer && (
              <div className="border rounded max-h-40 overflow-y-auto">
                {playerResults.map((p) => (
                  <button
                    key={p.id + p.source}
                    className="w-full px-3 py-2 hover:bg-accent text-left text-sm flex items-center justify-between"
                    onClick={() => {
                      setSelectedPlayer(p);
                      setPlayerSearch(p.display_name);
                      setPlayerResults([]);
                    }}
                  >
                    <span className="font-medium truncate">{p.display_name}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {p.source === "club_member" ? "Member" : "Profile"}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {selectedPlayer && (
              <div className="text-sm text-emerald-600 font-medium">
                Đã chọn: {selectedPlayer.display_name}
                {selectedPlayer.phone ? ` (${selectedPlayer.phone})` : ""}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Seat</label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={newPlayerSeat}
                  onChange={(e) => setNewPlayerSeat(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Chips</label>
                <Input
                  type="number"
                  min={0}
                  value={newPlayerChips}
                  onChange={(e) => setNewPlayerChips(Number(e.target.value))}
                />
              </div>
            </div>
            <Button
              onClick={handleAddPlayer}
              className="w-full"
              disabled={!selectedPlayer || addingPlayer}
            >
              {addingPlayer ? "Đang thêm..." : "Thêm player"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}