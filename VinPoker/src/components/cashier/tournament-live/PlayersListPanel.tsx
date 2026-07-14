import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RefreshCw, User } from "lucide-react";
import { formatVND } from "@/lib/format";
import type { Tournament } from "@/types/tournament";
import { PlayerActionSheet, type ActionSeat } from "./PlayerActionSheet";
import { MovePlayerDialog } from "./MovePlayerDialog";
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

/**
 * Kholdem-style players list. Active players sorted by chips; tap a row → the
 * action sheet (Info / Move / Free-sit[Sắp có] / Bust). All actions reuse existing
 * backend — no new tables/RPCs.
 */
export function PlayersListPanel({
  tournament,
  refreshTrigger,
}: {
  tournament: Tournament;
  refreshTrigger: number;
}) {
  const { user } = useAuth();
  const tid = tournament.id;
  const [seats, setSeats] = useState<SeatRow[] | null>(null);
  const [entryBySeat, setEntryBySeat] = useState<Record<string, string>>({});
  const [canMove, setCanMove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SeatRow | null>(null);
  const [moveTarget, setMoveTarget] = useState<SeatRow | null>(null);
  const [busting, setBusting] = useState(false);

  // Move authorization (owner/cashier/floor of the tournament's club) — same gate as the
  // move_player_seat RPC, so we don't show a Chuyển that would be rejected.
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
      const [seatsRes, { data: links }] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tid, action: "get_seats" } }),
        supabase.from("tournament_seats").select("id, entry_id").eq("tournament_id", tid),
      ]);
      const loaded: SeatRow[] = (seatsRes.data?.data ?? []) as SeatRow[];
      setSeats(loaded.filter((s) => s.is_active).sort((a, b) => b.chip_count - a.chip_count));
      const m: Record<string, string> = {};
      for (const r of (links ?? []) as { id: string; entry_id: string | null }[]) if (r.entry_id) m[r.id] = r.entry_id;
      setEntryBySeat(m);
    } finally {
      setLoading(false);
    }
  }, [tid]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const bust = async () => {
    if (!selected) return;
    setBusting(true);
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tid,
          action: "update_seats",
          seats: [{
            seat_id: selected.seat_id,
            player_id: selected.player_id,
            entry_number: selected.entry_number,
            table_id: selected.table_id,
            seat_number: selected.seat_number,
            chip_count: selected.chip_count,
            is_active: false,
            player_name: selected.player_name,
          }],
        },
      });
      const responseError = floorOpsResponseErrorCode(data);
      if (error || responseError) { toast.error(floorOpsErrorMessage(responseError, error?.message)); return; }
      toast.success(`Đã loại ${selected.player_name || "người chơi"}`);
      setSelected(null);
      load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Lỗi");
    } finally {
      setBusting(false);
    }
  };

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          <User className="h-4 w-4" /> Người chơi
          {seats && <span className="text-xs text-muted-foreground">· {seats.length} đang chơi</span>}
        </div>
        <Button size="sm" variant="outline" className="h-9" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Làm mới
        </Button>
      </div>

      {seats === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : seats.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Chưa có người chơi đang hoạt động.</div>
      ) : (
        <div className="space-y-1.5">
          {seats.map((s, idx) => (
            <button
              key={s.seat_id}
              onClick={() => setSelected(s)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-primary/50"
            >
              <span className="w-5 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{idx + 1}</span>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.player_name || s.player_id.slice(0, 8)}</div>
                <div className="text-xs text-muted-foreground">{s.table_name} · Ghế {s.seat_number}{s.entry_number > 1 ? ` · R#${s.entry_number}` : ""}</div>
              </div>
              <div className="shrink-0 text-right font-mono text-sm text-primary">{formatVND(s.chip_count)}</div>
            </button>
          ))}
        </div>
      )}

      <PlayerActionSheet
        open={selected !== null}
        onOpenChange={(v) => { if (!v) setSelected(null); }}
        seat={selected as ActionSeat | null}
        entryId={selected ? entryBySeat[selected.seat_id] : undefined}
        canMove={canMove}
        busting={busting}
        onMove={() => { if (selected) setMoveTarget(selected); }}
        onBust={bust}
      />

      {moveTarget && entryBySeat[moveTarget.seat_id] && (
        <MovePlayerDialog
          open={moveTarget !== null}
          onOpenChange={(v) => { if (!v) setMoveTarget(null); }}
          tournamentId={tid}
          entryId={entryBySeat[moveTarget.seat_id]}
          playerName={moveTarget.player_name || moveTarget.player_id.slice(0, 8)}
          currentTournamentTableId={moveTarget.table_id}
          currentSeatNumber={moveTarget.seat_number}
          onMoved={load}
        />
      )}
    </Card>
  );
}
