// src/pages/OnlinePokerTable.tsx
// GE-2D — single online-poker TABLE view (dark shell). Gated by FEATURES.onlinePoker.
// Renders the felt + seats (SeatRing), the public hand state (HandStateViewer), and
// the action bar (ActionBar) — all from a frozen mock hand. Sit/stand and every
// action are inert until the GE-2C runtime is live (RUNTIME_LIVE). The viewer is
// seat 3 and sees only its own hole cards; no other seat's cards are present.

import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE } from '@/lib/onlinePoker/types';
import { findMockTable } from '@/lib/onlinePoker/mockData';
import { useTableHand } from '@/lib/onlinePoker/useOnlinePoker';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { SeatRing } from '@/components/poker/SeatRing';
import { HandStateViewer } from '@/components/poker/HandStateViewer';
import { ActionBar } from '@/components/poker/ActionBar';
import { ChevronLeft } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

export default function OnlinePokerTable() {
  const { tableId = '' } = useParams();
  // Hooks first (rules-of-hooks): mock hand while dark, live hand+overlay when live.
  const { hand, loading } = useTableHand(tableId);

  if (!FEATURES.onlinePoker) return <PokerComingSoon />;

  // Table header metadata (name/blinds). While dark this is the mock row; live table
  // metadata (online_poker_tables row) is wired at enablement alongside listTablesLive.
  const table = findMockTable(tableId);
  if (!table) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <Card className="p-6 text-center space-y-3">
          <p className="text-muted-foreground">Không tìm thấy bàn này.</p>
          <Button asChild variant="outline"><Link to="/poker">Về sảnh</Link></Button>
        </Card>
      </div>
    );
  }

  if (!hand) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <Card className="p-6 text-center text-muted-foreground">
          {loading ? 'Đang tải bàn…' : 'Chưa có ván nào đang diễn ra.'}
        </Card>
      </div>
    );
  }

  const seated = hand.mySeat != null;

  return (
    <div className="container mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/poker"><ChevronLeft className="h-4 w-4" /> Sảnh</Link>
        </Button>
        <h1 className="truncate text-lg font-bold">{table.name}</h1>
        <Badge variant="outline" className="tabular-nums">{fmtChips(table.sb)}/{fmtChips(table.bb)}</Badge>
        {!RUNTIME_LIVE && <Badge variant="secondary" className="ml-auto">Xem trước</Badge>}
      </header>

      {/* the felt */}
      <Card className="overflow-hidden bg-black/20 p-4">
        <SeatRing hand={hand} />
      </Card>

      {/* seat controls (inert in the shell) */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" disabled={!RUNTIME_LIVE || seated} title={!RUNTIME_LIVE ? 'Runtime chưa mở' : undefined}>
          Ngồi vào (sit down)
        </Button>
        <Button variant="outline" disabled={!RUNTIME_LIVE || !seated} title={!RUNTIME_LIVE ? 'Runtime chưa mở' : undefined}>
          Đứng dậy (stand up)
        </Button>
      </div>

      <ActionBar hand={hand} />
      <HandStateViewer hand={hand} />
    </div>
  );
}
