-- 20261224000000_close_dealer_tables.sql
-- Operator "Đóng bàn" (owner 2026-07-08): a scope-aware bulk close in the Dealer
-- Swing battlefield map, next to "+ Thêm bàn". Closes the EXACT tables the operator
-- confirmed (p_table_ids) — never scope-scans for tables opened after the confirm
-- dialog was shown — releasing each seated dealer to the break pool (on_break),
-- from where the existing "Kết thúc nghỉ" returns them to available.
--
-- Mirrors the per-table release block of archive_and_close_dealer_tour
-- (20260902000000:147-209) but WITHOUT the archive/snapshot and WITHOUT touching
-- dealer_shifts (this closes TABLES, not the tour). It is atomic (one tx), so no
-- Telegram spam (close-table edge fires one msg/table). Only touches
-- dealer_assignments / dealer_attendance / dealer_breaks / game_tables.
--
-- SOURCE-ONLY: apply in an owner-gated SQL-editor window (verify with BEGIN…ROLLBACK
-- first). The frontend has NO feature flag → do NOT merge the FE PR until this RPC
-- is applied + verified live. Rollback:
--   docs/emergency_rollbacks/ROLLBACK_close_dealer_tables_20261224.sql

CREATE OR REPLACE FUNCTION public.close_dealer_tables(
  p_club_id   uuid,
  p_shift_id  uuid   DEFAULT NULL,   -- NULL = Tổng thể (any tour); else must match game_tables.shift_id
  p_table_ids uuid[] DEFAULT NULL    -- the EXACT tables confirmed in the dialog
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor            uuid := auth.uid();
  v_break_dur        int;
  v_tables_closed    int  := 0;
  v_dealers_released int  := 0;
  v_closed           jsonb := '[]'::jsonb;
  v_closed_ids       uuid[] := ARRAY[]::uuid[];
  v_skipped          uuid[];
  v_tx               jsonb;
  r_tbl  record;
  r_pa   record;
  r_asg  record;
  r_brk  record;
BEGIN
  -- Permission: caller must control this club's dealers (same gate as close-table
  -- and archive_and_close_dealer_tour).
  IF NOT public.is_club_dealer_control(v_actor, p_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'permission_denied');
  END IF;

  -- Nothing confirmed → no-op (never "close everything in scope" on an empty list).
  IF p_table_ids IS NULL OR array_length(p_table_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'tables_closed', 0, 'dealers_released', 0,
                              'closed_tables', '[]'::jsonb, 'skipped', '[]'::jsonb);
  END IF;

  -- Break duration mirrors close-table / archive RPC: club tournament config, default 10.
  SELECT COALESCE(break_duration_minutes, 10) INTO v_break_dur
    FROM public.swing_config WHERE club_id = p_club_id AND table_type = 'tournament' LIMIT 1;
  v_break_dur := COALESCE(v_break_dur, 10);

  -- Close ONLY the confirmed IDs that STILL validate (in this club, active, in scope).
  -- Lock the rows to serialise concurrent closes / double-click. We iterate the
  -- confirmed set — a table opened after the confirm dialog is NOT in p_table_ids
  -- and therefore never closed here.
  FOR r_tbl IN
    SELECT id, table_name FROM public.game_tables
     WHERE id = ANY(p_table_ids)
       AND club_id = p_club_id
       AND status = 'active'
       AND (p_shift_id IS NULL OR shift_id = p_shift_id)
     FOR UPDATE
  LOOP
    -- Release pre_assigned dealers pointing at this table (no break row).
    FOR r_pa IN
      SELECT id FROM public.dealer_attendance
       WHERE pre_assigned_table_id = r_tbl.id AND current_state = 'pre_assigned'
    LOOP
      PERFORM public.transition_dealer_state(r_pa.id, 'available', 'tables_closed_release_pre_assign');
    END LOOP;
    UPDATE public.dealer_attendance SET pre_assigned_table_id = NULL, pre_assigned_at = NULL
      WHERE pre_assigned_table_id = r_tbl.id;

    -- All active assignments (assigned + on_break) → completed + dealer to break pool.
    FOR r_asg IN
      SELECT id, attendance_id FROM public.dealer_assignments
       WHERE table_id = r_tbl.id AND status IN ('assigned','on_break') AND released_at IS NULL
    LOOP
      UPDATE public.dealer_assignments
         SET status = 'completed', released_at = now(), release_reason = 'tables_closed'
       WHERE id = r_asg.id;

      -- End any open break on this assignment FIRST, then create exactly one — so a
      -- dealer already on break is normalised to a single open break row (≤1/dealer).
      FOR r_brk IN
        SELECT id FROM public.dealer_breaks WHERE assignment_id = r_asg.id AND break_end IS NULL
      LOOP
        PERFORM public.end_dealer_break(r_brk.id, r_asg.attendance_id);
      END LOOP;

      v_tx := public.transition_dealer_state(r_asg.attendance_id, 'on_break', 'tables_closed');
      IF (v_tx->>'ok')::boolean IS NOT TRUE THEN
        UPDATE public.dealer_attendance SET current_state = 'available'
          WHERE id = r_asg.attendance_id AND status = 'checked_in'
            AND current_state IN ('assigned','in_transition');
      END IF;

      UPDATE public.dealer_attendance SET last_released_at = now() WHERE id = r_asg.attendance_id;

      INSERT INTO public.dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason)
      VALUES (r_asg.id, now(), v_break_dur, 'tables_closed_break');

      v_dealers_released := v_dealers_released + 1;
    END LOOP;

    -- Cancel reserved rows (Step-2 empty-table reservations) on this table (no break).
    UPDATE public.dealer_assignments
       SET status = 'swing_skipped', released_at = now(), release_reason = 'tables_closed'
     WHERE table_id = r_tbl.id AND status = 'reserved' AND released_at IS NULL;

    -- Deactivate + detach the table (same shape as archive RPC + close-table edge).
    UPDATE public.game_tables SET status = 'inactive', shift_id = NULL WHERE id = r_tbl.id;

    v_tables_closed := v_tables_closed + 1;
    v_closed := v_closed || jsonb_build_object('id', r_tbl.id, 'table_name', r_tbl.table_name);
    v_closed_ids := array_append(v_closed_ids, r_tbl.id);

    -- Per-table audit.
    INSERT INTO public.swing_audit_logs (club_id, shift_id, table_id, action, details, triggered_by)
    VALUES (p_club_id, p_shift_id, r_tbl.id, 'tables_closed',
            jsonb_build_object('table_name', r_tbl.table_name, 'source', 'dealer_swing_close_tables'),
            v_actor::text);
  END LOOP;

  -- Confirmed IDs that were NOT closed (already inactive / wrong club / wrong scope).
  SELECT COALESCE(array_agg(t), ARRAY[]::uuid[]) INTO v_skipped
    FROM unnest(p_table_ids) t WHERE NOT (t = ANY(v_closed_ids));

  -- One summary audit row (who closed which set, and how many dealers moved).
  INSERT INTO public.swing_audit_logs (club_id, shift_id, table_id, action, details, triggered_by)
  VALUES (p_club_id, p_shift_id, NULL, 'tables_closed_bulk',
          jsonb_build_object(
            'source', 'dealer_swing_close_tables',
            'table_ids', to_jsonb(p_table_ids),
            'tables_closed', v_tables_closed,
            'dealers_released', v_dealers_released,
            'skipped', to_jsonb(v_skipped)
          ),
          v_actor::text);

  RETURN jsonb_build_object(
    'ok', true,
    'tables_closed', v_tables_closed,
    'dealers_released', v_dealers_released,
    'closed_tables', v_closed,
    'skipped', to_jsonb(v_skipped)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid[]) IS
  'Dealer Swing operator "Đóng bàn": close ONLY the confirmed table_ids (validated in-club/active/scope), '
  'releasing seated dealers to the break pool (on_break, ≤1 open break each). Scope-aware via p_shift_id '
  '(NULL=all). Mirrors archive_and_close_dealer_tour release WITHOUT archive; no Telegram. authenticated + gate.';

NOTIFY pgrst, 'reload schema';
