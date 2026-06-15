// src/components/poker/PlayingCard.tsx
// GE-2E — presentational card. Face-up renders a polished face (two-corner index,
// large centre pip, soft shadow, rounded corners); face-down renders the Royal
// Guilloché CardBack. `reveal` plays a one-shot CSS flip-in on mount (deal /
// showdown), disabled under prefers-reduced-motion. Pure visual; the 2-char card
// string parsing (rank/suit) is unchanged.

import { cn } from '@/lib/utils';
import { CardBack } from './CardBack';
import './pokerTable.css';

const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = new Set(['h', 'd']);

export function PlayingCard({
  card,
  size = 'md',
  reveal = false,
  className,
}: {
  /** "Ah", "Td", … or undefined/"?" for a face-down card */
  card?: string;
  size?: 'sm' | 'md' | 'lg';
  /** play a one-shot flip-in when the card mounts (deal / showdown reveal) */
  reveal?: boolean;
  className?: string;
}) {
  const dims = size === 'lg' ? 'h-16 w-11' : size === 'sm' ? 'h-8 w-6' : 'h-12 w-9';

  if (!card || card === '?') {
    return <CardBack size={size} className={className} />;
  }

  const rank = card.slice(0, card.length - 1);
  const suit = card.slice(-1).toLowerCase();
  const glyph = SUIT_GLYPH[suit] ?? suit;
  const red = RED.has(suit);
  const color = red ? 'text-rose-600' : 'text-zinc-900';

  const idx = size === 'lg' ? 'text-[11px]' : size === 'sm' ? 'text-[7px]' : 'text-[9px]';
  const pip = size === 'lg' ? 'text-[28px]' : size === 'sm' ? 'text-[15px]' : 'text-[22px]';

  return (
    <div
      className={cn(
        'relative select-none rounded-md bg-white shadow-md ring-1',
        red ? 'ring-rose-200' : 'ring-zinc-300',
        dims,
        reveal && 'op-card-reveal',
        className,
      )}
      aria-label={card}
    >
      <span className={cn('absolute left-0.5 top-0 flex flex-col items-center font-bold leading-none', idx, color)}>
        <span>{rank}</span>
        <span>{glyph}</span>
      </span>
      <span className={cn('absolute inset-0 flex items-center justify-center font-semibold leading-none', pip, color)} aria-hidden="true">
        {glyph}
      </span>
      <span className={cn('absolute bottom-0 right-0.5 flex rotate-180 flex-col items-center font-bold leading-none', idx, color)}>
        <span>{rank}</span>
        <span>{glyph}</span>
      </span>
    </div>
  );
}
