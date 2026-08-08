import { useEffect, useMemo, useState } from "react";
import { FEATURES } from "@/lib/featureFlags";
import { getDecisionEventState } from "./decisionPacketRpc";
import type { DecisionEventStateResponse } from "./decisionPacketRuntimeTypes";
import type { SeriesEvent } from "./nativeData";
import { buildTrustedForecastHistoryV1, type TrustedForecastHistoryExclusion, type TrustedForecastHistoryResult } from "./trustedForecastHistoryV1";

export type TrustedForecastHistoryStatus = "disabled" | "loading" | "ready" | "unavailable";

export interface TrustedForecastHistoryData {
  readonly status: TrustedForecastHistoryStatus;
  readonly result: TrustedForecastHistoryResult;
  readonly reason: string | null;
}

const EMPTY_RESULT: TrustedForecastHistoryResult = Object.freeze({
  version: "series-trusted-forecast-history-v1",
  asOfTs: "1970-01-01T00:00:00.000Z",
  events: Object.freeze([]),
  exclusions: Object.freeze([]),
});

function candidateEventIds(events: readonly { readonly id: string; readonly start_time: string | null; readonly status: string | null }[], asOfTs: string): string[] {
  const asOfMs = Date.parse(asOfTs);
  return events
    .filter((event) => event.status === "completed" && event.start_time !== null && Number.isFinite(Date.parse(event.start_time)) && Date.parse(event.start_time) < asOfMs)
    .map((event) => event.id)
    .sort();
}

export function useTrustedForecastHistory(input: {
  readonly enabled: boolean;
  readonly clubId: string | null;
  readonly asOfTs: string;
  readonly nativeEvents: readonly SeriesEvent[];
  readonly captureEvents: readonly { readonly id: string; readonly start_time: string | null; readonly status: string | null }[];
}): TrustedForecastHistoryData {
  const ids = useMemo(() => candidateEventIds(input.captureEvents, input.asOfTs), [input.captureEvents, input.asOfTs]);
  const candidateKey = ids.join("|");
  const [state, setState] = useState<TrustedForecastHistoryData>({ status: "disabled", result: EMPTY_RESULT, reason: null });

  useEffect(() => {
    if (!input.enabled || !FEATURES.seriesProspectiveResearchCohortV1 || !input.clubId) {
      setState({ status: "disabled", result: EMPTY_RESULT, reason: null });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", result: EMPTY_RESULT, reason: null });
    (async () => {
      const responses = await Promise.all(ids.map(async (eventId) => ({ eventId, response: await getDecisionEventState(eventId) })));
      if (cancelled) return;
      const statesByEventId: Record<string, DecisionEventStateResponse | null> = {};
      const failures: string[] = [];
      for (const item of responses) {
        if (item.response.ok) statesByEventId[item.eventId] = item.response.value;
        else {
          statesByEventId[item.eventId] = null;
          failures.push(`${item.eventId}:${item.response.error}`);
        }
      }
      const result = buildTrustedForecastHistoryV1({
        asOfTs: input.asOfTs,
        events: input.nativeEvents,
        statesByEventId,
      });
      setState({
        status: failures.length > 0 && result.events.length === 0 ? "unavailable" : "ready",
        result,
        reason: failures.length > 0 ? `D2B read unavailable: ${failures.join(", ")}` : null,
      });
    })().catch((error: unknown) => {
      if (!cancelled) setState({ status: "unavailable", result: EMPTY_RESULT, reason: error instanceof Error ? error.message : "D2B read unavailable." });
    });
    return () => {
      cancelled = true;
    };
  }, [input.asOfTs, input.clubId, input.enabled, input.nativeEvents, candidateKey, ids]);

  return state;
}

export function summarizeTrustedHistoryExclusions(exclusions: readonly TrustedForecastHistoryExclusion[]): string {
  return exclusions.length === 0 ? "" : exclusions.map((item) => `${item.eventId}:${item.code}`).join(", ");
}
