import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildFloorTableNumberOptions,
  type FloorTableCatalogRow,
  type FloorTableNumberState,
} from "./floorTablePresentation";

type PickerFilter = "all" | "available" | "closed";

const FILTERS: readonly { value: PickerFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "available", label: "Có thể mở" },
  { value: "closed", label: "Đã đóng" },
];

const stateLabel: Record<FloorTableNumberState, string> = {
  available: "Có thể mở",
  active: "Đang mở",
  closed: "Mở lại",
};

export function FloorTableNumberPicker({
  rows,
  value,
  onChange,
  disabled = false,
}: {
  rows: readonly FloorTableCatalogRow[];
  value: number | null;
  onChange: (tableNumber: number) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PickerFilter>("all");
  const options = useMemo(() => buildFloorTableNumberOptions(rows), [rows]);
  const visible = useMemo(() => {
    const needle = query.trim();
    return options.filter((option) => {
      if (filter !== "all" && option.state !== filter) return false;
      return needle.length === 0 || String(option.number).includes(needle);
    });
  }, [filter, options, query]);

  return (
    <section aria-labelledby="floor-table-number-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="floor-table-number-heading" className="text-sm font-semibold text-foreground">
            Chọn số bàn
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Bàn đang mở bị khóa. Bàn đã đóng có thể mở lại.
          </p>
        </div>
        <div className="relative w-full sm:w-48">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Tìm số bàn"
            inputMode="numeric"
            value={query}
            onChange={(event) => setQuery(event.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="Tìm số 1–100"
            className="h-10 w-full rounded-xl border border-border bg-background/70 pl-9 pr-3 text-sm text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          />
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Lọc số bàn">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            data-ops-action="floor.tables.filter_number_catalog"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={cn(
              "min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              filter === item.value
                ? "border-primary/55 bg-primary/15 text-primary"
                : "border-border bg-background/60 text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        className="mt-3 grid max-h-[34vh] grid-cols-5 gap-2 overflow-y-auto pr-1 sm:max-h-72 sm:grid-cols-8 lg:grid-cols-10"
        aria-label="Danh sách số bàn từ 1 đến 100"
      >
        {visible.map((option) => {
          const active = option.state === "active";
          const selected = option.number === value;
          return (
            <button
              key={option.number}
              type="button"
              data-ops-action="floor.tables.select_number"
              data-testid="floor-table-number-option"
              data-floor-table-number={option.number}
              disabled={disabled || active}
              aria-label={`Bàn ${option.number} — ${stateLabel[option.state]}`}
              aria-pressed={selected}
              onClick={() => onChange(option.number)}
              className={cn(
                "relative min-h-14 rounded-xl border px-1 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                option.state === "available" && "border-border bg-card/70 text-foreground hover:border-primary/45",
                option.state === "closed" && "border-amber-400/35 bg-amber-400/8 text-amber-100 hover:border-amber-300/70",
                active && "cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground opacity-55",
                selected && "border-primary bg-primary/15 text-primary ring-2 ring-primary/30",
              )}
            >
              <span className="block font-mono text-base font-semibold">{option.number}</span>
              <span className="mt-0.5 block truncate text-[9px] leading-3">
                {stateLabel[option.state]}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
          Không có số bàn phù hợp bộ lọc.
        </p>
      )}
    </section>
  );
}
