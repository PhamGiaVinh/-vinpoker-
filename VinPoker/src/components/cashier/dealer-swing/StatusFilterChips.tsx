/**
 * StatusFilterChips — battle-map status filter for the Dealer Swing operator
 * panel (UI Phase 4 operator-panel recompose).
 *
 * PRESENTATION ONLY: one row of pill chips with live counts; clicking a chip
 * filters the visual table map ("BẢN ĐỒ CHIẾN TRƯỜNG") by status. Receives the
 * per-status counts + the active filter as props and emits the next filter via
 * onChange. The status kinds mirror getSwingTableStatus exactly (empty / overdue
 * / due_soon / ok) so the chip counts and the per-card badges never diverge.
 * Never changes swing/timer logic. Stitch Dark / neon-green.
 */

import type { SwingTableStatusKind } from "./swingTableStatus";

export type StatusFilterValue = "all" | SwingTableStatusKind;

export interface StatusFilterChipsProps {
  counts: Record<StatusFilterValue, number>;
  value: StatusFilterValue;
  onChange: (next: StatusFilterValue) => void;
}

interface ChipDef {
  value: StatusFilterValue;
  label: string;
  /** Classes applied only when the chip is the active filter. */
  activeClass: string;
  /** Leading status dot color. */
  dot: string;
}

const CHIPS: ChipDef[] = [
  { value: "all", label: "Tất cả", activeClass: "border-primary text-primary bg-primary/10", dot: "bg-zinc-400" },
  { value: "ok", label: "Ổn định", activeClass: "border-primary text-primary bg-primary/10", dot: "bg-primary" },
  { value: "due_soon", label: "Sắp đến giờ", activeClass: "border-amber-500/60 text-amber-400 bg-amber-500/10", dot: "bg-amber-400" },
  { value: "overdue", label: "Quá hạn", activeClass: "border-red-500/60 text-red-400 bg-red-500/10", dot: "bg-red-400" },
  { value: "empty", label: "Trống", activeClass: "border-zinc-500/60 text-zinc-200 bg-zinc-700/40", dot: "bg-zinc-400" },
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
              active ? chip.activeClass : "border-zinc-700 text-zinc-400 bg-zinc-900/40 hover:border-zinc-600",
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
