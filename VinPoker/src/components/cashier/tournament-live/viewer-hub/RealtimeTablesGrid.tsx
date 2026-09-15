import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, Radio, Search, Users } from "lucide-react";
import { formatStack } from "@/lib/format";
import type { PublicFreshness, PublicTableCatalogItem, PublicTableSnapshot } from "./publicSnapshotTypes";

const PAGE_SIZE = 6;

function MiniTable({ table }: { table: PublicTableSnapshot }) {
  const playersBySeat = new Map(table.players.slice(0, 9).map((player) => [player.seatNumber, player]));
  const latestActor = table.latestAction ? table.players.find((player) => player.playerId === table.latestAction?.playerId && player.entryNumber === table.latestAction.entryNumber) : null;
  return (
    <div className="relative mx-auto aspect-[1.9/1] w-full max-w-[34rem] rounded-[46%] border border-amber-400/55 bg-[radial-gradient(circle_at_50%_45%,#174b39,#0b2b22_70%)] shadow-[inset_0_0_0_5px_rgba(0,0,0,.34),0_18px_45px_rgba(0,0,0,.2)]">
      <div className="absolute inset-[27%_22%] flex flex-col items-center justify-center text-center">
        <span className="tracker-num text-sm font-black text-amber-200">{table.pot == null || !table.bigBlind ? "Chưa có dữ liệu" : `POT ${(table.pot / table.bigBlind).toFixed(1).replace(/\.0$/, "")} BB`}</span>
        {table.board && table.board.length > 0 && <span className="mt-1 flex justify-center gap-0.5">{table.board.map((card) => <img key={card} src={`/cards/four-color/${card}.svg`} alt={card} className="h-8 w-[1.45rem] rounded-[3px] object-cover shadow" />)}</span>}
        {table.latestAction && <span className="mt-1 max-w-full truncate rounded-full bg-black/70 px-2 py-0.5 text-[8px] font-bold uppercase text-emerald-300">{latestActor?.name ?? "Người chơi"} · {table.latestAction.actionType}</span>}
      </div>
      {Array.from({ length: 9 }, (_, index) => {
        const seatNumber = index + 1;
        const player = playersBySeat.get(seatNumber);
        const angle = (Math.PI * 2 * index) / 9 - Math.PI / 2;
        const left = 50 + Math.cos(angle) * 45;
        const top = 50 + Math.sin(angle) * 43;
        if (!player) return <span key={seatNumber} className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-dashed border-amber-300/35 bg-black/55 text-[8px] text-amber-100/60" style={{ left: `${left}%`, top: `${top}%` }}>{seatNumber}</span>;
        return <div key={`${player.playerId}:${player.entryNumber}`} className="absolute w-[5.2rem] -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${left}%`, top: `${top}%` }}>
          <div className="relative mx-auto flex h-8 w-8 items-center justify-center overflow-visible rounded-full border border-amber-300/80 bg-zinc-900 text-[10px] font-black text-white">
            {player.avatarUrl ? <img src={player.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" /> : player.name.slice(0, 2).toUpperCase()}
            {table.buttonSeat === player.seatNumber ? <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-300 px-0.5 text-[7px] font-black text-black">D</span> : null}
          </div>
          <div className="mt-0.5 truncate rounded-md border border-amber-400/35 bg-black/75 px-1 py-0.5 text-[9px] font-bold text-white">{player.name}</div>
          <div className="tracker-num text-[9px] font-bold text-emerald-300">{player.stack == null ? "—" : table.bigBlind ? `${(player.stack / table.bigBlind).toFixed(1).replace(/\.0$/, "")} BB` : formatStack(player.stack)}</div>
        </div>;
      })}
    </div>
  );
}

export function RealtimeTablesGrid({ catalog, tables, freshness, onVisibleTableIds, onView, onHistory }: { catalog: PublicTableCatalogItem[]; tables: PublicTableSnapshot[]; freshness?: PublicFreshness; onVisibleTableIds: (ids: string[]) => void; onView: (id: string) => void; onHistory: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    if (!needle) return catalog;
    return catalog.filter((table) => table.name.toLocaleLowerCase("vi").includes(needle) || table.searchPlayers.some((name) => name.toLocaleLowerCase("vi").includes(needle)));
  }, [catalog, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleCatalog = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const tableById = useMemo(() => new Map(tables.map((table) => [table.tableId, table])), [tables]);
  useEffect(() => setPage(0), [query]);
  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);
  const visibleKey = visibleCatalog.map((table) => table.tableId).join(":");
  useEffect(() => {
    onVisibleTableIds(visibleKey ? visibleKey.split(":") : []);
  }, [onVisibleTableIds, visibleKey]);
  return <section className="min-w-0 space-y-3" aria-label="Bàn trực tiếp">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[hsl(var(--viewer-neon))]">Tables live</p><h2 className="text-xl font-black">Bàn trực tiếp</h2></div>
      <label className="flex min-h-11 min-w-[15rem] flex-1 items-center gap-2 rounded-xl border border-border/60 bg-card/55 px-3 sm:max-w-sm"><Search className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Tìm bàn hoặc người chơi</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm bàn hoặc người chơi" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" /></label>
    </div>
    {freshness?.state !== "current" && <p className="text-xs text-amber-400">Dữ liệu bàn đang cập nhật{freshness?.oldestPendingAt ? ` từ ${new Date(freshness.oldestPendingAt).toLocaleTimeString("vi-VN")}` : ""}.</p>}
    {filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-border/55 py-14 text-center text-sm text-muted-foreground">Không tìm thấy bàn phù hợp</div> : <div className="grid gap-4 min-[1200px]:grid-cols-2">
      {visibleCatalog.map((summary) => {
        const table = tableById.get(summary.tableId);
        return <article key={summary.tableId} className="min-w-0 rounded-2xl border border-border/55 bg-card/55 p-3 sm:p-4">
        <header className="mb-3 flex items-center justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-lg font-black">{summary.name}</h3><p className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" />{summary.playerCount} người chơi {table?.trackerState === "live" && <span className="inline-flex items-center gap-1 text-emerald-400"><Radio className="h-3 w-3" /> LIVE</span>}</p></div><button type="button" onClick={() => onHistory(summary.tableId)} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border/60 px-3 text-xs font-bold"><History className="h-4 w-4" /> Lịch sử</button></header>
        {table ? <button type="button" onClick={() => onView(table.tableId)} className="block min-h-11 w-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--viewer-neon))]" aria-label={`Xem ${table.name}`}><MiniTable table={table} /></button> : <div className="flex aspect-[1.9/1] items-center justify-center rounded-[46%] border border-dashed border-border/60 text-xs text-muted-foreground">Đang tải dữ liệu bàn…</div>}
      </article>;
      })}
    </div>}
    {pageCount > 1 && <div className="flex items-center justify-center gap-3"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border/60 disabled:opacity-40" aria-label="Trang bàn trước"><ChevronLeft className="h-4 w-4" /></button><span className="tracker-num text-xs text-muted-foreground">{page + 1} / {pageCount}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border/60 disabled:opacity-40" aria-label="Trang bàn tiếp theo"><ChevronRight className="h-4 w-4" /></button></div>}
  </section>;
}
