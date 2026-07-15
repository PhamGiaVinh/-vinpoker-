import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, User, Search, Users } from "lucide-react";
import { formatVND } from "@/lib/format";
import type { Tournament } from "@/types/tournament";
import { PlayerActionSheet, type ActionSeat } from "./PlayerActionSheet";
import { MovePlayerDialog } from "./MovePlayerDialog";
import { EditChipsDialog } from "./EditChipsDialog";
import { PlayerInfoSheet } from "./PlayerInfoSheet";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { getFloorOperatorClubIds } from "@/lib/floorOperatorAccess";
import { floorOpsErrorMessage, floorOpsResponseErrorCode } from "@/lib/floorOpsErrors";

interface SeatRow {
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

interface EntryRow {
  id: string;
  player_id: string;
  player_name: string;
  current_stack: number;
  seat_number: number | null;
  finished_place: number | null;
  status: string;
}

type GroupKey = "playing" | "waiting" | "bust";

/**
 * Kholdem-style 3-group players panel: Đang chơi / Chờ xếp / Bust, each with a
 * count badge + search + sort-by-chips. "Đang chơi" reuses the proven get_seats
 * path (works for any tournament); "Chờ xếp"/"Bust" read tournament_entries
 * (registered / busted). Tap a playing row → action sheet (Chuyển / Sửa chip /
 * Phiếu / Loại). All actions reuse existing backend.
 */
export function PlayersGroupedPanel({
  tournament,
  refreshTrigger,
}: {
  tournament: Tournament;
  refreshTrigger: number;
}) {
  const { user } = useAuth();
  const tid = tournament.id;
  const [seats, setSeats] = useState<SeatRow[] | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [entryBySeat, setEntryBySeat] = useState<Record<string, string>>({});
  const [canMove, setCanMove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [group, setGroup] = useState<GroupKey>("playing");
  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<SeatRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<SeatRow | null>(null);
  const [editTarget, setEditTarget] = useState<SeatRow | null>(null);
  const [infoTarget, setInfoTarget] = useState<SeatRow | null>(null);
  const [receipt, setReceipt] = useState<SeatReceiptData | null>(null);
  const [busting, setBusting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) { setCanMove(false); return; }
      const ids = await getFloorOperatorClubIds(user.id).catch(() => []);
      if (!alive) return;
      setCanMove(ids.includes(tournament.club_id));
    })();
    return () => { alive = false; };
  }, [user, tournament.club_id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [seatsRes, linksRes, entriesRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tid, action: "get_seats" } }),
        supabase.from("tournament_seats").select("id, entry_id").eq("tournament_id", tid),
        supabase
          .from("tournament_entries")
          .select("id, player_id, current_stack, seat_number, finished_place, status")
          .eq("tournament_id", tid),
      ]);
      const loaded: SeatRow[] = (seatsRes.data?.data ?? []) as SeatRow[];
      setSeats(loaded.filter((s) => s.is_active).sort((a, b) => b.chip_count - a.chip_count));
      const m: Record<string, string> = {};
      for (const r of (linksRes.data ?? []) as { id: string; entry_id: string | null }[]) if (r.entry_id) m[r.id] = r.entry_id;
      setEntryBySeat(m);
      const allEntries = entriesRes.data ?? [];
      setEntries(allEntries.map((e) => ({
        id: e.id,
        player_id: e.player_id,
        player_name: e.player_id.slice(0, 8),
        current_stack: e.current_stack ?? 0,
        seat_number: e.seat_number ?? null,
        finished_place: e.finished_place ?? null,
        status: e.status,
      })));
    } finally {
      setLoading(false);
    }
  }, [tid]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const waiting = useMemo(
    () => entries.filter((entry) => entry.status === "registered"),
    [entries],
  );
  const bust = useMemo(
    () => entries
      .filter((entry) => entry.status === "busted")
      .sort((a, b) => (a.finished_place ?? 1e9) - (b.finished_place ?? 1e9)),
    [entries],
  );

  const counts = { playing: seats?.length ?? 0, waiting: waiting.length, bust: bust.length };

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (value: string) =>
    !normalizedQuery || value.toLowerCase().includes(normalizedQuery);
  const visiblePlaying = (seats ?? []).filter((seat) =>
    matchesQuery(seat.player_name || seat.player_id) || matchesQuery(seat.table_name));

  const bustSeat = async (target: SeatRow | null) => {
    if (!target) return;
    setBusting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tid,
          action: "update_seats",
          seats: [{
            seat_id: target.seat_id,
            player_id: target.player_id,
            entry_number: target.entry_number,
            table_id: target.table_id,
            seat_number: target.seat_number,
            chip_count: target.chip_count,
            is_active: false,
            player_name: target.player_name,
          }],
        },
      });
      const responseError = floorOpsResponseErrorCode(data);
      if (error || responseError) { toast.error(floorOpsErrorMessage(responseError, error?.message)); return; }
      toast.success(`Đã loại ${target.player_name || "người chơi"}`);
      setSelected(null);
      setInfoTarget(null);
      load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Lỗi");
    } finally {
      setBusting(false);
    }
  };

  const openReceipt = (target: SeatRow | null) => {
    if (!target) return;
    setReceipt({
      tournamentName: tournament.name,
      tournamentDate: (tournament as Tournament & { start_time?: string | null }).start_time ?? null,
      playerName: target.player_name || target.player_id.slice(0, 8),
      tableNumber: null,
      seatNumber: target.seat_number,
      receiptCode: entryBySeat[target.seat_id] ?? target.seat_id,
      startingStack: target.chip_count,
      qrValue: entryBySeat[target.seat_id] ?? target.seat_id,
    });
  };

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" /> Người chơi
        </div>
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([
          ["playing", "Đang chơi", counts.playing, "text-primary border-primary/45 bg-primary/10"],
          ["waiting", "Chờ xếp", counts.waiting, "text-warning border-warning/45 bg-warning/10"],
          ["bust", "Bust", counts.bust, "text-destructive border-destructive/45 bg-destructive/10"],
        ] as [GroupKey, string, number, string][]).map(([k, label, n, active]) => (
          <button
            key={k}
            onClick={() => setGroup(k)}
            className={`rounded-lg border px-2 py-2 text-sm ${group === k ? active : "border-border bg-card text-muted-foreground"}`}
          >
            {label} <span className="ml-1 rounded-full bg-background/40 px-1.5 text-xs">{n}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Tìm tên / bàn…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {seats === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : group === "playing" ? (
        visiblePlaying.length === 0 ? (
          <Empty text="Chưa có người chơi đang hoạt động." />
        ) : (
          <div className="space-y-1.5">
            {visiblePlaying.map((s, idx) => (
              <button
                key={s.seat_id}
                onClick={() => setSelected(s)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-primary/50"
              >
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                <Avatar name={s.player_name || s.player_id} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.player_name || s.player_id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{s.table_name} · Ghế {s.seat_number}{s.entry_number > 1 ? ` · R#${s.entry_number}` : ""}</div>
                </div>
                <div className="shrink-0 text-right font-mono text-sm text-primary">{formatVND(s.chip_count)}</div>
              </button>
            ))}
          </div>
        )
      ) : group === "waiting" ? (
        waiting.filter((e) => matchesQuery(e.player_name || e.player_id)).length === 0 ? (
          <Empty text="Không có người chờ xếp bàn." />
        ) : (
          <div className="space-y-1.5">
            {waiting.filter((e) => matchesQuery(e.player_name || e.player_id)).map((e, idx) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
                <Avatar name={e.player_name || e.player_id} tone="warning" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.player_name || e.player_id.slice(0, 8)}</div>
                  <div className="text-xs text-warning">Chờ xếp bàn</div>
                </div>
                <div className="shrink-0 text-right font-mono text-xs text-muted-foreground">{formatVND(e.current_stack)}</div>
              </div>
            ))}
          </div>
        )
      ) : (
        bust.filter((e) => matchesQuery(e.player_name || e.player_id)).length === 0 ? (
          <Empty text="Chưa có người bị loại." />
        ) : (
          <div className="space-y-1.5">
            {bust.filter((e) => matchesQuery(e.player_name || e.player_id)).map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2 opacity-80">
                <span className="w-7 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{e.finished_place ? `#${e.finished_place}` : "—"}</span>
                <Avatar name={e.player_name || e.player_id} tone="muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium line-through decoration-muted-foreground/40">{e.player_name || e.player_id.slice(0, 8)}</div>
                  <div className="text-xs text-destructive">Đã loại</div>
                </div>
              </div>
            ))}
          </div>
        )
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
        onBust={() => bustSeat(selected)}
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
        onBust={() => bustSeat(infoTarget)}
      />

      {moveTarget && entryBySeat[moveTarget.seat_id] && (
        <MovePlayerDialog
          open={moveTarget !== null}
          onOpenChange={(v) => { if (!v) setMoveTarget(null); }}
          tournamentId={tid}
          entryId={entryBySeat[moveTarget.seat_id]}
          playerName={moveTarget.player_name || moveTarget.player_id.slice(0, 8)}
          currentTournamentTableId={null}
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

function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{text}</div>;
}

function Avatar({ name, tone = "primary" }: { name: string; tone?: "primary" | "warning" | "muted" }) {
  const parts = name.trim().split(" ");
  const ini = ((parts[0]?.[0] ?? "?") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
  const cls = tone === "warning" ? "bg-warning/15 text-warning" : tone === "muted" ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary";
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium ${cls}`}>
      {ini || <User className="h-4 w-4" />}
    </span>
  );
}
