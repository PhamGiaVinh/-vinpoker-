import { cn } from "@/lib/utils";

/**
 * CompactMetricCard — ô số tóm tắt (nhãn nhỏ trên, số to dưới). Số đếm không có "đ".
 * docs/design/ios-operations-components.md §15.
 */
export function CompactMetricCard({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "primary" | "danger";
  className?: string;
}) {
  const valueCls =
    tone === "primary" ? "text-primary" : tone === "danger" ? "text-rose-400" : "text-foreground";
  return (
    <div className={cn("rounded-xl bg-muted/40 p-3 text-center", className)}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold leading-none", valueCls)}>{value}</div>
    </div>
  );
}
