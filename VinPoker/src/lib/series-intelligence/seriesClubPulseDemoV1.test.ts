import { describe, expect, it } from "vitest";
import {
  createSeriesClubPulseDemoV1,
  mapSeriesClubPulseDemoToCopilotContextV1,
  SERIES_CLUB_PULSE_DEMO_CLUB_ID,
  SERIES_CLUB_PULSE_DEMO_VALUES,
} from "./seriesClubPulseDemoV1";
import { createMockSeriesCopilotContextV1 } from "./seriesCopilotMockAdapter";

describe("seriesClubPulseDemoV1", () => {
  it("creates a complete strict demo pulse without unavailable metrics", () => {
    const pulse = createSeriesClubPulseDemoV1("2026-08-11T12:34:56.789Z");

    expect(pulse.clubId).toBe(SERIES_CLUB_PULSE_DEMO_CLUB_ID);
    expect(pulse.asOf).toBe("2026-08-11T12:34:56.789Z");
    expect(pulse.clubLocalDate).toBe("2026-08-11");
    expect(pulse.entriesToday.value).toBe(SERIES_CLUB_PULSE_DEMO_VALUES.entriesToday);
    expect(pulse.playersPlayingNow.value).toBe(52);
    expect(pulse.dataQuality).toEqual({ unavailableMetricIds: [], partialMetricIds: [], staleMetricIds: [] });
    expect(Object.isFrozen(pulse)).toBe(true);
  });

  it("keeps the V context explicitly local and illustrative", () => {
    const pulse = createSeriesClubPulseDemoV1("2026-08-11T12:34:56.789Z");
    const context = mapSeriesClubPulseDemoToCopilotContextV1(pulse);

    expect(context.sourceMode).toBe("mock_local_fixture");
    expect(context.metrics).toHaveLength(7);
    expect(context.metrics.find((metric) => metric.metricId === "players_playing_now")?.value).toBe(52);
  });

  it("builds a valid V context from the complete demo pulse", async () => {
    const pulse = createSeriesClubPulseDemoV1("2026-08-11T12:34:56.789Z");
    const context = await createMockSeriesCopilotContextV1(mapSeriesClubPulseDemoToCopilotContextV1(pulse));

    expect(context.clubPulse.metrics).toHaveLength(7);
    expect(context.dataGaps.map((gap) => gap.dataGapId)).toEqual(["gap_satellite_conversion"]);
  });
});
