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
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [newTableName, setNewTableName] = useState("");
  const [addingTable, setAddingTable] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState("");
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
      setAddTableOpen(false);
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
    if (!selectedTableId) {
      toast.error("Chọn bàn");
      return;
    }
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
      toast.success(`Đã thêm ${playerName.trim()}${entryNum > 1 ? ` (entry #${entryNum})` : ""}`);
      setAddPlayerOpen(false);
      setPlayerName("");
      setNewPlayerSeat(1);
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
          <Dialog open={addTableOpen} onOpenChange={setAddTableOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" onClick={() => { setNewTableName(""); }}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Thêm bàn
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Tạo bàn mới</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Input
                  placeholder="Tên bàn (VD: Bàn 1, Table A)"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddTable(); }}
                />
                <Button onClick={handleAddTable} disabled={addingTable || !newTableName.trim()} className="w-full">
                  {addingTable ? "Đang tạo..." : "Tạo bàn"}
                </Button>
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
      ) : seats.length === 0 && tables.length === 0 ? (
        <div className="text-muted-foreground text-center py-8">
          Chưa có bàn nào. Nhấn "Thêm bàn" để tạo.
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByTable).map(([tableId, tableSeats]) => (
            <div key={tableId} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  {tableNameMap[tableId] || tableId.slice(0, 8)}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedTableId(tableId);
                    setNewPlayerSeat(Math.max(0, ...tableSeats.map((s) => s.seat_number)) + 1);
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
            </div>
          ))}
        </div>
      )}

      <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm player vào {tableNameMap[selectedTableId] || "bàn"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Tên người chơi</label>
              <Input
                placeholder="Nhập tên..."
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
              />
            </div>
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
              disabled={!playerName.trim() || addingPlayer}
            >
              {addingPlayer ? "Đang thêm..." : "Thêm player"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}