-- Chip bank manual adjustment: bind tournament/club and make retry identity payload-safe.
-- Forward-only replacement of the reviewed live function; never replay the archived migration.
-- SOURCE ONLY. Daybreak and bank coupling remain OFF. Apply only through the protected
-- owner-approved migration workflow after a fresh restore-verified recovery point.
-- Rollback: a new forward migration restoring the reviewed previous function body from
-- migration-archive/historical-never-replay/20261019000000_chip_ops_ledger_bank.sql.
-- Do not rewrite schema_migrations, truncate the bank ledger, or restore DB over new writes.

DO $precondition$
DECLARE v_body_sha256 text;
BEGIN
  SELECT encode(extensions.digest(convert_to(p.prosrc, 'UTF8'), 'sha256'), 'hex')
  INTO v_body_sha256
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text)');

  IF v_body_sha256 IS DISTINCT FROM 'c42675d1ef018ef928730963156d1935457faae8c6a1a1c846a0189d6f6ae523' THEN
    RAISE EXCEPTION 'chip_ops_bank_adjust live body differs from reviewed precondition';
  END IF;
END;
$precondition$;

CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(
  p_club_id         uuid,
  p_denomination_id uuid,
  p_direction       text,
  p_count           bigint,
  p_tournament_id   uuid DEFAULT NULL,
  p_old_version     integer DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_on    bigint;
  v_ver   integer;
  v_new   bigint;
  v_prior public.chip_bank_ledger%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_club_id IS NULL OR p_denomination_id IS NULL OR p_direction IS NULL OR
     p_direction NOT IN ('xuat', 'thu') OR p_count IS NULL OR p_count <= 0 OR
     p_old_version IS NULL OR p_old_version < 0 OR
     p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 OR
     length(p_idempotency_key) > 128 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT');
  END IF;
  IF NOT (COALESCE(public.is_club_owner(v_uid, p_club_id), false) OR
          COALESCE(public.is_club_chip_master(v_uid, p_club_id), false)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chip_set_denomination d
    WHERE d.id = p_denomination_id AND d.club_id = p_club_id
  ) THEN
    RETURN jsonb_build_object('error', 'DENOM_NOT_IN_CLUB');
  END IF;

  -- A committed retry must return the prior receipt, never apply a second balance change.
  -- The global unique key is not authority to replay another actor's or payload's result.
  SELECT * INTO v_prior FROM public.chip_bank_ledger
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_prior.club_id IS DISTINCT FROM p_club_id OR
       v_prior.reason IS DISTINCT FROM 'manual' OR
       v_prior.denomination_id IS DISTINCT FROM p_denomination_id OR
       v_prior.tournament_id IS DISTINCT FROM p_tournament_id OR
       v_prior.direction IS DISTINCT FROM p_direction OR
       v_prior.count IS DISTINCT FROM p_count OR
       v_prior.actor IS DISTINCT FROM v_uid OR
       (v_prior.details ? 'expected_version' AND
        (v_prior.details->>'expected_version')::integer IS DISTINCT FROM p_old_version) THEN
      RETURN jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true,
      'direction', v_prior.direction, 'count', v_prior.count,
      'on_hand_count', v_prior.balance_after, 'balance_after', v_prior.balance_after);
  END IF;

  IF p_tournament_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = p_tournament_id AND t.club_id = p_club_id AND t.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'TOURNAMENT_NOT_IN_CLUB');
  END IF;

  SELECT on_hand_count, version INTO v_on, v_ver
  FROM public.chip_bank
  WHERE club_id = p_club_id AND denomination_id = p_denomination_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_old_version <> 0 THEN RETURN jsonb_build_object('error', 'race_lost'); END IF;
    v_on := 0;
    v_new := CASE WHEN p_direction = 'thu' THEN p_count ELSE -p_count END;
    IF v_new < 0 THEN RETURN jsonb_build_object('error', 'BANK_NEGATIVE', 'on_hand', v_on); END IF;
    BEGIN
      INSERT INTO public.chip_bank (club_id, denomination_id, on_hand_count, version, updated_by)
      VALUES (p_club_id, p_denomination_id, v_new, 1, v_uid);
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', 'race_lost');
    END;
  ELSE
    IF v_ver <> p_old_version THEN
      RETURN jsonb_build_object('error', 'race_lost', 'actual_version', v_ver);
    END IF;
    v_new := CASE WHEN p_direction = 'thu' THEN v_on + p_count ELSE v_on - p_count END;
    IF v_new < 0 THEN RETURN jsonb_build_object('error', 'BANK_NEGATIVE', 'on_hand', v_on); END IF;
    UPDATE public.chip_bank
    SET on_hand_count = v_new, version = v_ver + 1, updated_at = now(), updated_by = v_uid
    WHERE club_id = p_club_id AND denomination_id = p_denomination_id;
  END IF;

  INSERT INTO public.chip_bank_ledger
    (club_id, denomination_id, tournament_id, direction, count, balance_after,
     reason, idempotency_key, actor, details)
  VALUES
    (p_club_id, p_denomination_id, p_tournament_id, p_direction, p_count, v_new,
     'manual', p_idempotency_key, v_uid, jsonb_build_object('expected_version', p_old_version));

  RETURN jsonb_build_object('status', 'ok', 'direction', p_direction,
    'count', p_count, 'on_hand_count', v_new, 'balance_after', v_new);
END;
$function$;

REVOKE ALL ON FUNCTION public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) TO authenticated;
