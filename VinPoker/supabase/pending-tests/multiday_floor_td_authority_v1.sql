-- Disposable-only capability fixture. Restore the fixture helper at ROLLBACK;
-- production authorization uses the existing is_club_floor implementation.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('10000000-0000-0000-0000-000000000004'),
 ('10000000-0000-0000-0000-000000000005'),
 ('10000000-0000-0000-0000-000000000006')
ON CONFLICT(id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.is_club_floor(p_actor uuid,p_club uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT p_actor='10000000-0000-0000-0000-000000000004'::uuid
   AND p_club='20000000-0000-0000-0000-000000000001'::uuid
$$;
INSERT INTO public.clubs(id,owner_id)
VALUES('20000000-0000-0000-0000-000000000002',
 '10000000-0000-0000-0000-000000000006') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
VALUES
 ('30000000-0000-0000-0000-000000000150',
  '20000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000150',50,1000000,100000),
 ('30000000-0000-0000-0000-000000000151',
  '20000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000151',50,1000000,100000);
INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 ('40000000-0000-0000-0000-000000000150',
  '20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000150','final'),
 ('40000000-0000-0000-0000-000000000151',
  '20000000-0000-0000-0000-000000000002',
  '30000000-0000-0000-0000-000000000151','final');
DO $$ DECLARE v_out jsonb; BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 v_out:=public.multi_day_floor_read_v1('30000000-0000-0000-0000-00000000006e');
 IF v_out->'capabilities' IS DISTINCT FROM
   '{"canFinalizePayout":true,"canRequestAdjustment":true,"canApproveAdjustment":true}'::jsonb THEN
   RAISE EXCEPTION 'owner_capabilities_missing: %',v_out->'capabilities';
 END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000004',true);
 v_out:=public.multi_day_set_qualification_rules_v2(
   '30000000-0000-0000-0000-000000000150','SUM_STACKS',0.5,100);
 IF v_out->>'day2Percent'<>'100' THEN RAISE EXCEPTION 'floor_rules_denied'; END IF;
 v_out:=public.multi_day_floor_read_v1('30000000-0000-0000-0000-000000000150');
 IF v_out->'rules'->>'day2Percent'<>'100' OR v_out->'capabilities' IS DISTINCT FROM
   '{"canFinalizePayout":false,"canRequestAdjustment":false,"canApproveAdjustment":false}'::jsonb THEN
   RAISE EXCEPTION 'floor_read_capabilities_wrong: %',v_out;
 END IF;
 v_out:=public.multi_day_floor_read_v1('30000000-0000-0000-0000-00000000006e');
 IF v_out->'finalization' IS NULL OR v_out->'capabilities'->>'canFinalizePayout'<>'false' OR
    v_out->'capabilities'->>'canApproveAdjustment'<>'false' THEN
   RAISE EXCEPTION 'finalized_floor_capabilities_wrong: %',v_out->'capabilities';
 END IF;
 v_out:=public.multi_day_payout_postfinal_state_v1('30000000-0000-0000-0000-00000000006e');
 IF v_out->>'revision' IS NULL THEN RAISE EXCEPTION 'floor_postfinal_read_denied'; END IF;
 v_out:=public.multi_day_qualification_preview_v1('30000000-0000-0000-0000-000000000150');
 IF v_out->>'state'<>'PLANNED' THEN RAISE EXCEPTION 'floor_preview_denied'; END IF;
 -- The event is already qualified; reaching already-locked proves the Floor
 -- actor passed the qualification Lock authority check without mutating it.
 BEGIN
   PERFORM public.multi_day_lock_qualification_v1(
     '30000000-0000-0000-0000-00000000006e',
     ARRAY['00000000-0000-0000-0000-000000000001'::uuid],
     repeat('a',32),'c0000000-0000-0000-0000-000000000150');
   RAISE EXCEPTION 'already_locked_not_detected';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_qualification_already_locked' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_floor_read_v1('30000000-0000-0000-0000-000000000151');
   RAISE EXCEPTION 'cross_club_read_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_floor_actor_denied' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v2(
     '30000000-0000-0000-0000-000000000151','SUM_STACKS',0.5,100);
   RAISE EXCEPTION 'cross_club_rules_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_rules_actor_denied' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v2(
     '30000000-0000-0000-0000-000000000150','SUM_STACKS',0.5,100);
   RAISE EXCEPTION 'gate_off_rules_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
 BEGIN
   PERFORM public.multi_day_qualification_preview_v1('30000000-0000-0000-0000-000000000150');
   RAISE EXCEPTION 'unassigned_actor_preview_allowed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_preview_actor_denied' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
SELECT 'multiday_floor_td_authority_v1 PASS' AS result;
