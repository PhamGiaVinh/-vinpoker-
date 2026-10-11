\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $$ DECLARE definition text; BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO STRICT definition FROM pg_trigger t
  WHERE t.tgrelid='public.tournament_hands'::regclass
    AND t.tgname='trg_tracker_hand_source_revision'
    AND NOT t.tgisinternal AND t.tgenabled='O';
  IF definition <> 'CREATE TRIGGER trg_tracker_hand_source_revision BEFORE UPDATE OF tournament_id, hand_number, button_seat, community_cards, pot_size, side_pots, status, is_voided, tracker_level_id, tracker_level_number, tracker_small_blind, tracker_big_blind, tracker_bba, tracker_is_break, tracker_blind_evidence ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION floor_private.bump_hand_identity_revision_v1()' THEN
    RAISE EXCEPTION 'identity58_trigger_postcheck_failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE
    p.oid='public.tracker_bump_hand_source_revision()'::regprocedure
    AND md5(replace(p.prosrc,E'\r',''))='788228372490f54cfa8e28c3d2ec1908'
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=""']
    AND p.proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'identity58_revision_function_postcheck_failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE
    t.tgrelid='public.tournament_hands'::regclass
    AND t.tgname='trg_tracker_enqueue_historical_display' AND t.tgenabled='O') THEN
    RAISE EXCEPTION 'identity58_enqueue_disabled';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE
    t.tgrelid='public.tournament_hands'::regclass
    AND t.tgname='trg_tracker_new_hand_identity_chain_v1' AND t.tgenabled='O'
    AND pg_get_triggerdef(t.oid)='CREATE TRIGGER trg_tracker_new_hand_identity_chain_v1 AFTER UPDATE ON public.tournament_hands REFERENCING OLD TABLE AS identity_old NEW TABLE AS identity_new FOR EACH STATEMENT EXECUTE FUNCTION floor_private.invalidate_new_hand_identity_chain_v1()') THEN
    RAISE EXCEPTION 'identity58_new_range_trigger_postcheck_failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE
    p.oid='floor_private.invalidate_new_hand_identity_chain_v1()'::regprocedure
    AND md5(replace(p.prosrc,E'\r',''))='4d11bde070cb76c9c0b012ee1daddbef'
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=""']
    AND p.proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'identity58_new_range_authority_postcheck_failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE
    p.oid='floor_private.bump_hand_identity_revision_v1()'::regprocedure
    AND md5(replace(p.prosrc,E'\r',''))='c7c774e44774c0faf6c8deb16904c332'
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=""']
    AND p.proacl::text='{postgres=X/postgres}') THEN
    RAISE EXCEPTION 'identity58_private_revision_authority_postcheck_failed';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tournament_hands'::regclass
    AND tgname='trg_00_tracker_hand_identity_scope_v1') THEN
    RAISE EXCEPTION 'identity58_unsafe_scope_trigger_present';
  END IF;
END $$;
ROLLBACK;
\echo HAND_IDENTITY58_READONLY_OBJECT_POSTCHECK_PASS
