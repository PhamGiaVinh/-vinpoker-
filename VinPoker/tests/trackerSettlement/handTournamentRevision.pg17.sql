\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF current_database()<>'vinpoker_ops_card56_overlap_20261011' THEN
  RAISE EXCEPTION 'tournament_revision_wrong_database';
 END IF;
END $$;
-- Clone only owned synthetic fixture rows. Keep real constraints/triggers active.
INSERT INTO public.tournaments SELECT (jsonb_populate_record(NULL::public.tournaments,
 to_jsonb(t)||jsonb_build_object('id','85800000-0000-4000-8000-000000000058',
 'name','Identity58 target TEST'))).* FROM public.tournaments t
 WHERE id='85000000-0000-4000-8000-000000000001';
INSERT INTO public.game_tables SELECT (jsonb_populate_record(NULL::public.game_tables,
 to_jsonb(t)||jsonb_build_object('id','83800000-0000-4000-8000-000000000058',
 'table_name','Identity58 TEST'))).* FROM public.game_tables t
 WHERE id='83000000-0000-4000-8000-000000000001';
INSERT INTO public.table_sessions SELECT (jsonb_populate_record(NULL::public.table_sessions,
 to_jsonb(t)||jsonb_build_object('id','83600000-0000-4000-8000-000000000058',
 'game_table_id','83800000-0000-4000-8000-000000000058',
 'tournament_id','85800000-0000-4000-8000-000000000058'))).* FROM public.table_sessions t
 WHERE id='83500000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_tables SELECT (jsonb_populate_record(NULL::public.tournament_tables,
 to_jsonb(t)||jsonb_build_object('id','84800000-0000-4000-8000-000000000058',
 'table_id','83800000-0000-4000-8000-000000000058',
 'game_table_id','83800000-0000-4000-8000-000000000058',
 'table_session_id','83600000-0000-4000-8000-000000000058',
 'tournament_id','85800000-0000-4000-8000-000000000058'))).* FROM public.tournament_tables t
 WHERE id='84000000-0000-4000-8000-000000000001';
UPDATE public.tournament_hands SET status='completed'
 WHERE id='86000000-0000-4000-8000-000000000001';
CREATE TEMP TABLE tour_revision_before AS SELECT * FROM public.tournament_hands
 WHERE id='86000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated',
 'sub','81100000-0000-4000-8000-000000000001')::text,true);
SET LOCAL ROLE authenticated;
UPDATE public.tournament_hands SET tournament_id='85800000-0000-4000-8000-000000000058',
 table_id='84800000-0000-4000-8000-000000000058',
 tournament_table_id='84800000-0000-4000-8000-000000000058',
 table_session_id='83600000-0000-4000-8000-000000000058'
 WHERE id='86000000-0000-4000-8000-000000000001';
RESET ROLE;
DO $$ BEGIN
 IF NOT (SELECT h.tournament_id='85800000-0000-4000-8000-000000000058'
   AND h.source_revision=b.source_revision+1 FROM public.tournament_hands h
   JOIN tour_revision_before b USING(id)) THEN
  RAISE EXCEPTION 'tournament_revision_same_club_update_failed';
 END IF;
END $$;
CREATE TEMP TABLE tour_denial_before AS SELECT to_jsonb(h) AS snapshot
 FROM public.tournament_hands h WHERE id='86000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  UPDATE public.tournament_hands SET tournament_id='85000000-0000-4000-8000-000000000002',
   table_id='84000000-0000-4000-8000-000000000003',
   tournament_table_id='84000000-0000-4000-8000-000000000003',
   table_session_id='83500000-0000-4000-8000-000000000003'
   WHERE id='86000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'tournament_revision_foreign_club_accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT to_jsonb(h) IS DISTINCT FROM b.snapshot FROM public.tournament_hands h
   CROSS JOIN tour_denial_before b WHERE h.id='86000000-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'tournament_revision_denial_mutated_hand';
 END IF;
END $$;
ROLLBACK;
\echo HAND_TOURNAMENT58_REVISION_TENANT_PASS
