import { useState } from "react";
import { FEATURES } from "@/lib/featureFlags";
import { useFloorTournaments } from "./useFloorTournaments";
import type { ClubRow } from "./TournamentManagerShared";
import { DailyTournamentsBoard } from "./DailyTournamentsBoard";
import { MultiDayTournamentsBoard } from "./MultiDayTournamentsBoard";

/**
 * Floor landing — the entry point of Floor tournament management. A segmented
 * [ Giải thường | Multi-day ] over two self-contained boards (each with its own list +
 * "+ Tạo giải"). Owns the data hook ONCE and passes it to whichever board is active, so a
 * single realtime channel + readiness effect run. `onSelect` enters a tournament's
 * operational tabs.
 */
export function FloorTournamentsLanding({ clubIds, clubs, onSelect }: { clubIds: string[]; clubs: ClubRow[]; onSelect: (id: string) => void }) {
  const data = useFloorTournaments(clubIds);
  const [view, setView] = useState<"daily" | "multi">("daily");

  const multiClub = clubs.length > 1;
  const clubNameMap = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  // [P0-2] the flag gates only the "+ Tạo Multi-day" affordance (inside the board). The
  // Multi-day segment still shows whenever multi-day tours exist, so they never go invisible.
  const hasMultiTours = data.tours.some((tr) => tr.event_id != null);
  const showMulti = FEATURES.multiDayTournaments || hasMultiTours;
  const activeView = !showMulti && view === "multi" ? "daily" : view;

  const boardProps = { ...data, multiClub, clubNameMap, clubs, clubIds, onSelect };

  const segBtn = (key: "daily" | "multi", label: string) => (
    <button
      type="button"
      onClick={() => setView(key)}
      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${activeView === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex w-full gap-1 rounded-lg bg-muted/40 p-1 sm:w-fit">
        {segBtn("daily", "Giải thường")}
        {showMulti && segBtn("multi", "Multi-day")}
      </div>
      {activeView === "daily" ? <DailyTournamentsBoard {...boardProps} /> : <MultiDayTournamentsBoard {...boardProps} />}
    </div>
  );
}
