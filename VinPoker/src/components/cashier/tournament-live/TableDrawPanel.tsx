import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { RefreshCw, Save } from "lucide-react";
import type { TournamentSeat } from "@/types/tournament";

interface SeatData {
  seat_id: string;
  player_id: string;
  entry_number: number;
  table_id: string;
  seat_number: number;
  chip_count: number;
  is_active: boolean;
}

export function TableDrawPanel({ tournamentId, refreshTrigger }: { tournamentId: string; refreshTrigger?: number }) {
  const [seats, setSeats] = useState<SeatData[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSeats = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
      body: { tournament_id: tournamentId, action: "get_seats" },
    });
    setLoading(false);
    if (error || data?.error) { toast.error(data?.error || error?.message); setSeats([]); return; }
    setSeats(data?.data ?? []);
  }, [tournamentId]);

  useEffect(() => { loadSeats(); }, [loadSeats, refreshTrigger]);

  const handleSave = async () => {
    if (!seats) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: { tournament_id: tournamentId, action: "update_seats", seats: seats.map((s) => ({
          player_id: s.player_id,
          entry_number: s.entry_number,
          table_id: s.table_id,
          seat_number: s.seat_number,
          chip_count: s.chip_count,
          is_active: s.is_active,
        })) },
      });
      if (error || data?.error) { toast.error(data?.error || error?.message); return; }
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
      <div className="flex items-center justify-between">
        <div className="font-semibold">Table Draw</div>
        <div className="flex items-center gap-2">
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
              <div className="text-sm font-medium mb-2">Bàn {tableId.slice(0, 6)}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {tableSeats.map((seat, idx) => {
                  const globalIndex = seats.findIndex((s) => s.seat_id === seat.seat_id);
                  return (
                    <div key={seat.seat_id} className="border rounded p-2 space-y-1">
                      <div className="text-xs text-muted-foreground">Seat {seat.seat_number}</div>
                      <div className="text-sm font-medium truncate">{seat.player_id.slice(0, 8)}</div>
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
    </Card>
  );
}


