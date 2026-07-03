import { formatVND } from "@/lib/format";

/**
 * Hàng đối soát kỳ vọng / thực tế / chênh lệch — bố cục hàng (không phải bảng) nên
 * tự co giãn tốt ở 390px. Chênh lệch ≠ 0 không bao giờ bị "làm tròn cho khớp".
 */
export function VarianceRow({
  label,
  expected,
  actual,
  note,
}: {
  label: string;
  expected: number;
  actual: number;
  note?: string;
}) {
  const diff = actual - expected;
  const matched = diff === 0;
  return (
    <div className="py-2.5 border-b border-border/60 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-foreground/90">{label}</span>
        <span
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border tabular-nums ${
            matched
              ? "border-primary/40 text-primary bg-primary/10"
              : "border-amber-500/40 text-amber-400 bg-amber-500/10"
          }`}
        >
          {matched ? "Khớp" : `Chênh lệch ${diff > 0 ? "+" : "−"}${formatVND(Math.abs(diff))}`}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-[12px] text-muted-foreground tabular-nums">
        <span>
          Kỳ vọng: <span className="text-foreground/80">{formatVND(expected)}</span>
        </span>
        <span>
          Thực tế: <span className="text-foreground/80">{formatVND(actual)}</span>
        </span>
      </div>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
