import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSeriesClubLivePulseV1,
  type SeriesClubLivePulseRpcError,
  type SeriesClubLivePulseRpcResult,
} from "./seriesClubLivePulseRpc";
import type { SeriesClubLivePulseV1 } from "./seriesClubLivePulseV1";

export type SeriesClubLivePulseRuntimeState = "disabled" | "loading" | "ready" | "unavailable" | "refreshing";
export type SeriesClubLivePulseLoader = (clubId: string) => Promise<SeriesClubLivePulseRpcResult>;

export interface UseSeriesClubLivePulseV1Options {
  enabled: boolean;
  clubId: string | null;
  load?: SeriesClubLivePulseLoader;
}

export interface UseSeriesClubLivePulseV1Result {
  state: SeriesClubLivePulseRuntimeState;
  pulse: SeriesClubLivePulseV1 | null;
  error: SeriesClubLivePulseRpcError | "club_unavailable" | null;
  retryable: boolean;
  refresh: () => void;
}

export function useSeriesClubLivePulseV1({
  enabled,
  clubId,
  load = getSeriesClubLivePulseV1,
}: UseSeriesClubLivePulseV1Options): UseSeriesClubLivePulseV1Result {
  const [pulse, setPulse] = useState<SeriesClubLivePulseV1 | null>(null);
  const [error, setError] = useState<UseSeriesClubLivePulseV1Result["error"]>(null);
  const [retryable, setRetryable] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestRef = useRef(0);
  const [state, setState] = useState<SeriesClubLivePulseRuntimeState>(enabled ? "loading" : "disabled");

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!enabled) {
      setState("disabled");
      setPulse(null);
      setError(null);
      setRetryable(false);
      return;
    }
    if (!clubId) {
      setState("unavailable");
      setPulse(null);
      setError("club_unavailable");
      setRetryable(false);
      return;
    }

    setState((current) => current === "ready" || current === "refreshing" ? "refreshing" : "loading");
    setError(null);
    void load(clubId).then((result) => {
      if (requestRef.current !== requestId) return;
      if (result.ok) {
        setPulse(result.value);
        setState("ready");
        setError(null);
        setRetryable(false);
        return;
      }
      setPulse(null);
      setState("unavailable");
      setError(result.error);
      setRetryable(result.retryable);
    }).catch(() => {
      if (requestRef.current !== requestId) return;
      setPulse(null);
      setState("unavailable");
      setError("rpc_error");
      setRetryable(true);
    });
  }, [clubId, enabled, load, refreshKey]);

  const refresh = useCallback(() => {
    if (enabled && clubId) setRefreshKey((current) => current + 1);
  }, [clubId, enabled]);

  return { state, pulse, error, retryable, refresh };
}
