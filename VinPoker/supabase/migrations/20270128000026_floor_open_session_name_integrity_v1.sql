-- Fix live multi-table creation: legacy table_name defaults to empty text,
-- but (tournament_id, table_name) is unique. Each session gets a unique label.
-- Physical table number and exact session remain the operational identities.
-- No legacy row, entry, chips, attendance, receipt or ledger is rewritten.
-- ROLLBACK: keep automatic Swing OFF; restore the reviewed function body from
-- 20270113000011_floor_table_control_v3_final_contract.sql at e53468d8237d42c2482b7e8b2a67205c5769937d.
-- Preserve new sessions and labels. Do not delete historical tournament tables.
BEGIN;
DO $precondition$
BEGIN
  IF pg_catalog.md5(pg_catalog.replace((SELECT prosrc FROM pg_catalog.pg_proc
      WHERE oid='public.floor_open_tournament_table_v3(uuid,uuid,text,uuid)'::regprocedure), chr(13), ''))
      IS DISTINCT FROM '35b7ba0e858a6c4f3f945e53b4a364bd' THEN
    RAISE EXCEPTION 'FLOOR_OPEN_FUNCTION_PRECONDITION_MISMATCH';
  END IF;
END;
$precondition$;

CREATE OR REPLACE FUNCTION public.floor_open_tournament_table_v3(
  p_tournament_id uuid,
  p_game_table_id uuid,
  p_control_mode text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament public.tournaments%ROWTYPE;
  v_game_table public.game_tables%ROWTYPE;
  v_session_id uuid;
  v_tournament_table_id uuid;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_tournament_id IS NULL
     OR p_game_table_id IS NULL
     OR p_request_id IS NULL
     OR p_control_mode IS NULL
     OR p_control_mode NOT IN ('manual', 'tracker') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id,
    'game_table_id', p_game_table_id,
    'control_mode', p_control_mode
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_open_tournament_table_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_open_tournament_table_v3', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'tournament_not_open', 'status', v_tournament.status
    );
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT * INTO v_game_table
  FROM public.game_tables
  WHERE id = p_game_table_id
    AND club_id = v_tournament.club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  IF v_game_table.operational_status IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_preflight_required');
  END IF;
  IF v_game_table.operational_status <> 'available' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'game_table_not_available',
      'operational_status', v_game_table.operational_status
    );
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.table_sessions active_session
    WHERE active_session.game_table_id = v_game_table.id
      AND active_session.closed_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_in_use');
  END IF;

  BEGIN
    INSERT INTO public.table_sessions (
      club_id,
      game_table_id,
      session_type,
      tournament_id,
      control_mode,
      control_epoch,
      revision,
      opened_by
    ) VALUES (
      v_tournament.club_id,
      v_game_table.id,
      'tournament',
      v_tournament.id,
      p_control_mode,
      1,
      1,
      v_actor
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.tournament_tables (
      tournament_id,
      game_table_id,
      table_session_id,
      table_number,
      table_name,
      max_seats,
      status
    ) VALUES (
      v_tournament.id,
      v_game_table.id,
      v_session_id,
      v_game_table.table_number,
      pg_catalog.format('Bàn %s · phiên %s', v_game_table.table_number, v_session_id),
      9,
      'active'
    )
    RETURNING id INTO v_tournament_table_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_in_use');
  END;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'tournament_id', v_tournament.id,
    'tournament_table_id', v_tournament_table_id,
    'table_session_id', v_session_id,
    'game_table_id', v_game_table.id,
    'table_number', v_game_table.table_number,
    'control_mode', p_control_mode,
    'control_epoch', 1,
    'revision', 1
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_open_tournament_table_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid,uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3(uuid,uuid,text,uuid) TO authenticated;
COMMIT;

