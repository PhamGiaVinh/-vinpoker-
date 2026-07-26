BEGIN;

-- Source-only rollout note:
-- This migration must be applied through the controlled Floor DB runbook before
-- the new picker can open a table. It does not deploy Edge, change a feature
-- flag, or touch an existing tournament until an authenticated operator calls
-- the RPC.
--
-- ROLLBACK:
--   REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v2(UUID, INTEGER, TEXT)
--     FROM PUBLIC, anon, authenticated, service_role;
--   DROP FUNCTION IF EXISTS public.floor_open_tournament_table_v2(UUID, INTEGER, TEXT);

/**
 * Opens or reopens one numbered Floor table with its chip-authority mode in the
 * same transaction. The existing open_tournament_table RPC remains the single
 * source of table allocation, authorization, tournament locking and duplicate
 * prevention. This wrapper narrows the new UX to tables 1–100 and nine seats,
 * then records the deliberate Manual/Tracker choice before commit.
 */
CREATE OR REPLACE FUNCTION public.floor_open_tournament_table_v2(
  p_tournament_id UUID,
  p_table_number INTEGER,
  p_control_mode TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_open_result JSONB;
  v_tournament_table_id UUID;
  v_club_id UUID;
  v_previous_mode TEXT;
  v_previous_revision BIGINT;
  v_next_revision BIGINT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_table_number IS NULL OR p_table_number < 1 OR p_table_number > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_table_number');
  END IF;
  IF p_control_mode IS NULL OR p_control_mode NOT IN ('manual', 'tracker') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_floor_control_mode');
  END IF;

  -- open_tournament_table derives the actor from auth.uid(), locks the
  -- tournament row, verifies owner/cashier/floor membership and serializes
  -- duplicate number decisions. Nested calls share this transaction.
  v_open_result := public.open_tournament_table(
    p_tournament_id,
    p_table_number,
    9
  );
  IF COALESCE((v_open_result->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_open_result;
  END IF;

  v_tournament_table_id := (v_open_result->>'tournament_table_id')::UUID;

  SELECT
    t.club_id,
    tt.floor_control_mode,
    tt.floor_control_revision
  INTO
    v_club_id,
    v_previous_mode,
    v_previous_revision
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE tt.id = v_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND tt.table_number = p_table_number
    AND tt.status = 'active'
  FOR UPDATE OF tt;

  IF NOT FOUND THEN
    -- Raising (rather than returning a partial error envelope) rolls the nested
    -- table-open write back with the transaction.
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'table_mode_apply_failed';
  END IF;

  UPDATE public.tournament_tables
  SET max_seats = 9,
      floor_control_mode = p_control_mode,
      floor_control_revision = floor_control_revision + 1
  WHERE id = v_tournament_table_id
    AND tournament_id = p_tournament_id
    AND status = 'active'
    AND floor_control_revision = v_previous_revision
  RETURNING floor_control_revision INTO v_next_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'table_mode_apply_failed';
  END IF;

  INSERT INTO public.audit_logs (
    club_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    payload
  ) VALUES (
    v_club_id,
    v_actor,
    CASE
      WHEN COALESCE((v_open_result->>'reopened')::BOOLEAN, false)
        THEN 'floor_table_reopened_v2'
      ELSE 'floor_table_opened_v2'
    END,
    'tournament_table',
    v_tournament_table_id,
    jsonb_build_object(
      'tournament_id', p_tournament_id,
      'table_number', p_table_number,
      'max_seats', 9,
      'floor_control_mode', p_control_mode,
      'previous_floor_control_mode', v_previous_mode,
      'previous_floor_control_revision', v_previous_revision,
      'floor_control_revision', v_next_revision,
      'reopened', COALESCE((v_open_result->>'reopened')::BOOLEAN, false),
      'payout_applied', false
    )
  );

  RETURN v_open_result || jsonb_build_object(
    'max_seats', 9,
    'floor_control_mode', p_control_mode,
    'floor_control_revision', v_next_revision,
    'payout_applied', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v2(UUID, INTEGER, TEXT)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v2(UUID, INTEGER, TEXT)
TO authenticated;

COMMIT;
