/**
 * SwingBadges — pure leaf badge primitives extracted verbatim from DealerSwingTab (D2 slice 1).
 * No state, no imports beyond props → relocating them is byte-identical at the render level.
 * First step of the D2 decomposition (see docs/dealer-swing/D2_DECOMPOSITION_PLAN.md).
 */

export function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    A: "bg-warning/20 text-warning border-warning/40",
    B: "bg-[hsl(var(--ds-active)_/_0.15)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.4)]",
    C: "bg-warning/20 text-warning border-warning/40",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 border font-bold ${colors[tier] ?? colors.C} rounded-none`}>
      {tier}
    </span>
  );
}

export function TableTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    tournament: "Tournament",
  };
  const colors: Record<string, string> = {
    tournament: "bg-[hsl(var(--ds-active)_/_0.1)] text-[hsl(var(--ds-active))] border-[hsl(var(--ds-active)_/_0.3)]",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 border font-semibold ${colors[type] ?? "bg-primary/10 text-primary border-primary/30"} rounded-none`}>
      {labels[type] ?? type}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "Sẵn sàng": "bg-success/20 text-success",
    "Đang bàn": "bg-[hsl(var(--ds-active)_/_0.2)] text-[hsl(var(--ds-active))]",
    "Đang nghỉ": "bg-warning/20 text-warning",
    "Đang chờ": "bg-[hsl(var(--ds-preassign)_/_0.2)] text-[hsl(var(--ds-preassign))]",
  };
  return (
    <span className={`text-[10px] px-1.5 py-[1px] font-medium ${colors[status] ?? "bg-muted text-muted-foreground"} rounded-none`}>
      {status}
    </span>
  );
}
