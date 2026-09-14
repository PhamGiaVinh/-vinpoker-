import { Check, RadioTower, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FloorTableControlMode } from "@/lib/floorTableControlMode";

type ModeSpec = {
  mode: FloorTableControlMode;
  eyebrow: string;
  title: string;
  description: string;
  note: string;
};

const MODES: readonly ModeSpec[] = [
  {
    mode: "manual",
    eyebrow: "FLOOR ĐIỀU HÀNH",
    title: "Manual Floor",
    description: "Floor quản lý chip và thao tác trực tiếp tại bàn.",
    note: "Loại còn chip được cảnh báo và ghi audit; không payout.",
  },
  {
    mode: "tracker",
    eyebrow: "BÀN LIVE",
    title: "Live Tracker",
    description: "Tracker là nguồn chip cho bàn có hand live.",
    note: "Chỉ loại khi chip đã về 0; phải chọn trước khi bắt đầu hand.",
  },
];

/**
 * Visual, accessible control-mode choice. The illustration is made from local
 * UI primitives rather than external images, so it works offline and conveys
 * meaning together with the visible policy text.
 */
export function FloorTableModePicker({
  value,
  onChange,
  disabled = false,
  testIdPrefix = "floor-open-mode",
}: {
  value: FloorTableControlMode;
  onChange: (mode: FloorTableControlMode) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Chọn loại bàn">
      {MODES.map((item) => {
        const selected = value === item.mode;
        const tracker = item.mode === "tracker";

        return (
          <button
            key={item.mode}
            type="button"
            data-ops-action="floor.tables.select_control_mode"
            role="radio"
            data-testid={`${testIdPrefix}-${item.mode}`}
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(item.mode)}
            className={cn(
              "group min-h-[88px] rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-55",
              selected
                ? "border-[#c9a86a]/75 bg-[#c9a86a]/10 ring-1 ring-[#c9a86a]/35"
                : "border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/[0.045]",
            )}
          >
            <span className="flex items-start gap-3">
              <span className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-lg border",
                tracker ? "border-sky-300/25 bg-sky-400/10 text-sky-200" : "border-[#c9a86a]/25 bg-[#c9a86a]/10 text-[#e0c787]",
              )} aria-hidden="true">
                {tracker ? <RadioTower className="h-5 w-5" /> : <UsersRound className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span>
                    <span className={cn("block text-[9px] font-medium tracking-[0.12em]", tracker ? "text-sky-200/80" : "text-[#e0c787]/85")}>{item.eyebrow}</span>
                    <span className="mt-0.5 block text-sm font-semibold text-[#f2ece6]">{item.title}</span>
                  </span>
                  <span className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                    selected ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/30 text-transparent",
                  )}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-4 text-[#c8bec4]">{item.description}</span>
                <span className="mt-1 block text-[11px] leading-4 text-[#9b8e97]">{item.note}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
