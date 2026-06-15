// All-tables preview strip (Viewer Event Hub — Increment B). Horizontal-scroll
// mini cards for every live table in the tournament. Presentational only.

import type { HubTableSummary } from "./hubDerive";

export interface LiveTablesStripProps {
  tables: HubTableSummary[];
  /** Optional: highlight the table currently featured. */
  activeTableId?: string | null;
}

export function LiveTablesStrip({ tables, activeTableId }: LiveTablesStripProps) {
  if (!tables || tables.length <= 1) return null; // single table → no strip needed
  return (
    <div className="space-y-1.5">
      <div className="tracker-display text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        Các bàn trực tiếp
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tables.map((t) => {
          const isActive = activeTableId === t.tableId;
          return (
            <div
              key={t.tableId}
              className={`shrink-0 w-28 rounded-xl border p-2.5 bg-card/60 ${
                isActive ? "border-warning/70 shadow-[0_0_12px_rgba(245,179,64,0.25)]" : "border-border/50"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-foreground truncate">{t.name}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t.playerCount} người chơi
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
