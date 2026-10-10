-- Forward-only: hash-bearing hand identity changes must own a new generation.
-- No row backfill, grants, function replacement, or worker activation.
-- Rollback: restore the reviewed predecessor trigger with a forward migration;
-- preserve revisions, queued generations and settlement audit already produced.
BEGIN;
DO $migration$
DECLARE predecessor text; replacement text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO STRICT predecessor
  FROM pg_trigger t WHERE t.tgrelid='public.tournament_hands'::regclass
    AND t.tgname='trg_tracker_hand_source_revision'
    AND NOT t.tgisinternal AND t.tgenabled='O';
  IF (SELECT md5(replace(p.prosrc,E'\r','')) FROM pg_proc p
      WHERE p.oid='public.tracker_bump_hand_source_revision()'::regprocedure)
      <> '788228372490f54cfa8e28c3d2ec1908' THEN
    RAISE EXCEPTION 'hand_identity_revision_function_drift';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE
      p.oid='public.tracker_bump_hand_source_revision()'::regprocedure
      AND p.proowner='postgres'::regrole AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=""']
      AND p.proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'hand_identity_revision_authority_drift';
  END IF;
  IF predecessor <> 'CREATE TRIGGER trg_tracker_hand_source_revision BEFORE UPDATE OF button_seat, community_cards, pot_size, side_pots, status, is_voided, tracker_level_id, tracker_level_number, tracker_small_blind, tracker_big_blind, tracker_bba, tracker_is_break, tracker_blind_evidence ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION tracker_bump_hand_source_revision()' THEN
    RAISE EXCEPTION 'hand_identity_revision_trigger_drift';
  END IF;
  replacement := replace(predecessor,'BEFORE UPDATE OF button_seat,',
    'BEFORE UPDATE OF tournament_id, hand_number, button_seat,');
  EXECUTE 'DROP TRIGGER trg_tracker_hand_source_revision ON public.tournament_hands';
  EXECUTE replacement;
END $migration$;
COMMIT;
