import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Save, Plus, UserPlus, X, Undo2, AlertTriangle, ArrowRightLeft } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { MovePlayerDialog } from "./MovePlayerDialog";

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

const MAX_SEATS_PER_TABLE = 10;

/**
 * Visibility-only balance hint. Suggests source/destination table only — never
 * a specific player (no approved balancing policy exists yet) and never calls
 * any move RPC. Returns null when tables are balanced within 1 player.
 */
export function suggestBalanceMove(
  tables: TableInfo[],
  activeCounts: Record<string, number>,
): { fromTableId: string; toTableId: string; reason: string } | null {
  if (tables.length < 2) return null;
  let max = tables[0], min = tables[0];
  for (const t of tables) {
    if ((activeCounts[t.table_id] ?? 0) > (activeCounts[max.table_id] ?? 0)) max = t;
    if ((activeCounts[t.table_id] ?? 0) < (activeCounts[min.table_id] ?? 0)) min = t;
  }
  const diff = (activeCounts[max.table_id] ?? 0) - (activeCounts[min.table_id] ?? 0);
  if (diff <= 1) return null;
  return {
    fromTableId: max.table_id,
    toTableId: min.table_id,
    reason: `${max.table_name} có ${activeCounts[max.table_id] ?? 0} người, ${min.table_name} có ${activeCounts[min.table_id] ?? 0} người`,
  };
}

/** Finds the active-seat conflict for (table, seat), excluding one seat row. */
function findOccupant(
  seats: SeatData[],
  tableId: string,
  seatNumber: number,
  excludeSeatId?: string,
): SeatData | undefined {
  return seats.find(
    (s) =>
      s.is_active &&
      s.table_id === tableId &&
      s.seat_number === seatNumber &&
      s.seat_id !== excludeSeatId,
  );
}

/** First free seat number 1..MAX on a table among active seats, or null if full. */
function firstFreeSeat(seats: SeatData[], tableId: string): number | null {
  const taken = new Set(
    seats.filter((s) => s.is_active && s.table_id === tableId).map((s) => s.seat_number),
  );
  for (let n = 1; n <= MAX_SEATS_PER_TABLE; n++) if (!taken.has(n)) return n;
  return null;
}

export function TableDrawPanel({
  tournamentId,
  refreshTrigger,
}: {
  tournamentId: string;
  refreshTrigger?: number;
}) {
  const [seats, setSeats] = useState<SeatData[] | null>(null);
  // Last successfully loaded/saved snapshot — the baseline for dirty-state and
  // chip-conservation checks, and the target of "Hủy thay đổi".
  const [snapshot, setSnapshot] = useState<SeatData[] | null>(null);
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
  // Chip-conservation confirm gate: holds the pending diff while the floor confirms.
  const [chipWarning, setChipWarning] = useState<{ before: number; after: number } | null>(null);
  // System-A linkage: seats with an entry have receipts/history — their table/seat
  // must only change through MovePlayerDialog (move_player_seat), never bulk save.
  const [entryIdBySeatId, setEntryIdBySeatId] = useState<Record<string, string>>({});
  const [moveTarget, setMoveTarget] = useState<{ entryId: string; seat: SeatData } | null>(null);

  const loadSeats = useCallback(async () => {
    setLoading(true);
    try {
      const [seatsRes, tablesRes, entriesRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", {
          body: { tournament_id: tournamentId, action: "get_seats" },
        }),
        supabase.rpc("get_tournament_tables", { p_tournament_id: tournamentId }),
        // get_seats doesn't return entry_id — fetch the linkage directly (SELECT-authenticated RLS)
        FEATURES.movePlayer
          ? supabase.from("tournament_seats").select("id, entry_id").eq("tournament_id", tournamentId)
          : Promise.resolve({ data: null } as { data: { id: string; entry_id: string | null }[] | null }),
      ]);
      if (seatsRes.error || seatsRes.data?.error) {
        toast.error(seatsRes.data?.error || seatsRes.error?.message);
        setSeats([]);
        setSnapshot([]);
      } else {
        const loaded: SeatData[] = seatsRes.data?.data ?? [];
        setSeats(loaded);
        setSnapshot(loaded.map((s) => ({ ...s })));
      }
      if (tablesRes.data) {
        const tInfo = Array.isArray(tablesRes.data)
          ? tablesRes.data.map((t: any) => ({ table_id: t.table_id, table_name: t.table_name }))
          : [];
        setTables(tInfo);
      }
      const entryMap: Record<string, string> = {};
      for (const row of (entriesRes.data ?? []) as { id: string; entry_id: string | null }[]) {
        if (row.entry_id) entryMap[row.id] = row.entry_id;
      }
      setEntryIdBySeatId(entryMap);
    } finally {
      setLoading(false);
      setChipWarning(null);
    }
  }, [tournamentId]);

  useEffect(() => {
    loadSeats();
  }, [loadSeats, refreshTrigger]);

  const isDirty = useMemo(() => {
    if (!seats || !snapshot) return false;
    if (seats.length !== snapshot.length) return true;
    const snapById = new Map(snapshot.map((s) => [s.seat_id, s]));
    return seats.some((s) => {
      const o = snapById.get(s.seat_id);
      return (
        !o ||
        o.table_id !== s.table_id ||
        o.seat_number !== s.seat_number ||
        o.chip_count !== s.chip_count ||
        o.is_active !== s.is_active
      );
    });
  }, [seats, snapshot]);

  const revertChanges = () => {
    if (!snapshot) return;
    setSeats(snapshot.map((s) => ({ ...s })));
    setChipWarning(null);
    toast.info("Đã hủy các thay đổi chưa lưu");
  };

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
    if (!addingPlayerTableId || !seats) return;
    if (newPlayerChips < 0) {
      toast.error("Chips phải >= 0");
      return;
    }
    const seatNum = Math.round(newPlayerSeat);
    if (!Number.isFinite(seatNum) || seatNum < 1 || seatNum > MAX_SEATS_PER_TABLE) {
      toast.error(`Seat phải từ 1 đến ${MAX_SEATS_PER_TABLE}`);
      return;
    }
    // Block occupied seats immediately — don't wait for the backend to reject.
    const occupant = findOccupant(seats, addingPlayerTableId, seatNum);
    if (occupant) {
      toast.error(`Seat ${seatNum} đã có ${occupant.player_name || "người chơi khác"} đang ngồi`);
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
          seat_number: seatNum,
          chip_count: newPlayerChips,
        },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Lỗi thêm player");
        return;
      }
      toast.success(`Đã thêm ${playerName.trim()}`);
      setPlayerName("");
      setNewPlayerChips(0);
      loadSeats();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setAddingPlayer(false);
    }
  };

  const doSave = async () => {
    if (!seats) return;
    setSaving(true);
    setChipWarning(null);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: seats.map((s) => ({
            seat_id: s.seat_id, // UPDATE-by-id target (avoids the dropped-constraint upsert)
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

  const handleSave = async () => {
    if (!seats || !snapshot) return;
    // System-A guard (defense-in-depth behind the locked inputs): bulk save must
    // never change table/seat of an entry-backed row — that breaks its receipt
    // and history. Moving those goes through MovePlayerDialog only.
    if (FEATURES.movePlayer) {
      const snapById = new Map(snapshot.map((s) => [s.seat_id, s]));
      for (const s of seats) {
        const o = snapById.get(s.seat_id);
        if (!o || !entryIdBySeatId[s.seat_id]) continue;
        if (o.table_id !== s.table_id || o.seat_number !== s.seat_number) {
          toast.error(
            `${s.player_name || "Người chơi"} có phiếu ghế — dùng nút "Chuyển" thay vì sửa trực tiếp để giữ phiếu/lịch sử hợp lệ.`,
          );
          return;
        }
      }
    }
    // Duplicate active (table, seat) — abort naming the exact conflict.
    const byKey = new Map<string, SeatData>();
    for (const s of seats) {
      if (!s.is_active) continue;
      const key = `${s.table_id}:${s.seat_number}`;
      const prev = byKey.get(key);
      if (prev) {
        const tName = tables.find((t) => t.table_id === s.table_id)?.table_name || s.table_name;
        toast.error(
          `Trùng chỗ: ${prev.player_name || prev.player_id.slice(0, 8)} và ${s.player_name || s.player_id.slice(0, 8)} cùng ngồi ${tName} - Seat ${s.seat_number}`,
        );
        return;
      }
      byKey.set(key, s);
    }
    // Chip conservation: compare last loaded/saved snapshot vs current draft.
    const before = snapshot.filter((s) => s.is_active).reduce((sum, s) => sum + s.chip_count, 0);
    const after = seats.filter((s) => s.is_active).reduce((sum, s) => sum + s.chip_count, 0);
    if (before !== after) {
      setChipWarning({ before, after });
      return;
    }
    await doSave();
  };

  const updateSeat = (seatId: string, field: keyof SeatData, value: any) => {
    if (!seats) return;
    setSeats(seats.map((s) => (s.seat_id === seatId ? { ...s, [field]: value } : s)));
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

  const activeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    (seats ?? []).forEach((s) => {
      if (s.is_active) m[s.table_id] = (m[s.table_id] ?? 0) + 1;
    });
    return m;
  }, [seats]);

  const totalActive = useMemo(
    () => (seats ?? []).filter((s) => s.is_active).length,
    [seats],
  );

  const balanceHint = useMemo(
    () => suggestBalanceMove(tables, activeCounts),
    [tables, activeCounts],
  );

  const renderSeatCard = (seat: SeatData) => {
    const editable = seat.is_active;
    // System-A lock (owner-approved acceptance): entry-backed seats have receipts +
    // history — bulk editor must never change their table/seat. Chips and the
    // Active toggle stay bulk-editable; moving goes through MovePlayerDialog only.
    const entryId = FEATURES.movePlayer ? entryIdBySeatId[seat.seat_id] : undefined;
    const seatLocked = editable && !!entryId;
    return (
      <div
        key={seat.seat_id}
        className={`border rounded p-2 space-y-1 ${editable ? "" : "opacity-60 bg-muted/30"}`}
      >
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          Seat
          {editable && !seatLocked ? (
            <Input
              type="number"
              min={1}
              max={MAX_SEATS_PER_TABLE}
              value={seat.seat_number}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                updateSeat(seat.seat_id, "seat_number", v);
              }}
              className="h-6 w-14 px-1 text-xs"
            />
          ) : (
            <span>{seat.seat_number}</span>
          )}
          {seat.entry_number > 1 && (
            <span className="ml-1 text-amber-500">R#{seat.entry_number}</span>
          )}
          {seatLocked && (
            <span className="ml-1 text-[10px] text-sky-400" title="Có phiếu ghế — dùng Chuyển để giữ phiếu/lịch sử hợp lệ">🎫</span>
          )}
        </div>
        <div className="text-sm font-medium truncate">{seat.player_name || seat.player_id.slice(0, 8)}</div>
        {editable ? (
          <>
            <Input
              type="number"
              min={0}
              value={seat.chip_count}
              onChange={(e) => updateSeat(seat.seat_id, "chip_count", Math.max(0, Number(e.target.value)))}
              className="h-7 text-xs font-mono"
            />
            {seatLocked ? (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs"
                onClick={() => setMoveTarget({ entryId: entryId!, seat })}
              >
                <ArrowRightLeft className="w-3 h-3 mr-1" /> Chuyển
              </Button>
            ) : tables.length > 1 ? (
              <select
                value={seat.table_id}
                onChange={(e) => updateSeat(seat.seat_id, "table_id", e.target.value)}
                className="w-full h-7 text-xs rounded border border-input bg-background px-1"
                title="Chuyển bàn (lưu mới có hiệu lực)"
              >
                {tables.map((t) => (
                  <option key={t.table_id} value={t.table_id}>{t.table_name}</option>
                ))}
              </select>
            ) : null}
          </>
        ) : (
          <div className="text-xs font-mono">{seat.chip_count.toLocaleString()}</div>
        )}
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={seat.is_active}
            onChange={(e) => updateSeat(seat.seat_id, "is_active", e.target.checked)}
          />
          Active
        </label>
      </div>
    );
  };

  return (
    <Card className="p-4 space-y-4">
      {moveTarget && (
        <MovePlayerDialog
          open={moveTarget !== null}
          onOpenChange={(v) => { if (!v) setMoveTarget(null); }}
          tournamentId={tournamentId}
          entryId={moveTarget.entryId}
          playerName={moveTarget.seat.player_name || moveTarget.seat.player_id.slice(0, 8)}
          currentTournamentTableId={moveTarget.seat.table_id}
          currentSeatNumber={moveTarget.seat.seat_number}
          onMoved={loadSeats}
        />
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold">Table Draw</div>
          <span className="text-xs text-muted-foreground">
            {tables.length} bàn · {totalActive} người đang chơi
          </span>
          {isDirty && (
            <Badge variant="outline" className="text-amber-500 border-amber-500/40">
              Có thay đổi chưa lưu
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setShowAddTable(!showAddTable)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Tạo bàn
          </Button>
          <Button size="sm" variant="outline" onClick={loadSeats} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Làm mới
          </Button>
          {isDirty && (
            <Button size="sm" variant="outline" onClick={revertChanges} disabled={saving}>
              <Undo2 className="w-3.5 h-3.5 mr-1" /> Hủy thay đổi
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving || !seats || !isDirty}>
            <Save className="w-3.5 h-3.5 mr-1" />
            Lưu thay đổi
          </Button>
        </div>
      </div>

      {/* Balance hint — visibility only, never auto-applies */}
      {balanceHint && (
        <div className="flex items-center gap-2 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2">
          <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
          <span>
            Gợi ý cân bàn: chuyển 1 người từ {tableNameMap[balanceHint.fromTableId] || "bàn đông"} sang {tableNameMap[balanceHint.toTableId] || "bàn vắng"} ({balanceHint.reason})
          </span>
        </div>
      )}

      {/* Chip conservation confirm gate */}
      {chipWarning && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Tổng chip thay đổi từ {chipWarning.before.toLocaleString()} → {chipWarning.after.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground">
            Xác nhận đây là rebuy/addon/penalty/manual correction. Nếu không, hãy kiểm tra lại chip trước khi lưu.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={doSave} disabled={saving}>
              Xác nhận và lưu
            </Button>
            <Button size="sm" variant="outline" onClick={() => setChipWarning(null)} disabled={saving}>
              Quay lại sửa
            </Button>
          </div>
        </div>
      )}

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
            const activeSeats = tableSeats.filter((s) => s.is_active);
            const inactiveSeats = tableSeats.filter((s) => !s.is_active);
            const isAddingPlayer = addingPlayerTableId === table.table_id;

            return (
              <div key={table.table_id} className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">{table.table_name}</div>
                    <Badge variant="outline" className="text-xs">
                      {activeSeats.length}/{MAX_SEATS_PER_TABLE}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingPlayerTableId(isAddingPlayer ? null : table.table_id);
                      setPlayerName("");
                      setNewPlayerSeat(firstFreeSeat(seats, table.table_id) ?? 1);
                      setNewPlayerChips(0);
                    }}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1" />
                    {isAddingPlayer ? "Đóng" : "Thêm player"}
                  </Button>
                </div>

                {/* Active players — editable */}
                {activeSeats.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {activeSeats.map(renderSeatCard)}
                  </div>
                )}

                {/* Inactive/busted — read-only except the Active toggle */}
                {inactiveSeats.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Đã bust / không hoạt động
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {inactiveSeats.map(renderSeatCard)}
                    </div>
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
                          max={MAX_SEATS_PER_TABLE}
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

          {/* Orphan seats (table not in tables list yet) — read-only */}
          {Object.entries(groupedByTable).filter(([tid]) => !tables.find((t) => t.table_id === tid)).map(([tableId, tableSeats]) => (
            <div key={tableId} className="border rounded-lg p-3">
              <div className="text-sm font-medium mb-2">{tableNameMap[tableId] || tableId.slice(0, 8)}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {tableSeats.map((seat) => (
                  <div key={seat.seat_id} className="border rounded p-2 space-y-1">
                    <div className="text-xs text-muted-foreground">Seat {seat.seat_number}</div>
                    <div className="text-sm font-medium truncate">{seat.player_name || seat.player_id.slice(0, 8)}</div>
                    <div className="text-xs font-mono">{seat.chip_count.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
