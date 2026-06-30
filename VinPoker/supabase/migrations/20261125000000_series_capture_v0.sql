-- Series Intelligence — CAPTURE v0 (data-capture foundation).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. The owner reads the SQL and applies it later in a
-- controlled session (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db),
-- then regen types.ts in a SEPARATE step. schema_migrations is NOT touched by the controlled apply.
--
-- WHY: stands up the DATA-CAPTURE layer for Series Intelligence so real club data can start flowing in:
--   forecast snapshots (a forecast recorded BEFORE an event, for later accuracy scoring), decision logs
--   (recommended vs owner decision vs public action vs post-event outcome — the learning-loop spine),
--   campaign logs (marketing spend/segment), and registration events (funnel + unique/re-entry source).
--   THIS IS INFRASTRUCTURE ONLY — there is NO model, NO prediction, NO calculation here.
--
-- SCOPE: 4 tables, owner-scoped RLS. No RPC, no Edge, no trigger, no cross-module FK beyond public.clubs /
--   public.tournaments. The forecast layer that WRITES series_forecast_snapshots is a separate (unmerged)
--   concern — this PR only creates the schema; there is no write path to snapshots in this PR.
--
-- PRIVACY (locked): series_registration_events.player_ref_hash MUST be a hashed/opaque identifier. NEVER
--   store a raw phone, name, Telegram/Facebook handle, ID card, or any personal identifier. player_ref_type
--   records WHICH KIND of identifier was hashed so the same person can be reconciled later.
--
-- LEAKAGE RULE (locked): the post-event columns on series_decision_logs (actual_*) are captured for SCORING
--   only. They are RESULTS, never to be fed back as forecast inputs. See the data dictionary.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS before CREATE POLICY. A future gated
--   re-apply is a safe no-op. Auth helper public.is_club_owner(uuid, uuid) (owner + super_admin) already exists.

-- ===========================================================================================
-- 1. TABLES (4) — each carries a denormalized club_id (owner-scoped, join-free RLS).
-- ===========================================================================================

-- 1.1 series_forecast_snapshots — a forecast captured BEFORE an event; immutable record for scoring.
CREATE TABLE IF NOT EXISTS public.series_forecast_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  horizon          text NOT NULL,
  days_before      integer,
  forecast_base    integer,
  forecast_low     integer,
  forecast_high    integer,
  confidence_tier  text,
  candidate_gtd    bigint,
  overlay_risk_pct numeric,
  source_label     text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT auth.uid(),
  CONSTRAINT sfs_horizon_chk     CHECK (horizon IN ('T-21','T-7','T-1','T-0')),
  CONSTRAINT sfs_tier_chk        CHECK (confidence_tier IS NULL OR confidence_tier IN ('low','medium','high')),
  CONSTRAINT sfs_fc_nonneg       CHECK (
    (forecast_base IS NULL OR forecast_base >= 0)
    AND (forecast_low  IS NULL OR forecast_low  >= 0)
    AND (forecast_high IS NULL OR forecast_high >= 0)),
  CONSTRAINT sfs_fc_ordered      CHECK (
    forecast_low IS NULL OR forecast_base IS NULL OR forecast_high IS NULL
    OR (forecast_low <= forecast_base AND forecast_base <= forecast_high)),
  CONSTRAINT sfs_overlay_pct_chk CHECK (overlay_risk_pct IS NULL OR (overlay_risk_pct >= 0 AND overlay_risk_pct <= 100)),
  CONSTRAINT sfs_gtd_chk         CHECK (candidate_gtd IS NULL OR candidate_gtd >= 0),
  CONSTRAINT sfs_days_chk        CHECK (days_before IS NULL OR days_before >= 0)
);

-- 1.2 series_decision_logs — recommended vs owner decision vs public action + post-event outcome.
CREATE TABLE IF NOT EXISTS public.series_decision_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id               uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  event_id              uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  forecast_snapshot_id  uuid REFERENCES public.series_forecast_snapshots(id) ON DELETE SET NULL,
  decision_horizon      text NOT NULL,
  recommended_action    text,
  owner_decision        text,
  public_action         text,
  decision_reason       text,
  -- post-event (nullable, filled by UPDATE) — SCORING-ONLY results, never forecast inputs:
  actual_result         text,
  actual_entries        integer,
  actual_unique_players integer,
  actual_reentries      integer,
  actual_prize_pool     bigint,
  actual_overlay_amount bigint,
  post_event_reason     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid DEFAULT auth.uid(),
  CONSTRAINT sdl_horizon_chk     CHECK (decision_horizon IN ('T-21','T-7','T-1','T-0','post')),
  CONSTRAINT sdl_actuals_nonneg  CHECK (
    (actual_entries        IS NULL OR actual_entries        >= 0)
    AND (actual_unique_players IS NULL OR actual_unique_players >= 0)
    AND (actual_reentries      IS NULL OR actual_reentries      >= 0)
    AND (actual_prize_pool     IS NULL OR actual_prize_pool     >= 0)
    AND (actual_overlay_amount IS NULL OR actual_overlay_amount >= 0))
);

-- 1.3 series_campaign_logs — marketing campaign log (event_linked optional).
CREATE TABLE IF NOT EXISTS public.series_campaign_logs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                   uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  campaign_id               text,
  event_linked              uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  channel                   text,
  spend                     bigint,
  creative_type             text,
  target_segment            text,
  baseline_expected_entries integer,
  decision_reason           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid DEFAULT auth.uid(),
  CONSTRAINT scl_spend_chk    CHECK (spend IS NULL OR spend >= 0),
  CONSTRAINT scl_baseline_chk CHECK (baseline_expected_entries IS NULL OR baseline_expected_entries >= 0)
);

-- 1.4 series_registration_events — per-registration capture (funnel + unique/re-entry later).
CREATE TABLE IF NOT EXISTS public.series_registration_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  event_id         uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_ref_hash  text,  -- OPAQUE/HASHED only — never a raw personal identifier (see header + dictionary)
  player_ref_type  text,
  registered_at    timestamptz NOT NULL DEFAULT now(),
  is_reentry       boolean NOT NULL DEFAULT false,
  bullet           smallint,
  commitment_stage text,
  entry_source     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT auth.uid(),
  CONSTRAINT sre_ref_type_chk CHECK (player_ref_type IS NULL OR player_ref_type IN ('phone','app_user_id','host_label')),
  CONSTRAINT sre_bullet_chk   CHECK (bullet IS NULL OR bullet >= 1),
  CONSTRAINT sre_stage_chk    CHECK (commitment_stage IS NULL OR commitment_stage IN ('interested','reserved','paid','seated','cancelled')),
  CONSTRAINT sre_source_chk   CHECK (entry_source IS NULL OR entry_source IN ('direct','online','floor','satellite','unknown'))
);

-- Indexes (RLS/scan support).
CREATE INDEX IF NOT EXISTS idx_sfs_club  ON public.series_forecast_snapshots(club_id);
CREATE INDEX IF NOT EXISTS idx_sfs_event ON public.series_forecast_snapshots(event_id);
CREATE INDEX IF NOT EXISTS idx_sdl_club  ON public.series_decision_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_sdl_event ON public.series_decision_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_sdl_snap  ON public.series_decision_logs(forecast_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_scl_club  ON public.series_campaign_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_scl_event ON public.series_campaign_logs(event_linked);
CREATE INDEX IF NOT EXISTS idx_sre_club  ON public.series_registration_events(club_id);
CREATE INDEX IF NOT EXISTS idx_sre_event ON public.series_registration_events(event_id);

-- ===========================================================================================
-- 2. RLS — owner-scoped (public.is_club_owner covers owner + super_admin). GRANTs MATCH the writes;
--    NO DELETE anywhere. Every INSERT/UPDATE WITH CHECK additionally enforces that the referenced
--    event belongs to the SAME club (no cross-club row even if a foreign UUID is known).
-- ===========================================================================================

ALTER TABLE public.series_forecast_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_decision_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_campaign_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_registration_events  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.series_forecast_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_decision_logs       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_campaign_logs       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_registration_events FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT         ON public.series_forecast_snapshots  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.series_decision_logs       TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.series_campaign_logs       TO authenticated;
GRANT SELECT, INSERT         ON public.series_registration_events TO authenticated;

-- 2.1 series_forecast_snapshots — SELECT + INSERT (owner + event/club).
DROP POLICY IF EXISTS sfs_select ON public.series_forecast_snapshots;
CREATE POLICY sfs_select ON public.series_forecast_snapshots
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sfs_insert ON public.series_forecast_snapshots;
CREATE POLICY sfs_insert ON public.series_forecast_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
  );

-- 2.2 series_decision_logs — SELECT + INSERT + UPDATE (owner + event/club + snapshot-club match).
DROP POLICY IF EXISTS sdl_select ON public.series_decision_logs;
CREATE POLICY sdl_select ON public.series_decision_logs
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sdl_insert ON public.series_decision_logs;
CREATE POLICY sdl_insert ON public.series_decision_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
    AND (forecast_snapshot_id IS NULL
         OR EXISTS (SELECT 1 FROM public.series_forecast_snapshots s WHERE s.id = forecast_snapshot_id AND s.club_id = club_id))
  );

DROP POLICY IF EXISTS sdl_update ON public.series_decision_logs;
CREATE POLICY sdl_update ON public.series_decision_logs
  FOR UPDATE TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id))
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
    AND (forecast_snapshot_id IS NULL
         OR EXISTS (SELECT 1 FROM public.series_forecast_snapshots s WHERE s.id = forecast_snapshot_id AND s.club_id = club_id))
  );

-- 2.3 series_campaign_logs — SELECT + INSERT + UPDATE (owner + optional event/club).
DROP POLICY IF EXISTS scl_select ON public.series_campaign_logs;
CREATE POLICY scl_select ON public.series_campaign_logs
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS scl_insert ON public.series_campaign_logs;
CREATE POLICY scl_insert ON public.series_campaign_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND (event_linked IS NULL
         OR EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_linked AND t.club_id = club_id))
  );

DROP POLICY IF EXISTS scl_update ON public.series_campaign_logs;
CREATE POLICY scl_update ON public.series_campaign_logs
  FOR UPDATE TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id))
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND (event_linked IS NULL
         OR EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_linked AND t.club_id = club_id))
  );

-- 2.4 series_registration_events — SELECT + INSERT (owner + event/club).
DROP POLICY IF EXISTS sre_select ON public.series_registration_events;
CREATE POLICY sre_select ON public.series_registration_events
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sre_insert ON public.series_registration_events;
CREATE POLICY sre_insert ON public.series_registration_events
  FOR INSERT TO authenticated
  WITH CHECK (
    club_id IS NOT NULL
    AND public.is_club_owner(auth.uid(), club_id)
    AND EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = event_id AND t.club_id = club_id)
  );

-- ===========================================================================================
-- ROLLBACK (undo this migration), in reverse FK order (decision_logs before forecast_snapshots):
--   DROP TABLE IF EXISTS public.series_registration_events;
--   DROP TABLE IF EXISTS public.series_campaign_logs;
--   DROP TABLE IF EXISTS public.series_decision_logs;        -- drops the forecast_snapshot_id FK
--   DROP TABLE IF EXISTS public.series_forecast_snapshots;
-- ===========================================================================================
