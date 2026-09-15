import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { TournamentRedrawTvBatch } from "@/hooks/useTournamentRedrawTv";

const TV_REDRAW_PAGE_SIZE = 18;
const TV_REDRAW_PAGE_MS = 12_000;

export function TvRedrawScreen({ tournamentName, batch }: { tournamentName: string; batch: TournamentRedrawTvBatch }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(batch.moves.length / TV_REDRAW_PAGE_SIZE));
  const visibleMoves = useMemo(
    () => batch.moves.slice(page * TV_REDRAW_PAGE_SIZE, (page + 1) * TV_REDRAW_PAGE_SIZE),
    [batch.moves, page],
  );

  useEffect(() => { setPage(0); }, [batch.batchId]);
  useEffect(() => {
    if (pages <= 1) return;
    const timer = window.setInterval(() => setPage((current) => (current + 1) % pages), TV_REDRAW_PAGE_MS);
    return () => window.clearInterval(timer);
  }, [pages]);

  return (
    <main className="flex h-full min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#14372f_0%,#07110f_48%,#030706_100%)] px-[4vmin] py-[3vmin] text-[#f7f2e8]">
      <header className="flex items-end justify-between gap-[3vmin] border-b border-emerald-300/20 pb-[2vmin]">
        <div className="min-w-0">
          <div className="text-[1.7vmin] font-semibold uppercase tracking-[0.26em] text-emerald-300">VinPoker · Redraw đã áp dụng</div>
          <h1 className="mt-[0.7vmin] truncate text-[4.5vmin] font-black tracking-[-0.03em]">{tournamentName}</h1>
        </div>
        <div className="shrink-0 rounded-full border border-[#c9a86a]/40 bg-[#c9a86a]/12 px-[2vmin] py-[0.8vmin] text-[2vmin] font-bold text-[#f0d69a]">{batch.targetMaxSeats}-MAX</div>
      </header>

      <section className="mt-[2vmin] min-h-0 flex-1 overflow-hidden rounded-[2vmin] border border-white/10 bg-black/25">
        <div className="grid h-full auto-rows-fr grid-cols-2 gap-px bg-white/10 xl:grid-cols-3">
          {visibleMoves.map((move) => (
            <article key={move.ordinal} className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-[1.5vmin] bg-[#07100e] px-[2vmin] py-[1.2vmin]">
              <div className="min-w-0">
                <div className="truncate text-[2.15vmin] font-bold">{move.playerName}</div>
                <div className="mt-[0.45vmin] flex items-center gap-[0.8vmin] text-[1.55vmin]">
                  <span className="text-white/40 line-through">Bàn {move.fromTableNumber} · Ghế {move.fromSeatNumber}</span>
                  <ArrowRight className="h-[1.8vmin] w-[1.8vmin] text-[#c9a86a]" />
                  <span className="font-black text-emerald-300">Bàn {move.toTableNumber} · Ghế {move.toSeatNumber}</span>
                </div>
              </div>
              <div className="grid h-[4.3vmin] w-[4.3vmin] place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-[1.8vmin] font-black text-emerald-200">{move.toSeatNumber}</div>
            </article>
          ))}
        </div>
      </section>
      <footer className="flex items-center justify-between gap-[2vmin] pt-[1.4vmin] text-[1.45vmin] text-white/45">
        <span>Vui lòng di chuyển tới bàn và ghế mới · danh sách được cập nhật trực tiếp từ Floor</span>
        {pages > 1 && <span className="shrink-0 font-mono text-[#f0d69a]">Trang {page + 1}/{pages}</span>}
      </footer>
    </main>
  );
}
