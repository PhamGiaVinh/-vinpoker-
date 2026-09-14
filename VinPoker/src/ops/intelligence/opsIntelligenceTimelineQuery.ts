import type { OpsIntelligenceClient } from "./opsIntelligenceQueryOptions";
import { parseOpsIntelligenceTimelineV1 } from "./opsIntelligenceTimelineV1";

type TimelineRpcClient = { rpc(name: "get_ops_intelligence_timeline_v1", params: { p_club_id: string; p_tournament_id: string }): PromiseLike<{ data: unknown; error: unknown }> };

export function timelineQueryOptions(client: OpsIntelligenceClient, clubId: string, tournamentId: string) {
  return {
    queryKey: ["ops", clubId, "intelligence", "timeline-v1", tournamentId] as const,
    queryFn: async () => {
      const { data, error } = await (client as unknown as TimelineRpcClient).rpc("get_ops_intelligence_timeline_v1", { p_club_id: clubId, p_tournament_id: tournamentId });
      if (error) throw new Error("OPERATIONAL_TIMELINE_READ_UNAVAILABLE");
      return { value: parseOpsIntelligenceTimelineV1(data, clubId, tournamentId), observedAt: new Date().toISOString() };
    },
  };
}
