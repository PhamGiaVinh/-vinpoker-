-- ============================================================================
-- Archive & Close Tour — Dealer Swing (PR2 DB primitive)
-- ============================================================================
-- Authored SOURCE-ONLY (owner policy 2026-06-15). NOT applied. Apply later as a
-- controlled single Management-API op in an owner-gated window — do NOT use
-- `supabase db push` / deploy_db=true.
--
-- Purpose: one SECURITY DEFINER RPC `archive_and_close_dealer_tour` that, in a
-- SINGLE transaction: (1) snapshots the whole swing state of a tour into
-- `dealer_swing_archives`, then (2) releases every ACTIVE table of the tour and
-- sends its dealers to the break pool — by MIRRORING the canonical per-table
-- close-table logic (status='completed'+released_at, end open break,
-- transition_dealer_state→'on_break' fallback available, last_released_at,
-- dealer_breaks row, table status='inactive'+shift_id=NULL, audit). Archive is
-- inserted BEFORE any mutation in the same tx → if archive (or anything) fails,
-- the whole close rolls back. Idempotent via dealer_shifts.closed_at.
--
-- Live schema verified before authoring: dealer_assignments.status CHECK =
-- (assigned,on_break,completed,swing_skipped,reserved) + has release_reason;
-- game_tables.status = (active,inactive,maintenance); dealer_breaks(assignment_id,
-- break_start, expected_duration_minutes, reason, attendance_id, club_id);
-- is_club_dealer_control(_user_id uuid,_club_id uuid); end_dealer_break(p_break_id,
-- p_attendance_id); swing_audit_logs / audit_logs columns as used by close-table.
-- ============================================================================

BEGIN;

-- ── 1. Tour close/archive markers (additive; idempotency + UI closed-state) ──
ALTER TABLE public.dealer_shifts ADD COLUMN IF NOT EXISTS closed_at   timestamptz;
ALTER TABLE public.dealer_shifts ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ── 2. Archive table (JSONB snapshot) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dealer_swing_archives (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL,
  tour_id          uuid NOT NULL,
  tour_name        text,
  snapshot         jsonb NOT NULL,
  archive_filename text,
  actor_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dealer_swing_archives_tour ON public.dealer_swing_archives (tour_id, created_at DESC);

-- RLS: dealer-control of the club may READ the snapshot (for the "Tải JSON"
-- download). No INSERT/UPDATE/DELETE policy → only the SECURITY DEFINER RPC
-- writes (it bypasses RLS); nobody can hand-edit/forge archives.
ALTER TABLE public.dealer_swing_archives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsa_select_dealer_control ON public.dealer_swing_archives;
CREATE POLICY dsa_select_dealer_control ON public.dealer_swing_archives
  FOR SELECT TO authenticated
  USING (public.is_club_dealer_control(auth.uid(), club_id));

-- ── 3. archive_and_close_dealer_tour ─────────────────────────────────────────
-- Returns jsonb {ok, outcome, archive_id?, archive_filename?, tables_released,
--   dealers_released, assignments_closed, reservations_cancelled, warnings}.
-- Outcomes: ok | already_closed | permission_denied | tour_not_found
CREATE OR REPLACE FUNCTION public.archive_and_close_dealer_tour(
  p_tour_id uuid,
  p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_tour       dealer_shifts%ROWTYPE;
  v_archive_id uuid;
  v_filename   text;
  v_snapshot   jsonb;
  v_break_dur  int;
  v_tables_released        int := 0;
  v_dealers_released       int := 0;
  v_assignments_closed     int := 0;
  v_reservations_cancelled int := 0;
  v_warnings   jsonb := '[]'::jsonb;
  v_cnt        int;
  v_tx         jsonb;
  r_tbl  record;
  r_pa   record;
  r_asg  record;
  r_brk  record;
BEGIN
  -- Permission: caller must control this club's dealers.
  IF NOT public.is_club_dealer_control(v_actor, p_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'permission_denied');
  END IF;

  -- Lock the tour row (serialises concurrent close + double-click).
  SELECT * INTO v_tour FROM dealer_shifts
   WHERE id = p_tour_id AND club_id = p_club_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'tour_not_found');
  END IF;

  -- Idempotent: already closed → return the existing archive id (no re-mutate).
  IF v_tour.closed_at IS NOT NULL THEN
    SELECT id INTO v_archive_id FROM dealer_swing_archives
      WHERE tour_id = p_tour_id ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'outcome', 'already_closed', 'archive_id', v_archive_id);
  END IF;

  -- Break duration (mirror close-table): club tournament config, default 10.
  SELECT break_duration_minutes INTO v_break_dur
    FROM swing_config WHERE club_id = p_club_id AND table_type = 'tournament' LIMIT 1;
  v_break_dur := COALESCE(v_break_dur, 10);

  v_filename := 'swing_'
    || regexp_replace(COALESCE(NULLIF(v_tour.tour_name, ''), 'tour'), '[^a-zA-Z0-9]+', '_', 'g')
    || '_' || to_char(now(), 'YYYYMMDD_HH24MI') || '.json';

  -- ── 3a. Build the full snapshot ──────────────────────────────────────────
  v_snapshot := jsonb_build_object(
    'tour',        to_jsonb(v_tour),
    'captured_at', now(),
    'actor_id',    v_actor,
    'tables',      (SELECT COALESCE(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
                      FROM game_tables g WHERE g.shift_id = p_tour_id),
    'assignments', (SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
                      FROM dealer_assignments a
                      JOIN game_tables g ON g.id = a.table_id
                     WHERE g.shift_id = p_tour_id AND a.released_at IS NULL
                       AND a.status IN ('assigned','on_break','reserved')),
    'attendance',  (SELECT COALESCE(jsonb_agg(to_jsonb(da)), '[]'::jsonb)
                      FROM dealer_attendance da
                     WHERE da.id IN (SELECT a.attendance_id FROM dealer_assignments a
                                       JOIN game_tables g ON g.id = a.table_id
                                      WHERE g.shift_id = p_tour_id AND a.released_at IS NULL)),
    'dealer_breaks', (SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
                      FROM dealer_breaks b WHERE b.club_id = p_club_id AND b.break_end IS NULL),
    'swing_audit_logs', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
                      FROM swing_audit_logs s WHERE s.shift_id = p_tour_id),
    'audit_logs',  (SELECT COALESCE(jsonb_agg(to_jsonb(al)), '[]'::jsonb)
                      FROM audit_logs al
                     WHERE al.club_id = p_club_id AND al.entity_type = 'game_table'
                       AND al.entity_id IN (SELECT id FROM game_tables WHERE shift_id = p_tour_id))
  );

  -- ── 3b. Insert archive FIRST (same tx → close blocked if this fails) ──────
  INSERT INTO dealer_swing_archives (club_id, tour_id, tour_name, snapshot, archive_filename, actor_id)
  VALUES (p_club_id, p_tour_id, v_tour.tour_name, v_snapshot, v_filename, v_actor)
  RETURNING id INTO v_archive_id;

  -- ── 3c. Per ACTIVE table of the tour — mirror close-table ────────────────
  FOR r_tbl IN
    SELECT id, table_name FROM game_tables WHERE shift_id = p_tour_id AND status = 'active'
  LOOP
    -- Release pre_assigned dealers pointing at this table.
    FOR r_pa IN
      SELECT id FROM dealer_attendance WHERE pre_assigned_table_id = r_tbl.id AND current_state = 'pre_assigned'
    LOOP
      PERFORM transition_dealer_state(r_pa.id, 'available', 'tour_closed_release_pre_assign');
    END LOOP;
    UPDATE dealer_attendance SET pre_assigned_table_id = NULL, pre_assigned_at = NULL
      WHERE pre_assigned_table_id = r_tbl.id;

    -- All active assignments (assigned + on_break).
    FOR r_asg IN
      SELECT id, attendance_id FROM dealer_assignments
       WHERE table_id = r_tbl.id AND status IN ('assigned','on_break') AND released_at IS NULL
    LOOP
      UPDATE dealer_assignments
         SET status = 'completed', released_at = now(), release_reason = 'tour_closed'
       WHERE id = r_asg.id;
      v_assignments_closed := v_assignments_closed + 1;

      -- End any open break on this assignment.
      FOR r_brk IN SELECT id FROM dealer_breaks WHERE assignment_id = r_asg.id AND break_end IS NULL LOOP
        PERFORM end_dealer_break(r_brk.id, r_asg.attendance_id);
      END LOOP;

      -- Dealer → on_break (canonical break pool). Fallback to available.
      v_tx := transition_dealer_state(r_asg.attendance_id, 'on_break', 'tour_closed');
      IF (v_tx->>'ok')::boolean IS NOT TRUE THEN
        UPDATE dealer_attendance SET current_state = 'available'
          WHERE id = r_asg.attendance_id AND status = 'checked_in'
            AND current_state IN ('assigned','in_transition');
      END IF;

      UPDATE dealer_attendance SET last_released_at = now() WHERE id = r_asg.attendance_id;

      INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason)
      VALUES (r_asg.id, now(), v_break_dur, 'tour_closed_break');

      v_dealers_released := v_dealers_released + 1;
    END LOOP;

    -- Cancel reserved rows (Step-2 empty-table reservations) on this table.
    UPDATE dealer_assignments
       SET status = 'swing_skipped', released_at = now(), release_reason = 'tour_closed'
     WHERE table_id = r_tbl.id AND status = 'reserved' AND released_at IS NULL;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_reservations_cancelled := v_reservations_cancelled + v_cnt;

    -- Deactivate the table (return to pool).
    UPDATE game_tables SET status = 'inactive', shift_id = NULL WHERE id = r_tbl.id;
    v_tables_released := v_tables_released + 1;

    -- Audit (both logs, mirror close-table).
    INSERT INTO swing_audit_logs (club_id, shift_id, table_id, action, details, triggered_by)
    VALUES (p_club_id, p_tour_id, r_tbl.id, 'tour_closed',
            jsonb_build_object('table_name', r_tbl.table_name, 'archive_id', v_archive_id), v_actor::text);
    INSERT INTO audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (p_club_id, v_actor, 'tour_closed', 'game_table', r_tbl.id,
            jsonb_build_object('tour_id', p_tour_id, 'archive_id', v_archive_id));
  END LOOP;

  IF v_tables_released = 0 THEN
    v_warnings := v_warnings || to_jsonb('no_active_tables'::text);
  END IF;

  -- ── 3d. Mark the tour closed + archived ──────────────────────────────────
  UPDATE dealer_shifts SET closed_at = now(), archived_at = now() WHERE id = p_tour_id;

  RETURN jsonb_build_object(
    'ok', true, 'outcome', 'ok',
    'archive_id', v_archive_id, 'archive_filename', v_filename,
    'tables_released', v_tables_released, 'dealers_released', v_dealers_released,
    'assignments_closed', v_assignments_closed, 'reservations_cancelled', v_reservations_cancelled,
    'warnings', v_warnings
  );
END;
$$;

-- ── 4. Grants — RPC has an internal auth.uid() actor guard, so authenticated
--      may call it (it self-rejects non-dealer-control). anon revoked. ────────
REVOKE ALL ON FUNCTION public.archive_and_close_dealer_tour(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.archive_and_close_dealer_tour(uuid, uuid) TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- VERIFICATION (AFTER a controlled apply; read-only):
-- ----------------------------------------------------------------------------
-- 1) Columns + table + index exist:
--    SELECT 1 FROM information_schema.columns WHERE table_name='dealer_shifts' AND column_name IN ('closed_at','archived_at');
--    SELECT 1 FROM information_schema.tables WHERE table_name='dealer_swing_archives';
-- 2) RPC exists, SECURITY DEFINER, search_path:
--    SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname='archive_and_close_dealer_tour';
-- 3) anon cannot execute (empty):
--    SELECT grantee FROM information_schema.role_routine_grants
--    WHERE routine_name='archive_and_close_dealer_tour' AND grantee IN ('anon','public');
-- 4) RLS policy present:
--    SELECT polname FROM pg_policies WHERE tablename='dealer_swing_archives';
-- 5) Smoke (on a DISPOSABLE test tour with the floor user's JWT):
--    SELECT archive_and_close_dealer_tour('<tour>','<club>');  -- {ok,outcome:ok,...}
--    SELECT archive_and_close_dealer_tour('<tour>','<club>');  -- {ok,outcome:already_closed}
--
-- ROLLBACK (if needed after apply):
-- ----------------------------------------------------------------------------
--   DROP FUNCTION IF EXISTS public.archive_and_close_dealer_tour(uuid, uuid);
--   DROP TABLE IF EXISTS public.dealer_swing_archives;     -- (drops the snapshots!)
--   ALTER TABLE public.dealer_shifts DROP COLUMN IF EXISTS closed_at;
--   ALTER TABLE public.dealer_shifts DROP COLUMN IF EXISTS archived_at;
-- ============================================================================
