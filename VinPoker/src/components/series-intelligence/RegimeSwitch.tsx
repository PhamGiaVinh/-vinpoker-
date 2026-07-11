import { useState } from "react";
import { Landmark, TriangleAlert, MonitorSmartphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/featureFlags";
import { useRegimeOverride } from "@/lib/series-intelligence/useRegimeOverride";
import {
  MAX_REGIME_NOTE_LEN,
  REGIME_WATCHLIST,
  watchlistSuggestsRegimeChange,
} from "@/lib/series-intelligence/regimeOverride";

/**
 * RegimeSwitch — lets the owner mark "chế độ đã thay đổi" (regime break) for the current market/legal
 * environment, escalating every forward-looking caveat. LOCAL-ONLY: stored in this browser only — the
 * copy states plainly it is NOT a club-wide setting and other people/devices/agents don't see it.
 * Gated by FEATURES.seriesRegimeSwitch (and self-hidden when seriesRegimeNotice is off, since the
 * escalation rides the RegimeNotice caveat).
 */
export function RegimeSwitch({ clubId }: { clubId?: string } = {}) {
  // TP8: scope the mark per-club ONLY when seriesRegimeTripwire is on (else undefined ⇒ legacy global mark).
  const { mark, setChanged } = useRegimeOverride(FEATURES.seriesRegimeTripwire ? clubId : undefined);
  const [note, setNote] = useState(mark.note);
  const [watch, setWatch] = useState<boolean[]>(() => REGIME_WATCHLIST.map(() => false));
  if (!FEATURES.seriesRegimeSwitch || !FEATURES.seriesRegimeNotice) return null;

  const on = mark.changed;
  const watchCount = watch.filter(Boolean).length;
  return (
    <Card className={cn("p-3 space-y-2 text-xs", on ? "border-destructive/50 bg-destructive/5" : "gradient-card border-primary/40")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display text-sm flex items-center gap-2">
          <Landmark className={cn("h-4 w-4", on ? "text-destructive" : "text-primary")} />
          Chế độ thị trường / pháp lý
        </h4>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className={cn("text-[11px]", on ? "text-destructive font-medium" : "text-muted-foreground")}>
            {on ? "Đã đánh dấu THAY ĐỔI" : "Đang bình thường"}
          </span>
          <Switch
            checked={on}
            onCheckedChange={(v) => setChanged(v, note)}
            aria-label="Đánh dấu chế độ đã thay đổi"
          />
        </label>
      </div>

      <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
        <MonitorSmartphone className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          <strong>Ghi chú cục bộ trên máy này</strong> — chỉ lưu trên trình duyệt hiện tại,{" "}
          <strong>KHÔNG phải cài đặt chung của CLB</strong>. Người khác, máy khác, agent khác không thấy dấu này.
        </span>
      </p>

      {on && (
        <>
          <p className="flex items-start gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-1.5 text-[10px] text-destructive">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            Khi đã đánh dấu: các số dự báo/EV dựa trên dữ liệu cũ nên <strong>bỏ, đánh giá lại theo kịch bản</strong> —
            không hiệu chỉnh xuyên cú gãy chế độ.
          </p>
          <div className="space-y-1">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_REGIME_NOTE_LEN))}
              onBlur={() => setChanged(true, note)}
              placeholder="Ghi chú (tùy chọn): thay đổi gì? (vd: luật siết cấp phép, mở hợp pháp hóa…)"
              className="h-14 text-[11px]"
            />
            {mark.markedAt && (
              <div className="text-[9.5px] text-muted-foreground">
                Đánh dấu lúc: {new Date(mark.markedAt).toLocaleString("vi-VN")} · {note.length}/{MAX_REGIME_NOTE_LEN}
              </div>
            )}
          </div>
        </>
      )}
      {FEATURES.seriesRegimeTripwire && (
        <div className="space-y-1 rounded-md border border-border/60 bg-card/40 p-2">
          <div className="text-[10px] font-medium text-muted-foreground">
            Dấu hiệu chế độ có thể đã đổi <span className="font-normal">(đánh dấu để tự nhắc — chỉ trên máy này)</span>
          </div>
          <div className="grid grid-cols-1 gap-1">
            {REGIME_WATCHLIST.map((label, i) => (
              <label key={label} className="flex items-center gap-2 text-[11px]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[hsl(var(--warning))]"
                  checked={watch[i]}
                  onChange={(e) => setWatch((w) => w.map((v, j) => (j === i ? e.target.checked : v)))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {watchlistSuggestsRegimeChange(watchCount) && !on && (
            <p className="flex items-start gap-1 rounded-md border border-warning/40 bg-warning/10 p-1.5 text-[10px] text-warning">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              Có {watchCount} dấu hiệu — cân nhắc gạt cờ "chế độ đã thay đổi" ở trên (chỉ gợi ý, không tự bật).
            </p>
          )}
        </div>
      )}
      <div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground" onClick={() => { setNote(""); setChanged(false, ""); }} disabled={!on && note === ""}>
          Xóa dấu / về bình thường
        </Button>
      </div>
    </Card>
  );
}
