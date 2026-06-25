import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight, CalendarPlus, Loader2 } from "lucide-react";
import { useFloorTournaments } from "./useFloorTournaments";
import { NewTournamentDialog, TournamentCard, type ClubRow } from "./TournamentManagerShared";

/**
 * Floor — tournament list management (legacy single-panel view). Data + dialogs are shared
 * with the new Daily/Multi-day boards (useFloorTournaments + TournamentManagerShared); this
 * panel is the parity reference during the Floor split rollout (removed in the final patch).
 * Frontend-only: plain `tournaments` CRUD scoped to the operator's clubs.
 */
export function TournamentManagerPanel({ clubIds, clubs, embedded = false }: { clubIds: string[]; clubs: ClubRow[]; embedded?: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const { tours, loading, flightMeta, finalMeta, reload, deleteTour, setTourStatus, startTournament } = useFloorTournaments(clubIds);

  const clubNameMap = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const multiClub = clubs.length > 1;

  return (
    <Card className={embedded ? "border-0 bg-transparent shadow-none" : "mb-4 border-primary/20"}>
      {!embedded && (
        <div className="flex items-center justify-between gap-2 p-3">
          <button type="button" onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 min-w-0 text-left">
            {expanded
              ? <ChevronDown className="w-4 h-4 text-primary shrink-0" />
              : <ChevronRight className="w-4 h-4 text-primary shrink-0" />}
            <CalendarPlus className="w-4 h-4 text-primary shrink-0" />
            <span className="font-display text-primary truncate">Quản lý giải đấu</span>
            <span className="text-xs text-muted-foreground">({tours.length})</span>
          </button>
          {clubIds.length > 0 && (
            <NewTournamentDialog clubs={clubs} defaultClubId={clubIds[0]} multiClub={multiClub} onCreated={reload} />
          )}
        </div>
      )}

      {(embedded || expanded) && (
        <div className={embedded ? "" : "px-3 pb-3"}>
          {embedded && clubIds.length > 0 && (
            <div className="flex justify-end mb-3">
              <NewTournamentDialog clubs={clubs} defaultClubId={clubIds[0]} multiClub={multiClub} onCreated={reload} />
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : tours.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("clubAdmin.noTournaments")}</p>
          ) : (
            <div className="max-h-[42vh] overflow-y-auto space-y-2 pr-1">
              {tours.map((t2) => (
                <TournamentCard
                  key={t2.id}
                  tour={t2}
                  flightMeta={flightMeta[t2.id]}
                  finalMeta={finalMeta[t2.id]}
                  multiClub={multiClub}
                  clubName={clubNameMap[t2.club_id]}
                  reload={reload}
                  onDelete={deleteTour}
                  onSetStatus={setTourStatus}
                  onStart={startTournament}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
