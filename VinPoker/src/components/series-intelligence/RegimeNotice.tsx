import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";

/**
 * Regime caveat (lớp chế độ, STATIC — framework North Star): every forward-looking number carries the
 * implicit assumption "the current market/legal regime holds". A regime break (law change, full
 * legalization, crackdown) is a step change no model trained on old data can bridge — so instead of
 * pretending to forecast through it, we print the assumption right next to the numbers.
 *
 * Text-only, no state, no interactivity. (An owner-flippable "regime changed" switch is a separate,
 * deferred increment — it needs a real club-level setting + audit trail, not localStorage.)
 * Gated by FEATURES.seriesRegimeNotice; renders nothing while the flag is off.
 */
export function RegimeNotice({ tone = "default", className }: { tone?: "default" | "felt"; className?: string }) {
  if (!FEATURES.seriesRegimeNotice) return null;
  const felt = tone === "felt";
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
