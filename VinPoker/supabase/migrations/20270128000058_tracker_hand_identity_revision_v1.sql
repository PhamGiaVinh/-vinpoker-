-- Forward-only: hash-bearing hand identity changes must own a new generation.
-- No row backfill, existing shared function/grant replacement, or worker activation.
-- Hand revision routing is replaced for every tracked outcome column.
-- Emergency compensation only: remove the added statement trigger and restore
-- the reviewed predecessor revision trigger together in a forward transaction;
-- preserve revisions, queued generations and settlement audit already produced.
-- Restoring the predecessor reintroduces the identity gap; not a steady-state fix.
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
  replacement := replace(replacement,'EXECUTE FUNCTION tracker_bump_hand_source_revision()',
    'EXECUTE FUNCTION floor_private.bump_hand_identity_revision_v1()');
  -- Installed below after the predecessor has been qualified.
  CREATE FUNCTION floor_private.bump_hand_identity_revision_v1()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
  BEGIN
    NEW.source_revision := COALESCE(OLD.source_revision,1)+1;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END $body$;
  EXECUTE replacement;
END $migration$;
ALTER FUNCTION floor_private.bump_hand_identity_revision_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.bump_hand_identity_revision_v1()
  FROM PUBLIC,anon,authenticated,service_role;
-- Do not acquire tournament advisory locks after a hand tuple is locked.
-- Collect the complete OLD/NEW range union, then lock outcomes by stable ID.
CREATE FUNCTION floor_private.invalidate_new_hand_identity_chain_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE outcome_ids uuid[];
BEGIN
  WITH changed AS (
    SELECT o.id,o.tournament_id old_tournament,o.hand_number old_number,
      n.tournament_id new_tournament,n.hand_number new_number
    FROM identity_old o JOIN identity_new n ON n.id=o.id
    WHERE o.tournament_id IS DISTINCT FROM n.tournament_id
      OR o.hand_number IS DISTINCT FROM n.hand_number
      OR o.source_revision IS DISTINCT FROM n.source_revision
  )
  SELECT array_agg(DISTINCT proof.id ORDER BY proof.id) INTO outcome_ids
  FROM changed c JOIN public.tournament_hands h ON
    (h.tournament_id=c.old_tournament AND h.hand_number<=c.old_number)
    OR (h.tournament_id=c.new_tournament AND h.hand_number<=c.new_number)
    OR h.id=c.id
  JOIN public.tournament_settlement_outcomes proof ON proof.hand_id=h.id
  WHERE proof.status='verified' AND
    (COALESCE(proof.verification_scope,'chain')='chain' OR
      (proof.verification_scope='historical_display' AND h.id=c.id));
  PERFORM proof.id FROM public.tournament_settlement_outcomes proof
    WHERE proof.id=ANY(outcome_ids) ORDER BY proof.id FOR UPDATE;
  UPDATE public.tournament_settlement_outcomes SET status='stale',updated_at=pg_catalog.now()
    WHERE id=ANY(outcome_ids) AND status='verified';
  RETURN NULL;
END $$;
ALTER FUNCTION floor_private.invalidate_new_hand_identity_chain_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.invalidate_new_hand_identity_chain_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_tracker_new_hand_identity_chain_v1
AFTER UPDATE ON public.tournament_hands
REFERENCING OLD TABLE AS identity_old NEW TABLE AS identity_new
FOR EACH STATEMENT
EXECUTE FUNCTION floor_private.invalidate_new_hand_identity_chain_v1();
COMMIT;
