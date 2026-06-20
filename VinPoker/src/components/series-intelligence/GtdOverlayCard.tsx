import { Scale, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import {
  resolveOverlay,
  type GtdOverlayResult,
  type TruePrizePool,
} from "@/lib/series-intelligence/gtdOverlay";

/**
 * GTD overlay — committed GTD vs the prize pool. Two-state per event:
 *  - "thực thu (cashier-confirmed)" when the server RPC reports confirmed entries
 *    (GTD #2, behind the flag); else
 *  - "ước tính (entry × buy-in)" fallback (#415).
 * The client never recomputes the true number — it only reads `truePrizeByEvent` (RPC).
 */
export function GtdOverlayCard({
  overlay,
  truePrizeByEvent,
}: {
  overlay: GtdOverlayResult;
  truePrizeByEvent?: Map<string, TruePrizePool> | null;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" /> Overlay GTD
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Chỉ các giải đã đặt GTD · "thực thu" khi có entry đã xác nhận (cashier), nếu chưa thì "ước tính" từ entry × buy-in.
        </p>
      </div>

      {!overlay.available ? (
        <Card className="p-4 border-primary/30 gradient-card text-xs text-muted-foreground">
          Chưa có giải nào đặt GTD. Đặt GTD ở Floor (tạo/sửa giải) để xem overlay.
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {overlay.rows.map((r) => {
              const res = resolveOverlay(r, truePrizeByEvent?.get(r.event_id) ?? null);
              const isTrue = res.source === "true";
              return (
                <Card key={r.event_id} className="p-3 gradient-card border-primary/40 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">{r.event_name ?? "—"}</div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-none",
                        isTrue
                          ? "border-primary/40 text-primary bg-primary/10"
                          : "border-border text-muted-foreground bg-secondary",
                      )}
                    >
                      {res.label}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs tabular-nums">
                    <span className="text-muted-foreground">GTD cam kết</span>
                    <span>{formatVndShort(r.gtd)}</span>
                  </div>
                  <div className="flex justify-between text-xs tabular-nums">
                    <span className="text-muted-foreground">{isTrue ? "Thực thu" : "Ước tính (entry × buy-in)"}</span>
                    <span>{res.prizeValue === null ? "—" : formatVndShort(res.prizeValue)}</span>
                  </div>
                  {res.overlay === null ? (
                    <div className="text-[11px] text-muted-foreground">{r.basis}</div>
                  ) : res.covered ? (
                    <div className="flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Đủ GTD (
                      {isTrue ? "thực thu" : "ước tính"} ≥ cam kết)
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> Overlay (có thể phải bù)
                      </span>
                      <span className="text-warning tabular-nums">{formatVndShort(res.overlay)}</span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground/80">{overlay.disclaimer}</p>
        </>
      )}
    </section>
  );
}
