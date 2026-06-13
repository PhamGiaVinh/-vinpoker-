// src/components/poker/PlayingCard.tsx
// GE-2D — pure presentational card. Renders a 2-char card string ("Ah", "Td",
// "?" = face-down). No logic; purely visual.

import { cn } from '@/lib/utils';

const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = new Set(['h', 'd']);

export function PlayingCard({
  card,
  size = 'md',
  className,
}: {
  /** "Ah", "Td", … or undefined/"?" for a face-down card */
  card?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dims = size === 'lg' ? 'h-16 w-11 text-lg' : size === 'sm' ? 'h-8 w-6 text-[10px]' : 'h-12 w-9 text-sm';

  if (!card || card === '?') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-primary/20',
          'bg-gradient-to-br from-zinc-800 to-zinc-900 text-primary/30 font-bold select-none',
          dims,
          className,
        )}
        aria-label="face-down card"
      >
        ◆
      </div>
    );
  }

  const rank = card.slice(0, card.length - 1);
  const suit = card.slice(-1).toLowerCase();
  const red = RED.has(suit);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-md border bg-white font-bold leading-none select-none shadow-sm',
        red ? 'text-rose-600 border-rose-200' : 'text-zinc-900 border-zinc-300',
        dims,
        className,
      )}
      aria-label={card}
    >
      <span>{rank}</span>
      <span>{SUIT_GLYPH[suit] ?? suit}</span>
    </div>
  );
}
