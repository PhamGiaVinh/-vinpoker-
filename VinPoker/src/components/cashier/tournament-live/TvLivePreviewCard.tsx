import { useState, type ReactNode } from "react";
import { Tv, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Live preview of what this tournament's paired TVs are showing — the real /tv screen
 * embedded in an iframe. It auto-scales to the 16:9 box (the iframe is its own viewport,
 * so the clock's vmin sizing renders correctly) and, being same-origin, inherits the
 * operator's session. No `allow="fullscreen"` → document.fullscreenEnabled is false inside
 * the frame, which suppresses TvChrome's kiosk fullscreen prompt in the embed.
 *
 * "Trực tiếp" = the real /tv for this tournament (what the paired TVs display now).
 * "Demo mẫu" = /tv?mock=1, a self-running sample clock for a quick look at the UI.
 */
export function TvLivePreviewCard({ tournamentId, action }: { tournamentId: string; action?: ReactNode }) {
  const [mock, setMock] = useState(false);
  const src = `/tv/${tournamentId}${mock ? "?mock=1" : ""}`;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Tv className="w-4 h-4 text-emerald-400" />
          Màn hình TV đang chạy
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={mock ? "outline" : "default"} className="h-7 px-2.5 text-xs" onClick={() => setMock(false)}>
            Trực tiếp
          </Button>
          <Button size="sm" variant={mock ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={() => setMock(true)}>
            Demo mẫu
          </Button>
          <a href={src} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> Mở
          </a>
        </div>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
      <p className="text-xs text-muted-foreground">
        {mock
          ? "Mẫu tự chạy (dữ liệu demo) — xem nhanh giao diện đồng hồ TV."
          : "Đúng những gì màn hình TV của giải này đang hiển thị (đồng hồ trực tiếp)."}
      </p>
      <div className="overflow-hidden rounded-lg border border-border bg-black">
        <iframe
          key={src}
          src={src}
          title="Xem trước màn hình TV"
          loading="lazy"
          style={{ aspectRatio: "16 / 9", width: "100%", display: "block", border: 0 }}
        />
      </div>
    </Card>
  );
}
