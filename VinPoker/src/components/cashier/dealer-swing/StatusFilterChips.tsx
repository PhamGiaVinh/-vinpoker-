/**
 * StatusFilterChips — battle-map status filter for the Dealer Control operator
 * panel (UI polish). One row of pill chips with live counts; clicking filters
 * the visual table map by the 7-status system (see dealerStatusStyle.ts).
 * PRESENTATION ONLY: receives per-status counts + active filter, emits the next
 * filter. Status kinds + colors come from the shared dealerStatusStyle so chips,
 * cards and legend stay in lockstep. Never changes swing/timer logic.
 */

import { dealerStatusStyle, DEALER_STATUS_ORDER, type DealerTableStatus } from "./dealerStatusStyle";

export type StatusFilterValue = "all" | DealerTableStatus;

export interface StatusFilterChipsProps {
  counts: Record<StatusFilterValue, number>;
  value: StatusFilterValue;
  onChange: (next: StatusFilterValue) => void;
}

interface Chip {
  value: StatusFilterValue;
  label: string;
  dot: string;
  activeText: string;
}

const CHIPS: Chip[] = [
  { value: "all", label: "Tất cả", dot: "bg-muted-foreground", activeText: "text-primary" },
  ...DEALER_STATUS_ORDER.map((k): Chip => ({
    value: k,
    label: dealerStatusStyle[k].label,
    dot: dealerStatusStyle[k].dot,
    activeText: dealerStatusStyle[k].text,
  })),
];

export default function StatusFilterChips({ counts, value, onChange }: StatusFilterChipsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lọc bàn theo trạng thái">
      {CHIPS.map((chip) => {
        const active = value === chip.value;
        const count = counts[chip.value] ?? 0;
        return (
          <button
            key={chip.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(chip.value)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              active
                ? `border-primary/60 bg-primary/10 ${chip.activeText}`
                : "border-border text-muted-foreground bg-card/40 hover:border-border",
            ].join(" ")}
          >
            <span className={["w-1.5 h-1.5 rounded-full", chip.dot].join(" ")} aria-hidden="true" />
            <span>{chip.label}</span>
            <span className="tabular-nums text-[11px] opacity-80">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
