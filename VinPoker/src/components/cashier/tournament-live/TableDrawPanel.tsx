import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, Save, Plus, UserPlus, X } from "lucide-react";

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

export function TableDrawPanel({
  tournamentId,
  refreshTrigger,
}: {
  tournamentId: string;
  refreshTrigger?: number;
}) {
  const [seats, setSeats] = useState<SeatData[] | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Add table inline
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [addingTable, setAddingTable] = useState(false);
  // Add player inline per table
  const [addingPlayerTableId, setAddingPlayerTableId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [newPlayerSeat, setNewPlayerSeat] = useState(1);
  const [newPlayerChips, setNewPlayerChips] = useState(0);
  const [addingPlayer, setAddingPlayer] = useState(false);

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

  const handleAddTable = async () => {
    if (!newTableName.trim()) {
      toast.error("Nhập tên bàn");
      return;
    }
    setAddingTable(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: { tournament_id: tournamentId, action: "add_table", table_name: newTableName.trim() },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Lỗi thêm bàn");
        return;
      }
      toast.success(`Đã tạo bàn "${newTableName.trim()}"`);
      setNewTableName("");
      setShowAddTable(false);
      loadSeats();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setAddingTable(false);
    }
  };

  const handleAddPlayer = async () => {
    if (!playerName.trim()) {
      toast.error("Nhập tên người chơi");
      return;
    }
    if (!addingPlayerTableId) return;
    if (newPlayerChips < 0) {
      toast.error("Chips phải >= 0");
      return;
    }
    setAddingPlayer(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "add_player",
          player_name: playerName.trim(),
          table_id: addingPlayerTableId,
          seat_number: newPlayerSeat,
          chip_count: newPlayerChips,
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Lỗi thêm player");
        return;
      }
      toast.success(`Đã thêm ${playerName.trim()}`);
      setPlayerName("");
      setNewPlayerSeat((prev) => prev + 1);
      setNewPlayerChips(0);
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
            player_name: s.player_name,
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
    tables.forEach((t) => { m[t.table_id] = t.table_name; });
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
          <Button size="sm" variant="outline" onClick={() => setShowAddTable(!showAddTable)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Tạo bàn
          </Button>
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

      {/* Add table inline form */}
      {showAddTable && (
        <div className="flex items-center gap-2 border rounded-lg p-3 bg-muted/30">
          <Input
            placeholder="Tên bàn (VD: Bàn 1)"
            value={newTableName}
            onChange={(e) => setNewTableName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddTable(); }}
            className="flex-1"
          />
          <Button size="sm" onClick={handleAddTable} disabled={addingTable || !newTableName.trim()}>
            {addingTable ? "..." : "Tạo"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setShowAddTable(false); setNewTableName(""); }}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Tables + Add player forms */}
      {seats == null ? (
        <div className="text-muted-foreground">Đang tải...</div>
      ) : tables.length === 0 && seats.length === 0 ? (
        <div className="text-muted-foreground text-center py-8">
          Chưa có bàn nào. Nhấn "Tạo bàn" để bắt đầu.
        </div>
      ) : (
        <div className="space-y-4">
          {tables.map((table) => {
            const tableSeats = groupedByTable[table.table_id] || [];
            const isAddingPlayer = addingPlayerTableId === table.table_id;

            return (
              <div key={table.table_id} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{table.table_name}</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingPlayerTableId(isAddingPlayer ? null : table.table_id);
                      setPlayerName("");
                      setNewPlayerSeat(tableSeats.length > 0 ? Math.max(...tableSeats.map((s) => s.seat_number)) + 1 : 1);
                      setNewPlayerChips(0);
                    }}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1" />
                    {isAddingPlayer ? "Đóng" : "Thêm player"}
                  </Button>
                </div>

                {/* Player list */}
                {tableSeats.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {tableSeats.map((seat) => {
                      const globalIndex = seats!.findIndex((s) => s.seat_id === seat.seat_id);
                      return (
                        <div key={seat.seat_id} className="border rounded p-2 space-y-1">
                          <div className="text-xs text-muted-foreground">
                            Seat {seat.seat_number}
                            {seat.entry_number > 1 && (
                              <span className="ml-1 text-amber-500">R#{seat.entry_number}</span>
                            )}
                          </div>
                          <div className="text-sm font-medium truncate">{seat.player_name || seat.player_id.slice(0, 8)}</div>
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
                )}

                {tableSeats.length === 0 && !isAddingPlayer && (
                  <div className="text-xs text-muted-foreground">Chưa có người chơi</div>
                )}

                {/* Add player inline form */}
                {isAddingPlayer && (
                  <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Tên</label>
                        <Input
                          placeholder="Tên người chơi"
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddPlayer(); }}
                        />
                      </div>
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
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddPlayer(); }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleAddPlayer} disabled={!playerName.trim() || addingPlayer}>
                        {addingPlayer ? "Đang thêm..." : "Thêm"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Orphan seats (table not in tables list yet) */}
          {Object.entries(groupedByTable).filter(([tid]) => !tables.find((t) => t.table_id === tid)).map(([tableId, tableSeats]) => (
            <div key={tableId} className="border rounded-lg p-3">
              <div className="text-sm font-medium mb-2">{tableNameMap[tableId] || tableId.slice(0, 8)}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {tableSeats.map((seat) => {
                  const globalIndex = seats!.findIndex((s) => s.seat_id === seat.seat_id);
                  return (
                    <div key={seat.seat_id} className="border rounded p-2 space-y-1">
                      <div className="text-xs text-muted-foreground">Seat {seat.seat_number}</div>
                      <div className="text-sm font-medium truncate">{seat.player_name || seat.player_id.slice(0, 8)}</div>
                      <div className="text-xs font-mono">{seat.chip_count.toLocaleString()}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}