import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  RefreshCw, Save, Plus, UserPlus, X, Undo2, AlertTriangle, ArrowRightLeft,
  ChevronLeft, Search, UserMinus, RotateCcw,
} from "lucide-react";
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
  table_number: number | null;
  max_seats: number;
  status: string;
}

const DEFAULT_MAX_SEATS = 9;
const MAX_SEATS_PER_TABLE = 10; // hard ceiling for seat-number validation

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

/** First free seat number 1..max on a table among active seats, or null if full. */
function firstFreeSeat(seats: SeatData[], tableId: string, maxSeats: number): number | null {
  const taken = new Set(
    seats.filter((s) => s.is_active && s.table_id === tableId).map((s) => s.seat_number),
  );
  for (let n = 1; n <= maxSeats; n++) if (!taken.has(n)) return n;
  return null;
}

export function TableDrawPanel({
  tournamentId,
  refreshTrigger,
}: {
  tournamentId: string;
  refreshTrigger?: number;
}) {
  const { user } = useAuth();
  const [seats, setSeats] = useState<SeatData[] | null>(null);
  // Last successfully loaded/saved snapshot — the baseline for dirty-state and
  // chip-conservation checks, and the target of "Hủy thay đổi".
  const [snapshot, setSnapshot] = useState<SeatData[] | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Kholdem-style navigation: Table Map (null) ↔ a single table's seat detail.
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  // Move authorization: move_player_seat requires owner/cashier of the tournament's
  // club. Tournament Live is also reachable via dealer_control, so we hide "Chuyển"
  // for viewers who can't execute the move (the guard would reject them anyway).
  const [canMove, setCanMove] = useState(false);
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

  // ── Move authorization (owner/cashier of the tournament's club) ──────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) { setCanMove(false); return; }
      const [{ data: tourn }, { data: ids }] = await Promise.all([
        supabase.from("tournaments").select("club_id").eq("id", tournamentId).maybeSingle(),
        supabase.rpc("cashier_club_ids", { _user_id: user.id }),
      ]);
      if (!alive) return;
      const clubId = (tourn as any)?.club_id;
      const allowed = (ids ?? []).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r));
      setCanMove(!!clubId && allowed.includes(clubId));
    })();
    return () => { alive = false; };
  }, [tournamentId, user]);

  const loadSeats = useCallback(async () => {
    setLoading(true);
    try {
      const [seatsRes, tablesRes, entriesRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", {
          body: { tournament_id: tournamentId, action: "get_seats" },
        }),
        // Source tables directly from tournament_tables (keyed by id = seat.table_id).
        // This includes floor-created tables that get_tournament_tables can omit
        // (its game_tables join drops tables with no linked game table) and carries
        // number/capacity/status for the map pods. SELECT is authenticated-RLS.
        supabase.from("tournament_tables")
          .select("id, table_name, table_number, max_seats, status")
          .eq("tournament_id", tournamentId),
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
        const tInfo: TableInfo[] = (tablesRes.data as any[]).map((t) => ({
          table_id: t.id,
          table_name: t.table_name ?? (t.table_number != null ? `Bàn ${t.table_number}` : "Bàn ?"),
          table_number: t.table_number ?? null,
          max_seats: t.max_seats ?? DEFAULT_MAX_SEATS,
          status: t.status ?? "active",
        }));
        tInfo.sort((a, b) => (a.table_number ?? 1e9) - (b.table_number ?? 1e9));
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

  const maxSeatsFor = useCallback(
    (tableId: string) => tables.find((t) => t.table_id === tableId)?.max_seats ?? DEFAULT_MAX_SEATS,
    [tables],
  );

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
      setAddingPlayerTableId(null);
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

  // Auto-open the only table so a single-table tournament skips the map step.
  useEffect(() => {
    if (selectedTableId === null && tables.length === 1) setSelectedTableId(tables[0].table_id);
  }, [tables, selectedTableId]);

  const openAddPlayer = (tableId: string, seatNumber?: number) => {
    setAddingPlayerTableId(tableId);
    setPlayerName("");
    setNewPlayerSeat(seatNumber ?? firstFreeSeat(seats ?? [], tableId, maxSeatsFor(tableId)) ?? 1);
    setNewPlayerChips(0);
  };

  // ── Seat row (touch-friendly; replaces the old cramped seat card) ────────────
  const renderSeatRow = (seat: SeatData) => {
    const editable = seat.is_active;
    const entryId = FEATURES.movePlayer ? entryIdBySeatId[seat.seat_id] : undefined;
    const seatLocked = editable && !!entryId; // entry-backed: table/seat read-only
    const showMove = seatLocked && canMove;   // hide Chuyển from non-cashier viewers
    return (
      <div
        key={seat.seat_id}
        className={`flex items-center gap-2 rounded-lg border p-2 ${editable ? "bg-card" : "opacity-60 bg-muted/30"}`}
      >
        {/* Seat number badge */}
        <div className="flex h-11 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-bold tabular-nums">
          {seat.seat_number}
        </div>
        {/* Identity + chips */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-sm font-medium">
            <span className="truncate">{seat.player_name || seat.player_id.slice(0, 8)}</span>
            {seat.entry_number > 1 && <span className="text-amber-500 text-xs">R#{seat.entry_number}</span>}
            {seatLocked && <span className="text-[10px] text-sky-400" title="Có phiếu ghế — dùng Chuyển để giữ phiếu/lịch sử">🎫</span>}
          </div>
          {editable ? (
            <Input
              type="number"
              min={0}
              value={seat.chip_count}
              onChange={(e) => updateSeat(seat.seat_id, "chip_count", Math.max(0, Number(e.target.value)))}
              className="mt-1 h-11 font-mono text-sm"
              aria-label="Chip count"
            />
          ) : (
            <div className="font-mono text-xs text-muted-foreground">{seat.chip_count.toLocaleString()} chip</div>
          )}
        </div>
        {/* Actions */}
        <div className="flex shrink-0 flex-col gap-1.5">
          {editable ? (
            <>
              {showMove ? (
                <Button size="sm" variant="outline" className="h-11 px-3"
                  onClick={() => setMoveTarget({ entryId: entryId!, seat })}>
                  <ArrowRightLeft className="w-4 h-4 mr-1" /> Chuyển
                </Button>
              ) : (!seatLocked && tables.length > 1) ? (
                <select
                  value={seat.table_id}
                  onChange={(e) => updateSeat(seat.seat_id, "table_id", e.target.value)}
                  className="h-11 rounded-md border border-input bg-background px-2 text-xs"
                  title="Chuyển bàn (lưu mới có hiệu lực)"
                >
                  {tables.map((t) => (
                    <option key={t.table_id} value={t.table_id}>{t.table_name}</option>
                  ))}
                </select>
              ) : null}
              <Button size="sm" variant="outline" className="h-11 px-3 text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => updateSeat(seat.seat_id, "is_active", false)}>
                <UserMinus className="w-4 h-4 mr-1" /> Loại
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-11 px-3"
              onClick={() => updateSeat(seat.seat_id, "is_active", true)}>
              <RotateCcw className="w-4 h-4 mr-1" /> Kích hoạt
            </Button>
          )}
        </div>
      </div>
    );
  };

  // ── Level 1: Table Map ───────────────────────────────────────────────────────
  const renderTableMap = () => {
    const q = tableSearch.trim().toLowerCase();
    const filtered = tables.filter((t) =>
      !q ||
      (t.table_number != null && String(t.table_number).includes(q)) ||
      t.table_name.toLowerCase().includes(q),
    );
    return (
      <div className="space-y-3">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="Tìm bàn theo số / tên…"
            className="h-11 pl-8"
            inputMode="numeric"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {tables.length === 0 ? 'Chưa có bàn nào. Nhấn "Tạo bàn" để bắt đầu.' : "Không tìm thấy bàn."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {filtered.map((t) => {
              const count = activeCounts[t.table_id] ?? 0;
              const full = count >= t.max_seats;
              const isBalanceFrom = balanceHint?.fromTableId === t.table_id;
              return (
                <button
                  key={t.table_id}
                  onClick={() => setSelectedTableId(t.table_id)}
                  className={`flex min-h-[88px] flex-col items-center justify-center gap-1 rounded-xl border p-3 text-center transition-colors hover:border-primary/60 hover:bg-primary/5 ${
                    t.status !== "active" ? "opacity-60" : ""
                  } ${isBalanceFrom ? "border-amber-500/50" : "border-border"}`}
                >
                  <span className="text-base font-bold leading-none">{t.table_name}</span>
                  <Badge
                    variant="outline"
                    className={`tabular-nums ${full ? "border-emerald-500/50 text-emerald-400" : "text-muted-foreground"}`}
                  >
                    {count}/{t.max_seats}
                  </Badge>
                  {t.status !== "active" && (
                    <span className="text-[10px] uppercase text-muted-foreground">{t.status}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Level 2: Table detail (seat list) ────────────────────────────────────────
  const renderTableDetail = (table: TableInfo) => {
    const tableSeats = groupedByTable[table.table_id] || [];
    const active = tableSeats.filter((s) => s.is_active).sort((a, b) => a.seat_number - b.seat_number);
    const inactive = tableSeats.filter((s) => !s.is_active);
    const activeByNum = new Map(active.map((s) => [s.seat_number, s]));
    const isAddingPlayer = addingPlayerTableId === table.table_id;
    const seatNumbers = Array.from({ length: table.max_seats }, (_, i) => i + 1);

    return (
      <div className="space-y-3">
        {/* Detail header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {tables.length > 1 && (
              <Button size="sm" variant="ghost" className="h-11 px-2" onClick={() => setSelectedTableId(null)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Tất cả bàn
              </Button>
            )}
            <div className="text-base font-semibold">{table.table_name}</div>
            <Badge variant="outline" className="tabular-nums">{active.length}/{table.max_seats}</Badge>
          </div>
          <Button size="sm" className="h-11" onClick={() => openAddPlayer(table.table_id)}>
            <UserPlus className="w-4 h-4 mr-1" /> Thêm player
          </Button>
        </div>

        {/* Seat list 1..max — occupied rows + tappable empty slots */}
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {seatNumbers.map((n) => {
            const occ = activeByNum.get(n);
            if (occ) return renderSeatRow(occ);
            return (
              <button
                key={`empty-${n}`}
                onClick={() => openAddPlayer(table.table_id, n)}
                className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <span className="flex h-11 w-10 shrink-0 items-center justify-center rounded-md bg-muted/50 text-sm font-bold tabular-nums">{n}</span>
                <span className="flex items-center gap-1"><Plus className="w-4 h-4" /> Ghế trống — thêm</span>
              </button>
            );
          })}
        </div>

        {/* Busted / inactive */}
        {inactive.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Đã bust / không hoạt động</div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">{inactive.map(renderSeatRow)}</div>
          </div>
        )}

        {/* Add player inline form (stacks on phone) */}
        {isAddingPlayer && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div>
                <label className="text-xs text-muted-foreground">Tên</label>
                <Input className="h-11" placeholder="Tên người chơi" value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddPlayer(); }} autoFocus />
              </div>
              <div className="sm:w-20">
                <label className="text-xs text-muted-foreground">Seat</label>
                <Input className="h-11" type="number" min={1} max={MAX_SEATS_PER_TABLE} value={newPlayerSeat}
                  onChange={(e) => setNewPlayerSeat(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Chips</label>
                <Input className="h-11 font-mono" type="number" min={0} value={newPlayerChips}
                  onChange={(e) => setNewPlayerChips(Number(e.target.value))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddPlayer(); }} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-11" onClick={() => setAddingPlayerTableId(null)}>Đóng</Button>
              <Button size="sm" className="h-11" onClick={handleAddPlayer} disabled={!playerName.trim() || addingPlayer}>
                {addingPlayer ? "Đang thêm..." : "Thêm"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const selectedTable = selectedTableId ? tables.find((t) => t.table_id === selectedTableId) ?? null : null;

  return (
    <Card className="p-3 sm:p-4 space-y-4">
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

      {/* Control / dirty bar — always visible so edits in a table detail stay saveable */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-semibold">Sơ đồ bàn</div>
          <span className="text-xs text-muted-foreground">{tables.length} bàn · {totalActive} người</span>
          {isDirty && (
            <Badge variant="outline" className="text-amber-500 border-amber-500/40">Có thay đổi chưa lưu</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="h-11" onClick={() => setShowAddTable(!showAddTable)}>
            <Plus className="w-4 h-4 mr-1" /> Tạo bàn
          </Button>
          <Button size="sm" variant="outline" className="h-11" onClick={loadSeats} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
          </Button>
          {isDirty && (
            <Button size="sm" variant="outline" className="h-11" onClick={revertChanges} disabled={saving}>
              <Undo2 className="w-4 h-4 mr-1" /> Hủy
            </Button>
          )}
          <Button size="sm" className="h-11" onClick={handleSave} disabled={saving || !seats || !isDirty}>
            <Save className="w-4 h-4 mr-1" /> Lưu thay đổi
          </Button>
        </div>
      </div>

      {/* Balance hint */}
      {balanceHint && (
        <div className="flex items-center gap-2 text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-2">
          <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
          <span>Gợi ý cân bàn: chuyển 1 người từ {tableNameMap[balanceHint.fromTableId] || "bàn đông"} sang {tableNameMap[balanceHint.toTableId] || "bàn vắng"} ({balanceHint.reason})</span>
        </div>
      )}

      {/* Chip conservation gate */}
      {chipWarning && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Tổng chip thay đổi từ {chipWarning.before.toLocaleString()} → {chipWarning.after.toLocaleString()}
          </div>
          <p className="text-xs text-muted-foreground">Xác nhận đây là rebuy/addon/penalty/manual correction. Nếu không, hãy kiểm tra lại chip trước khi lưu.</p>
          <div className="flex gap-2">
            <Button size="sm" className="h-11" onClick={doSave} disabled={saving}>Xác nhận và lưu</Button>
            <Button size="sm" variant="outline" className="h-11" onClick={() => setChipWarning(null)} disabled={saving}>Quay lại sửa</Button>
          </div>
        </div>
      )}

      {/* Add table inline form */}
      {showAddTable && (
        <div className="flex items-center gap-2 border rounded-lg p-3 bg-muted/30">
          <Input placeholder="Tên bàn (VD: Bàn 1)" value={newTableName} className="h-11 flex-1"
            onChange={(e) => setNewTableName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddTable(); }} />
          <Button size="sm" className="h-11" onClick={handleAddTable} disabled={addingTable || !newTableName.trim()}>
            {addingTable ? "..." : "Tạo"}
          </Button>
          <Button size="sm" variant="ghost" className="h-11" onClick={() => { setShowAddTable(false); setNewTableName(""); }}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Body: Table Map ↔ Table detail */}
      {seats == null ? (
        <div className="text-muted-foreground">Đang tải...</div>
      ) : selectedTable ? (
        renderTableDetail(selectedTable)
      ) : (
        renderTableMap()
      )}
    </Card>
  );
}
