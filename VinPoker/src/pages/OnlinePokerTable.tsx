// src/pages/OnlinePokerTable.tsx
// Friends-practice TABLE: open seating (no approval, no wallet), with a transferable
// host. Click an empty seat → choose your chips → sit. The first sitter is the host;
// the host can hand the role to another seated player, and it auto-reassigns when the
// host leaves. Server-authoritative: the engine decides cards, legality, winner, chips.

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { FEATURES } from '@/lib/featureFlags';
import { RUNTIME_LIVE, type ActionType, type PublicHandResult, type PublicHandView, type PublicSeatView } from '@/lib/onlinePoker/types';
import type { RpcOutcome } from '@/lib/onlinePoker/wire';
import { useTableHand, useTableMeta } from '@/lib/onlinePoker/useOnlinePoker';
import type { LiveSeat, LiveTableMeta } from '@/lib/onlinePoker/client';
import { PokerComingSoon } from '@/components/poker/PokerComingSoon';
import { SeatRing } from '@/components/poker/SeatRing';
import { HandStateViewer } from '@/components/poker/HandStateViewer';
import { ActionBar } from '@/components/poker/ActionBar';
import { ShowdownResult } from '@/components/poker/ShowdownResult';
import { AllInRunout } from '@/components/poker/AllInRunout';
import { isAllInShowdown, ALLIN_CINEMATIC_TOTAL_MS } from '@/lib/onlinePoker/allinCinematic';
import { occupiedCount, isTableLive, emptyStateLabel } from '@/lib/onlinePoker/tableDisplay';
import { SitDownDialog } from '@/components/poker/SitDownDialog';
import { BustoutDialog } from '@/components/poker/BustoutDialog';
import { actionToSound } from '@/lib/onlinePoker/pokerSounds';
import { playPokerLiveSound, markPokerSoundGesture, isPokerSoundMuted, setPokerSoundMuted } from '@/lib/pokerLiveSound';
import { readImmersivePref, writeImmersivePref, requestFullscreenBestEffort, exitFullscreenBestEffort } from '@/lib/onlinePoker/immersive';
import { iAmInLiveHand as computeIAmInLiveHand } from '@/lib/onlinePoker/tableState';
import { readFeltSkin, writeFeltSkin, type FeltSkin } from '@/lib/onlinePoker/feltSkin';
import { ChevronLeft, Crown, LogIn, Volume2, VolumeX, Maximize2, Minimize2, Palette } from 'lucide-react';

const fmtChips = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : s;
};

/** Map RPC/edge outcome codes to a friendly Vietnamese message. */
const OUTCOME_VN: Record<string, string> = {
  bad_buyin: 'Số chip không hợp lệ.',
  bad_blinds: 'Blind không hợp lệ.',
  seat_taken: 'Ghế vừa có người ngồi, chọn ghế khác nhé.',
  already_seated: 'Bạn đã ngồi ở bàn này rồi.',
  bad_seat: 'Ghế không hợp lệ.',
  disabled: 'Poker đang tạm đóng.',
  unauthenticated: 'Bạn cần đăng nhập.',
  table_not_found: 'Không tìm thấy bàn.',
  table_not_open: 'Bàn đang đóng.',
  not_seated: 'Bạn chưa ngồi ở bàn này.',
  not_host: 'Chỉ chủ bàn mới làm được việc này.',
  target_not_seated: 'Người này chưa ngồi ở bàn.',
  in_active_hand: 'Đang trong ván — không thể rời lúc này.',
  not_your_turn: 'Chưa tới lượt bạn.',
  not_in_betting: 'Ván chưa tới vòng cược.',
  seat_cannot_act: 'Ghế này không thể hành động.',
  action_not_legal: 'Hành động không hợp lệ.',
  amount_required: 'Cần nhập số tiền cược.',
  illegal_amount: 'Số tiền cược không hợp lệ.',
  race_lost: 'Trạng thái vừa thay đổi, thử lại.',
  bad_amount: 'Số chip mua thêm không hợp lệ.',
  has_chips: 'Bạn vẫn còn chip, không cần mua thêm.',
};
const vn = (code?: string) => (code && OUTCOME_VN[code]) || 'Có lỗi xảy ra, thử lại.';

/** Merge the active hand (if any) with the live seats into a full maxSeats ring. */
function buildRingView(meta: LiveTableMeta, hand: PublicHandView | null, seats: LiveSeat[], mySeatNo: number | null): PublicHandView {
  const handByNo = new Map<number, PublicSeatView>();
  if (hand) for (const s of hand.seats) handByNo.set(s.seat, s);
  const liveByNo = new Map<number, LiveSeat>();
  for (const s of seats) liveByNo.set(s.seatNo, s);

  const ringSeats: PublicSeatView[] = [];
  for (let n = 1; n <= meta.maxSeats; n++) {
    const hs = handByNo.get(n);
    if (hs) {
      // Keep the HAND seat intact (revealedCards / status / settled stack must NOT be
      // lost at showdown); only borrow the live displayName so the felt + winner panel
      // can name the player.
      const ls = liveByNo.get(n);
      ringSeats.push(ls?.displayName && !hs.displayName ? { ...hs, displayName: ls.displayName } : hs);
      continue;
    }
    const ls = liveByNo.get(n);
    if (ls) {
      ringSeats.push({ seat: n, playerId: ls.userId, displayName: ls.displayName, stack: ls.stack, committed: '0', status: 'sitting_out' });
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
    // Carry the server settlement so the felt can glow the winner + the result panel
    // can announce the pot. Preserved through the merge (never recomputed client-side).
    ...(hand?.result ? { result: hand.result } : {}),
    myHoleCards: hand?.myHoleCards,
    mySeat: hand?.mySeat ?? mySeatNo ?? undefined,
  };
}

/** A full snapshot of a just-completed hand, held on screen during the showdown dwell. */
type DwellSnap = {
  ringView: PublicHandView;
  winnerSeats: number[];
  result: PublicHandResult;
  handId: string;
  capturedAt: number;
  /** how long to hold the snapshot — longer for the all-in cinematic runout. */
  holdMs: number;
};
const RESULT_DWELL_MS = 8000;

export default function OnlinePokerTable() {
  const { tableId = '' } = useParams();
  const { user } = useAuth();
  const { hand, seats, mySeatNo, myUserId, hostUserId, amIHost, legal, loading, dealSignal, dealSeats, refresh, actions } = useTableHand(tableId);
  const table = useTableMeta(tableId);

  const [sitSeat, setSitSeat] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bustOpen, setBustOpen] = useState(false);
  const bustHandledRef = useRef(false);
  const [muted, setMuted] = useState<boolean>(isPokerSoundMuted());
  const toggleMute = () => { const v = !muted; setPokerSoundMuted(v); setMuted(v); markPokerSoundGesture(); };

  // UI-4 — optional felt skin (emerald default / premium burgundy+gold), persisted locally.
  const [feltSkin, setFeltSkin] = useState<FeltSkin>(readFeltSkin);
  const toggleSkin = () => { const next: FeltSkin = feltSkin === 'premium' ? 'emerald' : 'premium'; setFeltSkin(next); writeFeltSkin(next); };

  // Mobile immersive table mode (CSS-default; native fullscreen requested on the gesture).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [immersive, setImmersive] = useState<boolean>(readImmersivePref);
  const enterImmersive = () => { setImmersive(true); writeImmersivePref(true); markPokerSoundGesture(); requestFullscreenBestEffort(rootRef.current); };
  const exitImmersive = () => { setImmersive(false); writeImmersivePref(false); exitFullscreenBestEffort(); };
  // Lock body scroll + allow Escape to leave; restore + exit native fullscreen on unmount.
  useEffect(() => {
    if (!immersive) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setImmersive(false); writeImmersivePref(false); exitFullscreenBestEffort(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prevOverflow; document.removeEventListener('keydown', onKey); };
  }, [immersive]);
  useEffect(() => () => { exitFullscreenBestEffort(); }, []); // safety on page unmount

  // Best-effort auto-leave when the player exits the table (SPA route unmount / tab close).
  // A ref carries the latest seated / in-hand state into the unmount cleanup. This is
  // ADVISORY only — an async leave fired during unload may not complete; the reliable
  // cleanup is the server-side stale-seat reaper (PR-B). Never leave mid-hand (the server
  // forbids it, and the timeout-sweep force-folds an absent actor on their turn).
  const leaveRef = useRef<{ seated: boolean; inActiveHand: boolean; leave: () => Promise<unknown> } | null>(null);
  useEffect(() => {
    const fireLeave = () => {
      const r = leaveRef.current;
      if (r && r.seated && !r.inActiveHand) void r.leave().catch(() => {});
    };
    // pagehide with persisted=false = a real unload (not bfcache/background) → leave.
    const onPageHide = (e: PageTransitionEvent) => { if (!e.persisted) fireLeave(); };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      fireLeave(); // SPA route unmount
    };
  }, []);

  // ── showdown result dwell ───────────────────────────────────────────────────
  // When a hand completes with a settlement result, snapshot the WHOLE completed hand
  // (felt + reveals + winner + result) and hold it ~8s. The server may auto-deal the
  // next hand immediately; the snapshot keeps the board runout / revealed hands / winner
  // visible so the result is never silently overwritten. Display-only — never blocks the
  // server; cleared on timeout, when a NEW hand needs my action, or when I act.
  const [dwell, setDwell] = useState<DwellSnap | null>(null);
  const dwellHandIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!table || !hand || hand.status !== 'complete' || !hand.result || !hand.handId) return;
    if (!isTableLive(table.status, occupiedCount(seats))) return; // never capture a result for a closed/empty table
    if (dwellHandIdRef.current === hand.handId) return; // snapshot each completion once
    dwellHandIdRef.current = hand.handId;
    const ringView = buildRingView(table, hand, seats, mySeatNo);
    const winnerSeats = Array.from(new Set(hand.result.potAwards.flatMap((a) => a.winners)));
    // All-in showdowns play a longer cinematic runout; give the snapshot enough headroom
    // (the AllInRunout's onDone clears it earlier; this is the safety fallback).
    const holdMs = isAllInShowdown(ringView) ? ALLIN_CINEMATIC_TOTAL_MS + 2000 : RESULT_DWELL_MS;
    setDwell({ ringView, winnerSeats, result: hand.result, handId: hand.handId, capturedAt: Date.now(), holdMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand?.handId, hand?.status]);

  useEffect(() => {
    if (!dwell) return;
    const id = setTimeout(() => setDwell(null), dwell.holdMs);
    return () => clearTimeout(id);
  }, [dwell]);

  // A genuinely NEW hand drops the held result so the felt yields to the live hand. The
  // render-time `freshDeal` gate (below) already HIDES the dwell on the same render the deal
  // signal bumps — this effect releases the dwell STATE + its timer and re-arms bustout. A
  // fresh non-cinematic deal (board empty) OR a hand that now needs MY action both qualify.
  // Never cut an all-in cinematic short — it finishes via AllInRunout's own onDone.
  useEffect(() => {
    if (!dwell || !hand || hand.handId === dwell.handId) return;
    const cinematicDwell = isAllInShowdown(dwell.ringView);
    const fresh = hand.status !== 'complete' && (hand.board?.length ?? 0) === 0;
    const needsMyAction = hand.status === 'betting' && hand.toActSeat === mySeatNo;
    // Release the dwell STATE in lockstep with the render-time gate: a fresh non-cinematic
    // deal, or a hand that needs MY action (drops even a cinematic so I'm never blocked).
    if (needsMyAction || (fresh && !cinematicDwell)) setDwell(null);
  }, [hand?.handId, hand?.toActSeat, hand?.status, hand?.board?.length, mySeatNo, dwell]);

  // PR C — switching tables must not carry a previous table's held result/cinematic. Use
  // the effect CLEANUP (which fires only when tableId actually changes — and on unmount —
  // never on first mount) so a freshly-snapshotted result isn't wiped on initial render.
  useEffect(() => {
    return () => { setDwell(null); dwellHandIdRef.current = null; };
  }, [tableId]);

  // PR C — a table that goes closed / empty (no players) must not keep showing a stale
  // result. Clear the dwell so the felt falls back to the empty state.
  useEffect(() => {
    if (!isTableLive(table?.status, occupiedCount(seats))) setDwell(null);
  }, [table?.status, seats]);

  // E4 — bustout. After settlement the server writes the busted player's seat stack to 0
  // (migration 20260907000000), so a seated player with 0 chips and no live hand has lost
  // all their chips. Offer leave/rebuy ONCE per bust, and only after any result dwell has
  // finished (so the outcome is seen first). Dismissable to keep spectating; re-armed only
  // once the player is no longer busted (e.g. after leaving). Never decides chips client-side.
  const myStackStr = seats.find((s) => s.userId === myUserId)?.stack;
  const inLiveHand = !!hand && (hand.status === 'dealing' || hand.status === 'betting');
  const isBusted = mySeatNo != null && myStackStr != null && Number(myStackStr) === 0 && !inLiveHand;
  useEffect(() => {
    if (isBusted && !dwell) {
      if (!bustHandledRef.current) { bustHandledRef.current = true; setBustOpen(true); }
    } else if (!isBusted) {
      bustHandledRef.current = false;
      setBustOpen(false);
    }
  }, [isBusted, dwell]);

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

  const seated = mySeatNo != null;
  const inActiveHand = !!hand && (hand.status === 'dealing' || hand.status === 'betting');
  // I can leave any time UNLESS my own seat is genuinely contesting the live hand
  // (active/allin) — the server blocks that to preserve chip conservation. Just being at
  // the table while OTHERS play (sitting_out / joined after the deal) must NOT block leave.
  const iAmInLiveHand = computeIAmInLiveHand(hand, mySeatNo);
  const seatedPlayers = [...seats].sort((a, b) => a.seatNo - b.seatNo);
  const occupied = occupiedCount(seats);
  const tableLive = isTableLive(table.status, occupied);

  // Keep the unmount-leave snapshot current every render.
  leaveRef.current = { seated, inActiveHand, leave: actions.leaveTable };

  // PR C — only show a held result on a LIVE table; never for a closed / empty one.
  // P0 deal-anim fix: when a genuinely NEW hand has been dealt (handId changed from the
  // dwell's, board empty, not complete), drop the held result RIGHT HERE in render — NOT in
  // an effect, which clears one commit too late and lets DealAnimation fire over the stale
  // felt. This makes the felt the live new hand on the SAME render the deal signal bumps, so
  // the cards fly over the correct empty felt to the correct seat positions. An all-in
  // cinematic dwell is PRESERVED (excluded) so AllInRunout finishes via its own onDone.
  const cinematicDwell = !!dwell && isAllInShowdown(dwell.ringView);
  const newHand = !!hand && !!hand.handId && hand.handId !== dwell?.handId;
  // freshDeal = a new hand just dealt (board empty) → drops a NON-cinematic held result so
  // the deal flourish flies over the clean felt. needsMyAction drops the dwell even mid-
  // cinematic (never block me). An all-in cinematic is otherwise PRESERVED until its own
  // AllInRunout onDone — a new hand merely ARRIVING must not cut the runout short.
  const freshDeal = newHand && hand?.status !== 'complete' && (hand?.board?.length ?? 0) === 0;
  const needsMyAction = newHand && hand?.status === 'betting' && hand?.toActSeat === mySeatNo;
  const dropDwell = needsMyAction || (freshDeal && !cinematicDwell);
  const showing: DwellSnap | null = (tableLive && dwell && !dropDwell) ? dwell : null;
  // Once the dwell ends a completed hand can still be the latest (no new deal yet), and a
  // non-live table should show nothing — in both cases clear the felt (null hand → empty
  // board) so a stale completed board never lingers. During an active hand or the dwell
  // the real hand / snapshot is shown, so #329's cinematic is untouched.
  const completedLingering = !showing && hand?.status === 'complete';
  const feltHand = (!tableLive || completedLingering) ? null : hand;
  const ringView = buildRingView(table, feltHand, seats, mySeatNo);
  const feltView = showing ? showing.ringView : ringView;
  const feltWinners = showing ? showing.winnerSeats : undefined;
  // An all-in showdown replays as a cinematic runout (its own felt + reveals + equity +
  // result); other states use the plain felt + result panel below.
  const cinematic = !!showing && isAllInShowdown(showing.ringView);

  const openSit = (seatNo: number) => {
    // Don't offer to sit until the first load settles — a reload could otherwise briefly
    // open the dialog for a seat the player already occupies (server would then reject).
    if (loading) return;
    if (seated) { toast.info('Bạn đã ngồi ở bàn này rồi.'); return; }
    setSitSeat(seatNo);
  };

  const confirmSit = async (buyin: string) => {
    if (sitSeat == null) return;
    markPokerSoundGesture(); // first deliberate table action → unlock audio
    try {
      const res = (await actions.sitOpen(sitSeat, buyin)) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success(`Đã ngồi vào ghế ${sitSeat}`); setSitSeat(null); refresh(); }
      else toast.error(vn(res?.outcome));
    } catch { toast.error('Không ngồi được, thử lại.'); }
  };

  const leave = async () => {
    try {
      const res = (await actions.leaveTable()) as RpcOutcome;
      if (res?.outcome === 'ok') {
        // Clear local seat-bound UI at once so I can immediately re-join (don't wait for
        // the poll). mySeatNo is seats-authoritative, so refresh() drops `seated` too.
        toast.success('Đã rời bàn.');
        setSitSeat(null);
        setBustOpen(false);
        bustHandledRef.current = false;
        refresh();
      } else if (res?.outcome === 'in_active_hand') {
        toast.error('Bạn đang trong ván, không thể rời ngay. Sẽ rời được sau khi xong ván.');
      } else {
        toast.error(vn(res?.outcome));
      }
    } catch { toast.error('Không rời được, thử lại.'); }
  };

  // Rebuy a fresh stack after busting. The amount is server-dictated (= the table's
  // starting stack); the client just sends that value and the server re-validates it.
  // On success the seat stack > 0, so the bustout effect closes the modal on next load.
  const rebuy = async () => {
    try {
      const res = (await actions.rebuy(table.startingStack)) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success('Đã mua thêm chip.'); setBustOpen(false); }
      else if (res?.outcome !== 'has_chips') toast.error(vn(res?.outcome));
      refresh();
    } catch { toast.error('Không mua được chip, thử lại.'); }
  };

  const transfer = async (toUserId: string, name: string) => {
    try {
      const res = (await actions.transferHost(toUserId)) as RpcOutcome;
      if (res?.outcome === 'ok') { toast.success(`Đã trao quyền chủ bàn cho ${name}`); refresh(); }
      else toast.error(vn(res?.outcome));
    } catch { toast.error('Không trao quyền được, thử lại.'); }
  };

  const submit = async (a: { type: ActionType; amount?: string }) => {
    if (!hand || mySeatNo == null || submitting) return; // ignore re-taps while a submit is in flight
    setDwell(null); // acting on the new hand drops any lingering result view
    setSubmitting(true);
    // Instant audio feedback for MY action (opponents' sounds are derived from polling in
    // useTableHand, which skips my seat to avoid doubling up).
    markPokerSoundGesture();
    playPokerLiveSound(actionToSound(a.type));
    try {
      const res = (await actions.submitAction({ handId: hand.handId, seat: mySeatNo, type: a.type, amount: a.amount })) as { ok: boolean; code?: string };
      if (res && res.ok === false) toast.error(vn(res.code));
      else refresh();
    } catch { toast.error('Gửi hành động thất bại, thử lại.'); }
    finally { setSubmitting(false); }
  };

  const nameFor = (s: LiveSeat) => (s.userId === myUserId ? 'Bạn' : s.displayName || `Ghế ${s.seatNo}`);

  return (
    <div
      ref={rootRef}
      className={immersive
        ? 'fixed inset-0 z-[60] mx-auto flex h-[100dvh] w-full max-w-4xl flex-col gap-2 overflow-y-auto bg-background p-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] [padding-top:max(0.75rem,env(safe-area-inset-top))]'
        // Chrome-less route (no Layout nav): own full-viewport shell + safe-area insets so
        // the table fills the phone edge-to-edge; max-w-4xl keeps desktop centered.
        : 'mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col gap-2 bg-background p-3 sm:p-4 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] [padding-top:max(0.75rem,env(safe-area-inset-top))]'}
      style={{ background: 'radial-gradient(130% 85% at 50% 26%, #0b1410 0%, #07090b 72%)' }}
    >
      <header className="flex items-center gap-2 rounded-xl bg-black/25 px-1.5 py-1">
        {immersive ? (
          <Button variant="ghost" size="sm" onClick={exitImmersive}><Minimize2 className="h-4 w-4" /> Thoát</Button>
        ) : (
          <Button asChild variant="ghost" size="sm"><Link to="/poker"><ChevronLeft className="h-4 w-4" /> Sảnh</Link></Button>
        )}
        <h1 className="truncate text-base font-semibold">{table.name}</h1>
        <Badge variant="outline" className="tabular-nums text-[11px]">{fmtChips(table.sb)}/{fmtChips(table.bb)}</Badge>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={toggleSkin}
          aria-label="Đổi giao diện bàn"
          title={feltSkin === 'premium' ? 'Giao diện: Cao cấp (chạm để về Xanh)' : 'Giao diện: Xanh (chạm để Cao cấp)'}
        >
          <Palette className={feltSkin === 'premium' ? 'h-4 w-4 text-amber-300' : 'h-4 w-4'} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={immersive ? exitImmersive : enterImmersive}
          aria-label={immersive ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
          title={immersive ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
        >
          {immersive ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMute}
          aria-label={muted ? 'Bật tiếng' : 'Tắt tiếng'}
          title={muted ? 'Bật tiếng' : 'Tắt tiếng'}
        >
          {muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4" />}
        </Button>
        {amIHost && <Badge className="gap-1"><Crown className="h-3 w-3" /> Chủ bàn</Badge>}
      </header>

      {/* All-in showdown → cinematic runout replay (staged reveals → flop → equity → turn
          → equity → river → result). Otherwise the felt: the live hand, or the held
          showdown snapshot. Empty seats are tap-to-sit when you're not seated / no result. */}
      {/* Felt is the page — the table floats in the dark void with no card chrome around
          it, centered in the available height so it dominates the screen. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {cinematic && showing ? (
          <AllInRunout hand={showing.ringView} bb={table.bb} skin={feltSkin} onDone={() => setDwell(null)} />
        ) : (
          <SeatRing
            hand={feltView}
            bb={table.bb}
            winnerSeats={feltWinners}
            dealSignal={dealSignal}
            dealSeats={dealSeats}
            skin={feltSkin}
            // Sit is allowed on any OPEN table (incl. an empty one — that's how you start
            // it); only a closed table or an active result/cinematic blocks it.
            onEmptySeatClick={!seated && !loading && !showing && table.status !== 'closed' ? openSit : undefined}
          />
        )}
      </div>

      {/* seat controls */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!seated ? (
          <span className="text-sm text-muted-foreground">Chạm một ghế trống để vào chơi.</span>
        ) : (
          <>
            <Badge variant="secondary">Bạn đang ngồi ghế {mySeatNo}</Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={leave}
              disabled={iAmInLiveHand}
              title={iAmInLiveHand ? 'Bạn đang trong ván — sẽ rời được sau khi xong ván' : undefined}
            >
              {iAmInLiveHand ? 'Rời sau ván' : 'Đứng dậy / rời bàn'}
            </Button>
          </>
        )}
      </div>

      {/* players + host controls ("danh sách chủ trên bàn") */}
      {seatedPlayers.length > 0 && (
        <Card className="p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Người chơi tại bàn</div>
          <div className="space-y-1.5">
            {seatedPlayers.map((s) => {
              const isHost = s.userId === hostUserId;
              const isMe = s.userId === myUserId;
              return (
                <div key={s.seatNo} className="flex items-center gap-2 text-sm">
                  <span className="w-7 text-center text-xs text-muted-foreground tabular-nums">#{s.seatNo}</span>
                  <span className={`truncate ${isMe ? 'font-semibold' : ''}`}>{nameFor(s)}</span>
                  {isHost && <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><Crown className="h-3 w-3" /> Chủ</Badge>}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmtChips(s.stack)}</span>
                  {amIHost && !isHost && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => transfer(s.userId, nameFor(s))}>
                      Trao quyền
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* showdown result — winner / pot / refund, held during the dwell so it's seen
          before the next hand. Suppressed for an all-in cinematic (which shows its own
          result at the end). Takes priority over the action bar + waiting hint. */}
      {showing && !cinematic && (
        <ShowdownResult
          result={showing.result}
          handNo={showing.ringView.handNo}
          seats={showing.ringView.seats}
          mySeat={showing.ringView.mySeat}
          bb={table.bb}
        />
      )}

      {/* action bar — only during an active hand, and never over a result being shown */}
      {!showing && inActiveHand && <ActionBar hand={hand!} legal={legal ?? undefined} bb={table.bb} busy={submitting} onAction={submit} />}

      {/* status line — a closed/empty table shows "Bàn đã đóng / Bàn trống" (and never a
          stale completed board, since feltHand is cleared above); a live table between
          hands shows the waiting hint. Suppressed while a result/cinematic is shown. */}
      {!showing && !inActiveHand && (
        !tableLive ? (
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-sm text-muted-foreground">
            {emptyStateLabel(table.status, occupied)}
          </div>
        ) : seated ? (
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-sm text-muted-foreground">
            {occupied < 2 ? 'Đang chờ thêm người chơi…' : 'Ván mới sẽ bắt đầu trong giây lát…'}
          </div>
        ) : null
      )}

      {(showing || inActiveHand) && <HandStateViewer hand={showing ? showing.ringView : hand!} />}

      <SitDownDialog
        open={sitSeat != null}
        onOpenChange={(v) => { if (!v) setSitSeat(null); }}
        seatNo={sitSeat}
        tableName={table.name}
        sb={table.sb}
        bb={table.bb}
        defaultStack={table.startingStack}
        onConfirm={confirmSit}
      />

      <BustoutDialog
        open={bustOpen}
        onOpenChange={setBustOpen}
        onLeave={async () => { await leave(); setBustOpen(false); }}
        rebuyEnabled={FEATURES.onlinePokerRebuy}
        rebuyAmount={table.startingStack}
        onRebuy={rebuy}
      />
    </div>
  );
}
