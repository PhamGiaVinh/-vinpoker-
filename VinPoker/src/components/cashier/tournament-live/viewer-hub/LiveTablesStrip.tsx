// All-tables preview strip (Viewer Event Hub — Increment B). Horizontal-scroll
// mini cards for every live table in the tournament. Presentational only.

import { useTranslation } from "react-i18next";
import type { HubTableSummary } from "./hubDerive";

export interface LiveTablesStripProps {
  tables: HubTableSummary[];
  /** Optional: highlight the table currently featured. */
  activeTableId?: string | null;
}

export function LiveTablesStrip({ tables, activeTableId }: LiveTablesStripProps) {
  const { t } = useTranslation();
  if (!tables || tables.length <= 1) return null; // single table → no strip needed
  return (
    <div className="space-y-1.5">
      <div className="tracker-display text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        {t("liveHub.tables.title", "Các bàn trực tiếp")}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tables.map((tbl) => {
          const isActive = activeTableId === tbl.tableId;
          return (
            <div
              key={tbl.tableId}
              className={`shrink-0 w-28 rounded-xl border p-2.5 bg-card/60 ${
                isActive ? "border-warning/70 shadow-[0_0_12px_rgba(245,179,64,0.25)]" : "border-border/50"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-foreground truncate">{tbl.name}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("liveHub.tables.players", "{{count}} người chơi", { count: tbl.playerCount })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
