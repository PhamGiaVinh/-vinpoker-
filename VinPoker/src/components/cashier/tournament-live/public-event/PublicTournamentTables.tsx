import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Search, UsersRound } from "lucide-react";
import { fmtCompact } from "../viewer-hub/hubDerive";
import type { PublicTable } from "./publicTournamentEvent";

interface PublicTournamentTablesProps {
  tables: PublicTable[];
}

export function PublicTournamentTables({ tables }: PublicTournamentTablesProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(tables[0]?.id ?? null);
  const [expandedId, setExpandedId] = useState<string | null>(tables[0]?.id ?? null);

  useEffect(() => {
    if (selectedId && tables.some((table) => table.id === selectedId)) return;
    setSelectedId(tables[0]?.id ?? null);
  }, [selectedId, tables]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    if (!needle) return tables;
    return tables.filter((table) =>
      table.label.toLocaleLowerCase("vi").includes(needle)
      || table.seats.some((seat) => seat.playerName?.toLocaleLowerCase("vi").includes(needle)),
    );
  }, [query, tables]);
  const selected = tables.find((table) => table.id === selectedId) ?? null;

  if (tables.length === 0) {
    return (
      <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.025] px-5 py-16 text-center">
        <UsersRound className="mx-auto h-8 w-8 text-slate-600" aria-hidden="true" />
        <h2 className="mt-4 font-bold text-white">Chưa có bàn đang chạy</h2>
        <p className="mt-1 text-sm text-slate-400">Bàn sẽ xuất hiện khi Floor mở bàn cho giải.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="public-tables-title" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">Tournament floor</div>
          <h2 id="public-tables-title" className="mt-1 text-2xl font-black text-white">Bàn đang chạy</h2>
        </div>
        <div className="text-sm text-slate-400">{tables.length} bàn · {tables.reduce((sum, table) => sum + occupiedCount(table), 0)} người chơi</div>
      </div>

      <label className="relative mb-4 block lg:hidden">
        <span className="sr-only">Tìm bàn hoặc người chơi</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm bàn hoặc người chơi"
          className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-emerald-400"
        />
      </label>

      <div className="space-y-3 lg:hidden">
        {filtered.map((table) => {
          const expanded = expandedId === table.id;
          return (
            <article key={table.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#09100d]">
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : table.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-black text-white">{table.label}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                    Đang chạy
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <strong className="tabular-nums text-slate-200">{occupiedCount(table)}/9</strong>
                  <ChevronDown className={`h-5 w-5 text-slate-500 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                </span>
              </button>
              {expanded && <PublicSeatRoster table={table} />}
            </article>
          );
        })}
      </div>

      <div className="hidden min-h-[560px] grid-cols-[minmax(250px,0.7fr)_minmax(0,1.5fr)] overflow-hidden rounded-3xl border border-white/10 bg-[#07100c] lg:grid">
        <aside className="border-r border-white/10 bg-black/20 p-4">
          <label className="relative block">
            <span className="sr-only">Tìm bàn hoặc người chơi</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm bàn hoặc người chơi"
              className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-3 text-sm text-white outline-none placeholder:text-slate-600 focus-visible:ring-2 focus-visible:ring-emerald-400"
            />
          </label>
          <div className="mt-4 space-y-2">
            {filtered.map((table) => (
              <button
                type="button"
                key={table.id}
                onClick={() => setSelectedId(table.id)}
                aria-pressed={selectedId === table.id}
                className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${selectedId === table.id ? "border-emerald-400/45 bg-emerald-400/10" : "border-transparent bg-white/[0.025] hover:bg-white/[0.05]"}`}
              >
                <span>
                  <span className="block font-bold text-white">{table.label}</span>
                  <span className="text-xs text-emerald-300">● Đang chạy</span>
                </span>
                <strong className="tabular-nums text-slate-300">{occupiedCount(table)}/9</strong>
              </button>
            ))}
          </div>
        </aside>
        <div className="min-w-0 p-5 xl:p-7">
          {selected ? (
            <>
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black text-white">{selected.label}</h3>
                  <p className="mt-1 text-sm text-slate-400">Danh sách đủ 9 ghế · cập nhật từ Floor</p>
                </div>
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-200">
                  {occupiedCount(selected)}/9 ghế
                </div>
              </div>
              <PublicSeatRoster table={selected} desktop />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PublicSeatRoster({ table, desktop = false }: { table: PublicTable; desktop?: boolean }) {
  if (table.dataQuality === "inconsistent") {
    return (
      <div role="status" className="flex min-h-36 items-center gap-3 border-t border-amber-300/15 bg-amber-300/[0.06] px-4 py-5 text-sm text-amber-100 lg:rounded-2xl lg:border">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        Dữ liệu ghế chưa nhất quán. Danh sách được khóa thay vì hiển thị sai người chơi.
      </div>
    );
  }

  return (
    <ol className={`${desktop ? "overflow-hidden rounded-2xl border border-white/10" : "border-t border-white/10"}`}>
      {table.seats.map((seat) => (
        <li key={seat.seatNumber} className="grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.07] px-4 py-2.5 last:border-b-0">
          <span className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-xs font-bold tabular-nums text-slate-400">
            {seat.seatNumber}
          </span>
          {seat.playerName ? (
            <span className="min-w-0 truncate font-semibold text-slate-100">{seat.playerName}</span>
          ) : (
            <span className="italic text-slate-600">Empty</span>
          )}
          <span className="whitespace-nowrap font-mono text-sm tabular-nums text-amber-200">
            {seat.chipCount == null ? "" : fmtCompact(seat.chipCount)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function occupiedCount(table: PublicTable): number {
  return table.seats.filter((seat) => seat.playerName != null).length;
}
