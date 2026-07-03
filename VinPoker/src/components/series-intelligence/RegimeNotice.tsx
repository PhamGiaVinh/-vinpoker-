import { Landmark, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { useRegimeOverride } from "@/lib/series-intelligence/useRegimeOverride";

/**
 * Regime caveat (lớp chế độ — framework North Star): every forward-looking number carries the implicit
 * assumption "the current market/legal regime holds". A regime break (law change, full legalization,
 * crackdown) is a step change no model trained on old data can bridge — so instead of pretending to
 * forecast through it, we print the assumption right next to the numbers.
 *
 * DEFAULT = static caveat. When the owner has LOCALLY marked "regime changed" (RegimeSwitch, gated
 * `seriesRegimeSwitch`), this escalates to an active warning. The mark is browser-local only (never a
 * club setting) — the switch's own copy states that; here we only reflect its state.
 * Gated by FEATURES.seriesRegimeNotice; renders nothing while the flag is off.
 */
export function RegimeNotice({ tone = "default", className }: { tone?: "default" | "felt"; className?: string }) {
  const { mark } = useRegimeOverride();
  if (!FEATURES.seriesRegimeNotice) return null;
  const felt = tone === "felt";

  if (FEATURES.seriesRegimeSwitch && mark.changed) {
    return (
      <p
        className={cn(
          "flex items-start gap-1.5 text-[10px] leading-snug font-sans font-medium",
          felt ? "text-[var(--gold2)]" : "text-destructive",
          className,
        )}
      >
        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>
          <b>Bạn đã đánh dấu chế độ THAY ĐỔI</b> (cục bộ trên máy này) — các số dựa trên dữ liệu cũ nên{" "}
          <b>bỏ, đánh giá lại theo kịch bản</b>, không hiệu chỉnh xuyên cú gãy.
        </span>
      </p>
    );
  }

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[10px] leading-snug font-sans",
        felt ? "text-[var(--mut)]" : "text-muted-foreground",
        className,
      )}
    >
      <Landmark className={cn("mt-0.5 h-3 w-3 shrink-0", felt ? "text-[var(--gold2)]" : "text-primary")} aria-hidden />
      <span>
        <b className={felt ? "text-[var(--cream)]" : "text-foreground"}>Giả định:</b> chế độ thị trường/pháp lý hiện
        tại còn giữ — nếu luật thay đổi (siết hoặc mở hẳn), các số dựa trên dữ liệu cũ <b>không còn tin được</b> và
        cần vứt để đánh giá lại theo kịch bản, không hiệu chỉnh.
      </span>
    </p>
  );
}
