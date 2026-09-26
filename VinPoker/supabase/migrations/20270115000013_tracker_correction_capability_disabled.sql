-- R1 Release containment: disable only legacy correction/undo RPC execution.
-- Normal Tracker writes, board/finish flows, reads, auth, and raw table grants
-- are intentionally unchanged. No function bodies or business rows are edited.
-- ROLLBACK: do not re-grant these SECURITY DEFINER/critical writer RPCs. Reopen
-- correction only through a separately reviewed replacement capability and a
-- forward migration with explicit owner approval.
BEGIN;

CREATE TEMP TABLE tracker_correction_writer_definitions_before
ON COMMIT DROP AS
SELECT p.oid, pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = ANY (ARRAY[
    'edit_completed_hand',
    'apply_resettle_forward',
    'commit_tournament_settlement_outcome',
    'commit_tracker_hand_correction_outcome',
    'delete_last_action',
    'undo_last_action'
  ]);

DO $disable_correction_capabilities$
DECLARE
  v_unexpected text;
BEGIN
  -- Each signature was checked against its canonical CREATE FUNCTION source.
  -- Absence is allowed because several legacy writers live only in the
  -- historical-never-replay archive; any unreviewed overload stops migration.
  WITH expected(proname, argument_types) AS (
    VALUES
      ('edit_completed_hand', 'uuid, uuid, text, jsonb, jsonb, jsonb, integer, jsonb'),
      ('apply_resettle_forward', 'uuid, uuid, text, jsonb, jsonb, jsonb'),
      ('commit_tournament_settlement_outcome', 'uuid, uuid, bigint, text, bigint, text, text, text, jsonb, jsonb, jsonb, jsonb'),
      ('commit_tracker_hand_correction_outcome', 'uuid, uuid, bigint, text, bigint, text, text, text, jsonb, jsonb, jsonb, jsonb, text'),
      ('delete_last_action', 'uuid, uuid'),
      ('undo_last_action', 'uuid')
  )
  SELECT string_agg(
    format('%I(%s)', p.proname, pg_catalog.oidvectortypes(p.proargtypes)),
    ', ' ORDER BY p.proname, pg_catalog.oidvectortypes(p.proargtypes)
  )
  INTO v_unexpected
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN expected e
    ON e.proname = p.proname
   AND e.argument_types = pg_catalog.oidvectortypes(p.proargtypes)
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY[
      'edit_completed_hand',
      'apply_resettle_forward',
      'commit_tournament_settlement_outcome',
      'commit_tracker_hand_correction_outcome',
      'delete_last_action',
      'undo_last_action'
    ])
    AND e.proname IS NULL;

  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'tracker_correction_unreviewed_writer_overload: %', v_unexpected;
  END IF;

  IF pg_catalog.to_regprocedure('public.edit_completed_hand(uuid,uuid,text,jsonb,jsonb,jsonb,integer,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.edit_completed_hand(uuid,uuid,text,jsonb,jsonb,jsonb,integer,jsonb) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF pg_catalog.to_regprocedure('public.apply_resettle_forward(uuid,uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.apply_resettle_forward(uuid,uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF pg_catalog.to_regprocedure('public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.commit_tournament_settlement_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF pg_catalog.to_regprocedure('public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.commit_tracker_hand_correction_outcome(uuid,uuid,bigint,text,bigint,text,text,text,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF pg_catalog.to_regprocedure('public.delete_last_action(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.delete_last_action(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
  IF pg_catalog.to_regprocedure('public.undo_last_action(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.undo_last_action(uuid) FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END;
$disable_correction_capabilities$;

DO $verify_correction_capabilities$
DECLARE
  v_changed text;
BEGIN
  SELECT string_agg(before.oid::regprocedure::text, ', ' ORDER BY before.oid::regprocedure::text)
  INTO v_changed
  FROM tracker_correction_writer_definitions_before before
  LEFT JOIN pg_catalog.pg_proc p ON p.oid = before.oid
  WHERE p.oid IS NULL
     OR pg_catalog.pg_get_functiondef(p.oid) IS DISTINCT FROM before.definition;

  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION 'tracker_correction_writer_definition_changed: %', v_changed;
  END IF;
END;
$verify_correction_capabilities$;

COMMIT;
