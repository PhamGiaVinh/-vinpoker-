import type { TableCardDealer } from "./TableCard.types";

interface DealerRowBadge {
  label: string;
  color: "green" | "yellow" | "red" | "gray";
}

interface DealerRowProps {
  dealer: TableCardDealer;
  variant?: "primary" | "secondary";
  badge?: DealerRowBadge;
  workDuration?: string;
  accentColor?: string;
}

const TIER_DOT_COLORS: Record<string, string> = {
  A: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]",
  B: "bg-blue-400 shadow-[0_0_6px_rgba(96,165,250,0.6)]",
  C: "bg-zinc-500 shadow-[0_0_6px_rgba(113,113,122,0.4)]",
};

const TIER_BADGE_COLORS: Record<string, string> = {
  A: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  B: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  C: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const BADGE_COLORS: Record<DealerRowBadge["color"], string> = {
  green:  "bg-green-500/20 text-green-400 border-green-500/30",
  yellow: "bg-yellow-500/15 text-yellow-400/80 border-yellow-500/25",
  red:    "bg-red-500/20 text-red-400 border-red-500/30",
  gray:   "bg-zinc-500/15 text-zinc-500 border-zinc-600/20",
};

export function DealerRow({
  dealer,
  variant = "primary",
  badge,
  workDuration,
  accentColor,
}: DealerRowProps) {
  const isPrimary = variant === "primary";

  return (
    <div
      className={[
        "flex items-center gap-2.5 px-2 py-1.5 rounded",
        isPrimary ? "" : "opacity-70 hover:opacity-100 transition-opacity duration-150",
        accentColor ? "border-l-2 pl-2.5" : "",
      ].join(" ")}
      style={accentColor ? { borderLeftColor: accentColor } : undefined}
    >
      {/* Avatar with tier color dot */}
      <div className="relative flex-shrink-0">
        <div
          className={[
            "flex items-center justify-center rounded-full font-bold flex-shrink-0",
            "bg-zinc-700 text-zinc-200",
            isPrimary ? "w-9 h-9 text-sm" : "w-7 h-7 text-[11px]",
          ].join(" ")}
        >
          {dealer.full_name.charAt(0).toUpperCase()}
        </div>
        <div
          className={[
            "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-900",
            TIER_DOT_COLORS[dealer.tier] ?? TIER_DOT_COLORS.C,
          ].join(" ")}
        />
      </div>

      {/* Name + info */}
      <div className="flex-1 min-w-0">
        <div
          className={[
            "font-medium truncate leading-tight",
            isPrimary ? "text-sm text-zinc-100" : "text-xs text-zinc-400",
          ].join(" ")}
        >
          {dealer.full_name}
          {workDuration && isPrimary && (
            <span className="text-[10px] text-zinc-600 font-mono ml-2">
              {workDuration}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* Tier badge */}
          <span
            className={[
              "border rounded px-1.5 font-semibold flex-shrink-0 leading-none",
              isPrimary ? "text-[10px] py-0.5" : "text-[9px] py-px",
              TIER_BADGE_COLORS[dealer.tier] ?? TIER_BADGE_COLORS.C,
            ].join(" ")}
          >
            {dealer.tier}
          </span>

          {/* Source badge */}
          {badge && (
            <span
              className={[
                "border rounded px-1.5 text-[9px] py-px flex-shrink-0 leading-none",
                BADGE_COLORS[badge.color],
              ].join(" ")}
            >
              {badge.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
