// Series Intelligence — AUTOSYNC row shapes. The 3 tables created by 20261126000000_series_capture_autosync.sql
// are now in the generated Supabase types, so alias their Row types straight from there (source of truth — never
// hand-declare column shapes). Only AutosyncClubResult is hand-written: it is the JSONB return of the
// series_capture_autosync_club(uuid) RPC (typed generically as Json by the generator), not a table Row.
import type { Database } from "@/integrations/supabase/types";

type Tbl = Database["public"]["Tables"];

/** One system-owned row per finished event (UPSERT-recomputed by the sync). */
export type SeriesEventActuals = Tbl["series_event_actuals"]["Row"];
/** Per-club kill-switch (default OFF, owner-scoped). */
export type SeriesCaptureSettings = Tbl["series_capture_settings"]["Row"];
/** Run-log row (cron or manual). */
export type SeriesCaptureRun = Tbl["series_capture_runs"]["Row"];

/** Return of the owner-checked series_capture_autosync_club(uuid) RPC. `busy` = the club's lock was held
 *  (a cron tick or another manual sync is running) and this call was a non-blocking no-op — try again shortly. */
export interface AutosyncClubResult {
  ok: boolean;
  busy?: boolean;
  rows_reg?: number;
  rows_actuals?: number;
  run_at: string;
}
