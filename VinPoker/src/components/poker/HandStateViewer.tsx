// src/components/poker/HandStateViewer.tsx
// GE-2D — read-only inspector for the PUBLIC hand state. Mirrors what a client
// would render from online_poker_hands.state (the public projection) plus the
// caller's own hole cards. Collapsible raw JSON helps verify, at a glance, that
// no other seat's hole cards are ever present in the public payload.

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PlayingCard } from './PlayingCard';
import type { PublicHandView } from '@/lib/onlinePoker/types';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

export function HandStateViewer({ hand }: { hand: PublicHandView }) {
  const [showJson, setShowJson] = useState(false);
  const toActName = hand.seats.find((s) => s.seat === hand.toActSeat)?.displayName ?? `Ghế ${hand.toActSeat}`;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Hand #{hand.handNo}</Badge>
        <Badge variant="secondary" className="uppercase">{hand.street}</Badge>
        <Badge variant="outline">{hand.status}</Badge>
        <span className="ml-auto text-sm tabular-nums text-primary">Pot {fmtChips(hand.pot)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Bài chung (board)</div>
          <div className="mt-1 flex gap-1">
            {hand.board.length ? hand.board.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
              : <span className="text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Bài của bạn</div>
          <div className="mt-1 flex gap-1">
            {hand.myHoleCards?.length ? hand.myHoleCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
              : <span className="text-muted-foreground">—</span>}
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Đến lượt: <span className="text-foreground font-medium">{hand.toActSeat != null ? toActName : '—'}</span>
        {' · '}Nút (button): ghế {hand.buttonSeat}
      </div>

      <div>
        <Button size="sm" variant="ghost" onClick={() => setShowJson((v) => !v)}>
          {showJson ? 'Ẩn' : 'Xem'} public state (JSON)
        </Button>
        {showJson && (
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(hand, null, 2)}
          </pre>
        )}
      </div>
    </Card>
  );
}
