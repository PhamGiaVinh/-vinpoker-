import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, Search, LayoutGrid, LayoutList, Shuffle, Plus } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import type { Tournament } from "@/types/tournament";
import { FloorTableDetailSheet, type MapSeat, type MapTable } from "./FloorTableDetailSheet";
import { RedrawLauncherDialog } from "./RedrawLauncherDialog";
import { OpenTableDialog } from "./OpenTableDialog";
import { PlayerActionSheet, type ActionSeat } from "./PlayerActionSheet";
import { MovePlayerDialog } from "./MovePlayerDialog";
import { EditChipsDialog } from "./EditChipsDialog";
import { PlayerInfoSheet } from "./PlayerInfoSheet";
import { BustConfirmDialog } from "./BustConfirmDialog";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";

type StatusKey = "open" | "running" | "paused" | "closed";

const STATUS_META: Record<StatusKey, { label: string; dot: string; text: string }> = {
  open: { label: "Mở / trống", dot: "bg-primary", text: "text-primary" },
  running: { label: "Đang chạy", dot: "bg-sky-500", text: "text-sky-400" },
  paused: { label: "Tạm dừng", dot: "bg-amber-500", text: "text-amber-400" },
  closed: { label: "Đóng", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

const STATUS_ORDER: StatusKey[] = ["open", "running", "paused", "closed"];

// Pseudo-zones grouped by table number (Zone A = 1–20, B = 21–40, …) until an
// explicit tournament_tables.zone column is added (see floor-zone-table-status-spec).
const ZONE_SIZE = 20;
function zoneOf(n: number | null): string {
  if (n == null || n < 1) return "Khác";
  return String.fromCharCode(65 + Math.floor((n - 1) / ZONE_SIZE));
}

// Status from data already loaded: closed (table broken/closed) → paused (room on
// break) → running (has active players) → open. Per-table pause needs a table-level
// field (deferred); break is room-wide via tournament.status.
function tableStatus(occupied: number, raw: string, onBreak: boolean): StatusKey {
  if (raw !== "active") return "closed";
  if (onBreak) return "paused";
  if (occupied > 0) return "running";
  return "open";
}

/**
 * Floor table map — zone-grouped, color-coded status grid (Mở / Đang chạy / Tạm
 * dừng / Đóng) scaling to 50–100 tables, with status filters, table/player search,
 * density toggle, sticky summary and a legend. Click a table → detail sheet; tap a
 * player there → Chuyển / Sửa chip / Phiếu / Loại. Reuses existing backend only
 * (tournament_tables select + get_seats + move_player_seat / update_seats). Zones
 * are derived from table number; status is derived client-side (paused = tournament
 * on break).
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
  const onBreak = tournament.status === "break";
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
  const [infoTarget, setInfoTarget] = useState<MapSeat | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [busting, setBusting] = useState(false);
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [openTableOpen, setOpenTableOpen] = useState(false);
  // Floor "Loại" out-confirm dialog (FEATURES.floorOutConfirm). Preview a busting player's
  // finishing place + prize before the (unchanged) bust runs. activeCount = live active-seat
  // count tournament-wide (= the player's finishing place, since it includes the one busting);
  // prizeMap = position → amount from the already-live tournament_prizes.
  const [bustTarget, setBustTarget] = useState<MapSeat | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  const [prizeMap, setPrizeMap] = useState<Map<number, number> | null>(null);
  const [prizeLoading, setPrizeLoading] = useState(false);

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

      // A seat's table_id may reference EITHER game_tables.id (older draw seats) OR
      // tournament_tables.id (seats created by move_player_seat / manual inserts) —
      // the live DB carries both conventions. Normalize every id to the table's
      // canonical key (game_tables.id = tournament_tables.table_id) so occupancy
      // shows regardless of which convention the seat used.
      const canonicalByAny: Record<string, string> = {};
      for (const t of built) {
        if (t.table_id) {
          canonicalByAny[t.table_id] = t.table_id; // game_tables.id → itself
          canonicalByAny[t.tt_id] = t.table_id;    // tournament_tables.id → game_tables.id
        }
      }
      const seats = (seatsRes.data?.data ?? []) as MapSeat[];
      // Tournament-wide active count (includes the player about to bust) = the finishing
      // place preview for the out-confirm dialog. Counted from the raw seat list (before the
      // table-mapping filter) so it never undercounts on multi-table events.
      setActiveCount(seats.filter((s) => s.is_active).length);
      const grouped: Record<string, MapSeat[]> = {};
      for (const s of seats) {
        if (!s.is_active) continue;
        const key = canonicalByAny[s.table_id] ?? s.table_id;
        (grouped[key] ??= []).push(s);
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

  // Load the prize table once per tournament for the out-confirm dialog (read-only; the
  // already-live get_tournament_prizes). On any failure fall back to an empty map so the
  // dialog degrades to a "no prize" (non-ITM) preview rather than hanging — it never blocks
  // the bust. Only fetched when the confirm dialog is enabled.
  useEffect(() => {
    if (!FEATURES.floorOutConfirm) return;
    let alive = true;
    setPrizeLoading(true);
    (async () => {
      try {
        const { data } = await supabase.rpc("get_tournament_prizes", { p_tournament_id: tid });
        const rows = (Array.isArray(data) ? data : []) as { position?: number; amount?: number }[];
        const m = new Map<number, number>();
        for (const r of rows) {
          if (r && typeof r.position === "number") m.set(r.position, Number(r.amount ?? 0));
        }
        if (alive) setPrizeMap(m);
      } catch {
        if (alive) setPrizeMap(new Map());
      } finally {
        if (alive) setPrizeLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tid]);

  const enriched = useMemo(() => (tables ?? []).map((t) => {
    const seats = seatsByTable[t.table_id] ?? [];
    return {
      table: t,
      seats,
      occ: seats.length,
      zone: zoneOf(t.table_number),
      status: tableStatus(seats.length, t.status, onBreak),
    };
  }), [tables, seatsByTable, onBreak]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { total: enriched.length, open: 0, running: 0, paused: 0, closed: 0 };
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

  const zones = useMemo(() => {
    const map = new Map<string, typeof visible>();
    for (const e of visible) {
      if (!map.has(e.zone)) map.set(e.zone, []);
      map.get(e.zone)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "Khác") return 1;
      if (b[0] === "Khác") return -1;
      return a[0] < b[0] ? -1 : 1;
    });
  }, [visible]);

  const bustSeat = async (target: MapSeat | null) => {
    if (!target) return;
    setBusting(true);
    try {
      if (FEATURES.floorAtomicPayout) {
        const { data, error } = await supabase.rpc("bust_tournament_player_with_payout" as any, {
          p_tournament_id: tid,
          p_seat_id: target.seat_id,
          p_expected_active_count: activeCount,
          p_idempotency_key: crypto.randomUUID(),
        } as any);
        if (error) { toast.error(error.message); return; }
        const result = data as any;
        toast.success(`Đã chốt hạng ${result?.place ?? ""} cho ${result?.player_name || target.player_name || "người chơi"}`);
        setSelected(null);
        setInfoTarget(null);
        await load();
        return;
      }
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tid,
          action: "update_seats",
          seats: [{
            seat_id: target.seat_id, player_id: target.player_id, entry_number: target.entry_number,
            table_id: target.table_id, seat_number: target.seat_number, chip_count: target.chip_count,
            is_active: false, player_name: target.player_name,
          }],
        },
      });
      if (error || (data as any)?.error) { toast.error((data as any)?.error || error?.message); return; }
      toast.success(`Đã loại ${target.player_name || "người chơi"}`);
      setSelected(null);
      setInfoTarget(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Lỗi");
    } finally {
      setBusting(false);
    }
  };

  // Entry point for the "Loại" action from either sheet. With the confirm flag OFF this is
  // byte-identical to the old behavior (bust immediately). With it ON, close the current sheet
  // and open the out-confirm dialog on the next frame (mirrors the sheet's own close→open race
  // guard) so the operator can review place + prize first.
  const requestBust = async (target: MapSeat | null) => {
    if (!target) return;
    if (!FEATURES.floorOutConfirm) { bustSeat(target); return; }
    if (FEATURES.floorAtomicPayout) {
      const { data, error } = await supabase.rpc("preview_tournament_bust" as any, {
        p_tournament_id: tid,
        p_seat_id: target.seat_id,
      } as any);
      if (error) { toast.error(error.message); return; }
      const preview = data as any;
      if (!preview?.can_confirm) {
        toast.error("Đăng ký vẫn mở: chưa thể chốt payout ITM.");
        return;
      }
      const nextPrize = new Map(prizeMap ?? []);
      nextPrize.set(Number(preview.place), Number(preview.prize ?? 0));
      setPrizeMap(nextPrize);
      setActiveCount(Number(preview.active_count_revision));
    }
    setSelected(null);
    setInfoTarget(null);
    requestAnimationFrame(() => setBustTarget(target));
  };

  const confirmBust = async () => {
    const target = bustTarget;
    if (!target) return;
    await bustSeat(target);
    setBustTarget(null);
  };

  const openReceipt = (target: MapSeat | null) => {
    if (!target) return;
    setReceipt({
      tournamentName: tournament.name,
      tournamentDate: (tournament as Tournament & { start_time?: string | null }).start_time ?? null,
      playerName: target.player_name || target.player_id.slice(0, 8),
      tableNumber: detailTable?.table_number ?? null,
      seatNumber: target.seat_number,
      receiptCode: entryBySeat[target.seat_id] ?? target.seat_id,
      startingStack: target.chip_count,
      qrValue: entryBySeat[target.seat_id] ?? target.seat_id,
    });
  };

  const cellCols = compact
    ? "grid-cols-5 sm:grid-cols-8 lg:grid-cols-12"
    : "grid-cols-3 sm:grid-cols-6 lg:grid-cols-10";

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      {/* Sticky summary */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 pb-2 bg-card/95 backdrop-blur space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold flex items-center gap-2"><LayoutGrid className="h-4 w-4" /> Sơ đồ bàn</div>
          <div className="flex items-center gap-1.5">
            {FEATURES.floorTableOps && canMove && (
              <Button size="sm" className="h-9" onClick={() => setOpenTableOpen(true)} title="Tạo thêm bàn mới">
                <Plus className="h-4 w-4 mr-1" /> Tạo thêm bàn
              </Button>
            )}
            {FEATURES.floorTableOps && canMove && (
              <Button size="sm" variant="outline" className="h-9" onClick={() => setRedrawOpen(true)} title="Bốc lại bàn (redraw)">
                <Shuffle className="h-4 w-4 mr-1" /> Bốc lại
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => setCompact((v) => !v)} title="Mật độ hiển thị">
              {compact ? <LayoutList className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5 text-center">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-lg border px-1 py-1.5 ${filter === "all" ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
          >
            <div className="text-base font-semibold text-foreground">{counts.total}</div>
            <div className="text-[10px] text-muted-foreground">Tổng</div>
          </button>
          {STATUS_ORDER.map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-lg border px-1 py-1.5 ${filter === k ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
            >
              <div className={`text-base font-semibold ${STATUS_META[k].text}`}>{counts[k]}</div>
              <div className="text-[10px] text-muted-foreground">{STATUS_META[k].label.split(" / ")[0]}</div>
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
        <div className="space-y-3">
          {zones.map(([zoneName, items]) => (
            <div key={zoneName}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="text-sm font-medium">Zone {zoneName}</span>
                <span className="text-[11px] text-muted-foreground">{items.length} bàn</span>
              </div>
              <div className={`grid ${cellCols} gap-2`}>
                {items.map((e) => {
                  const meta = STATUS_META[e.status];
                  return (
                    <button
                      key={e.table.tt_id}
                      onClick={() => setDetailTable(e.table)}
                      className="rounded-lg border border-border bg-card p-1.5 transition-colors hover:border-primary/50"
                      title={`${e.table.table_name} · ${meta.label} · ${e.occ}/${e.table.max_seats}`}
                    >
                      <TableIcon number={e.table.table_number} colorClass={meta.text} />
                      <div className="mt-0.5 text-center font-mono text-[9px] text-muted-foreground">{e.occ}/{e.table.max_seats}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        {STATUS_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_META[k].dot}`} /> {STATUS_META[k].label}
          </span>
        ))}
      </div>

      <FloorTableDetailSheet
        open={detailTable !== null}
        onOpenChange={(v) => { if (!v) setDetailTable(null); }}
        table={detailTable}
        seats={detailTable ? (seatsByTable[detailTable.table_id] ?? []) : []}
        onSeatTap={(s) => setSelected(s)}
        tournamentId={tid}
        tournamentName={tournament.name}
        tournamentDate={(tournament as Tournament & { start_time?: string | null }).start_time ?? null}
        onChanged={load}
      />

      {FEATURES.floorTableOps && (
        <OpenTableDialog
          open={openTableOpen}
          onOpenChange={setOpenTableOpen}
          tournamentId={tid}
          defaultMaxSeats={tables?.[0]?.max_seats ?? 9}
          onDone={load}
        />
      )}

      {FEATURES.floorTableOps && (
        <RedrawLauncherDialog
          open={redrawOpen}
          onOpenChange={setRedrawOpen}
          tournamentId={tid}
          onDone={load}
        />
      )}

      <PlayerActionSheet
        open={selected !== null}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
        seat={selected as ActionSeat | null}
        entryId={selected ? entryBySeat[selected.seat_id] : undefined}
        canMove={canMove}
        busting={busting}
        onMove={() => { if (selected) setMoveTarget(selected); }}
        onEditChips={() => { if (selected) setEditTarget(selected); }}
        onReceipt={() => openReceipt(selected)}
        onBust={() => requestBust(selected)}
        onInfo={() => { if (selected) setInfoTarget(selected); }}
      />

      <PlayerInfoSheet
        open={infoTarget !== null}
        onOpenChange={(v) => { if (!v) setInfoTarget(null); }}
        seat={infoTarget as ActionSeat | null}
        ticketNumber={infoTarget ? entryBySeat[infoTarget.seat_id] : undefined}
        canMove={canMove}
        busting={busting}
        onMove={() => { if (infoTarget) setMoveTarget(infoTarget); }}
        onReceipt={() => openReceipt(infoTarget)}
        onBust={() => requestBust(infoTarget)}
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

      {FEATURES.floorOutConfirm && (
        <BustConfirmDialog
          open={bustTarget !== null}
          onOpenChange={(v) => { if (!v) setBustTarget(null); }}
          playerName={bustTarget ? (bustTarget.player_name || bustTarget.player_id.slice(0, 8)) : ""}
          place={bustTarget && activeCount > 0 ? activeCount : null}
          prize={bustTarget && activeCount > 0 ? (prizeMap?.get(activeCount) ?? null) : null}
          prizeLoading={prizeLoading}
          itmPlaces={tournament.itm_places}
          busting={busting}
          onConfirm={confirmBust}
        />
      )}

      <SeatReceiptDialog open={receipt !== null} onOpenChange={(v) => { if (!v) setReceipt(null); }} receipt={receipt} />
    </Card>
  );
}

/**
 * Poker-table top-view icon (felt + seat marks + center number). Felt + seats use
 * currentColor from `colorClass` (status tone, theme-token based); the number sits
 * on top in the normal foreground color so it stays readable in any status/theme.
 * Scales to the grid cell (w-full) so the density toggle resizes it for free.
 */
function TableIcon({ number, colorClass }: { number: number | null; colorClass: string }) {
  return (
    <div className="relative">
      <span className={colorClass}>
        <svg viewBox="0 0 46 30" className="block w-full" aria-hidden="true">
          <rect x="3" y="7" width="40" height="16" rx="8" fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.4} />
          <g fill="currentColor">
            <circle cx="13" cy="5.5" r="1.4" /><circle cx="23" cy="5.5" r="1.4" /><circle cx="33" cy="5.5" r="1.4" />
            <circle cx="13" cy="24.5" r="1.4" /><circle cx="23" cy="24.5" r="1.4" /><circle cx="33" cy="24.5" r="1.4" />
          </g>
        </svg>
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold leading-none">
        {number ?? "?"}
      </span>
    </div>
  );
}
