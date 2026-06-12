import type { TvData } from "@/types/tv";
import { TvHeader } from "./TvHeader";
import { TvBreakOverlay } from "./TvBreakOverlay";
import { TvStatsBar } from "./TvStatsBar";
import { TvTicker } from "./TvTicker";

/**
 * Operator-forced break layout (tv_displays.layout = 'break_screen').
 * Same chrome as TvClockScreen but the break overlay is shown regardless of
 * whether the current level is a scheduled break — for unscheduled pauses,
 * dinner breaks, announcements between flights, etc.
 */
export function TvBreakScreen({ data }: { data: TvData }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col bg-background text-foreground">
      <TvHeader data={data} />
      <TvBreakOverlay data={data} />
      <TvStatsBar data={data} />
      <TvTicker data={data} />
    </div>
  );
}
