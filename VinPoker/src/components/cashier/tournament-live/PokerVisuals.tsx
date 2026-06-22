import { useId, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const SUIT_SYMBOL: Record<string, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
  "\u2660": "\u2660",
  "\u2665": "\u2665",
  "\u2666": "\u2666",
  "\u2663": "\u2663",
};

export function getOvalSeatStyle(
  index: number,
  total: number,
  radiusX = 43,
  radiusY = 34
): CSSProperties {
  const safeTotal = Math.max(total, 1);
  const angle = -90 + (index * 360) / safeTotal;
  const rad = (angle * Math.PI) / 180;

  return {
    left: `${50 + radiusX * Math.cos(rad)}%`,
    top: `${50 + radiusY * Math.sin(rad)}%`,
    transform: "translate(-50%, -50%)",
  };
}

export function isPokerCardRed(card?: string | null) {
  if (!card) return false;
  const suit = card.slice(-1);
  return suit === "h" || suit === "d" || suit === "\u2665" || suit === "\u2666";
}

export function pokerCardText(card?: string | null) {
  if (!card) return "";
  const rank = card.slice(0, -1);
  const suit = SUIT_SYMBOL[card.slice(-1)] || card.slice(-1);
  return `${rank}${suit}`;
}

export function PokerCard({
  card,
  hidden = false,
  size = "md",
  muted = false,
  className,
  style,
}: {
  card?: string | null;
  hidden?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
  /** Optional inline style (e.g. animationDelay for a staggered board reveal). */
  style?: CSSProperties;
}) {
  const red = isPokerCardRed(card);
  const sizeClass = {
    xs: "h-8 w-6 rounded-md text-[10px]",
    sm: "h-11 w-8 rounded-md text-xs",
    md: "h-16 w-12 rounded-lg text-base",
    lg: "h-20 w-14 rounded-xl text-lg",
  }[size];

  if (hidden) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden border border-amber-300/50 bg-[radial-gradient(circle_at_35%_25%,#245043,#0b1720_72%)] shadow-lg shadow-black/35",
          sizeClass,
          className
        )}
      >
        <div className="absolute inset-1 rounded-[inherit] border border-emerald-300/20" />
        <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.9)]" />
      </div>
    );
  }

  if (!card) {
    return (
      <div
        className={cn(
          "shrink-0 border border-dashed border-amber-200/25 bg-black/25 shadow-inner shadow-black/30",
          sizeClass,
          className
        )}
      />
    );
  }

  const rank = card.slice(0, -1);
  const suit = SUIT_SYMBOL[card.slice(-1)] || card.slice(-1);

  return (
    <div
      className={cn(
        "tracker-card-reveal relative shrink-0 overflow-hidden border border-amber-200/70 bg-[#f7f0df] font-serif font-black leading-none shadow-xl shadow-black/35",
        red ? "text-[#b51324]" : "text-[#111827]",
        muted && "opacity-55 grayscale",
        sizeClass,
        className
      )}
      style={style}
    >
      <div className="absolute inset-1 rounded-[inherit] border border-black/10" />
      <div className="absolute inset-0 flex items-center justify-center gap-0.5 text-[1.35em]">
        <span>{rank}</span>
        <span className="text-[0.9em]">{suit}</span>
      </div>
    </div>
  );
}

/**
 * Face-DOWN poker card — burgundy + gold, driven by the --poker-felt/--poker-gold
 * tokens so it stays a poker card in every theme. Separate from PokerCard on
 * purpose: PokerCard(null) keeps its empty-slot behavior (used by the board/replay).
 * Used by the viewer when a seat's hole cards are not revealed (privacy-safe — no
 * value is ever shown). Sizes mirror PokerCard so face-up/face-down line up.
 */
/**
 * Royal Guilloché card back — premium SVG (rosette linework + V medallion + double
 * border + corner ornaments). All colors come from --poker-card-* tokens so it
 * auto-switches dark↔warm (the warm set is intentionally brighter). Keeps the same
 * API (size / muted / className) and data-testid so existing callers + tests work.
 * xs/sm render a lighter "compact" density (fewer lines) for tiny hole cards.
 */
export function CardBack({
  size = "xs",
  muted = false,
  className,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
}) {
  const sizeClass = {
    xs: "h-8 w-6 rounded-md",
    sm: "h-11 w-8 rounded-md",
    md: "h-16 w-12 rounded-lg",
    lg: "h-20 w-14 rounded-xl",
  }[size];
  const uid = useId().replace(/:/g, "");
  // Same lighter pattern on EVERY card (board backs match the player hole-card
  // backs) — owner wants less guilloché on the board.
  const compact = true;
  const rosetteCount = compact ? 10 : 30;
  const innerCount = compact ? 0 : 16;
  const rRx = compact ? 17 : 24;
  const rRy = compact ? 37 : 53;
  const medR = compact ? 13 : 17;
  const vSize = compact ? 19 : 26;

  return (
    <div
      aria-hidden="true"
      data-testid="card-back"
      className={cn(
        "relative shrink-0 overflow-hidden border shadow-md shadow-black/40",
        muted && "opacity-55 grayscale",
        sizeClass,
        className
      )}
      style={{ borderColor: "var(--poker-card-border)" }}
    >
      <svg viewBox="0 0 100 140" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--poker-card-bg-soft)" />
            <stop offset="42%" stopColor="var(--poker-card-bg)" />
            <stop offset="100%" stopColor="var(--poker-card-bg-deep)" />
          </linearGradient>
          <radialGradient id={`${uid}glow`} cx="50%" cy="40%" r="65%">
            <stop offset="0%" stopColor="rgba(255,232,171,0.16)" />
            <stop offset="55%" stopColor="rgba(255,232,171,0.03)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
          <radialGradient id={`${uid}vig`} cx="50%" cy="50%" r="72%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.30)" />
          </radialGradient>
        </defs>

        <rect width="100" height="140" fill={`url(#${uid}bg)`} />
        <rect width="100" height="140" fill={`url(#${uid}glow)`} />
        <rect width="100" height="140" fill={`url(#${uid}vig)`} />

        {/* Double border. */}
        <rect x="4" y="4" width="92" height="132" rx="9" fill="none" stroke="var(--poker-card-border)" strokeWidth="1.6" opacity="0.95" />
        <rect x="8" y="8" width="84" height="124" rx="6" fill="none" stroke="var(--poker-card-border)" strokeWidth="0.9" opacity="0.55" />

        {/* Guilloché rosette. */}
        <g transform="translate(50 70)">
          {Array.from({ length: rosetteCount }).map((_, i) => (
            <ellipse
              key={`o${i}`}
              rx={rRx}
              ry={rRy}
              transform={`rotate(${(360 / rosetteCount) * i})`}
              fill="none"
              stroke="var(--poker-card-line)"
              strokeWidth={compact ? 0.5 : 0.6}
              opacity={compact ? 0.4 : 0.6}
            />
          ))}
          {Array.from({ length: innerCount }).map((_, i) => (
            <ellipse
              key={`i${i}`}
              rx={16}
              ry={37}
              transform={`rotate(${(360 / innerCount) * i + 5})`}
              fill="none"
              stroke="var(--poker-card-line)"
              strokeWidth={0.5}
              opacity={0.55}
            />
          ))}
          {!compact && (
            <>
              <circle r="33" fill="none" stroke="var(--poker-card-line)" strokeWidth="0.6" opacity="0.32" />
              <circle r="25" fill="none" stroke="var(--poker-card-line)" strokeWidth="0.5" opacity="0.32" />
            </>
          )}
        </g>

        {/* Medallion + V monogram. */}
        <circle cx="50" cy="70" r={medR + (compact ? 3 : 4)} fill="none" stroke="var(--poker-card-border)" strokeWidth="0.8" opacity="0.6" />
        <circle cx="50" cy="70" r={medR} fill="var(--poker-card-medallion)" stroke="var(--poker-card-border)" strokeWidth="1.1" />
        {!compact && (
          <path d="M45 54 L48 59 L50 52 L52 59 L55 54 L54 61 L46 61 Z" fill="var(--poker-card-border)" opacity="0.7" />
        )}
        <text
          x="50"
          y={compact ? 71 : 72}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--poker-card-text)"
          fontSize={vSize}
          fontWeight="700"
          fontFamily="Georgia, 'Times New Roman', serif"
        >
          V
        </text>
      </svg>
    </div>
  );
}

export function TrackerVisualStyles() {
  return (
    <style>
      {`
        @keyframes tracker-card-reveal {
          from { opacity: 0; transform: translateY(-12px) rotate(-3deg) scale(.92); }
          to { opacity: 1; transform: translateY(0) rotate(0deg) scale(1); }
        }
        @keyframes tracker-seat-pop {
          0% { transform: translate(-50%, -50%) scale(.94); opacity: .7; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        /* Subtle breathing — depth via a soft drop shadow, NOT a neon outer glow. */
        @keyframes tracker-pot-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 1px 6px rgba(0, 0, 0, .4); }
          50% { transform: scale(1.03); box-shadow: 0 2px 12px rgba(0, 0, 0, .5); }
        }
        /* One-shot chip pulse when a seat commits chips this street (Live Action Engine, cosmetic). */
        @keyframes tracker-bet-pulse {
          0% { transform: scale(.7); opacity: 0; }
          50% { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes tracker-glow-sweep {
          from { transform: translateX(-110%) skewX(-18deg); opacity: .12; }
          to { transform: translateX(210%) skewX(-18deg); opacity: .28; }
        }
        /* liveTableFx: a chip flies from a seat to the pot — anticipation pop-in, a
           lifted arc apex (55%), ease-out landing. left/top travel = container-% path. */
        @keyframes tracker-chip-push {
          0%   { left: var(--cp-fx); top: var(--cp-fy); transform: translate(-50%,-50%) scale(.6); opacity: 0; }
          12%  { left: var(--cp-fx); top: var(--cp-fy); transform: translate(-50%,-50%) scale(1.05); opacity: 1; }
          55%  { left: calc((var(--cp-fx) + var(--cp-tx)) / 2);
                 top:  calc((var(--cp-fy) + var(--cp-ty)) / 2 - 6%);
                 transform: translate(-50%,-50%) scale(1); opacity: 1; }
          100% { left: var(--cp-tx); top: var(--cp-ty); transform: translate(-50%,-50%) scale(.92); opacity: 0; }
        }
        .tracker-card-reveal { animation: tracker-card-reveal .36s cubic-bezier(.2,.7,.2,1) both; }
        .tracker-seat-pop { animation: tracker-seat-pop .22s ease-out both; }
        .tracker-pot-pulse { animation: tracker-pot-pulse 1.4s ease-in-out infinite; }
        .tracker-bet-pulse { animation: tracker-bet-pulse .42s ease-out both; }
        .tracker-chip-push {
          position: absolute; left: var(--cp-fx); top: var(--cp-fy);
          width: 14px; height: 14px; border-radius: 9999px;
          background: radial-gradient(circle at 35% 30%, #ffe7a8, #f5b340 60%, #9a6418 100%);
          box-shadow: 0 0 0 1.5px rgba(154,100,24,.85), 0 2px 6px rgba(0,0,0,.5);
          animation: tracker-chip-push 520ms cubic-bezier(.22,.61,.36,1) both;
          pointer-events: none;
        }
        .tracker-felt {
          background:
            radial-gradient(circle at 50% 38%, rgba(88, 23, 35, .96), rgba(43, 11, 19, .98) 58%, rgba(12, 13, 16, .98) 100%),
            repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.055) 0 1px, transparent 1px 6px);
        }
        .tracker-brass-ring {
          box-shadow:
            inset 0 0 0 10px rgba(245, 179, 64, .34),
            inset 0 0 0 17px rgba(112, 63, 26, .58),
            inset 0 0 58px rgba(0,0,0,.52),
            0 34px 90px rgba(0,0,0,.42);
        }
        .tracker-shine::before {
          content: "";
          position: absolute;
          inset: 0;
          width: 42%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.14), transparent);
          animation: tracker-glow-sweep 3.8s ease-in-out infinite;
          pointer-events: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .tracker-card-reveal,
          .tracker-seat-pop,
          .tracker-pot-pulse,
          .tracker-bet-pulse,
          .tracker-chip-push,
          .tracker-shine::before {
            animation: none !important;
          }
        }
      `}
    </style>
  );
}

export function TrackerStat({
  label,
  value,
  children,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-amber-200/15 bg-black/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200/60">{label}</div>
      <div className="mt-1 font-mono text-sm font-bold text-amber-100">{value}</div>
      {children}
    </div>
  );
}
