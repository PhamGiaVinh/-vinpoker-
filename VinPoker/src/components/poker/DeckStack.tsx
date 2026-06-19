// src/components/poker/DeckStack.tsx
// GE-2G — the dealer's deck at table centre, shown PRE-FLOP (before any community
// card). A short stack of Royal-Guilloché card backs, each nudged up/left with its
// own drop shadow so the pile reads as a real 3D deck with the gold V on top. Pure
// presentation; CSS only. Sits BELOW the pot/board layer and dims when a pot is
// already showing, so it never competes with the focal point.

import { cn } from '@/lib/utils';
import { CardBack } from './CardBack';

export function DeckStack({
  size = 'lg',
  count = 4,
  dimmed = false,
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  /** number of backs in the pile (visual only) */
  count?: number;
  /** lower the opacity when a pot/label is already on the felt */
  dimmed?: boolean;
  className?: string;
}) {
  const layers = Array.from({ length: Math.max(1, count) });
  return (
    <div
      className={cn('op-deck-stack relative select-none', dimmed && 'opacity-60', className)}
      aria-label="bộ bài"
      role="img"
    >
      {layers.map((_, i) => (
        <div
          key={i}
          className="absolute left-0 top-0"
          style={{
            // each layer lifts up-left a hair → a clean stacked-deck edge
            transform: `translate(${-i * 1.4}px, ${-i * 1.8}px)`,
            zIndex: i,
            filter: i < layers.length - 1 ? 'brightness(0.86)' : undefined,
          }}
        >
          <CardBack size={size} />
        </div>
      ))}
      {/* spacer keeps layout box = one card (the layers are absolutely stacked on top) */}
      <div className="invisible"><CardBack size={size} /></div>
    </div>
  );
}
