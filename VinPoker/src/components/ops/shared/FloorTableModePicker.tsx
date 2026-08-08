import { Check, HandCoins, MonitorPlay, RadioTower, UsersRound } from "lucide-react";
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
              "group overflow-hidden rounded-2xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c9a86a]/50 disabled:cursor-not-allowed disabled:opacity-55",
              selected
                ? "border-[#c9a86a]/75 bg-[#c9a86a]/10 ring-1 ring-[#c9a86a]/35"
                : "border-white/10 bg-black/15 hover:border-white/25 hover:bg-white/[0.045]",
            )}
          >
            <div className={cn(
              "relative flex h-28 items-center justify-center overflow-hidden border-b",
              tracker
                ? "border-sky-300/15 bg-sky-400/[0.07]"
                : "border-[#c9a86a]/15 bg-[#c9a86a]/[0.07]",
            )} aria-hidden="true">
              <span className={cn(
                "absolute h-24 w-24 rounded-full border opacity-70",
                tracker ? "border-sky-300/30" : "border-[#c9a86a]/35",
              )} />
              <span className={cn(
                "absolute h-16 w-16 rounded-full border opacity-80",
                tracker ? "border-sky-300/35" : "border-[#c9a86a]/40",
              )} />
              {tracker ? (
                <>
                  <MonitorPlay className="relative h-11 w-11 text-sky-200" strokeWidth={1.5} />
                  <RadioTower className="absolute bottom-4 right-[calc(50%-46px)] h-4 w-4 text-sky-300" />
                  <span className="absolute left-[calc(50%-55px)] top-4 rounded-full border border-sky-300/35 bg-sky-300/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-sky-100">LIVE</span>
                </>
              ) : (
                <>
                  <HandCoins className="relative h-11 w-11 text-[#e0c787]" strokeWidth={1.5} />
                  <UsersRound className="absolute bottom-4 right-[calc(50%-46px)] h-4 w-4 text-[#e0c787]" />
                  <span className="absolute left-[calc(50%-55px)] top-4 rounded-full border border-[#c9a86a]/35 bg-[#c9a86a]/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[#f3ddaa]">FLOOR</span>
                </>
              )}
            </div>

            <span className="block p-3">
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className={cn("block text-[10px] font-medium tracking-[0.14em]", tracker ? "text-sky-200/80" : "text-[#e0c787]/85")}>{item.eyebrow}</span>
                  <span className="mt-1 block text-base font-semibold text-[#f2ece6]">{item.title}</span>
                </span>
                <span className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                  selected ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/30 text-transparent",
                )}>
                  <Check className="h-3.5 w-3.5" />
                </span>
              </span>
              <span className="mt-1.5 block text-xs leading-5 text-[#c8bec4]">{item.description}</span>
              <span className="mt-2 block text-[11px] leading-4 text-[#9b8e97]">{item.note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
