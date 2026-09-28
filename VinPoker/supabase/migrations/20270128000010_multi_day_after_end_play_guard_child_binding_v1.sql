-- Forward-only repair for the live multi-day after-End-Play trigger shared by
-- tournament_hands, tournament_chip_counts, hand_players, and hand_actions.
-- hand_actions has only hand_id, so its tournament must be resolved through
-- tournament_hands for both the OLD and NEW row images.
--
-- ROLLBACK: deploy a new forward migration restoring the previously reviewed
-- function definition. Do not drop or disable the four guard triggers and do
-- not delete multi_day_flight_ends_v1 evidence.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.tournament_hands') IS NULL
     OR to_regclass('public.tournament_chip_counts') IS NULL
     OR to_regclass('public.hand_players') IS NULL
     OR to_regclass('public.hand_actions') IS NULL
     OR to_regclass('public.multi_day_flight_ends_v1') IS NULL
     OR to_regprocedure('private.multi_day_after_end_play_guard_v1()') IS NULL THEN
    RAISE EXCEPTION 'multi_day_after_end_play_guard_baseline_missing'
      USING ERRCODE = '23514';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION private.multi_day_after_end_play_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_tournament_id uuid;
  v_new_tournament_id uuid;
  v_tournament_id uuid;
  v_phase text;
BEGIN
  IF TG_TABLE_NAME IN ('tournament_hands', 'tournament_chip_counts', 'hand_players') THEN
    IF TG_OP <> 'INSERT' THEN
      v_old_tournament_id := OLD.tournament_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new_tournament_id := NEW.tournament_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'hand_actions' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT h.tournament_id
      INTO v_old_tournament_id
      FROM public.tournament_hands AS h
      WHERE h.id = OLD.hand_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT h.tournament_id
      INTO v_new_tournament_id
      FROM public.tournament_hands AS h
      WHERE h.id = NEW.hand_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'multi_day_end_play_guard_table_unsupported: %', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  FOR v_tournament_id IN
    SELECT DISTINCT candidate.tournament_id
    FROM pg_catalog.unnest(ARRAY[v_old_tournament_id, v_new_tournament_id])
      AS candidate(tournament_id)
    WHERE candidate.tournament_id IS NOT NULL
    ORDER BY candidate.tournament_id
  LOOP
    SELECT t.phase
    INTO v_phase
    FROM public.tournaments AS t
    WHERE t.id = v_tournament_id
    FOR SHARE;

    IF v_phase = 'flight'
       AND EXISTS (
         SELECT 1
         FROM public.multi_day_flight_ends_v1 AS f
         WHERE f.flight_tournament_id = v_tournament_id
       ) THEN
      RAISE EXCEPTION 'multi_day_end_play_source_frozen'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION private.multi_day_after_end_play_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
