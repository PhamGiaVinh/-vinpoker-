import { useEffect } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { NewTournamentDialog, TournamentCard } from "./TournamentManagerShared";
import { BulkScheduleDialog } from "./BulkScheduleDialog";
import type { FloorBoardProps } from "./useFloorTournaments";
import { BoardEmpty, BoardError } from "./floorBoardStates";

/**
 * "Giải thường" board — single-day tournaments. Partition is the exact complement of the
 * Multi-day board: a tour belongs here when it has no `event_id` [P0-1]. (We do NOT also
 * require `phase == null`, so an orphan `event_id==null && phase!=null` row still renders
 * here and never vanishes from Floor.)
 */
export function DailyTournamentsBoard(p: FloorBoardProps) {
  const daily = p.tours.filter((tr) => tr.event_id == null);

  // Observability: an orphan phase row (shouldn't exist, the create RPC always sets both)
  // would surface here — warn so it's visible rather than silent. [P0-1]
  useEffect(() => {
    const orphans = daily.filter((tr) => tr.phase != null);
    if (orphans.length) console.warn("[Floor] Daily board has rows with phase but no event_id:", orphans.map((o) => o.id));
  }, [daily]);

  const createBtn = p.clubIds.length > 0
    ? <NewTournamentDialog clubs={p.clubs} defaultClubId={p.clubIds[0]} multiClub={p.multiClub} onCreated={p.reload} lockMode="single" />
    : null;
  const bulkBtn = p.clubIds.length > 0
    ? <BulkScheduleDialog clubs={p.clubs} defaultClubId={p.clubIds[0]} multiClub={p.multiClub} onCreated={p.reload} />
    : null;
  const actions = <div className="flex flex-wrap items-center gap-2">{bulkBtn}{createBtn}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">Giải thường <span className="text-muted-foreground">({daily.length})</span></span>
        {actions}
      </div>
      {p.loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : p.error ? (
        <BoardError onRetry={p.reload} />
      ) : daily.length === 0 ? (
        <BoardEmpty icon={<CalendarPlus className="w-8 h-8" />} title="Chưa có giải thường nào" sub="Tạo từng giải, hoặc tạo hàng loạt từ ảnh lịch." create={actions} />
      ) : (
        <div className="max-h-[58vh] overflow-y-auto space-y-2 pr-1">
          {daily.map((tr) => (
            <TournamentCard
              key={tr.id}
              tour={tr}
              flightMeta={p.flightMeta[tr.id]}
              finalMeta={p.finalMeta[tr.id]}
              multiClub={p.multiClub}
              clubName={p.clubNameMap[tr.club_id]}
              reload={p.reload}
              onDelete={p.deleteTour}
              onSetStatus={p.setTourStatus}
              onStart={p.startTournament}
              onSelect={p.onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
