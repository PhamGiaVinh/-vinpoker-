// Series Intelligence — CAPTURE v0 data hook. Owner-scoped: lists the clubs the user OWNS (clubs.owner_id =
// auth.uid()), the club's tournaments (event picker), and reads all 4 CAPTURE tables filtered by club_id.
// Mutations inject club_id from the selected club so the caller never passes it (matches the RLS WITH CHECK:
// is_club_owner + series_event_in_club). No delete (DB grants none). Reload-after-write; friendly VN errors.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type {
  CampaignLog,
  CampaignLogInsert,
  CampaignLogUpdate,
  CaptureEventOption,
  DecisionLog,
  DecisionLogInsert,
  DecisionLogUpdate,
  ForecastSnapshot,
  ForecastSnapshotInsert,
  RegistrationEvent,
  RegistrationEventInsert,
} from "./captureTypes";

interface ClubOption {
  id: string;
  name: string;
}

/** Map a Supabase mutation error to a friendly Vietnamese message (RLS violations are the common case). */
function writeError(error: { code?: string; message?: string } | null): string {
  if (!error) return "Lỗi không xác định";
  const msg = error.message ?? "";
  if (error.code === "42501" || /row-level security/i.test(msg)) {
    return "Không ghi được: bạn phải là chủ CLB và giải phải thuộc CLB đó.";
  }
  return msg || "Lỗi không xác định";
}

export interface UseSeriesCapture {
  loading: boolean;
  saving: boolean;
  clubs: ClubOption[];
  clubId: string | null;
  setClubId: (id: string) => void;
  events: CaptureEventOption[];
  snapshots: ForecastSnapshot[];
  decisions: DecisionLog[];
  campaigns: CampaignLog[];
  registrations: RegistrationEvent[];
  reload: () => void;
  insertForecast: (p: Omit<ForecastSnapshotInsert, "club_id">) => Promise<boolean>;
  insertDecision: (p: Omit<DecisionLogInsert, "club_id">) => Promise<boolean>;
  updateDecision: (id: string, patch: DecisionLogUpdate) => Promise<boolean>;
  insertCampaign: (p: Omit<CampaignLogInsert, "club_id">) => Promise<boolean>;
  updateCampaign: (id: string, patch: CampaignLogUpdate) => Promise<boolean>;
  insertRegistration: (p: Omit<RegistrationEventInsert, "club_id">) => Promise<boolean>;
}

export function useSeriesCapture(): UseSeriesCapture {
  const { user } = useAuth();
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [events, setEvents] = useState<CaptureEventOption[]>([]);
  const [snapshots, setSnapshots] = useState<ForecastSnapshot[]>([]);
  const [decisions, setDecisions] = useState<DecisionLog[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLog[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Owned clubs (owner path — matches is_club_owner's non-super-admin branch). Auto-select the first.
  useEffect(() => {
    if (!user) {
      setClubs([]);
      setClubId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("clubs").select("id,name").eq("owner_id", user.id).order("name");
      if (cancelled) return;
      const list = (data ?? []) as ClubOption[];
      setClubs(list);
      setClubId((prev) => prev ?? list[0]?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Club-scoped reads: events (tournaments) + all 4 CAPTURE tables filtered by club_id.
  useEffect(() => {
    if (!clubId) {
      setEvents([]);
      setSnapshots([]);
      setDecisions([]);
      setCampaigns([]);
      setRegistrations([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [evt, sfs, sdl, scl, sre] = await Promise.all([
        supabase.from("tournaments").select("id,name,club_id,start_time,status").eq("club_id", clubId).order("start_time", { ascending: false }),
        supabase.from("series_forecast_snapshots").select("*").eq("club_id", clubId).order("created_at", { ascending: false }),
        supabase.from("series_decision_logs").select("*").eq("club_id", clubId).order("created_at", { ascending: false }),
        supabase.from("series_campaign_logs").select("*").eq("club_id", clubId).order("created_at", { ascending: false }),
        supabase.from("series_registration_events").select("*").eq("club_id", clubId).order("registered_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setEvents((evt.data ?? []) as CaptureEventOption[]);
      setSnapshots((sfs.data ?? []) as ForecastSnapshot[]);
      setDecisions((sdl.data ?? []) as DecisionLog[]);
      setCampaigns((scl.data ?? []) as CampaignLog[]);
      setRegistrations((sre.data ?? []) as RegistrationEvent[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // ── Mutations (club_id injected; toast + reload; no delete) ────────────────────────────────────────
  const run = useCallback(
    async (op: () => PromiseLike<{ error: { code?: string; message?: string } | null }>, okMsg: string): Promise<boolean> => {
      setSaving(true);
      const { error } = await op();
      setSaving(false);
      if (error) {
        toast.error("Lưu lỗi: " + writeError(error));
        return false;
      }
      toast.success(okMsg);
      reload();
      return true;
    },
    [reload],
  );

  const insertForecast: UseSeriesCapture["insertForecast"] = useCallback(
    (p) => {
      if (!clubId) return Promise.resolve(false);
      return run(() => supabase.from("series_forecast_snapshots").insert({ ...p, club_id: clubId }), "Đã lưu dự báo");
    },
    [clubId, run],
  );
  const insertDecision: UseSeriesCapture["insertDecision"] = useCallback(
    (p) => {
      if (!clubId) return Promise.resolve(false);
      return run(() => supabase.from("series_decision_logs").insert({ ...p, club_id: clubId }), "Đã lưu quyết định");
    },
    [clubId, run],
  );
  const updateDecision: UseSeriesCapture["updateDecision"] = useCallback(
    (id, patch) => run(() => supabase.from("series_decision_logs").update(patch).eq("id", id), "Đã cập nhật quyết định"),
    [run],
  );
  const insertCampaign: UseSeriesCapture["insertCampaign"] = useCallback(
    (p) => {
      if (!clubId) return Promise.resolve(false);
      return run(() => supabase.from("series_campaign_logs").insert({ ...p, club_id: clubId }), "Đã lưu chiến dịch");
    },
    [clubId, run],
  );
  const updateCampaign: UseSeriesCapture["updateCampaign"] = useCallback(
    (id, patch) => run(() => supabase.from("series_campaign_logs").update(patch).eq("id", id), "Đã cập nhật chiến dịch"),
    [run],
  );
  const insertRegistration: UseSeriesCapture["insertRegistration"] = useCallback(
    (p) => {
      if (!clubId) return Promise.resolve(false);
      return run(() => supabase.from("series_registration_events").insert({ ...p, club_id: clubId }), "Đã ghi đăng ký");
    },
    [clubId, run],
  );

  return useMemo(
    () => ({
      loading,
      saving,
      clubs,
      clubId,
      setClubId,
      events,
      snapshots,
      decisions,
      campaigns,
      registrations,
      reload,
      insertForecast,
      insertDecision,
      updateDecision,
      insertCampaign,
      updateCampaign,
      insertRegistration,
    }),
    [loading, saving, clubs, clubId, events, snapshots, decisions, campaigns, registrations, reload, insertForecast, insertDecision, updateDecision, insertCampaign, updateCampaign, insertRegistration],
  );
}
