// src/pages/OnlinePokerTable.tsx
// GE-2 closed alpha — a single online-poker TABLE you can actually play at.
// Server-authoritative: the client sends intent (sit / stand / claim / fold-check-
// call-bet-raise) through the online-poker-action Edge fn; the engine decides cards,
// legality, winner and chips. This page shows ALL seats (occupied + empty) whether or
// not a hand is in progress, lets you pick an empty seat + buy-in to sit, and renders
// the live action bar driven by the server's legal-action menu. Chips are STRINGS.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE, type ActionType, type PublicHandView, type PublicSeatView } from '@/lib/onlinePoker/types';
import type { RpcOutcome } from '@/lib/onlinePoker/wire';
import { useTableHand, useTableMeta } from '@/lib/onlinePoker/useOnlinePoker';
import type { LiveSeat, LiveTableMeta } from '@/lib/onlinePoker/client';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { SeatRing } from '@/components/poker/SeatRing';
import { HandStateViewer } from '@/components/poker/HandStateViewer';
import { ActionBar } from '@/components/poker/ActionBar';
import { SitDownDialog } from '@/components/poker/SitDownDialog';
import { ChevronLeft, Coins, LogIn } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

/** Map common RPC/edge outcome codes to a friendly Vietnamese message. */
const OUTCOME_VN: Record<string, string> = {
  insufficient_funds: 'Không đủ chip trong quỹ.',
  no_wallet: 'Chưa có quỹ chip — hãy nhận chip trước.',
  seat_taken: 'Ghế vừa có người ngồi, chọn ghế khác nhé.',
  already_seated: 'Bạn đã ngồi ở bàn này rồi.',
  buyin_out_of_range: 'Số chip mang vào ngoài giới hạn của bàn.',
  bad_seat: 'Ghế không hợp lệ.',
  disabled: 'Poker đang tạm đóng.',
  unauthenticated: 'Bạn cần đăng nhập.',
  table_not_found: 'Không tìm thấy bàn.',
  in_active_hand: 'Đang trong ván — không thể đứng dậy lúc này.',
  not_your_turn: 'Chưa tới lượt bạn.',
  not_in_betting: 'Ván chưa tới vòng cược.',
  seat_cannot_act: 'Ghế này không thể hành động.',
  action_not_legal: 'Hành động không hợp lệ.',
  amount_required: 'Cần nhập số tiền cược.',
  illegal_amount: 'Số tiền cược không hợp lệ.',
  race_lost: 'Trạng thái vừa thay đổi, thử lại.',
};
const vn = (code?: string) => (code && OUTCOME_VN[code]) || 'Có lỗi xảy ra, thử lại.';

/**
 * Merge the active hand (if any) with the live seats table into a full maxSeats ring:
 * in-hand seats keep their hand data; seated-but-not-in-hand players show as waiting;
 * the rest are empty (clickable to sit).
 */
function buildRingView(
  meta: LiveTableMeta, hand: PublicHandView | null, seats: LiveSeat[], mySeatNo: number | null,
): PublicHandView {
  const handByNo = new Map<number, PublicSeatView>();
  if (hand) for (const s of hand.seats) handByNo.set(s.seat, s);
  const liveByNo = new Map<number, LiveSeat>();
  for (const s of seats) liveByNo.set(s.seatNo, s);

  const ringSeats: PublicSeatView[] = [];
  for (let n = 1; n <= meta.maxSeats; n++) {
    const hs = handByNo.get(n);
    if (hs) { ringSeats.push(hs); continue; }
    const ls = liveByNo.get(n);
    if (ls) {
      ringSeats.push({
        seat: n, playerId: ls.userId, displayName: ls.displayName,
        stack: ls.stack, committed: '0', status: 'sitting_out',
      });
    } else {
      ringSeats.push({ seat: n, playerId: null, stack: '0', committed: '0', status: 'empty' });
    }
  }

  return {
    handId: hand?.handId ?? '',
    tableId: meta.id,
    handNo: hand?.handNo ?? 0,
    street: hand?.street ?? 'preflop',
    board: hand?.board ?? [],
    pot: hand?.pot ?? '0',
    toActSeat: hand?.toActSeat ?? null,
    buttonSeat: hand?.buttonSeat ?? 0,
    status: hand?.status ?? 'complete',
    seats: ringSeats,
    myHoleCards: hand?.myHoleCards,
    mySeat: hand?.mySeat ?? mySeatNo ?? undefined,
  };
}

export default function OnlinePokerTable() {
  const { tableId = '' } = useParams();
  const { user } = useAuth();
  const { hand, seats, mySeatNo, wallet, legal, loading, refresh, actions } = useTableHand(tableId);
  const table = useTableMeta(tableId);

  const [sitSeat, setSitSeat] = useState<number | null>(null);

  if (!FEATURES.onlinePoker) return <PokerComingSoon />;

  if (!table) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <Card className="space-y-3 p-6 text-center">
          <p className="text-muted-foreground">{loading ? 'Đang tải bàn…' : 'Không tìm thấy bàn này.'}</p>
          <Button asChild variant="outline"><Link to="/poker">Về sảnh</Link></Button>
        </Card>
      </div>
    );
  }

  // Login is required to act (the Edge needs a user JWT).
  if (RUNTIME_LIVE && !user) {
    return (
      <div className="container mx-auto max-w-2xl p-4">
        <Card className="space-y-4 p-6 text-center">
          <h1 className="text-lg font-bold">{table.name}</h1>
          <p className="text-muted-foreground">Đăng nhập để vào bàn chơi (chip ảo).</p>
          <Button asChild className="gap-2"><Link to="/auth"><LogIn className="h-4 w-4" /> Đăng nhập</Link></Button>
          <div><Button asChild variant="ghost" size="sm"><Link to="/poker">← Về sảnh</Link></Button></div>
        </Card>
      </div>
    );
  }

  const ringView = buildRingView(table, hand, seats, mySeatNo);
  const seated = mySeatNo != null;
  const inActiveHand = !!hand && (hand.status === 'dealing' || hand.status === 'betting');

  const openSit = (seatNo: number) => {
    if (seated) { toast.info('Bạn đã ngồi ở bàn này rồi.'); return; }
    setSitSeat(seatNo);
  };

  const confirmSit = async (buyin: string) => {
    if (sitSeat == null) return;
    try {
      const res = (await actions.sitDown(sitSeat, buyin)) as RpcOutcome;
      if (res?.outcome === 'ok') {
        toast.success(`Đã ngồi vào ghế ${sitSeat}`);
        setSitSeat(null);
        refresh();
      } else {
        toast.error(vn(res?.outcome));
      }
    } catch {
      toast.error('Không ngồi được, thử lại.');
    }
  };

  const claimChips = async () => {
    try {
      const res = (await actions.claimDaily()) as RpcOutcome;
      if (res?.outcome === 'ok') toast.success('Đã nhận 1.000.000 chip.');
      else if (res?.outcome === 'already_claimed') toast.info('Hôm nay bạn đã nhận chip rồi.');
      else toast.error(vn(res?.outcome));
      refresh();
    } catch { toast.error('Không nhận được chip, thử lại.'); }
  };

  const standUp = async () => {
    try {
      const res = (await actions.standUp()) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success('Đã đứng dậy.'); refresh(); }
      else toast.error(vn(res?.outcome));
    } catch { toast.error('Không đứng dậy được, thử lại.'); }
  };

  const submit = async (a: { type: ActionType; amount?: string }) => {
    if (!hand || mySeatNo == null) return;
    try {
      const res = (await actions.submitAction({ handId: hand.handId, seat: mySeatNo, type: a.type, amount: a.amount })) as
        { ok: boolean; code?: string };
      if (res && res.ok === false) toast.error(vn(res.code));
      else refresh();
    } catch { toast.error('Gửi hành động thất bại, thử lại.'); }
  };

  return (
    <div className="container mx-auto max-w-4xl space-y-3 p-3 sm:p-4">
      <header className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/poker"><ChevronLeft className="h-4 w-4" /> Sảnh</Link>
        </Button>
        <h1 className="truncate text-lg font-bold">{table.name}</h1>
        <Badge variant="outline" className="tabular-nums">{fmtChips(table.sb)}/{fmtChips(table.bb)}</Badge>
        <div className="ml-auto flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1">
          <Coins className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold tabular-nums text-primary">{fmtChips(wallet.balance)}</span>
        </div>
      </header>

      {/* the felt — all seats; empty ones are tap-to-sit when you're not seated */}
      <Card className="overflow-hidden bg-black/20 p-2 sm:p-3">
        <SeatRing
          hand={ringView}
          bb={table.bb}
          onEmptySeatClick={!seated ? openSit : undefined}
        />
      </Card>

      {/* seat controls */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!seated ? (
          <>
            <span className="text-sm text-muted-foreground">Chạm một ghế trống để vào chơi.</span>
            {Number(wallet.balance) < Number(table.minBuyin) && (
              <Button size="sm" variant="outline" onClick={claimChips}>Nhận chip miễn phí</Button>
            )}
          </>
        ) : (
          <>
            <Badge variant="secondary">Bạn đang ngồi ghế {mySeatNo}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={standUp}
              disabled={inActiveHand}
              title={inActiveHand ? 'Không thể đứng dậy khi đang trong ván' : undefined}
            >
              Đứng dậy
            </Button>
          </>
        )}
      </div>

      {/* action bar — only meaningful during an active hand */}
      {inActiveHand && (
        <ActionBar hand={hand!} legal={legal ?? undefined} bb={table.bb} onAction={submit} />
      )}

      {/* waiting hint when seated but no hand yet */}
      {seated && !inActiveHand && (
        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-sm text-muted-foreground">
          {seats.length < 2 ? 'Đang chờ thêm người chơi…' : 'Ván mới sẽ bắt đầu trong giây lát…'}
        </div>
      )}

      {inActiveHand && <HandStateViewer hand={hand!} />}

      <SitDownDialog
        open={sitSeat != null}
        onOpenChange={(v) => { if (!v) setSitSeat(null); }}
        seatNo={sitSeat}
        tableName={table.name}
        bb={table.bb}
        minBuyin={table.minBuyin}
        maxBuyin={table.maxBuyin}
        startingStack={table.startingStack}
        walletBalance={wallet.balance}
        onConfirm={confirmSit}
        onClaim={claimChips}
      />
    </div>
  );
}
