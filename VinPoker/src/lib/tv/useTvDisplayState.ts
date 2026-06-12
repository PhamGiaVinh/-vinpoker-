import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLiveClock } from "@/hooks/useLiveClock";
import { displayedRemaining, type ClockAnchor } from "@/lib/tv/clockAnchor";
import { rpcGetTvDisplayState } from "@/lib/tv/displayRpc";
import {
  mapDisplayStateToTvData,
  parseDisplayStatePayload,
  type TvDisplayStatePayload,
} from "@/lib/tv/mapDisplayState";
import type { TvData } from "@/types/tv";

export type TvDisplayViewState =
  | "loading"
  | "invalid" // covers invalid + expired + revoked → clear token, back to /tv/pair
  | "unpaired"
  | "standby" // paired, no tournament assigned
  | "ready"
  | "error";

const POLL_RUNNING_MS = 10_000; // clock running → tighter mirror of operator actions
const POLL_IDLE_MS = 30_000;
const ERROR_BACKOFF_START_MS = 5_000;
const ERROR_BACKOFF_MAX_MS = 60_000;
const ZERO_REPOLL_MS = 2_000;
const ZERO_REPOLL_MAX = 10;

/**
 * Anonymous TV state source for /display/:displayToken (PR C2).
 * Single read: get_tv_display_state — every poll doubles as the heartbeat.
 * Drift-proof countdown via the PR B anchor; instant config changes arrive on
 * the Broadcast channel `tv-display:{id}` (sent by the C3 dashboard on save).
 * The TV never advances levels itself — it clamps at 00:00 and repolls.
 */
export function useTvDisplayState(displayToken: string | undefined) {
  const [state, setState] = useState<TvDisplayViewState>("loading");
  const [payload, setPayload] = useState<TvDisplayStatePayload | null>(null);
  const [offline, setOffline] = useState(false);

  const anchorRef = useRef<ClockAnchor | null>(null);
  const requestSeqRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const errorsRef = useRef(0);
  const zeroPollRef = useRef<{ tries: number; timer: number | null }>({ tries: 0, timer: null });
  const latestRef = useRef<{ state: TvDisplayViewState; isRunning: boolean }>({
    state: "loading",
    isRunning: false,
  });

  const nowMs = useLiveClock();

  const fetchState = useCallback(async () => {
    if (!displayToken) return;
    const seq = ++requestSeqRef.current;
    const { data, error } = await rpcGetTvDisplayState(displayToken);
    if (seq !== requestSeqRef.current) return;

    if (error) {
      errorsRef.current += 1;
      setOffline(true);
      // Keep showing the last good data; only surface the error screen when
      // we never had any.
      if (latestRef.current.state === "loading") setState("error");
      return;
    }
    errorsRef.current = 0;
    setOffline(false);

    const parsed = parseDisplayStatePayload(data);
    setPayload(parsed);
    switch (parsed.status) {
      case "paired": {
        const clock = parsed.clock;
        anchorRef.current = clock
          ? {
              remainingAtFetch: clock.remaining_seconds ?? 0,
              anchorMs: performance.now(),
              isRunning: clock.is_running ?? false,
            }
          : null;
        setState(parsed.tournament && clock ? "ready" : "standby");
        break;
      }
      case "unpaired":
        setState("unpaired");
        break;
      default:
        // invalid | expired | revoked — caller clears the token and re-pairs.
        setState("invalid");
        break;
    }
  }, [displayToken]);

  // Poll loop with dynamic cadence (setTimeout chain, not setInterval).
  useEffect(() => {
    if (!displayToken) {
      setState("invalid");
      return;
    }
    let cancelled = false;

    const tick = async () => {
      await fetchState();
      if (cancelled) return;
      const { state: s, isRunning } = latestRef.current;
      let delay: number;
      if (errorsRef.current > 0) {
        delay = Math.min(ERROR_BACKOFF_START_MS * 2 ** (errorsRef.current - 1), ERROR_BACKOFF_MAX_MS);
      } else if (s === "ready" && isRunning) {
        delay = POLL_RUNNING_MS;
      } else {
        delay = POLL_IDLE_MS;
      }
      timerRef.current = window.setTimeout(() => void tick(), delay);
    };

    setState("loading");
    setPayload(null);
    anchorRef.current = null;
    void tick();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchState();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      requestSeqRef.current += 1;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [displayToken, fetchState]);

  // Broadcast: dashboard sends {event:'config'} on tv-display:{id} after saves.
  const displayId = payload?.display?.id ?? null;
  useEffect(() => {
    if (!displayId) return;
    const channel = supabase
      .channel(`tv-display:${displayId}`)
      .on("broadcast", { event: "config" }, () => {
        void fetchState();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [displayId, fetchState]);

  const display = displayedRemaining(anchorRef.current, performance.now());

  // Zero-cross: short repolls until the operator advances the level.
  useEffect(() => {
    const zero = zeroPollRef.current;
    const anchor = anchorRef.current;
    if (latestRef.current.state !== "ready" || !anchor || !anchor.isRunning || display > 0) {
      zero.tries = 0;
      return;
    }
    if (zero.timer != null || zero.tries >= ZERO_REPOLL_MAX) return;
    zero.timer = window.setTimeout(
      () => {
        zero.timer = null;
        zero.tries += 1;
        void fetchState();
      },
      zero.tries === 0 ? 0 : ZERO_REPOLL_MS,
    );
    return () => {
      if (zero.timer != null) {
        window.clearTimeout(zero.timer);
        zero.timer = null;
      }
    };
  }, [display, nowMs, fetchState]);

  const data: TvData | null = useMemo(() => {
    if (!payload) return null;
    return mapDisplayStateToTvData(payload, display);
  }, [payload, display]);

  latestRef.current = {
    state,
    isRunning: anchorRef.current?.isRunning ?? false,
  };

  return { state, data, payload, offline, refetch: fetchState };
}
