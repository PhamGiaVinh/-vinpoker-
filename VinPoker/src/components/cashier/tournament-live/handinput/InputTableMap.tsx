// Operator table picker for Hand Input. A grid of poker-table "logo" tiles (the
// same top-view felt-oval icon the spectator map uses) so the operator sees every
// table at a glance and taps one to start recording. Unlike the spectator
// LiveTablesMap this ALWAYS renders — even for a single table — because the
// operator still needs an explicit entry point. Presentational only: data is
// passed in (no queries here), tapping calls onSelect. Hardcoded Vietnamese to
// match the rest of the operator-only HandInputPanel.

export interface InputTableSummary {
  id: string;
  name: string;
  /** Active players currently seated at this table. */
  playerCount: number;
  /** True when this table has an in-progress (unfinished) hand to resume. */
  hasLiveHand: boolean;
}

interface InputTableMapProps {
  tables: InputTableSummary[];
  activeTableId: string | null;
  onSelect: (tableId: string) => void;
}

/** Poker-table top-view "logo": felt oval + 6 seat marks + a centered label. */
function TableTileIcon({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="relative">
      <span className={active ? "text-amber-400" : "text-emerald-400/80"}>
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

export function InputTableMap({ tables, activeTableId, onSelect }: InputTableMapProps) {
  if (!tables || tables.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Chưa có bàn nào trong giải này.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-0.5">
        Chọn bàn để nhập hand
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {tables.map((tbl) => {
          const isActive = activeTableId === tbl.id;
          const num = tbl.name.match(/\d+/);
          const label = num ? num[0] : tbl.name.slice(0, 2).toUpperCase();
          return (
            <button
              key={tbl.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(tbl.id)}
              className={`rounded-xl border bg-card/60 p-2.5 text-center transition-colors ${
                isActive
                  ? "border-amber-400/70 shadow-[0_0_12px_rgba(245,179,64,0.25)]"
                  : "border-border/50 hover:border-emerald-500/40"
              }`}
            >
              <div className="mx-auto w-12">
                <TableTileIcon label={label} active={isActive} />
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-foreground">{tbl.name}</div>
              <div className="text-[11px] text-muted-foreground">{tbl.playerCount} người chơi</div>
              {tbl.hasLiveHand && (
                <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> đang có hand
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
