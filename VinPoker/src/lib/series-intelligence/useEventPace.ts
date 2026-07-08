import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FEATURES } from "@/lib/featureFlags";
import type { SeriesEvent } from "./nativeData";
import type { PastEventPace } from "./nowcast";

export interface EventPaceData {
  /** Live sign-up count per event_id (from the auto-captured series_registration_events). */
  regCountByEvent: Map<string, number>;
  /** Pace curves of PAST completed events (start + final + registration timestamps) for τ estimation. */
  paceHistory: PastEventPace[];
  loading: boolean;
  /** false when the read failed / autosync not applied / no rows — the panel keeps manual entry. */
  available: boolean;
}

const EMPTY: EventPaceData = { regCountByEvent: new Map(), paceHistory: [], loading: false, available: false };

/**
 * TP1 — reads the auto-captured `series_registration_events` (read-only, owner-scoped RLS) to power the
 * nowcast: a live sign-up count per event + pace curves of past completed events. `events` supplies each
 * past event's finalTotal (total_entries) + which events are past. Defensive: any error / missing table /
 * no rows → `available:false` so RegistrationPacePanel falls back to manual entry (never guesses). Gated
 * on seriesNowcast so it doesn't query when the feature is off.
 */
export function useEventPace(clubId: string | undefined, events: SeriesEvent[]): EventPaceData {
  const q = useQuery({
    queryKey: ["seriesPace", clubId, events.length],
    enabled: !!clubId && FEATURES.seriesNowcast,
    queryFn: async (): Promise<{ ok: boolean; times: Map<string, string[]> }> => {
      const { data, error } = await supabase
        .from("series_registration_events")
        .select("event_id,registered_at")
        .eq("club_id", clubId as string)
        .limit(20_000);
      if (error) return { ok: false, times: new Map() };
      const times = new Map<string, string[]>();
      for (const r of (data ?? []) as Array<{ event_id: string; registered_at: string | null }>) {
        if (!r.registered_at) continue;
        const arr = times.get(r.event_id);
        if (arr) arr.push(r.registered_at);
        else times.set(r.event_id, [r.registered_at]);
      }
      return { ok: true, times };
    },
    retry: false,
    staleTime: 60_000,
  });

  if (!q.data?.ok) return { ...EMPTY, loading: q.isLoading };

  const times = q.data.times;
  const regCountByEvent = new Map<string, number>();
  for (const [id, arr] of times) regCountByEvent.set(id, arr.length);

  const now = Date.now();
  const paceHistory: PastEventPace[] = [];
  for (const e of events) {
    if (!e.event_date || e.total_entries === null || e.total_entries <= 0) continue;
    const start = new Date(e.event_date).getTime();
    if (Number.isNaN(start) || start >= now) continue; // completed only
    const registrationTimes = times.get(e.event_id);
    if (!registrationTimes || registrationTimes.length === 0) continue;
    paceHistory.push({ startTime: e.event_date, finalTotal: e.total_entries, registrationTimes });
  }

  return { regCountByEvent, paceHistory, loading: false, available: true };
}
