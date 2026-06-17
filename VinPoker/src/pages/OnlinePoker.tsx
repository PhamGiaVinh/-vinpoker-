// src/pages/OnlinePoker.tsx
// Friends-practice lobby: open tables created by players. Create your own table
// (you become host) or tap an existing table to join. No wallet/free-chips.
// Gated by FEATURES.onlinePoker; shows PokerComingSoon while false.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE } from '@/lib/onlinePoker/types';
import type { RpcOutcome } from '@/lib/onlinePoker/wire';
import { useLobby } from '@/lib/onlinePoker/useOnlinePoker';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { CreateTableDialog } from '@/components/poker/CreateTableDialog';
import { Spade, RefreshCw, Users, Plus, LogIn } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

/** 9 seat-dot positions around an oval poker table */
const SEAT_POSITIONS = [
  { x: 50, y: 8 }, { x: 78, y: 18 }, { x: 92, y: 44 }, { x: 85, y: 72 }, { x: 65, y: 88 },
  { x: 35, y: 88 }, { x: 15, y: 72 }, { x: 8, y: 44 }, { x: 22, y: 18 },
];

function TableFelt({ seated, maxSeats }: { seated: number; maxSeats: number }) {
  return (
    <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
      <ellipse cx="50" cy="50" rx="44" ry="36" fill="hsl(var(--primary)/0.12)" stroke="hsl(var(--primary)/0.35)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="6" fill="hsl(var(--primary)/0.08)" stroke="hsl(var(--primary)/0.2)" strokeWidth="1" />
      <text x="50" y="53.5" textAnchor="middle" fontSize="5" fill="hsl(var(--primary)/0.5)" fontWeight="bold">D</text>
      {SEAT_POSITIONS.slice(0, maxSeats).map((pos, i) => {
        const filled = i < seated;
        return (
          <circle key={i} cx={pos.x} cy={pos.y} r="5.5"
            fill={filled ? 'hsl(var(--primary)/0.85)' : 'hsl(var(--muted))'}
            stroke={filled ? 'hsl(var(--primary))' : 'hsl(var(--border))'} strokeWidth="1" />
        );
      })}
    </svg>
  );
}

export default function OnlinePoker() {
  const { user } = useAuth();
  const { tables, loading, error, createTable, refresh } = useLobby();
  const nav = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  if (!FEATURES.onlinePoker) return <PokerComingSoon />;

  const totalPlayers = tables.reduce((s, t) => s + t.seatedCount, 0);

  const onCreate = async (args: { name: string; sb: string; bb: string; buyin: string; maxSeats: number }) => {
    try {
      const res = (await createTable(args.name, args.sb, args.bb, args.buyin, args.maxSeats)) as RpcOutcome;
      if (res?.outcome === 'ok' && typeof res.table_id === 'string') {
        setCreateOpen(false);
        nav(`/poker/table/${res.table_id}`);
      } else {
        toast.error(res?.outcome === 'disabled' ? 'Poker đang tạm đóng.' : 'Không tạo được bàn, thử lại.');
      }
    } catch { toast.error('Không tạo được bàn, thử lại.'); }
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-4 p-4">
      {/* header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Spade className="h-6 w-6 text-primary shrink-0" />
        <h1 className="text-2xl font-bold">Poker Online</h1>
        <Badge variant="outline" className="ml-1">Đấu tập · chip ảo</Badge>
        {!RUNTIME_LIVE && <Badge variant="secondary">Xem trước</Badge>}
        <button
          onClick={refresh}
          className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Tải lại"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* summary + create */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground">{tables.length}</span> bàn</span>
          <span><span className="font-semibold text-foreground">{totalPlayers}</span> người chơi</span>
        </div>
        {user ? (
          <Button size="sm" className="ml-auto gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Tạo bàn mới
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline" className="ml-auto gap-1.5">
            <Link to="/auth"><LogIn className="h-4 w-4" /> Đăng nhập để chơi</Link>
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          Lỗi tải danh sách bàn: {error}
        </div>
      )}

      {/* table grid */}
      {loading && tables.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground text-sm">Đang tải bàn…</div>
      ) : tables.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-muted-foreground text-sm">Chưa có bàn nào đang mở.</p>
          {user && <Button onClick={() => setCreateOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Tạo bàn đầu tiên</Button>}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {tables.map((t) => {
            const isFull = t.seatedCount >= t.maxSeats;
            const isPaused = t.status === 'paused';
            const avail = t.maxSeats - t.seatedCount;
            return (
              <Card key={t.id} className={cn('flex flex-col gap-2 p-3 transition-all', isPaused && 'opacity-50')}>
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-sm truncate">{t.name}</span>
                  {isFull
                    ? <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Đầy</Badge>
                    : isPaused
                      ? <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Dừng</Badge>
                      : <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">Mở</Badge>}
                </div>

                <div className="text-[11px] text-muted-foreground tabular-nums">Blinds {fmtChips(t.sb)}/{fmtChips(t.bb)}</div>

                <div className="aspect-square w-full">
                  <TableFelt seated={t.seatedCount} maxSeats={t.maxSeats} />
                </div>

                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span className={cn('tabular-nums', t.seatedCount > 0 && 'text-foreground font-medium')}>{t.seatedCount}/{t.maxSeats}</span>
                  {avail > 0 && !isPaused && <span className="text-primary/70">· còn {avail}</span>}
                </div>

                <Button asChild size="sm" className="w-full mt-auto" variant={isFull || isPaused ? 'outline' : 'default'} disabled={isPaused}>
                  <Link to={`/poker/table/${t.id}`}>{isFull ? 'Xem bàn' : 'Vào chơi →'}</Link>
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground pt-2">
        Server quyết định bài · người thắng · chip. Tất cả là chip ảo để đấu tập — không liên quan tiền thật.
      </p>

      <CreateTableDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={onCreate} />
    </div>
  );
}
