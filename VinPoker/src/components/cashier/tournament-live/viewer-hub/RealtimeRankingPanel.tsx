import { AlertTriangle, Loader2 } from "lucide-react";
import { formatStack } from "@/lib/format";
import type { PublicFreshness, PublicRankingRow } from "./publicSnapshotTypes";

function formatBigBlinds(chips: number, bigBlind: number | null) {
  if (!bigBlind || bigBlind <= 0) return null;
  return `${(chips / bigBlind).toFixed(1).replace(/\.0$/, "")} BB`;
}

export function RealtimeRankingPanel({ rows, bigBlind, freshness, loading }: { rows: PublicRankingRow[]; bigBlind: number | null; freshness?: PublicFreshness; loading: boolean }) {
  if (loading) return <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return (
    <section className="overflow-hidden rounded-2xl border border-border/55 bg-card/55" aria-label="Chip Ranking">
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border/45 px-4">
        <h3 className="text-sm font-extrabold uppercase tracking-[0.12em]">Chip Ranking</h3>
        {freshness?.state !== "current" && <span className="inline-flex items-center gap-1 text-xs text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />Đang cập nhật</span>}
      </header>
      {rows.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chưa có stack xác nhận</p> : (
        <ol className="divide-y divide-border/35">
          {rows.map((row, index) => <li key={`${row.playerId}:${row.entryNumber}`} className="grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-4">
            <span className="tracker-num text-sm text-muted-foreground">{index + 1}</span>
            <span className="truncate text-sm font-semibold">{row.name}</span>
            <span className="text-right">
              <span className="tracker-num block text-sm font-extrabold text-[hsl(var(--viewer-neon))]">{row.chips == null ? "—" : formatStack(row.chips)}</span>
              {row.chips != null && formatBigBlinds(row.chips, bigBlind) ? <span className="tracker-num block text-[10px] text-muted-foreground">{formatBigBlinds(row.chips, bigBlind)}</span> : null}
            </span>
          </li>)}
        </ol>
      )}
    </section>
  );
}
