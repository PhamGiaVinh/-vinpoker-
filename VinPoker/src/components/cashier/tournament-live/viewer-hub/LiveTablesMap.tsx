// Public "Live Poker Event Hub" table-map picker (Viewer Event Hub). A grid of
// poker-table "logo" tiles (the same top-view table icon the Floor map uses) so a
// spectator gets an overview of every live table and taps one to feature it.
// Presentational only — data is HubTableSummary from useLiveTrackerData; tapping
// calls onSelect, which LiveHub feeds into TournamentLiveView's
// selectedTableIdOverride. No operator actions, no auth, no extra queries.

import { useTranslation } from "react-i18next";
import type { HubTableSummary } from "./hubDerive";

export interface LiveTablesMapProps {
  tables: HubTableSummary[];
  /** Currently-featured table (highlighted). */
  activeTableId?: string | null;
  onSelect: (tableId: string) => void;
  /** Min tables before the picker shows (default 2 — single table needs no picker).
   *  The event-tabs "Bàn đang chơi" card passes 1 so a single live table is tappable. */
  minToShow?: number;
  /** Section heading override (default "Chọn bàn xem trực tiếp"). */
  title?: string;
}

/** Poker-table top-view "logo": felt oval + 6 seat marks + a centered label. */
function TableTileIcon({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="relative">
      <span className={active ? "text-warning" : "text-emerald-400/80"}>
        <svg viewBox="0 0 46 30" className="block w-full" aria-hidden="true">
          <rect x="3" y="7" width="40" height="16" rx="8" fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.4} />
          <g fill="currentColor">
            <circle cx="13" cy="5.5" r="1.4" /><circle cx="23" cy="5.5" r="1.4" /><circle cx="33" cy="5.5" r="1.4" />
            <circle cx="13" cy="24.5" r="1.4" /><circle cx="23" cy="24.5" r="1.4" /><circle cx="33" cy="24.5" r="1.4" />
          </g>
        </svg>
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold leading-none text-foreground">
        {label}
      </span>
    </div>
  );
}

export function LiveTablesMap({ tables, activeTableId, onSelect, minToShow = 2, title }: LiveTablesMapProps) {
  const { t } = useTranslation();
  if (!tables || tables.length < minToShow) return null; // below threshold → no picker

  return (
    <div className="space-y-1.5">
      <div className="tracker-display text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        {title ?? t("liveHub.map.title", "Chọn bàn xem trực tiếp")}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {tables.map((tbl) => {
          const isActive = activeTableId === tbl.tableId;
          const num = tbl.name.match(/\d+/);
          const label = num ? num[0] : tbl.name.slice(0, 2).toUpperCase();
          return (
            <button
              key={tbl.tableId}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(tbl.tableId)}
              className={`rounded-xl border bg-card/60 p-2.5 text-center transition-colors ${
                isActive
                  ? "border-warning/70 shadow-[0_0_12px_rgba(245,179,64,0.25)]"
                  : "border-border/50 hover:border-emerald-500/40"
              }`}
            >
              <div className="mx-auto w-12">
                <TableTileIcon label={label} active={isActive} />
              </div>
              <div className="mt-1 flex items-center justify-center gap-1">
                <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
                <span className="truncate text-xs font-semibold text-foreground">{tbl.name}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("liveHub.tables.players", "{{count}} người chơi", { count: tbl.playerCount })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
