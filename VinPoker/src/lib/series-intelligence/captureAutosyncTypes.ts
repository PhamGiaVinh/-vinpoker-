// Series Intelligence — hand-written row shapes for the AUTOSYNC objects created by
// 20261126000000_series_capture_autosync.sql. These are NOT in the generated Supabase types until that
// (owner-gated) migration is applied and types.ts is regenerated; once it is, prefer the generated Row types
// and delete this file. Kept in sync with the migration column definitions.

/** One system-owned row per finished event (UPSERT-recomputed by the sync). */
export interface SeriesEventActuals {
  event_id: string;
  club_id: string;
  actual_entries: number;
  actual_unique_players: number;
  actual_reentries: number;
  actual_prize_pool: number; // = SUM(confirmed buy_in) = prize portion (fees excluded)
  actual_overlay_amount: number; // = max(0, guarantee_amount - prize_pool)
  source: string;
  captured_at: string;
}

/** Per-club kill-switch (default OFF, owner-scoped). */
export interface SeriesCaptureSettings {
  club_id: string;
  autosync_enabled: boolean;
  updated_at: string;
}

/** Run-log row (cron or manual). */
export interface SeriesCaptureRun {
  id: string;
  run_at: string;
  club_id: string | null;
  scope: string; // 'cron' | 'manual'
  rows_reg_captured: number;
  rows_actuals_upserted: number;
  rows_errored: number;
  error_sample: string | null;
}

/** Return of the owner-checked series_capture_autosync_club(uuid) RPC. `busy` = the club's lock was held
 *  (a cron tick or another manual sync is running) and this call was a non-blocking no-op — try again shortly. */
export interface AutosyncClubResult {
  ok: boolean;
  busy?: boolean;
  rows_reg?: number;
  rows_actuals?: number;
  run_at: string;
}
