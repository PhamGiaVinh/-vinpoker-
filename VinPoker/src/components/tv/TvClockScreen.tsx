import type { TvData } from "@/types/tv";
import { FEATURES } from "@/lib/featureFlags";
import { VinPokerTournamentClock } from "@/components/tournament-clock/VinPokerTournamentClock";
import { mapTvDataToClock } from "@/lib/tv/mapClockData";
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
  // PR Clock-B (flag-gated, default OFF): the new neon-green broadcast clock. It is a
  // self-contained 16:9 display (its own title/stats/blinds/prizes/footer), so it replaces
  // the whole legacy layout. On a break we fall through to the legacy layout below, which
  // renders TvBreakOverlay in its proper flow (the break screen keeps working unchanged).
  if (FEATURES.tournamentClockV2 && !data.isBreak) {
    return (
      <div className="grid min-h-screen w-full place-items-center bg-black">
        <VinPokerTournamentClock data={mapTvDataToClock(data)} />
      </div>
    );
  }

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
