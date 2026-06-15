// src/components/poker/CardBack.tsx
// GE-2E — "Royal Guilloché" card back: deep burgundy base + champagne-gold
// guilloché hairlines + a gold V monogram. Pure presentation, theme-agnostic
// (reads well on both the dark and warm themes — no token dependency). Sizes mirror
// PlayingCard so backs and faces line up. The guilloché is kept subtle so the
// smallest (sm) cards stay clean rather than muddy.

import { cn } from '@/lib/utils';

const GOLD = '#d9c27a';

export function CardBack({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = size === 'lg' ? 'h-16 w-11' : size === 'sm' ? 'h-8 w-6' : 'h-12 w-9';
  const mono = size === 'lg' ? 'h-5 w-5 text-[10px]' : size === 'sm' ? 'h-3 w-3 text-[6px]' : 'h-4 w-4 text-[8px]';

  return (
    <div
      className={cn('relative overflow-hidden rounded-md shadow-md select-none', dims, className)}
      aria-label="face-down card"
      style={{
        background: 'linear-gradient(135deg, #6a2032 0%, #4a1322 55%, #350b18 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(217,194,122,0.55), 0 1px 3px rgba(0,0,0,0.4)',
      }}
    >
      {/* guilloché: concentric rings + fine radial spokes in gold, low opacity */}
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'repeating-radial-gradient(circle at 50% 50%, rgba(217,194,122,0.18) 0 0.5px, transparent 0.5px 4px),' +
            'repeating-conic-gradient(from 0deg at 50% 50%, rgba(217,194,122,0.10) 0deg 4deg, transparent 4deg 10deg)',
        }}
      />
      {/* inner gold frame */}
      <div className="pointer-events-none absolute inset-[2px] rounded-[3px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(217,194,122,0.35)' }} />
      {/* V monogram */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn('flex items-center justify-center rounded-full font-bold leading-none', mono)}
          style={{ border: `1px solid ${GOLD}`, color: GOLD, background: 'rgba(53,11,24,0.55)' }}
        >
          V
        </span>
      </div>
    </div>
  );
}
