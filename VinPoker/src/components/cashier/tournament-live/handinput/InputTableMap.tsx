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
  /** trackerMultiTable — this table's in-progress hand id (for takeover). */
  lockHandId?: string | null;
  /** Display name of whoever holds the lock (null → unowned / self). */
  lockedByName?: string | null;
  /** The lock is held by SOMEONE ELSE right now (not this operator). */
  lockedByOther?: boolean;
  /** Minutes since the holder's last heartbeat (rounded). */
  lockAgeMin?: number | null;
  /** The lock is stale (past the TTL) → takeover is allowed without floor force. */
  lockStale?: boolean;
}

interface InputTableMapProps {
  tables: InputTableSummary[];
  activeTableId: string | null;
  onSelect: (tableId: string) => void;
  /** trackerMultiTable — take over a stale lock, then open the table. */
  onTakeover?: (handId: string, tableId: string) => void;
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

export function InputTableMap({ tables, activeTableId, onSelect, onTakeover }: InputTableMapProps) {
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
              {/* trackerMultiTable: who holds this table (only when someone else does). */}
              {tbl.lockedByOther && (
                <div className="mt-1 truncate text-[9px] text-muted-foreground">
                  🔒 {tbl.lockedByName || "người khác"}
                  {tbl.lockAgeMin != null ? ` · ${tbl.lockAgeMin} phút` : ""}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {/* trackerMultiTable: stale-lock takeover row (only rendered when onTakeover is
          wired AND a table has a stale lock held by someone else). */}
      {onTakeover &&
        tables
          .filter((t) => t.lockedByOther && t.lockStale && t.lockHandId)
          .map((t) => (
            <button
              key={`takeover-${t.id}`}
              type="button"
              onClick={() => onTakeover(t.lockHandId!, t.id)}
              className="flex w-full items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-[11px] text-amber-200 transition-colors hover:border-amber-400/70"
            >
              <span>
                <span className="font-semibold">{t.name}</span> — khóa bởi {t.lockedByName || "người khác"} đã{" "}
                {t.lockAgeMin ?? "?"} phút (treo)
              </span>
              <span className="ml-2 shrink-0 rounded-md bg-amber-500/30 px-2 py-1 font-bold">Tiếp quản</span>
            </button>
          ))}
    </div>
  );
}
