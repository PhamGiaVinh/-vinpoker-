import { Scale, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatVndShort } from "@/lib/clubFinance";
import type { GtdOverlayResult } from "@/lib/series-intelligence/gtdOverlay";

/**
 * GTD overlay (estimate) — committed GTD vs an estimate of the prize contribution
 * (entries × buy-in). NOT actual collected prize pool; clearly labelled.
 */
export function GtdOverlayCard({ overlay }: { overlay: GtdOverlayResult }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="font-display text-base flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" /> Overlay GTD (ước tính)
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Chỉ các giải đã đặt GTD · ước tính từ entry × buy-in, không phải prize pool thực thu.
        </p>
      </div>

      {!overlay.available ? (
        <Card className="p-4 border-primary/30 gradient-card text-xs text-muted-foreground">
          Chưa có giải nào đặt GTD. Đặt GTD ở Floor (tạo/sửa giải) để xem overlay ước tính.
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {overlay.rows.map((r) => (
              <Card key={r.event_id} className="p-3 gradient-card border-primary/40 space-y-1">
                <div className="text-sm font-medium truncate">{r.event_name ?? "—"}</div>
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-muted-foreground">GTD cam kết</span>
                  <span>{formatVndShort(r.gtd)}</span>
                </div>
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="text-muted-foreground">Ước tính (entry × buy-in)</span>
                  <span>{r.estimatedActual === null ? "—" : formatVndShort(r.estimatedActual)}</span>
                </div>
                {r.overlay === null ? (
                  <div className="text-[11px] text-muted-foreground">{r.basis}</div>
                ) : r.covered ? (
                  <div className="flex items-center gap-1 text-xs text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> Đủ GTD (ước tính ≥ cam kết)
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> Overlay (có thể phải bù)
                    </span>
                    <span className="text-warning tabular-nums">{formatVndShort(r.overlay)}</span>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/80">{overlay.disclaimer}</p>
        </>
      )}
    </section>
  );
}
