-- ═══════════════════════════════════════════════════════════════════════════
-- DRAFT BASELINE: Remote-Only Schema Objects (Milestone 0 Recovery)
-- Version: 20260611000001
-- Created: 2026-06-11
--
-- PURPOSE:
--   Captures schema objects that exist on the remote DB but have no
--   corresponding local migration file (part of the 99 remote-only versions
--   created June 4–10 via Supabase Dashboard / Lovable AI).
--
--   Without these objects a fresh build from local migrations alone would
--   have: broken tracker-table RLS, failing hand-write triggers, missing
--   cron functions, and missing core swing-path RPCs.
--
-- STATUS: DRAFT — DO NOT APPLY YET.
--   This file must NOT be pushed until:
--     1. D4a is approved (99 remote-only versions added to CI repair list)
--     2. This migration is marked --status applied on the remote dev DB
--        (the objects already exist there; re-running without that mark
--        would attempt duplicate creation and may fail on constraints)
--
-- IDEMPOTENCY:
--   Tables:    CREATE TABLE IF NOT EXISTS
--   Indexes:   CREATE INDEX IF NOT EXISTS
--   Functions: CREATE OR REPLACE FUNCTION
--   RLS:       ENABLE ROW LEVEL SECURITY is idempotent
--   Policies:  wrapped in DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL
--   Triggers:  DROP TRIGGER IF EXISTS before CREATE TRIGGER
--   Event trg: wrapped in duplicate_object guard
--
-- NOT INCLUDED:
--   disable_stale_audit_flags()  — runtime dependency on
--   enable_audit_for_stuck_rows()  dealer_assignments.should_audit_version
--                                  (added by pass1b_circuit_breaker.sql,
--                                  a pending local migration with a fix
--                                  required before apply)
--   dealer_state_health          — view DDL not reconstructable without pg_dump
--   ghost_assignments_health     — view DDL not reconstructable without pg_dump
--   v_stuck_assignment_version_history — same
--
-- PERMANENT SKIP NOTE:
--   20260609000002_recalculate_june_payroll.sql is permanently repair-reverted.
--   It must never be auto-applied. See migration-recovery-decisions.md (D3d).
--
-- SOURCE: D:\vinpoker-prod-audit-20260611-051112\
--   11_columns.json, 13_constraints_simple.json, 06_indexes.json,
--   03_rls_policies.json, 19_function_definitions.json,
--   20_trigger_definitions.json, 14_rls_status.json
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 1: Tables
-- ─────────────────────────────────────────────────────────────────────────

-- 1a. club_trackers
-- Grants users the 'tracker' role for a specific club.
-- CRITICAL: is_club_tracker() and tracker_club_ids() SELECT from this table.
-- Both are used as USING expressions in RLS policies on all four tracker
-- tables. Without this table, every query against tournament_hands,
-- tournament_chip_counts, tournament_seats, hand_players fails.
-- NOTE: No surrogate id column. PK is composite (club_id, user_id).
-- NOTE: granted_by FK target assumed auth.users(id) — verify if applying
--       to a fresh DB; ON DELETE clause assumed from standard Supabase patterns.
CREATE TABLE IF NOT EXISTS public.club_trackers (
  club_id    uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  granted_by uuid        NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT club_trackers_pkey
    PRIMARY KEY (club_id, user_id),
  CONSTRAINT club_trackers_club_id_fkey
    FOREIGN KEY (club_id)  REFERENCES public.clubs(id)     ON DELETE CASCADE,
  CONSTRAINT club_trackers_granted_by_fkey
    FOREIGN KEY (granted_by) REFERENCES auth.users(id)     ON DELETE SET NULL
);

-- 1b. tournament_hand_audit_log
-- Receives an INSERT on every tournament_hands INSERT or UPDATE via
-- trg_audit_tournament_hand. Without this table every hand write fails.
-- CRITICAL: trigger on tournament_hands calls audit_tournament_hand()
--           which INSERTs here; the entire Live Tracker input path breaks
--           without this table on a fresh build.
CREATE TABLE IF NOT EXISTS public.tournament_hand_audit_log (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  hand_id    uuid        NOT NULL,
  action     text        NOT NULL,
  actor_id   uuid,
  old_status text,
  new_status text,
  details    jsonb                DEFAULT '{}'::jsonb,
  created_at timestamptz          DEFAULT now(),
  CONSTRAINT tournament_hand_audit_log_pkey
    PRIMARY KEY (id),
  CONSTRAINT tournament_hand_audit_log_action_check
    CHECK (action IN ('created','voided','locked','unlocked','heartbeat','updated')),
  CONSTRAINT tournament_hand_audit_log_hand_id_fkey
    FOREIGN KEY (hand_id)   REFERENCES public.tournament_hands(id) ON DELETE CASCADE,
  CONSTRAINT tournament_hand_audit_log_actor_id_fkey
    FOREIGN KEY (actor_id)  REFERENCES auth.users(id)              ON DELETE SET NULL
);

-- 1c. payroll_calculation_log
-- Audit trail for payroll calculation RPCs. If missing and a payroll RPC
-- writes to it, the RPC fails on a fresh build.
-- NOTE: no index on payroll_id (pre-existing design gap; not fixed here).
-- NOTE: RLS policies on this table are broadly permissive (qual=true) —
--       pre-existing design; not changed in this baseline.
CREATE TABLE IF NOT EXISTS public.payroll_calculation_log (
  id                  uuid  NOT NULL DEFAULT gen_random_uuid(),
  payroll_id          uuid  NOT NULL,
  calculation_details jsonb NOT NULL,
  created_at          timestamptz    DEFAULT now(),
  CONSTRAINT payroll_calculation_log_pkey
    PRIMARY KEY (id),
  CONSTRAINT payroll_calculation_log_payroll_id_fkey
    FOREIGN KEY (payroll_id) REFERENCES public.dealer_payroll(id) ON DELETE CASCADE
);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 2: Indexes
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_club_trackers_club
  ON public.club_trackers (club_id);

CREATE INDEX IF NOT EXISTS idx_club_trackers_user
  ON public.club_trackers (user_id);

CREATE INDEX IF NOT EXISTS idx_hand_audit_log_hand_id
  ON public.tournament_hand_audit_log (hand_id);

CREATE INDEX IF NOT EXISTS idx_hand_audit_log_created_at
  ON public.tournament_hand_audit_log (created_at);


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 3: Enable Row Level Security
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.club_trackers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_hand_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_calculation_log    ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 4: Helper functions required by RLS policies
-- (Must precede policy creation; also required by tracker-table RLS)
-- ─────────────────────────────────────────────────────────────────────────

-- Returns true if _user_id is a tracker for _club_id, or club owner, or super_admin.
-- Used as USING expression in RLS policies on tracker tables.
-- Depends on: club_trackers (above), clubs, has_role() (in local migrations).
CREATE OR REPLACE FUNCTION public.is_club_tracker(_user_id uuid, _club_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.club_trackers ct
    WHERE ct.user_id = _user_id AND ct.club_id = _club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = _club_id AND c.owner_id = _user_id
  ) OR public.has_role(_user_id, 'super_admin')
$function$;

-- Returns all club_ids the user has tracker access to.
-- Used as USING expression in RLS policies on tracker tables.
-- Depends on: club_trackers (above), clubs, has_role() (in local migrations).
CREATE OR REPLACE FUNCTION public.tracker_club_ids(_user_id uuid)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
AS $function$
  SELECT club_id FROM public.club_trackers WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE public.has_role(_user_id, 'super_admin')
$function$;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 5: RLS Policies
-- Each policy is wrapped in a duplicate_object guard for idempotency.
-- ─────────────────────────────────────────────────────────────────────────

-- club_trackers policies
-- Depends on: has_role() (local migrations), clubs table.
DO $$ BEGIN
  CREATE POLICY "club_trackers_select_self"
    ON public.club_trackers FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "club_trackers_select_club_owner"
    ON public.club_trackers FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.clubs
      WHERE clubs.id = club_trackers.club_id AND clubs.owner_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "club_trackers_select_super"
    ON public.club_trackers FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'super_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "club_trackers_insert_super_owner"
    ON public.club_trackers FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.clubs
        WHERE clubs.id = club_trackers.club_id AND clubs.owner_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "club_trackers_delete_super_owner"
    ON public.club_trackers FOR DELETE TO authenticated
    USING (
      public.has_role(auth.uid(), 'super_admin')
      OR EXISTS (
        SELECT 1 FROM public.clubs
        WHERE clubs.id = club_trackers.club_id AND clubs.owner_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- tournament_hand_audit_log policies
-- SELECT policy joins club_trackers — requires club_trackers to exist first.
DO $$ BEGIN
  CREATE POLICY "Hand audit log insertable by authenticated users"
    ON public.tournament_hand_audit_log FOR INSERT TO authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Hand audit log selectable by admins"
    ON public.tournament_hand_audit_log FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1
      FROM (((((
        public.tournament_hands th
        JOIN public.tournaments t ON (t.id = th.tournament_id))
        LEFT JOIN public.clubs c ON (c.id = t.club_id))
        LEFT JOIN public.club_cashiers cc
          ON (cc.club_id = t.club_id AND cc.user_id = auth.uid()))
        LEFT JOIN public.club_trackers ct
          ON (ct.club_id = t.club_id AND ct.user_id = auth.uid()))
        LEFT JOIN public.club_dealer_controls cdc
          ON (cdc.club_id = t.club_id AND cdc.user_id = auth.uid()))
      WHERE th.id = tournament_hand_audit_log.hand_id
        AND (
          c.owner_id = auth.uid()
          OR cc.user_id IS NOT NULL
          OR ct.user_id IS NOT NULL
          OR cdc.user_id IS NOT NULL
        )
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payroll_calculation_log policies
-- NOTE: These are broadly permissive (qual = true) — pre-existing design.
DO $$ BEGIN
  CREATE POLICY "Club members can view calc log"
    ON public.payroll_calculation_log FOR SELECT TO public
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access calc log"
    ON public.payroll_calculation_log FOR ALL TO public
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 6: Core functions (critical + high + medium)
-- ─────────────────────────────────────────────────────────────────────────

-- audit_tournament_hand — trigger function called by trg_audit_tournament_hand.
-- CRITICAL: every tournament_hands INSERT/UPDATE calls this via trigger.
-- Depends on: tournament_hand_audit_log (above), auth.uid().
CREATE OR REPLACE FUNCTION public.audit_tournament_hand()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.tournament_hand_audit_log
      (hand_id, action, actor_id, old_status, new_status, details)
    VALUES (
      NEW.id, 'created', NEW.created_by, NULL, NEW.status,
      jsonb_build_object(
        'tournament_id', NEW.tournament_id,
        'table_id',      NEW.table_id,
        'hand_number',   NEW.hand_number
      )
    );
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.tournament_hand_audit_log
      (hand_id, action, actor_id, old_status, new_status, details)
    VALUES (
      NEW.id,
      CASE
        WHEN OLD.status = 'in_progress' AND NEW.status = 'voided'                              THEN 'voided'
        WHEN OLD.locked_by_user_id IS DISTINCT FROM NEW.locked_by_user_id
             AND NEW.locked_by_user_id IS NOT NULL                                             THEN 'locked'
        WHEN OLD.locked_by_user_id IS DISTINCT FROM NEW.locked_by_user_id
             AND NEW.locked_by_user_id IS NULL                                                 THEN 'unlocked'
        WHEN OLD.locked_at IS DISTINCT FROM NEW.locked_at AND OLD.locked_at IS NOT NULL        THEN 'heartbeat'
        ELSE 'updated'
      END,
      COALESCE(NEW.locked_by_user_id, NEW.created_by, auth.uid()),
      OLD.status, NEW.status, '{}'::jsonb
    );
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- get_escalation_config — returns escalation tier config for a club.
-- HIGH: called inside perform_swing() on the escalation path.
-- Depends on: swing_escalation_config (in local migrations).
CREATE OR REPLACE FUNCTION public.get_escalation_config(p_club_id uuid)
  RETURNS TABLE(
    tier_1_min_overdue_min        integer,
    tier_1_min_rest_min           integer,
    tier_2_min_overdue_min        integer,
    tier_2_min_rest_min           integer,
    tier_2_skip_priority_break    boolean,
    tier_3_min_overdue_min        integer,
    tier_3_min_rest_min           integer,
    tier_3_skip_fatigue_cap       boolean,
    force_release_at_overdue_min  integer,
    audit_enabled_min_overdue_min integer
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sec.tier_1_min_overdue_min,
    sec.tier_1_min_rest_min,
    sec.tier_2_min_overdue_min,
    sec.tier_2_min_rest_min,
    sec.tier_2_skip_priority_break,
    sec.tier_3_min_overdue_min,
    sec.tier_3_min_rest_min,
    sec.tier_3_skip_fatigue_cap,
    sec.force_release_at_overdue_min,
    sec.audit_enabled_min_overdue_min
  FROM public.swing_escalation_config sec
  WHERE sec.club_id = p_club_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 5, 5, 15, 3, true, 30, 0, true, 30, 5;
  END IF;
END;
$function$;

-- reconcile_ghost_assignments — cron target (every 15 min).
-- HIGH: without this function the cron job fails every run and ghost
--       assignments (status='assigned', swing_due_at > 60 min ago) accumulate.
-- Depends on: dealer_assignments, transition_dealer_state() (local migrations).
-- NOTE: function checks result->>'success' but transition_dealer_state returns
--       key 'ok' — latent bug copied from live DB as-is for fidelity.
CREATE OR REPLACE FUNCTION public.reconcile_ghost_assignments(p_club_id uuid DEFAULT NULL::uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
AS $function$
DECLARE
  v_ghost RECORD;
  v_fixed_count INT := 0;
  v_skipped_count INT := 0;
  v_current_result JSONB;
  v_preassigned_result JSONB;
  v_current_ok BOOLEAN;
  v_preassigned_ok BOOLEAN;
  v_errors JSONB := '[]'::jsonb;
BEGIN
  FOR v_ghost IN
    SELECT
      da.id,
      da.attendance_id,
      da.pre_assigned_attendance_id,
      da.table_id,
      da.club_id
    FROM dealer_assignments da
    WHERE da.status = 'assigned'
      AND da.released_at IS NULL
      AND da.swing_processed_at IS NOT NULL
      AND da.swing_due_at < NOW() - INTERVAL '60 minutes'
      AND (p_club_id IS NULL OR da.club_id = p_club_id)
  LOOP
    BEGIN
      IF v_ghost.attendance_id IS NULL AND v_ghost.pre_assigned_attendance_id IS NULL THEN
        v_errors := v_errors || jsonb_build_object(
          'assignment_id', v_ghost.id,
          'step', 'pre_check',
          'error', 'Both attendance_id and pre_assigned_attendance_id are NULL — data corruption'
        );
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;
      v_current_ok := TRUE;
      v_preassigned_ok := TRUE;
      IF v_ghost.attendance_id IS NOT NULL THEN
        SELECT transition_dealer_state(
          p_attendance_id := v_ghost.attendance_id,
          p_new_state     := 'available',
          p_reason        := 'reconcile_ghost_release_current'
        ) INTO v_current_result;
        v_current_ok := COALESCE((v_current_result->>'success')::boolean, FALSE);
        IF NOT v_current_ok THEN
          v_errors := v_errors || jsonb_build_object(
            'assignment_id', v_ghost.id,
            'step', 'release_current',
            'error', v_current_result->>'error'
          );
        END IF;
      END IF;
      IF v_ghost.pre_assigned_attendance_id IS NOT NULL THEN
        SELECT transition_dealer_state(
          p_attendance_id := v_ghost.pre_assigned_attendance_id,
          p_new_state     := 'available',
          p_reason        := 'reconcile_ghost_release_preassigned'
        ) INTO v_preassigned_result;
        v_preassigned_ok := COALESCE((v_preassigned_result->>'success')::boolean, FALSE);
        IF NOT v_preassigned_ok THEN
          v_errors := v_errors || jsonb_build_object(
            'assignment_id', v_ghost.id,
            'step', 'release_preassigned',
            'error', v_preassigned_result->>'error'
          );
        END IF;
      END IF;
      IF v_current_ok AND v_preassigned_ok THEN
        UPDATE dealer_assignments
        SET
          status = 'completed',
          released_at = NOW(),
          release_reason = 'reconcile_ghost_cleanup',
          pre_assigned_attendance_id = NULL,
          pre_assigned_at = NULL,
          updated_at = NOW()
        WHERE id = v_ghost.id;
        v_fixed_count := v_fixed_count + 1;
        RAISE NOTICE 'Reconciled ghost assignment % on table %', v_ghost.id, v_ghost.table_id;
      ELSE
        v_errors := v_errors || jsonb_build_object(
          'assignment_id', v_ghost.id,
          'step', 'post_check',
          'error', 'One or more releases failed, NOT marking completed'
        );
        v_skipped_count := v_skipped_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'assignment_id', v_ghost.id,
        'step', 'exception',
        'error', SQLERRM
      );
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object(
    'fixed_count',   v_fixed_count,
    'skipped_count', v_skipped_count,
    'error_count',   jsonb_array_length(v_errors),
    'errors',        v_errors,
    'club_id',       p_club_id,
    'timestamp',     NOW()
  );
END;
$function$;

-- club_local_date — returns current date in club's local timezone.
-- MEDIUM: used in shift scheduling calculations.
-- Depends on: club_settings (in local migrations).
CREATE OR REPLACE FUNCTION public.club_local_date(p_club_id uuid)
  RETURNS date
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
AS $function$
  SELECT (NOW() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.club_settings WHERE club_id = p_club_id),
    'Asia/Ho_Chi_Minh'
  ))::DATE;
$function$;

-- tournament_break_all_tables — sends all assigned dealers on break.
-- MEDIUM: used by tournament director for table-wide break operations.
-- Depends on: dealer_assignments, game_tables, dealer_attendance, dealers,
--             dealer_breaks, audit_logs.
-- NOTE: inserts into dealer_breaks using column names started_at /
--       duration_minutes / reason. Verify these match the live dealer_breaks
--       schema (get_swing_metrics references break_start /
--       expected_duration_minutes — potential column name inconsistency in
--       the live DB definition; copied as-is for fidelity).
CREATE OR REPLACE FUNCTION public.tournament_break_all_tables(
  p_club_id         uuid,
  p_duration_minutes integer DEFAULT 20,
  p_reason           text    DEFAULT 'tournament_break'
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  v_assignment RECORD;
  v_affected JSONB := '[]'::JSONB;
  v_break_started_at TIMESTAMPTZ := now();
BEGIN
  FOR v_assignment IN
    SELECT
      da.id AS assignment_id,
      da.attendance_id,
      da.version,
      da.table_id,
      gt.table_name,
      d.full_name,
      d.telegram_user_id,
      d.telegram_username
    FROM dealer_assignments da
    JOIN game_tables gt       ON gt.id   = da.table_id
    JOIN dealer_attendance datt ON datt.id = da.attendance_id
    JOIN dealers d            ON d.id    = datt.dealer_id
    WHERE gt.club_id = p_club_id
      AND da.status = 'assigned'
    FOR UPDATE OF da SKIP LOCKED
  LOOP
    UPDATE dealer_assignments
    SET
      status            = 'on_break',
      version           = v_assignment.version + 1,
      swing_processed_at = v_break_started_at
    WHERE id = v_assignment.assignment_id;

    INSERT INTO dealer_breaks (
      attendance_id, assignment_id, started_at, duration_minutes, reason
    ) VALUES (
      v_assignment.attendance_id,
      v_assignment.assignment_id,
      v_break_started_at,
      p_duration_minutes,
      p_reason
    );

    UPDATE dealer_attendance
    SET current_state = 'on_break'
    WHERE id = v_assignment.attendance_id;

    INSERT INTO audit_logs (club_id, action, metadata, created_at)
    VALUES (
      p_club_id,
      'tournament_break',
      jsonb_build_object(
        'assignment_id',   v_assignment.assignment_id,
        'attendance_id',   v_assignment.attendance_id,
        'table_name',      v_assignment.table_name,
        'duration_minutes', p_duration_minutes
      ),
      now()
    );

    v_affected := v_affected || jsonb_build_array(jsonb_build_object(
      'attendance_id',   v_assignment.attendance_id,
      'full_name',       v_assignment.full_name,
      'telegram_user_id', v_assignment.telegram_user_id,
      'table_name',      v_assignment.table_name
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'affected_dealers', v_affected,
    'count',            jsonb_array_length(v_affected),
    'started_at',       v_break_started_at
  );
END;
$function$;

-- reconcile_dealer_states — corrects state drift between dealer_attendance
-- and dealer_assignments. Called by ops / manual reconciliation.
-- MEDIUM: state reconciliation unavailable without this on a fresh build.
-- Depends on: dealer_attendance, dealers, dealer_assignments.
-- NOTE: Step 3 contains `Dass.status` (capital D) — case inconsistency
--       copied as-is from live DB for fidelity. PostgreSQL folds to lowercase
--       at parse time so this is a latent identifier-case bug that may cause
--       a runtime error on some Postgres versions.
CREATE OR REPLACE FUNCTION public.reconcile_dealer_states(p_club_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
AS $function$
DECLARE
  v_fixed_available          INT := 0;
  v_fixed_assigned           INT := 0;
  v_fixed_pre_assigned_orphan INT := 0;
  v_fixed_pre_assigned_timeout INT := 0;
  v_cleared_orphaned         INT := 0;
  v_fixed_orphan_assignments INT := 0;
BEGIN
  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'assigned'
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'available'
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_available FROM fixed;

  WITH fixed AS (
    UPDATE dealer_assignments dass
    SET status        = 'completed',
        released_at   = NOW(),
        release_reason = 'pass0d_orphan_cleanup'
    FROM dealers d, dealer_attendance da
    WHERE dass.attendance_id = da.id
      AND da.dealer_id = d.id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND dass.status IN ('on_break', 'pre_assigned')
      AND dass.released_at IS NULL
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass2
        WHERE dass2.attendance_id = da.id
          AND dass2.id != dass.id
          AND dass2.status = 'assigned'
          AND dass2.released_at IS NULL
          AND dass2.table_id != dass.table_id
      )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_fixed_orphan_assignments FROM fixed;

  IF v_fixed_orphan_assignments > 0 THEN
    RAISE NOTICE '[reconcile] Step 1.5: Released % orphan assignments', v_fixed_orphan_assignments;
  END IF;

  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'assigned'
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_assigned FROM fixed;

  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'pre_assigned'
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.attendance_id = da.id
          AND Dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.pre_assigned_attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_pre_assigned_orphan FROM fixed;

  WITH fixed AS (
    UPDATE dealer_attendance da
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    FROM dealers d
    WHERE d.id = da.dealer_id
      AND d.club_id = p_club_id
      AND da.status = 'checked_in'
      AND da.current_state = 'pre_assigned'
      AND da.pre_assigned_at < NOW() - INTERVAL '30 seconds'
      AND EXISTS (
        SELECT 1 FROM dealer_assignments dass
        WHERE dass.pre_assigned_attendance_id = da.id
          AND dass.status = 'assigned'
          AND dass.released_at IS NULL
      )
    RETURNING da.id
  )
  SELECT COUNT(*) INTO v_fixed_pre_assigned_timeout FROM fixed;

  WITH cleared AS (
    UPDATE dealer_assignments dass
    SET pre_assigned_attendance_id = NULL,
        pre_assigned_at = NULL,
        updated_at = NOW()
    FROM dealers d, dealer_attendance da
    WHERE dass.attendance_id = da.id
      AND da.dealer_id = d.id
      AND d.club_id = p_club_id
      AND dass.status = 'assigned'
      AND dass.released_at IS NULL
      AND dass.pre_assigned_attendance_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM dealer_attendance da2
        WHERE da2.id = dass.pre_assigned_attendance_id
          AND da2.current_state = 'pre_assigned'
      )
    RETURNING dass.id
  )
  SELECT COUNT(*) INTO v_cleared_orphaned FROM cleared;

  RETURN jsonb_build_object(
    'fixed_available',            v_fixed_available,
    'fixed_assigned',             v_fixed_assigned,
    'fixed_pre_assigned_orphan',  v_fixed_pre_assigned_orphan,
    'fixed_pre_assigned_timeout', v_fixed_pre_assigned_timeout,
    'cleared_orphaned',           v_cleared_orphaned,
    'fixed_orphan_assignments',   v_fixed_orphan_assignments
  );
END;
$function$;

-- release_dealer_from_table — releases all assigned/on_break dealers at a table.
-- MEDIUM: manual dealer release operations unavailable without this.
-- Depends on: dealer_assignments, dealer_attendance.
CREATE OR REPLACE FUNCTION public.release_dealer_from_table(
  p_table_id    uuid,
  p_released_by uuid DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
AS $function$
DECLARE
  v_assignment         RECORD;
  v_other_active_count INT;
  v_new_state          TEXT;
  v_released_count     INT := 0;
BEGIN
  FOR v_assignment IN
    SELECT id, attendance_id, dealer_id, status
    FROM dealer_assignments
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
    ORDER BY assigned_at ASC
  LOOP
    UPDATE dealer_assignments
    SET released_at = NOW(),
        status      = 'completed',
        updated_at  = NOW()
    WHERE id = v_assignment.id;

    v_released_count := v_released_count + 1;

    SELECT COUNT(*) INTO v_other_active_count
    FROM dealer_assignments
    WHERE attendance_id = v_assignment.attendance_id
      AND status = 'assigned'
      AND released_at IS NULL
      AND id != v_assignment.id;

    v_new_state := CASE WHEN v_other_active_count > 0 THEN 'assigned' ELSE 'available' END;

    UPDATE dealer_attendance
    SET current_state       = v_new_state,
        pre_assigned_table_id = NULL,
        pre_assigned_at     = NULL
    WHERE id = v_assignment.attendance_id;
  END LOOP;

  UPDATE dealer_assignments dass
  SET pre_assigned_attendance_id = NULL,
      pre_assigned_at  = NULL,
      updated_at       = NOW()
  WHERE dass.table_id = p_table_id
    AND dass.pre_assigned_attendance_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM dealer_attendance da
      WHERE da.id = dass.pre_assigned_attendance_id
        AND da.current_state = 'pre_assigned'
    );

  RETURN jsonb_build_object(
    'released_count', v_released_count,
    'table_id',       p_table_id
  );
END;
$function$;

-- get_swing_metrics — global health snapshot (no p_club_id parameter).
-- MEDIUM: monitoring/metrics endpoint.
-- Depends on: dealer_attendance, dealer_assignments, swing_audit_logs,
--             dealer_breaks (all in local migrations).
CREATE OR REPLACE FUNCTION public.get_swing_metrics()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH state_distribution AS (
    SELECT current_state, COUNT(*)::int AS count
    FROM dealer_attendance
    WHERE status = 'checked_in'
    GROUP BY current_state
  ),
  active_dealers AS (
    SELECT COUNT(*)::int AS count FROM dealer_attendance
    WHERE current_state = 'assigned' AND status = 'checked_in'
  ),
  available_dealers AS (
    SELECT COUNT(*)::int AS count FROM dealer_attendance
    WHERE current_state = 'available' AND status = 'checked_in'
  ),
  on_break_dealers AS (
    SELECT COUNT(*)::int AS count FROM dealer_attendance
    WHERE current_state = 'on_break' AND status = 'checked_in'
  ),
  active_tables AS (
    SELECT COUNT(*)::int AS count FROM dealer_assignments
    WHERE status = 'assigned'
  ),
  overtime_dealers AS (
    SELECT COUNT(*)::int AS count FROM dealer_attendance
    WHERE overtime_minutes > 0 AND status = 'checked_in'
  ),
  recent_activity AS (
    SELECT
      COUNT(*)::int AS swings_last_24h,
      COUNT(*) FILTER (WHERE details->>'was_overtime' = 'true')::int AS overtime_swings_24h
    FROM swing_audit_logs
    WHERE action = 'swing_executed'
      AND created_at >= NOW() - INTERVAL '24 hours'
  ),
  last_24h_outcomes AS (
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE error_message IS NOT NULL), 0)::int AS errors_24h,
      COALESCE(COUNT(*) FILTER (WHERE action = 'race_lost'), 0)::int AS race_lost_24h
    FROM swing_audit_logs
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  ),
  stuck_dealers AS (
    SELECT
      COUNT(*)::int AS count,
      json_agg(json_build_object(
        'id',           da.id,
        'dealer_id',    da.dealer_id,
        'current_state', da.current_state,
        'minutes_in_state', CASE
          WHEN da.current_state = 'pre_assigned' AND da.pre_assigned_at IS NOT NULL
            THEN ROUND(EXTRACT(EPOCH FROM (NOW() - da.pre_assigned_at)) / 60)
          ELSE ROUND(EXTRACT(EPOCH FROM (NOW() - da.created_at)) / 60)
        END,
        'pre_assigned_at', da.pre_assigned_at,
        'check_in_time', da.check_in_time
      ) ORDER BY da.current_state, da.created_at) AS details
    FROM dealer_attendance da
    WHERE da.check_out_time IS NULL
      AND da.current_state IN ('in_transition', 'pre_assigned')
  ),
  orphaned_breaks AS (
    SELECT
      COUNT(*)::int AS count,
      json_agg(json_build_object(
        'break_id',        db.id,
        'assignment_id',   db.assignment_id,
        'started',         db.break_start,
        'expected_duration', db.expected_duration_minutes,
        'overdue_minutes', ROUND(EXTRACT(EPOCH FROM (
          NOW() - (db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL)
        )) / 60)
      ) ORDER BY db.break_start) AS details
    FROM dealer_breaks db
    WHERE db.break_end IS NULL
      AND db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL < NOW()
  ),
  ot_details AS (
    SELECT json_agg(json_build_object(
      'dealer_id',       da.dealer_id,
      'attendance_id',   da.id,
      'overtime_minutes', da.overtime_minutes,
      'current_state',   da.current_state
    ) ORDER BY da.overtime_minutes DESC) AS details
    FROM dealer_attendance da
    WHERE da.overtime_minutes > 0 AND da.status = 'checked_in'
  )
  SELECT jsonb_build_object(
    'snapshot', jsonb_build_object(
      'active_tables',     (SELECT count FROM active_tables),
      'active_dealers',    (SELECT count FROM active_dealers),
      'available_dealers', (SELECT count FROM available_dealers),
      'on_break_dealers',  (SELECT count FROM on_break_dealers),
      'overtime_dealers',  (SELECT count FROM overtime_dealers),
      'total_checked_in',  (SELECT COALESCE(SUM(count), 0) FROM state_distribution)
    ),
    'state_distribution',  (SELECT jsonb_object_agg(COALESCE(current_state, 'unknown'), count) FROM state_distribution),
    'recent_activity', jsonb_build_object(
      'swings_last_24h',    (SELECT swings_last_24h FROM recent_activity),
      'overtime_swings_24h', (SELECT overtime_swings_24h FROM recent_activity),
      'errors_last_24h',    (SELECT errors_24h FROM last_24h_outcomes),
      'race_lost_24h',      (SELECT race_lost_24h FROM last_24h_outcomes)
    ),
    'stuck_dealers',          (SELECT count FROM stuck_dealers),
    'stuck_dealer_details',   COALESCE((SELECT details FROM stuck_dealers), '[]'::json),
    'orphaned_breaks',        (SELECT count FROM orphaned_breaks),
    'orphaned_break_details', COALESCE((SELECT details FROM orphaned_breaks), '[]'::json),
    'overtime_details',       COALESCE((SELECT details FROM ot_details), '[]'::json),
    'health_status', CASE
      WHEN (SELECT count FROM stuck_dealers) > 0   THEN 'warning'
      WHEN (SELECT count FROM orphaned_breaks) > 5 THEN 'warning'
      WHEN (SELECT errors_24h FROM last_24h_outcomes) > 10 THEN 'degraded'
      ELSE 'healthy'
    END,
    'taken_at', NOW()::timestamptz
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- force_release_stuck_assignment — emergency ops: force-releases an assignment
-- that exceeds the club's force_release threshold.
-- MEDIUM: emergency release unavailable without this on a fresh build.
-- Depends on: dealer_assignments, swing_escalation_config (local migrations).
-- NOTE: sets should_audit_version = false — runtime dependency on
--       dealer_assignments.should_audit_version column (added by
--       pass1b_circuit_breaker.sql). Function creates fine on a fresh build
--       but would fail at runtime if that migration has not been applied.
CREATE OR REPLACE FUNCTION public.force_release_stuck_assignment(
  p_assignment_id uuid,
  p_club_id       uuid,
  p_reason        text DEFAULT 'force_release_overdue'
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_row      record;
  v_threshold integer;
  v_minutes_overdue numeric;
BEGIN
  SELECT force_release_at_overdue_min INTO v_threshold
  FROM public.swing_escalation_config
  WHERE club_id = p_club_id;
  IF v_threshold IS NULL THEN v_threshold := 30; END IF;

  SELECT a.*, EXTRACT(EPOCH FROM (now() - a.swing_due_at))/60.0 AS minutes_overdue
  INTO v_row
  FROM public.dealer_assignments a
  WHERE a.id = p_assignment_id
    AND a.club_id = p_club_id
    AND a.status IN ('assigned', 'on_break')
    AND a.swing_processed_at IS NULL
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'not_found_or_already_processed',
      'assignment_id', p_assignment_id
    );
  END IF;

  v_minutes_overdue := v_row.minutes_overdue;

  IF v_minutes_overdue < v_threshold THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'below_threshold',
      'minutes_overdue', v_minutes_overdue,
      'threshold', v_threshold
    );
  END IF;

  UPDATE public.dealer_assignments
  SET
    status             = 'completed',
    released_at        = now(),
    release_reason     = p_reason,
    should_audit_version = false,
    updated_at         = now()
  WHERE id = p_assignment_id;

  RETURN jsonb_build_object(
    'success',         true,
    'assignment_id',   p_assignment_id,
    'table_id',        v_row.table_id,
    'attendance_id',   v_row.attendance_id,
    'minutes_overdue', v_minutes_overdue,
    'threshold',       v_threshold,
    'reason',          p_reason,
    'released_at',     now()
  );
EXCEPTION
  WHEN lock_not_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason',  'row_locked_by_concurrent_update',
      'assignment_id', p_assignment_id
    );
END;
$function$;

-- cleanup_old_diagnostic_logs — cron target; deletes diagnostic_logs > 7 days.
-- LOW: diagnostic log table grows unbounded without this on a fresh build.
-- Depends on: diagnostic_logs (assumed in local migrations).
CREATE OR REPLACE FUNCTION public.cleanup_old_diagnostic_logs()
  RETURNS void
  LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM diagnostic_logs
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$function$;


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 7: Triggers
-- ─────────────────────────────────────────────────────────────────────────

-- trg_audit_tournament_hand
-- Confirmed absent from all local migration files. Must be created here.
-- Fires after every INSERT and UPDATE on tournament_hands.
-- Calls audit_tournament_hand() defined in Section 6 above.
DROP TRIGGER IF EXISTS trg_audit_tournament_hand ON public.tournament_hands;
CREATE TRIGGER trg_audit_tournament_hand
  AFTER INSERT OR UPDATE ON public.tournament_hands
  FOR EACH ROW EXECUTE FUNCTION public.audit_tournament_hand();


-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 8: Event trigger function + event trigger
-- rls_auto_enable automatically enables RLS on every new public table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (schema: %)', cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$function$;

DO $$
BEGIN
  CREATE EVENT TRIGGER rls_auto_enable_trigger
    ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    EXECUTE PROCEDURE public.rls_auto_enable();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- DEFERRED — not included in this baseline
-- ─────────────────────────────────────────────────────────────────────────
--
-- disable_stale_audit_flags(p_stale_after_hours integer DEFAULT 24)
-- enable_audit_for_stuck_rows(p_club_id uuid, p_min_overdue_min integer DEFAULT 5)
--
-- Both reference dealer_assignments.should_audit_version (SET / WHERE clause).
-- That column is added by 20260725000001_pass1b_circuit_breaker.sql, which
-- is a pending local migration requiring the CONCURRENTLY fix (D3c, already
-- applied) before it can be pushed. These functions will create without error
-- on a fresh build but will fail at runtime until pass1b_circuit_breaker
-- has been applied.
--
-- Include them in a follow-up migration after pass1b_circuit_breaker confirms
-- applied, OR add them here with a comment accepting the runtime-only risk.
-- ─────────────────────────────────────────────────────────────────────────
