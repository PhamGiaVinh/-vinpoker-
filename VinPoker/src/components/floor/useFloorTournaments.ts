import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { flightEntrants, qualifierTarget, type FlightMeta, type FinalMeta } from "./TournamentManagerShared";

export type EventMeta = { name: string; itm_percent: number };
type TourStatus = "scheduled" | "live" | "finished" | "cancelled";

/**
 * Single data owner for the Floor tournament boards (Daily + Multi-day). Extracted from
 * TournamentManagerPanel so one hook owns the tours list + realtime + the multi-day
 * readiness meta + the CRUD actions — both boards consume it via props (they never call
 * this hook themselves), so exactly one realtime channel + one readiness effect run.
 */
export function useFloorTournaments(clubIds: string[]) {
  const { t } = useTranslation();
  const [tours, setTours] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flightMeta, setFlightMeta] = useState<Record<string, FlightMeta>>({});
  const [finalMeta, setFinalMeta] = useState<Record<string, FinalMeta>>({});
  const [eventMeta, setEventMeta] = useState<Record<string, EventMeta>>({});

  const load = useCallback(async () => {
    if (!clubIds.length) { setTours([]); setError(null); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .in("club_id", clubIds)
      .order("start_time");
    if (error) { setError(error.message); toast.error(error.message); } else { setError(null); }
    setTours(data ?? []);
    setLoading(false);
  }, [clubIds]);

  useEffect(() => { load(); }, [load]);

  // Realtime: re-load on any tournaments change for this floor's clubs. Channel name is
  // unique per hook instance so a fast landing→tournament→back remount can't collide with
  // a not-yet-cleaned-up channel; cleanup removes it on unmount. [P1-6]
  const loadRef = useRef(load);
  loadRef.current = load;
  const clubKey = clubIds.join(",");
  const instanceId = useId();
  useEffect(() => {
    if (!clubKey) return;
    const channel = supabase
      .channel(`floor-tour-mgr:${clubKey}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments" }, () => {
        loadRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [clubKey, instanceId]);

  // MD-2/3 — per-flight ITM readiness + per-final qualifier pool + per-event meta (name +
  // itm_percent for the Main Event card header). Gated; only queries the new objects when on.
  useEffect(() => {
    if (!FEATURES.multiDayTournaments) { setFlightMeta({}); setFinalMeta({}); setEventMeta({}); return; }
    const flights = tours.filter((x) => x.phase === "flight" && x.event_id);
    const finals = tours.filter((x) => x.phase === "final");
    const eventIds = [...new Set(tours.filter((x) => x.event_id).map((x) => x.event_id))];
    if (!flights.length && !finals.length && !eventIds.length) { setFlightMeta({}); setFinalMeta({}); setEventMeta({}); return; }
    let cancelled = false;
    (async () => {
      const flightIds = flights.map((x) => x.id);
      const finalIds = finals.map((x) => x.id);
      const [regsRes, seatsRes, evsRes, qualRes, entRes] = await Promise.all([
        flightIds.length ? (supabase as any).from("tournament_registrations").select("tournament_id").in("tournament_id", flightIds).eq("status", "confirmed") : Promise.resolve({ data: [] }),
        flightIds.length ? (supabase as any).from("tournament_seats").select("tournament_id, player_id").in("tournament_id", flightIds).eq("is_active", true) : Promise.resolve({ data: [] }),
        eventIds.length ? (supabase as any).from("tournament_events").select("id, itm_percent, name").in("id", eventIds) : Promise.resolve({ data: [] }),
        finalIds.length ? (supabase as any).from("tournament_event_qualifiers").select("final_tournament_id").in("final_tournament_id", finalIds) : Promise.resolve({ data: [] }),
        finalIds.length ? (supabase as any).from("tournament_entries").select("tournament_id, player_id").in("tournament_id", finalIds) : Promise.resolve({ data: [] }),
      ]);
      if (cancelled) return;
      const regCount: Record<string, number> = {};
      for (const r of ((regsRes.data ?? []) as any[])) regCount[r.tournament_id] = (regCount[r.tournament_id] || 0) + 1;
      const survivors: Record<string, Set<string>> = {};
      for (const s of ((seatsRes.data ?? []) as any[])) (survivors[s.tournament_id] ??= new Set()).add(s.player_id);
      const itmMap: Record<string, number> = {};
      const evMeta: Record<string, EventMeta> = {};
      for (const e of ((evsRes.data ?? []) as any[])) { itmMap[e.id] = Number(e.itm_percent) || 0; evMeta[e.id] = { name: e.name ?? "", itm_percent: Number(e.itm_percent) || 0 }; }
      const fMeta: Record<string, FlightMeta> = {};
      for (const fl of flights) {
        const surv = survivors[fl.id]?.size ?? 0;
        const ent = flightEntrants(regCount[fl.id] ?? 0, surv, fl.players_remaining);
        const itm = itmMap[fl.event_id] ?? 0;
        const target = qualifierTarget(ent, itm);
        fMeta[fl.id] = { entrants: ent, survivors: surv, itm, target, ready: surv > 0 && surv <= target };
      }
      const qCount: Record<string, number> = {};
      for (const q of ((qualRes.data ?? []) as any[])) qCount[q.final_tournament_id] = (qCount[q.final_tournament_id] || 0) + 1;
      const seatedByFinal: Record<string, Set<string>> = {};
      for (const e of ((entRes.data ?? []) as any[])) (seatedByFinal[e.tournament_id] ??= new Set()).add(e.player_id);
      const fnMeta: Record<string, FinalMeta> = {};
      for (const fn of finals) {
        const qualifiers = qCount[fn.id] ?? 0;
        const seated = seatedByFinal[fn.id]?.size ?? 0;
        fnMeta[fn.id] = { qualifiers, seated, pending: Math.max(0, qualifiers - seated) };
      }
      setFlightMeta(fMeta);
      setFinalMeta(fnMeta);
      setEventMeta(evMeta);
    })();
    return () => { cancelled = true; };
  }, [tours]);

  const deleteTour = useCallback(async (id: string) => {
    if (!confirm(t("clubAdmin.deleteConfirm"))) return;
    const { error } = await supabase.from("tournaments").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.tournamentDeleted")); load(); }
  }, [t, load]);

  const setTourStatus = useCallback(async (id: string, status: TourStatus) => {
    const { error } = await supabase.from("tournaments").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(t("clubAdmin.statusUpdated")); load(); }
  }, [t, load]);

  // "Bắt đầu giải" — same canonical clock-start as the operator Clock tab.
  const startTournament = useCallback(async (id: string) => {
    const { data, error } = await supabase.functions.invoke("tournament-live-clock", {
      body: { tournament_id: id, action: "start", current_level: 1 },
    });
    if (error || (data as any)?.error) toast.error((data as any)?.error || error?.message || "Không bắt đầu được giải");
    else { toast.success("Đã bắt đầu giải — đồng hồ chạy, giải lên Live Tracker + hiện blinds"); load(); }
  }, [load]);

  return { tours, loading, error, flightMeta, finalMeta, eventMeta, reload: load, deleteTour, setTourStatus, startTournament };
}
