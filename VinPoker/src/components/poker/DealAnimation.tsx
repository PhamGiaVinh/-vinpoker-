// src/components/poker/DealAnimation.tsx
// PR C — the "deal" flourish: when a NEW hand starts, transient card backs fly from the
// centre deck (50%,50%) out to each seated player, two rounds, staggered. It is a pure
// visual overlay — it never touches engine state and disappears once the real hole cards
// (PlayingCard's op-card-reveal) take over.
//
// Anti-replay (P0): only fires when a KNOWN previous handId changes to a brand-new hand
// (board empty) with ≥2 players in the hand — so it never replays on initial page load,
// reconnect mid-hand, a re-poll of the same hand, or a refresh. Disabled under
// prefers-reduced-motion. Positions reuse SeatRing's `pos` (outer-container %).

import { useEffect, useRef, useState } from 'react';
import { CardBack } from './CardBack';
import type { PublicHandView } from '@/lib/onlinePoker/types';

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type FlyCard = { x: number; y: number; delay: number };

export function DealAnimation({
  hand,
  pos,
}: {
  hand: PublicHandView;
  pos: Record<number, { x: number; y: number }>;
}) {
  const prevHandIdRef = useRef<string | null>(null);
  const idRef = useRef(0);
  const [deal, setDeal] = useState<{ id: number; cards: FlyCard[] } | null>(null);
  const [flying, setFlying] = useState(false);

  useEffect(() => {
    const prevId = prevHandIdRef.current;
    prevHandIdRef.current = hand.handId;

    const inHand = hand.seats.filter((s) => s.playerId && (s.status === 'active' || s.status === 'allin'));
    const fresh =
      !!prevId && !!hand.handId && hand.handId !== prevId &&
      (hand.board?.length ?? 0) === 0 && inHand.length >= 2;
    if (!fresh || reducedMotion()) return;

    // two rounds, one card per seated player each round, staggered clockwise.
    const ordered = [...inHand].sort((a, b) => a.seat - b.seat);
    const cards: FlyCard[] = [];
    let k = 0;
    for (let round = 0; round < 2; round++) {
      for (const s of ordered) {
        const p = pos[s.seat];
        if (!p) continue;
        cards.push({ x: p.x, y: p.y, delay: k * 75 });
        k++;
      }
    }
    if (!cards.length) return;

    const id = ++idRef.current;
    setFlying(false);
    setDeal({ id, cards });
    // next frame: flip targets on so the CSS left/top transition fires.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setFlying(true)));
    const totalMs = cards.length * 75 + 460;
    const clear = setTimeout(() => setDeal((d) => (d && d.id === id ? null : d)), totalMs);
    return () => { cancelAnimationFrame(raf); clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.handId]);

  if (!deal) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[15]" aria-hidden="true">
      {deal.cards.map((c, i) => (
        <div
          key={`${deal.id}-${i}`}
          className="op-deal-card absolute -translate-x-1/2 -translate-y-1/2"
          style={{
            left: flying ? `${c.x}%` : '50%',
            top: flying ? `${c.y}%` : '50%',
            transitionDelay: `${c.delay}ms`,
          }}
        >
          <CardBack size="sm" />
        </div>
      ))}
    </div>
  );
}
