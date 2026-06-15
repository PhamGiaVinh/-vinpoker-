/**
 * SwingClockRing — the signature countdown ring for a Dealer Swing battle-map
 * table tile (V3 operator-console redesign).
 *
 * PRESENTATION ONLY. Renders an SVG progress ring whose arc length encodes how
 * much of the current swing window has elapsed, and whose colour comes from the
 * shared 7-status system. Colour is driven by `currentColor` (set via a Tailwind
 * text-token class such as `text-success` / `text-destructive` /
 * `text-[hsl(var(--ds-active))]`) so it AUTO-RECOLOURS in the warm theme. The
 * optional glow uses `drop-shadow(... currentColor)` → neon in dark, soft in warm.
 *
 * No timing/business logic here — the parent passes the already-derived fraction
 * and label (see swingTableView / SwingTableCard).
 */

import { cn } from "@/lib/utils";

export interface SwingClockRingProps {
  /** 0..1 — fraction of the swing window elapsed (≥1 clamps to a full ring). */
  fraction: number;
  /** Tailwind text-color class for the arc (e.g. dealerStatusStyle.text). */
  colorClass: string;
  /** Center label (timer string, e.g. "12:30" / "+6:12"). */
  label: string;
  /** Tailwind text-color class for the center label (defaults to colorClass). */
  labelClass?: string;
  /** Tiny caption under the label (e.g. "CÒN" / "OT"). */
  caption?: string;
  size?: number;
  stroke?: number;
  /** Theme-aware glow on the arc (neon in dark, soft in warm). */
  glow?: boolean;
  /** Dashed faint ring for empty/unassigned tables. */
  empty?: boolean;
  className?: string;
}

export default function SwingClockRing({
  fraction,
  colorClass,
  label,
  labelClass,
  caption,
  size = 56,
  stroke = 5,
  glow = false,
  empty = false,
  className,
}: SwingClockRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const offset = c * (1 - f);

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} className="block -rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="text-border"
          stroke="currentColor"
          strokeOpacity={0.35}
          strokeDasharray={empty ? "3 5" : undefined}
        />
        {/* Progress arc (hidden when empty) */}
        {!empty && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className={colorClass}
            stroke="currentColor"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={glow ? { filter: "drop-shadow(0 0 3px currentColor)" } : undefined}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={cn("font-mono text-[12px] font-bold tabular-nums", labelClass ?? colorClass)}>{label}</span>
        {caption && <span className="mt-0.5 text-[7px] uppercase tracking-wider text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}
