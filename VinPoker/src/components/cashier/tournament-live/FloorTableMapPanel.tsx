import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, Search, LayoutGrid, LayoutList } from "lucide-react";
import type { Tournament } from "@/types/tournament";
import { FloorTableDetailSheet, type MapSeat, type MapTable } from "./FloorTableDetailSheet";
import { PlayerActionSheet, type ActionSeat } from "./PlayerActionSheet";
import { MovePlayerDialog } from "./MovePlayerDialog";
import { EditChipsDialog } from "./EditChipsDialog";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

type StatusKey = "playing" | "full" | "empty" | "closed";

const STATUS_META: Record<StatusKey, { label: string; dot: string; text: string }> = {
  playing: { label: "Đang chơi", dot: "bg-primary", text: "text-primary" },
  full: { label: "Đầy", dot: "bg-destructive", text: "text-destructive" },
  empty: { label: "Trống", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  closed: { label: "Đóng", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

function tableStatus(occupied: number, maxSeats: number, raw: string): StatusKey {
  if (raw !== "active") return "closed";
  if (occupied >= maxSeats) return "full";
  if (occupied > 0) return "playing";
  return "empty";
}

/**
 * Floor table map — color-coded status grid scaling to 50–100 tables with status
 * filters, table/player search, density toggle and a sticky summary. Click a
 * table → detail sheet; tap a player there → Chuyển / Sửa chip / Phiếu / Loại.
 * Reuses existing backend only (tournament_tables select + get_seats edge action
 * + move_player_seat / update_seats). No zone column exists, so tables are a flat
 * grid ordered by table number.
 */
export function FloorTableMapPanel({
  tournament,
  refreshTrigger,
}: {
  tournament: Tournament;
  refreshTrigger: number;
}) {
  const { user } = useAuth();
  const tid = tournament.id;
  const [tables, setTables] = useState<MapTable[] | null>(null);
  const [seatsByTable, setSeatsByTable] = useState<Record<string, MapSeat[]>>({});
  const [entryBySeat, setEntryBySeat] = useState<Record<string, string>>({});
  const [canMove, setCanMove] = useState(false);
  const [loading, setLoading] = useState(false);

  const [filter, setFilter] = useState<StatusKey | "all">("all");
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(false);

  const [detailTable, setDetailTable] = useState<MapTable | null>(null);
  const [selected, setSelected] = useState<MapSeat | null>(null);
  const [moveTarget, setMoveTarget] = useState<MapSeat | null>(null);
  const [editTarget, setEditTarget] = useState<MapSeat | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [busting, setBusting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) { setCanMove(false); return; }
      const { data: ids } = await supabase.rpc("cashier_club_ids", { _user_id: user.id });
      if (!alive) return;
      const allowed = (ids ?? []).map((r: any) => (typeof r === "string" ? r : r.cashier_club_ids ?? r));
      setCanMove(allowed.includes(tournament.club_id));
    })();
    return () => { alive = false; };
  }, [user, tournament.club_id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ttRes, seatsRes, linksRes] = await Promise.all([
        supabase.from("tournament_tables")
          .select("id, table_name, table_number, max_seats, status, table_id")
          .eq("tournament_id", tid),
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tid, action: "get_seats" } }),
        supabase.from("tournament_seats").select("id, entry_id").eq("tournament_id", tid),
      ]);
      const built: MapTable[] = ((ttRes.data ?? []) as any[])
        .map((t) => ({
          tt_id: t.id,
          table_id: t.table_id,
          table_number: t.table_number,
          table_name: t.table_name ?? (t.table_number != null ? `Bàn ${t.table_number}` : "Bàn ?"),
          max_seats: t.max_seats ?? 9,
          status: t.status ?? "active",
        }))
        .sort((a, b) => (a.table_number ?? 1e9) - (b.table_number ?? 1e9));
      setTables(built);

      const seats = (seatsRes.data?.data ?? []) as MapSeat[];
      const grouped: Record<string, MapSeat[]> = {};
      for (const s of seats) {
        if (!s.is_active) continue;
        (grouped[s.table_id] ??= []).push(s);
      }
      for (const k of Object.keys(grouped)) grouped[k].sort((a, b) => a.seat_number - b.seat_number);
      setSeatsByTable(grouped);

      const m: Record<string, string> = {};
      for (const r of (linksRes.data ?? []) as { id: string; entry_id: string | null }[]) if (r.entry_id) m[r.id] = r.entry_id;
      setEntryBySeat(m);
    } finally {
      setLoading(false);
    }
  }, [tid]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const enriched = useMemo(() => (tables ?? []).map((t) => {
    const seats = seatsByTable[t.table_id] ?? [];
    return { table: t, seats, occ: seats.length, status: tableStatus(seats.length, t.max_seats, t.status) };
  }), [tables, seatsByTable]);

  const counts = useMemo(() => {
    const c = { total: enriched.length, playing: 0, full: 0, empty: 0, closed: 0 } as Record<string, number>;
    for (const e of enriched) c[e.status]++;
    return c;
  }, [enriched]);

  const visible = useMemo(() => enriched.filter((e) => {
    if (filter !== "all" && e.status !== filter) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    if (String(e.table.table_number ?? "").includes(q) || e.table.table_name.toLowerCase().includes(q)) return true;
    return e.seats.some((s) => (s.player_name || s.player_id).toLowerCase().includes(q));
  }), [enriched, filter, query]);

  const bustSeat = async () => {
    if (!selected) return;
    setBusting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tid,
          action: "update_seats",
          seats: [{
            seat_id: selected.seat_id, player_id: selected.player_id, entry_number: selected.entry_number,
            table_id: selected.table_id, seat_number: selected.seat_number, chip_count: selected.chip_count,
            is_active: false, player_name: selected.player_name,
          }],
        },
      });
      if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
      toast.success(`Đã loại ${selected.player_name || "người chơi"}`);
      setSelected(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setBusting(false);
    }
  };

  const openReceipt = () => {
    if (!selected) return;
    setReceipt({
      tournamentName: tournament.name,
      tournamentDate: (tournament as Tournament & { start_time?: string | null }).start_time ?? null,
      playerName: selected.player_name || selected.player_id.slice(0, 8),
      tableNumber: detailTable?.table_number ?? null,
      seatNumber: selected.seat_number,
      receiptCode: entryBySeat[selected.seat_id] ?? selected.seat_id,
      startingStack: selected.chip_count,
      qrValue: entryBySeat[selected.seat_id] ?? selected.seat_id,
    });
  };

  const cellCols = compact
    ? "grid-cols-5 sm:grid-cols-8 lg:grid-cols-10"
    : "grid-cols-3 sm:grid-cols-5 lg:grid-cols-6";

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      {/* Sticky summary */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 pb-2 bg-card/95 backdrop-blur space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Sơ đồ bàn</div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => setCompact((v) => !v)} title="Mật độ hiển thị">
              {compact ? <LayoutList className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5 text-center">
          {([
            ["all", "Tổng", counts.total, "text-foreground"],
            ["playing", "Đang chơi", counts.playing, STATUS_META.playing.text],
            ["full", "Đầy", counts.full, STATUS_META.full.text],
            ["empty", "Trống", counts.empty, STATUS_META.empty.text],
            ["closed", "Đóng", counts.closed, STATUS_META.closed.text],
          ] as [StatusKey | "all", string, number, string][]).map(([k, label, n, cls]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-lg border px-1 py-1.5 ${filter === k ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
            >
              <div className={`text-base font-semibold ${cls}`}>{n}</div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Tìm số bàn / tên người chơi…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {(filter !== "all" || query) && (
            <button className="text-xs text-muted-foreground underline" onClick={() => { setFilter("all"); setQuery(""); }}>Xoá lọc</button>
          )}
        </div>
      </div>

      {tables === null ? (
        <div className={`grid ${cellCols} gap-2`}>{Array.from({ length: 18 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : visible.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Không có bàn khớp bộ lọc.</div>
      ) : (
        <div className={`grid ${cellCols} gap-2`}>
          {visible.map((e) => {
            const meta = STATUS_META[e.status];
            return (
              <button
                key={e.table.tt_id}
                onClick={() => setDetailTable(e.table)}
                className="rounded-lg border border-border bg-card p-2 text-center transition-colors hover:border-primary/50"
              >
                <div className="text-sm font-semibold leading-tight">{e.table.table_number ?? "?"}</div>
                <div className="font-mono text-[10px] text-muted-foreground">{e.occ}/{e.table.max_seats}</div>
                <span className={`mx-auto mt-0.5 block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              </button>
            );
          })}
        </div>
      )}

      <FloorTableDetailSheet
        open={detailTable !== null}
        onOpenChange={(v) => { if (!v) setDetailTable(null); }}
        table={detailTable}
        seats={detailTable ? (seatsByTable[detailTable.table_id] ?? []) : []}
        onSeatTap={(s) => setSelected(s)}
      />

      <PlayerActionSheet
        open={selected !== null}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
        seat={selected as ActionSeat | null}
        entryId={selected ? entryBySeat[selected.seat_id] : undefined}
        canMove={canMove}
        busting={busting}
        onMove={() => { if (selected) setMoveTarget(selected); }}
        onEditChips={() => { if (selected) setEditTarget(selected); }}
        onReceipt={openReceipt}
        onBust={bustSeat}
      />

      {moveTarget && entryBySeat[moveTarget.seat_id] && (
        <MovePlayerDialog
          open={moveTarget !== null}
          onOpenChange={(v) => { if (!v) setMoveTarget(null); }}
          tournamentId={tid}
          entryId={entryBySeat[moveTarget.seat_id]}
          playerName={moveTarget.player_name || moveTarget.player_id.slice(0, 8)}
          currentTournamentTableId={detailTable?.tt_id ?? null}
          currentSeatNumber={moveTarget.seat_number}
          onMoved={load}
        />
      )}

      <EditChipsDialog
        open={editTarget !== null}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        tournamentId={tid}
        seat={editTarget as ActionSeat | null}
        onSaved={load}
      />

      <SeatReceiptDialog open={receipt !== null} onOpenChange={(v) => { if (!v) setReceipt(null); }} receipt={receipt} />
    </Card>
  );
}
