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
  A: "bg-warning shadow-[0_0_6px_rgba(251,191,36,0.6)]",
  B: "bg-[hsl(var(--ds-active))] shadow-[0_0_6px_rgba(96,165,250,0.6)]",
  C: "bg-muted-foreground shadow-[0_0_6px_rgba(113,113,122,0.4)]",
};

const TIER_BADGE_COLORS: Record<string, string> = {
  A: "bg-warning/20 text-warning border-warning/30",
  B: "bg-[hsl(var(--ds-active))]/20 text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active))]/30",
  C: "bg-muted-foreground/20 text-muted-foreground border-border/30",
};

const BADGE_COLORS: Record<DealerRowBadge["color"], string> = {
  green:  "bg-success/20 text-success border-success/30",
  yellow: "bg-warning/15 text-warning/80 border-warning/25",
  red:    "bg-destructive/20 text-destructive border-destructive/30",
  gray:   "bg-muted-foreground/15 text-muted-foreground border-border/20",
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
            "bg-secondary text-foreground",
            isPrimary ? "w-9 h-9 text-sm" : "w-7 h-7 text-[11px]",
          ].join(" ")}
        >
          {dealer.full_name.charAt(0).toUpperCase()}
        </div>
        <div
          className={[
            "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-border",
            TIER_DOT_COLORS[dealer.tier] ?? TIER_DOT_COLORS.C,
          ].join(" ")}
        />
      </div>

      {/* Name + info */}
      <div className="flex-1 min-w-0">
        <div
          className={[
            "font-medium truncate leading-tight",
            isPrimary ? "text-sm text-foreground" : "text-xs text-muted-foreground",
          ].join(" ")}
        >
          {dealer.full_name}
          {workDuration && isPrimary && (
            <span className="text-[10px] text-muted-foreground font-mono ml-2">
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
