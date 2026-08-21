export type TrackerAnalyticsMetricKey =
  | "vpip"
  | "pfr"
  | "threeBet"
  | "foldToThreeBet"
  | "fourBet"
  | "fiveBet"
  | "wtsd"
  | "wsd"
  | "wwsf"
  | "flopCbet"
  | "turnCbet"
  | "foldToCbet"
  | "checkRaise"
  | "aggressionFrequency";

export interface TrackerAnalyticsMetric {
  numerator: number;
  denominator: number;
  percentage: number | null;
  sampleSize: number;
  metricVersion: string;
}

export interface TrackerPlayerAnalyticsResponse {
  ok: true;
  player: { id: string; name: string; avatar_url: string | null };
  tournament_id: string;
  days: number;
  truncated: boolean;
  analytics: {
    metricVersion: string;
    handsObserved: number;
    proofCoverage: { verified: number; required: number };
    unavailableMetrics: TrackerAnalyticsMetricKey[];
    metrics: Record<TrackerAnalyticsMetricKey, TrackerAnalyticsMetric>;
  };
}

export async function loadTrackerPlayerAnalytics(input: {
  tournamentId: string;
  playerId: string;
  days: 0 | 30 | 90 | 365;
}): Promise<TrackerPlayerAnalyticsResponse> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.functions.invoke("tracker-player-analytics", {
    body: {
      tournament_id: input.tournamentId,
      player_id: input.playerId,
      days: input.days,
    },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const payload = await context.clone().json() as { error?: string };
        throw new Error(payload.error ?? error.message);
      } catch (caught) {
        if (caught instanceof Error && caught.message !== error.message) throw caught;
      }
    }
    throw new Error(error.message);
  }
  const response = data as Partial<TrackerPlayerAnalyticsResponse> | null;
  if (response?.ok !== true || response.tournament_id !== input.tournamentId || response.player?.id !== input.playerId) {
    throw new Error("ANALYTICS_SCOPE_MISMATCH");
  }
  return response as TrackerPlayerAnalyticsResponse;
}
