import type { TruePrizePool } from "@/lib/series-intelligence/gtdOverlay";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { FEATURES } from "@/lib/featureFlags";
import { loadSeriesEventsForQuant } from "@/ops/series/seriesReadAdapter";
import type { OpsIntelligenceClient, OpsReadEnvelope } from "./opsIntelligenceQueryOptions";

type UntypedRpcClient = {
  rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
};

export function seriesHistoryQueryOptions(client: OpsIntelligenceClient, clubId: string) {
  return {
    queryKey: ["ops", clubId, "quant-q1", "series-history"] as const,
    queryFn: async (): Promise<OpsReadEnvelope<readonly SeriesEvent[]>> => {
      try {
        const value = await loadSeriesEventsForQuant(client, clubId);
        return Object.freeze({ value, availability: "exact", observedAt: new Date().toISOString(), reasonCode: null });
      } catch (error) {
        return Object.freeze({
          value: null,
          availability: "unavailable",
          observedAt: new Date().toISOString(),
          reasonCode: error instanceof Error ? error.message : "SERIES_READ_FAILED",
        });
      }
    },
  };
}

export function selectedPrizePoolQueryOptions(client: OpsIntelligenceClient, clubId: string, eventId: string | null) {
  return {
    queryKey: ["ops", clubId, "quant-q1", "true-prize-pool", eventId ?? "none"] as const,
    enabled: FEATURES.gtdTruePrizePool && eventId !== null,
    queryFn: async (): Promise<OpsReadEnvelope<TruePrizePool>> => {
      if (!eventId) return unavailablePrizePool("PRIZE_POOL_EVENT_MISSING");
      const result = await (client as unknown as UntypedRpcClient).rpc("get_tournament_prize_pool", { p_tournament_id: eventId });
      const observedAt = new Date().toISOString();
      if (result.error) return Object.freeze({ value: null, availability: "unavailable", observedAt, reasonCode: "PRIZE_POOL_READ_FAILED" });
      try {
        const value = parsePrizePool(result.data);
        return Object.freeze({ value, availability: "exact", observedAt, reasonCode: null });
      } catch {
        return Object.freeze({ value: null, availability: "unavailable", observedAt, reasonCode: "PRIZE_POOL_READ_MALFORMED" });
      }
    },
  };
}

export function parsePrizePool(value: unknown): TruePrizePool {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    throw new Error("PRIZE_POOL_READ_MALFORMED");
  }
  const row = value[0] as Record<string, unknown>;
  return Object.freeze({
    prizePool: nonNegativeInteger(row.prize_pool),
    confirmedEntryCount: nonNegativeInteger(row.confirmed_entry_count),
  });
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("PRIZE_POOL_READ_MALFORMED");
  return value;
}

function unavailablePrizePool(reasonCode: string): OpsReadEnvelope<TruePrizePool> {
  return Object.freeze({ value: null, availability: "unavailable", observedAt: "1970-01-01T00:00:00.000Z", reasonCode });
}
