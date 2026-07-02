// Series Intelligence — AUTOSYNC read/act hook (owner-scoped). Reads the per-club autosync switch, the latest
// run-log entry, and the auto-captured event actuals; exposes a "Sync ngay" that calls the owner-checked
// series_capture_autosync_club(uuid) RPC. Everything degrades gracefully to `available:false` when the autosync
// migration is not applied yet, so this ships safely in the same PR as the (unapplied) source-only migration.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SeriesEventActuals, SeriesCaptureRun, AutosyncClubResult } from "./captureAutosyncTypes";

// The autosync tables/RPC (series_capture_settings / series_event_actuals / series_capture_runs /
// series_capture_autosync_club) are now in the generated schema, so the typed client resolves them directly.
const db = supabase;

// PostgREST/pg codes that mean "the object isn't there yet" (migration unapplied) → treat as gracefully absent.
const NOT_APPLIED = new Set(["42P01", "PGRST202", "PGRST205", "PGRST203", "404"]);
function isNotApplied(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && NOT_APPLIED.has(error.code)) return true;
  return /does not exist|could not find|schema cache/i.test(error.message ?? "");
}

export interface CaptureAutosync {
  available: boolean; // backend applied + reachable
  enabled: boolean; // autosync_enabled for this club
  lastRun: SeriesCaptureRun | null;
  actualsByEvent: Map<string, SeriesEventActuals>;
  syncing: boolean;
  syncNow: () => Promise<void>;
  reload: () => void;
}

const EMPTY = new Map<string, SeriesEventActuals>();

export function useCaptureAutosync(clubId: string | null): CaptureAutosync {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [lastRun, setLastRun] = useState<SeriesCaptureRun | null>(null);
  const [actualsByEvent, setActualsByEvent] = useState<Map<string, SeriesEventActuals>>(EMPTY);
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!clubId) {
      setAvailable(false);
      setEnabled(false);
      setLastRun(null);
      setActualsByEvent(EMPTY);
      return;
    }
    let cancelled = false;
    (async () => {
      const settings = await db
        .from("series_capture_settings")
        .select("autosync_enabled")
        .eq("club_id", clubId)
        .maybeSingle();
      if (cancelled) return;
      if (isNotApplied(settings.error)) {
        setAvailable(false);
        setEnabled(false);
        setLastRun(null);
        setActualsByEvent(EMPTY);
        return;
      }
      setAvailable(true);
      setEnabled(Boolean((settings.data as { autosync_enabled?: boolean } | null)?.autosync_enabled));

      const [actuals, runs] = await Promise.all([
        db.from("series_event_actuals").select("*").eq("club_id", clubId),
        db.from("series_capture_runs").select("*").eq("club_id", clubId).order("run_at", { ascending: false }).limit(1),
      ]);
      if (cancelled) return;
      const m = new Map<string, SeriesEventActuals>();
      for (const row of (actuals.data as SeriesEventActuals[] | null) ?? []) m.set(row.event_id, row);
      setActualsByEvent(m);
      setLastRun(((runs.data as SeriesCaptureRun[] | null) ?? [])[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const syncNow = useCallback(async () => {
    if (!clubId) return;
    setSyncing(true);
    const { data, error } = await db.rpc("series_capture_autosync_club", { p_club_id: clubId });
    setSyncing(false);
    if (error) {
      toast.error(
        isNotApplied(error) ? "Tự động ghi chưa được cài đặt trên máy chủ." : "Đồng bộ lỗi: " + (error.message ?? ""),
      );
      return;
    }
    const res = data as unknown as AutosyncClubResult | null; // RPC returns jsonb (Json)
    if (res && res.ok === false && res.busy) {
      toast.info("Đang đồng bộ nền, thử lại sau giây lát.");
      return;
    }
    toast.success(res ? `Đã đồng bộ: +${res.rows_reg ?? 0} đăng ký · ${res.rows_actuals ?? 0} kết quả` : "Đã đồng bộ");
    reload();
  }, [clubId, reload]);

  return useMemo(
    () => ({ available, enabled, lastRun, actualsByEvent, syncing, syncNow, reload }),
    [available, enabled, lastRun, actualsByEvent, syncing, syncNow, reload],
  );
}
