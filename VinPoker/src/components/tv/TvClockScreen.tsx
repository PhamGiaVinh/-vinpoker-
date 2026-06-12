import type { TvData } from "@/types/tv";
import { TvHeader } from "./TvHeader";
import { TvTimer } from "./TvTimer";
import { TvBlindsPanel } from "./TvBlindsPanel";
import { TvStatsBar } from "./TvStatsBar";
import { TvBreakOverlay } from "./TvBreakOverlay";
import { TvTicker } from "./TvTicker";

/**
 * Pure presentational 16:9 TV layout. Receives one TvData prop —
 * mock (PR A) or live (PR B) — and renders identically for both.
 * Below the lg breakpoint the three middle columns stack for tablets.
 */
export function TvClockScreen({ data }: { data: TvData }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col bg-background text-foreground">
      <TvHeader data={data} />
      {data.isBreak ? (
        <TvBreakOverlay data={data} />
      ) : (
        <main className="grid grid-cols-1 items-center gap-[2vmin] px-[3vmin] py-[2vmin] lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_2.2fr_1fr]">
          <div className="order-2 lg:order-1">
            <TvBlindsPanel data={data} side="current" />
          </div>
          <div className="order-1 lg:order-2">
            <TvTimer data={data} />
          </div>
          <div className="order-3">
            <TvBlindsPanel data={data} side="next" />
          </div>
        </main>
      )}
      <TvStatsBar data={data} />
      <TvTicker data={data} />
    </div>
  );
}
