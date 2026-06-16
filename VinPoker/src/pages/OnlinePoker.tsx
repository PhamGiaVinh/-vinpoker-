// src/pages/OnlinePoker.tsx
// GE-2 closed alpha — visual table map lobby. 10 tables, 9 seats each.
// Gated by FEATURES.onlinePoker; shows PokerComingSoon while false.

import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE } from '@/lib/onlinePoker/types';
import { useLobby } from '@/lib/onlinePoker/useOnlinePoker';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { Spade, Coins, RefreshCw, Users } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

/** 9 seat-dot positions around an oval poker table */
const SEAT_POSITIONS = [
  { x: 50, y: 8  },  // top-center (seat 1)
  { x: 78, y: 18 },  // top-right
  { x: 92, y: 44 },  // right
  { x: 85, y: 72 },  // bottom-right
  { x: 65, y: 88 },  // bottom-center-right
  { x: 35, y: 88 },  // bottom-center-left
  { x: 15, y: 72 },  // bottom-left
  { x:  8, y: 44 },  // left
  { x: 22, y: 18 },  // top-left
];

function TableFelt({ seated, maxSeats }: { seated: number; maxSeats: number }) {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      {/* felt oval */}
      <ellipse cx="50" cy="50" rx="44" ry="36"
        fill="hsl(var(--primary)/0.12)" stroke="hsl(var(--primary)/0.35)" strokeWidth="1.5" />
      {/* dealer button hint */}
      <circle cx="50" cy="50" r="6"
        fill="hsl(var(--primary)/0.08)" stroke="hsl(var(--primary)/0.2)" strokeWidth="1" />
      <text x="50" y="53.5" textAnchor="middle" fontSize="5"
        fill="hsl(var(--primary)/0.5)" fontWeight="bold">D</text>
      {/* seat dots */}
      {SEAT_POSITIONS.slice(0, maxSeats).map((pos, i) => {
        const filled = i < seated;
        return (
          <circle key={i} cx={pos.x} cy={pos.y} r="5.5"
            fill={filled ? 'hsl(var(--primary)/0.85)' : 'hsl(var(--muted))'}
            stroke={filled ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
            strokeWidth="1" />
        );
      })}
    </svg>
  );
}

export default function OnlinePoker() {
  const { tables, wallet, loading, error, claimDaily, refresh } = useLobby();

  if (!FEATURES.onlinePoker) return <PokerComingSoon />;

  const full = tables.filter(t => t.seatedCount >= t.maxSeats).length;
  const active = tables.filter(t => t.status === 'open').length;

  return (
    <div className="container mx-auto max-w-5xl space-y-4 p-4">

      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Spade className="h-6 w-6 text-primary shrink-0" />
        <h1 className="text-2xl font-bold">Poker Online</h1>
        <Badge variant="outline" className="ml-1">Alpha · chip ảo</Badge>
        {!RUNTIME_LIVE && <Badge variant="secondary">Xem trước</Badge>}
        <button
          onClick={refresh}
          className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Tải lại"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* wallet bar */}
      <Card className="flex items-center gap-3 px-4 py-3">
        <Coins className="h-5 w-5 text-primary shrink-0" />
        <div>
          <div className="text-[11px] text-muted-foreground">Chip ảo của bạn</div>
          <div className="text-base font-bold tabular-nums text-primary">{fmtChips(wallet.balance)}</div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground">{active}</span> bàn mở</span>
          <span><span className="font-semibold text-foreground">{tables.reduce((s, t) => s + t.seatedCount, 0)}</span> người chơi</span>
          {full > 0 && <span className="text-amber-500">{full} bàn đầy</span>}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="ml-3 shrink-0"
          disabled={!RUNTIME_LIVE}
          onClick={() => { void claimDaily().catch(() => {}); }}
        >
          Nhận chip hôm nay
        </Button>
      </Card>

      {/* error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          Lỗi tải danh sách bàn: {error}
        </div>
      )}

      {/* table map grid */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Sơ đồ bàn — SB&nbsp;25 / BB&nbsp;50
        </h2>
        {loading && tables.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Đang tải bàn…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {tables.map((t) => {
              const isFull   = t.seatedCount >= t.maxSeats;
              const isPaused = t.status === 'paused';
              const avail    = t.maxSeats - t.seatedCount;
              return (
                <Card
                  key={t.id}
                  className={cn(
                    'flex flex-col gap-2 p-3 transition-all',
                    isPaused && 'opacity-50',
                  )}
                >
                  {/* table name + status */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-sm">{t.name}</span>
                    {isFull
                      ? <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Đầy</Badge>
                      : isPaused
                        ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Dừng</Badge>
                        : <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">Mở</Badge>
                    }
                  </div>

                  {/* felt SVG */}
                  <div className="aspect-square w-full">
                    <TableFelt seated={t.seatedCount} maxSeats={t.maxSeats} />
                  </div>

                  {/* seat count */}
                  <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span className={cn('tabular-nums', t.seatedCount > 0 && 'text-foreground font-medium')}>
                      {t.seatedCount}/{t.maxSeats}
                    </span>
                    {avail > 0 && !isPaused && (
                      <span className="text-primary/70">· còn {avail} ghế</span>
                    )}
                  </div>

                  {/* enter button */}
                  <Button
                    asChild
                    size="sm"
                    className="w-full mt-auto"
                    variant={isFull || isPaused ? 'outline' : 'default'}
                    disabled={isPaused}
                  >
                    <Link to={`/poker/table/${t.id}`}>
                      {isFull ? 'Xem bàn' : 'Vào chơi →'}
                    </Link>
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground pt-2">
        Server quyết định bài · người thắng · chip. Tất cả là chip ảo — không liên quan tiền thật.
      </p>
    </div>
  );
}
