// src/pages/OnlinePoker.tsx
// GE-2D — online-poker LOBBY (dark shell). Gated by FEATURES.onlinePoker: while
// false, real users see <PokerComingSoon/>; flip the flag locally to preview the
// mock lobby. Lists mock tables and a mock play-chip wallet. The "Nhận chip mỗi
// ngày" and "Vào bàn" controls are inert until the GE-2C runtime is live
// (RUNTIME_LIVE) — sit/claim will route through op_sit_down / op_claim_daily_chips.

import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE } from '@/lib/onlinePoker/types';
import { useLobby } from '@/lib/onlinePoker/useOnlinePoker';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { Spade, Coins, Users } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

export default function OnlinePoker() {
  // Hook first (rules-of-hooks): mock while dark, live rails when RUNTIME_LIVE.
  const { tables, wallet, claimDaily } = useLobby();

  if (!FEATURES.onlinePoker) return <PokerComingSoon />;

  return (
    <div className="container mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex items-center gap-3">
        <Spade className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Poker Online</h1>
        <Badge variant="outline" className="ml-1">Alpha · chip ảo</Badge>
        {!RUNTIME_LIVE && <Badge variant="secondary" className="ml-auto">Xem trước (dữ liệu mẫu)</Badge>}
      </header>

      {/* play-chip wallet */}
      <Card className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Coins className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Quỹ chip (play money)</div>
          <div className="text-lg font-bold tabular-nums text-primary">{fmtChips(wallet.balance)}</div>
        </div>
        <Button
          className="ml-auto"
          disabled={!RUNTIME_LIVE}
          title={!RUNTIME_LIVE ? 'Runtime chưa mở' : undefined}
          onClick={() => { void claimDaily().catch(() => {}); }}
        >
          Nhận chip mỗi ngày
        </Button>
      </Card>

      {/* table list */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Bàn chơi</h2>
        {tables.map((t) => (
          <Card key={t.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{t.name}</span>
                <Badge variant={t.status === 'open' ? 'default' : 'secondary'}>{t.status}</Badge>
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                <span>Blinds {fmtChips(t.sb)}/{fmtChips(t.bb)}</span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />{t.seatedCount}/{t.maxSeats}
                </span>
              </div>
            </div>
            <Button asChild variant="outline">
              <Link to={`/poker/table/${t.id}`}>Xem bàn</Link>
            </Button>
          </Card>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Server quyết định bài, người thắng và chip — client chỉ gửi thao tác. Tất cả là chip ảo,
        không liên quan tới tiền thật / cashier / payroll / staking.
      </p>
    </div>
  );
}
