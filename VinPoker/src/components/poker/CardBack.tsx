// src/components/poker/CardBack.tsx
// "Royal Guilloché" card back, GE-2G 3D pass: deep burgundy base + champagne-gold
// guilloché hairlines + a raised, bevelled gold **V** monogram and a slow diagonal
// gloss sweep so the back reads as a real, slightly-domed card rather than a flat
// rectangle. Pure CSS (no deps; no 3D transform on the element itself so the existing
// op-card-reveal flip stays intact); theme-agnostic (reads on dark + warm). Sizes
// mirror PlayingCard so backs and faces line up.

import { cn } from '@/lib/utils';
import './pokerTable.css';

const GOLD = '#d9c27a';
const GOLD_HI = '#f4e6b0'; // bevel highlight
const GOLD_LO = '#8a6f2b'; // bevel shadow

export function CardBack({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const dims = size === 'lg' ? 'h-16 w-11' : size === 'sm' ? 'h-8 w-6' : 'h-12 w-9';
  const mono = size === 'lg' ? 'h-6 w-6 text-[13px]' : size === 'sm' ? 'h-3.5 w-3.5 text-[8px]' : 'h-5 w-5 text-[11px]';

  return (
    <div
      className={cn('relative overflow-hidden rounded-md select-none', dims, className)}
      aria-label="face-down card"
      style={{
        background: 'linear-gradient(135deg, #6a2032 0%, #4a1322 55%, #350b18 100%)',
        // raised card edge: bright gold inset rim + top sheen + grounded drop shadow
        boxShadow:
          'inset 0 0 0 1px rgba(217,194,122,0.60), inset 0 1px 2px rgba(255,255,255,0.18),' +
          'inset 0 -3px 6px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.5)',
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
      {/* inner gold frame (double line for depth) */}
      <div className="pointer-events-none absolute inset-[2px] rounded-[3px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(217,194,122,0.38), inset 0 0 0 2px rgba(53,11,24,0.6)' }} />
      {/* slow diagonal gloss sweep — the "sheen" that sells the 3D dome */}
      <div className="op-card-sheen pointer-events-none absolute inset-0" aria-hidden="true" />
      {/* raised, bevelled V monogram */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn('flex items-center justify-center rounded-full font-black leading-none', mono)}
          style={{
            color: GOLD,
            background: 'radial-gradient(circle at 38% 30%, rgba(83,30,46,0.85), rgba(40,8,18,0.92))',
            // ring with an outer highlight + inner shadow = embossed bezel
            boxShadow: `inset 0 1px 1px ${GOLD_HI}80, inset 0 -1px 2px ${GOLD_LO}, 0 0 0 1px ${GOLD}80, 0 1px 2px rgba(0,0,0,0.55)`,
            // the V glyph: light from top, shadow below = engraved/raised
            textShadow: `0 1px 0 ${GOLD_LO}, 0 -0.5px 0 ${GOLD_HI}, 0 1px 3px rgba(0,0,0,0.6)`,
          }}
        >
          V
        </span>
      </div>
    </div>
  );
}
