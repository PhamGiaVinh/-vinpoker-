// src/components/poker/ShowdownResult.tsx
// Presentational ONLY — announces the result of a COMPLETED hand from the
// server-authoritative settlement (`PublicHandResult`). The client never evaluates
// hands or moves chips; it just reads winner / pot / refund and renders them.
// Used during the showdown "dwell" so the player always sees who won and how much
// before the next hand begins.

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy } from 'lucide-react';
import type { PublicHandResult, PublicSeatView } from '@/lib/onlinePoker/types';
import { fmtBB, fmtChips } from '@/lib/onlinePoker/sizing';

/** "12,345 (3 BB)" when bb is known, else the raw chip count. */
function chipLabel(chips: string, bb?: string): string {
  const inBB = bb ? fmtBB(chips, bb) : '';
  return inBB ? `${fmtChips(chips)} (${inBB} BB)` : fmtChips(chips);
}

export function ShowdownResult({
  result,
  handNo,
  seats,
  mySeat,
  bb,
}: {
  result: PublicHandResult;
  handNo: number;
  /** ring seats (carry displayName) — used to name the winner(s). */
  seats: PublicSeatView[];
  mySeat?: number;
  bb?: string;
}) {
  const nameOf = (seat: number): string => {
    if (seat === mySeat) return 'Bạn';
    return seats.find((s) => s.seat === seat)?.displayName ?? `Ghế ${seat}`;
  };

  const winners = Array.from(new Set(result.potAwards.flatMap((a) => a.winners)));
  const winnerNames = winners.map(nameOf).join(', ') || '—';
  const isShowdown = result.endedBy === 'showdown';

  return (
    <Card className="border-amber-300/40 bg-amber-300/[0.06] p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="gap-1 bg-amber-400 text-black hover:bg-amber-400">
          <Trophy className="h-3.5 w-3.5" /> Kết quả ván #{handNo}
        </Badge>
        <Badge variant="outline" className="border-amber-300/40 text-amber-200">
          {isShowdown ? 'Showdown' : 'Đối thủ bỏ bài'}
        </Badge>
      </div>

      <div className="mt-2 text-sm">
        <span className="font-semibold text-amber-200">{winnerNames}</span>
        <span className="text-foreground"> thắng </span>
        <span className="font-bold tabular-nums text-amber-100">{chipLabel(result.potTotal, bb)}</span>
        {winners.length > 1 && <span className="text-muted-foreground"> · chia pot</span>}
      </div>

      {result.refund && (
        <div className="mt-1 text-xs text-muted-foreground">
          Hoàn {chipLabel(result.refund.amount, bb)} cho {nameOf(result.refund.seat)} (phần cược thừa không ai theo)
        </div>
      )}

      <div className="mt-1.5 text-xs text-muted-foreground">Ván tiếp theo sẽ bắt đầu sau giây lát…</div>
    </Card>
  );
}
