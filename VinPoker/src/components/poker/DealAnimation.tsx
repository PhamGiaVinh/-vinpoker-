// src/components/poker/DealAnimation.tsx
// P0 repair — the "deal" flourish: when a NEW hand is dealt, transient card backs fly from
// the centre deck (50%,50%) out to each seated player, two rounds, staggered. Pure visual
// overlay — never touches engine state, disappears once the real hole cards reveal.
//
// Driven by `signal` from useTableHand (a counter that bumps ONCE per fresh live hand —
// the data layer already enforces anti-replay: known previous handId → new handId, board
// empty, ≥2 in-hand, never on initial load/poll/reconnect). The animation flies ONLY to
// `seats` (occupied/in-hand seats) — never to empty chairs. Disabled under reduced-motion.

import { useEffect, useRef, useState } from 'react';
import { CardBack } from './CardBack';
import { dealFlyCards } from '@/lib/onlinePoker/tableState';

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type FlyCard = { x: number; y: number; delay: number };

export function DealAnimation({
  signal,
  seats,
  pos,
}: {
  /** counter from useTableHand; a change (>0) triggers one deal animation. */
  signal: number;
  /** seat numbers that received cards — the ONLY seats cards fly to. */
  seats: number[];
  /** seat-centre positions (outer-container %), from SeatRing. */
  pos: Record<number, { x: number; y: number }>;
}) {
  const idRef = useRef(0);
  const firstRef = useRef(true);
  const [deal, setDeal] = useState<{ id: number; cards: FlyCard[] } | null>(null);
  const [flying, setFlying] = useState(false);

  useEffect(() => {
    // Skip the initial mount (signal starts at 0 / first observed value) — only react to a
    // genuine bump. The data layer never bumps on initial load, but guard the mount anyway.
    if (firstRef.current) { firstRef.current = false; return; }
    if (signal <= 0 || reducedMotion()) return;

    // only occupied/in-hand seats (never empty chairs), two rounds, staggered.
    const cards: FlyCard[] = dealFlyCards(seats, pos);
    if (cards.length < 2) return;

    const id = ++idRef.current;
    setFlying(false);
    setDeal({ id, cards });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setFlying(true)));
    const totalMs = cards.length * 75 + 460;
    const clear = setTimeout(() => setDeal((d) => (d && d.id === id ? null : d)), totalMs);
    return () => { cancelAnimationFrame(raf); clearTimeout(clear); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

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
