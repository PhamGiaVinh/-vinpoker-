import type { CSSProperties, ReactNode } from "react";
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
}: {
  card?: string | null;
  hidden?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
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
    >
      <div className="absolute inset-1 rounded-[inherit] border border-black/10" />
      <div className="absolute inset-0 flex items-center justify-center gap-0.5 text-[1.35em]">
        <span>{rank}</span>
        <span className="text-[0.9em]">{suit}</span>
      </div>
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
        @keyframes tracker-pot-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 18px rgba(251, 191, 36, .22); }
          50% { transform: scale(1.045); box-shadow: 0 0 34px rgba(251, 191, 36, .36); }
        }
        /* One-shot chip pulse when a seat commits chips this street (Live Action Engine, cosmetic). */
        @keyframes tracker-bet-pulse {
          0% { transform: scale(.6); opacity: 0; }
          45% { transform: scale(1.18); opacity: 1; box-shadow: 0 0 14px rgba(251, 191, 36, .5); }
          100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 rgba(251, 191, 36, 0); }
        }
        @keyframes tracker-glow-sweep {
          from { transform: translateX(-110%) skewX(-18deg); opacity: .12; }
          to { transform: translateX(210%) skewX(-18deg); opacity: .28; }
        }
        .tracker-card-reveal { animation: tracker-card-reveal .36s cubic-bezier(.2,.7,.2,1) both; }
        .tracker-seat-pop { animation: tracker-seat-pop .22s ease-out both; }
        .tracker-pot-pulse { animation: tracker-pot-pulse 1.4s ease-in-out infinite; }
        .tracker-bet-pulse { animation: tracker-bet-pulse .42s ease-out both; }
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
