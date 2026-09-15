import { Loader2, Trophy } from "lucide-react";
import { formatStack } from "@/lib/format";
import type { PublicFreshness, PublicPayoutRow } from "./publicSnapshotTypes";

export function RealtimePayoutPanel({ rows, freshness, loading, published }: { rows: PublicPayoutRow[]; freshness?: PublicFreshness; loading: boolean; published: boolean }) {
  if (loading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!published || rows.length === 0) return <div className="rounded-2xl border border-border/55 bg-card/45 py-12 text-center text-sm text-muted-foreground">Chưa công bố cơ cấu</div>;
  return (
    <section className="overflow-hidden rounded-2xl border border-border/55 bg-card/55" aria-label="Cơ cấu giải thưởng">
      {freshness?.state !== "current" && <p className="border-b border-border/40 px-4 py-2 text-xs text-amber-400">Dữ liệu giải thưởng đang cập nhật</p>}
      <div className="grid min-h-11 grid-cols-[5rem_minmax(0,1fr)_auto] items-center bg-card/70 px-4 text-[11px] font-bold uppercase tracking-wider text-muted-foreground"><span>Hạng</span><span>Người chơi</span><span>Giải mỗi người</span></div>
      <div className="divide-y divide-border/35">
        {rows.map((row) => <div key={`${row.fromPlace}:${row.toPlace}`} className="grid min-h-13 grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-2 px-4 text-sm">
          <span className="inline-flex items-center gap-1 font-bold">{row.fromPlace <= 3 && <Trophy className="h-3.5 w-3.5 text-amber-400" />}{row.fromPlace === row.toPlace ? `#${row.fromPlace}` : `#${row.fromPlace}–${row.toPlace}`}</span>
          <span className="truncate text-muted-foreground">{row.resultStatus === "official" ? row.playerName || "—" : "—"}</span>
          <span className="tracker-num font-extrabold text-[hsl(var(--viewer-neon))]">{formatStack(row.amountPerPlayer)}</span>
        </div>)}
      </div>
    </section>
  );
}
