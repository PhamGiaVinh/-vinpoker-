-- Disposable PG17 baseline: real package rules and qualification preview RPCs.
-- Historical rows keep their old quota; new rows freeze two independent rates.
\set ON_ERROR_STOP on
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
DO $$ DECLARE v_rule record; v_read jsonb; BEGIN
 SELECT * INTO v_rule FROM public.multi_day_qualification_rules_v1
 WHERE event_id='30000000-0000-0000-0000-00000000000a';
 IF v_rule.day2_percent IS DISTINCT FROM v_rule.itm_percent THEN
   RAISE EXCEPTION 'historical_single_rate_changed';
 END IF;
 v_read:=public.multi_day_floor_read_v1('30000000-0000-0000-0000-00000000000a');
 IF (v_read->'rules'->>'day2Percent')::numeric IS DISTINCT FROM v_rule.day2_percent THEN
   RAISE EXCEPTION 'historical_floor_projection_changed';
 END IF;
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v1(
     '30000000-0000-0000-0000-00000000000a','SUM_STACKS',1.5);
   RAISE EXCEPTION 'ambiguous_old_writer_allowed';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'multi_day_day2_percent_required' THEN RAISE; END IF;
 END;
END $$;
DO $$ DECLARE v_expected text; v_actual text; BEGIN
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 SELECT f.rules_version INTO v_expected FROM public.multi_day_payout_race_fixture_v1 f
 WHERE f.event_id='30000000-0000-0000-0000-00000000000b';
 v_actual:=public.multi_day_payout_preview_v1(
   '30000000-0000-0000-0000-00000000000b')->>'rulesVersion';
 IF v_actual IS DISTINCT FROM v_expected THEN
   RAISE EXCEPTION 'historical_rules_revision_changed: %, %',v_expected,v_actual;
 END IF;
END $$;
INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
VALUES('30000000-0000-0000-0000-00000000000f',
 '20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-0000000000ff',25,1000000,100000)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 ('40000000-0000-0000-0000-0000000000fe','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-00000000000f','flight'),
 ('40000000-0000-0000-0000-0000000000ff','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-00000000000f','final')
ON CONFLICT(id) DO NOTHING;
DO $$ DECLARE v_out jsonb; BEGIN
 v_out:=public.multi_day_set_qualification_rules_v2(
   '30000000-0000-0000-0000-00000000000f','SUM_STACKS',1.5,60);
 IF v_out->>'itmPercent'<>'25' OR v_out->>'day2Percent'<>'60' THEN
   RAISE EXCEPTION 'independent_rates_not_frozen: %',v_out;
 END IF;
 v_out:=public.multi_day_set_qualification_rules_v2(
   '30000000-0000-0000-0000-00000000000f','SUM_STACKS',1.5,60);
 IF v_out->>'idempotent'<>'true' THEN RAISE EXCEPTION 'rules_retry_failed'; END IF;
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v2(
     '30000000-0000-0000-0000-00000000000f','SUM_STACKS',1.5,61);
   RAISE EXCEPTION 'post_lock_day2_change_allowed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_rules_immutable' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.multi_day_qualification_rules_v1 SET day2_percent=61
    WHERE event_id='30000000-0000-0000-0000-00000000000f';
   RAISE EXCEPTION 'direct_day2_change_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 v_out:=public.multi_day_floor_read_v1('30000000-0000-0000-0000-00000000000f');
 IF v_out->'rules'->>'itmPercent'<>'25' OR
    v_out->'rules'->>'day2Percent'<>'60' THEN
   RAISE EXCEPTION 'floor_projection_not_distinct: %',v_out;
 END IF;
END $$;
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status)
SELECT format('50000000-0000-0000-0000-%s',lpad(to_hex(900+n),12,'0'))::uuid,
 '40000000-0000-0000-0000-0000000000fe'::uuid,
 format('60000000-0000-0000-0000-%s',lpad(to_hex(900+n),12,'0'))::uuid,1,
 CASE WHEN n=6 THEN 'cancelled' ELSE 'seated' END
FROM pg_catalog.generate_series(1,6) n
ON CONFLICT(id) DO NOTHING;
DO $$ DECLARE v_out jsonb; BEGIN
 v_out:=public.multi_day_qualification_preview_v1('30000000-0000-0000-0000-00000000000f');
 IF v_out->>'itmPercent'<>'25' OR v_out->>'day2Percent'<>'60' OR
    v_out->'flights'->0->>'validEntries'<>'5' OR
    v_out->'flights'->0->>'itmTarget'<>'2' OR
    v_out->'flights'->0->>'day2Target'<>'3' THEN
   RAISE EXCEPTION 'separate_ceil_wrong: %',v_out;
 END IF;
END $$;
INSERT INTO public.tournament_events(id,club_id,final_tournament_id,itm_percent,buy_in,rake_amount)
VALUES('30000000-0000-0000-0000-000000000010',
 '20000000-0000-0000-0000-000000000001',
 '40000000-0000-0000-0000-0000000001ff',20,1000000,100000)
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tournaments(id,club_id,event_id,phase) VALUES
 ('40000000-0000-0000-0000-0000000001fe','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000010','flight'),
 ('40000000-0000-0000-0000-0000000001ff','20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000010','final')
ON CONFLICT(id) DO NOTHING;
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status)
VALUES('50000000-0000-0000-0000-0000000003ff',
 '40000000-0000-0000-0000-0000000001fe',
 '60000000-0000-0000-0000-0000000003ff',1,'seated')
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 BEGIN
   PERFORM public.multi_day_set_qualification_rules_v2(
     '30000000-0000-0000-0000-000000000010','SELECT_LARGEST',1,40);
   RAISE EXCEPTION 'post_entry_rules_allowed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_rules_after_source' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1
   WHERE event_id='30000000-0000-0000-0000-000000000010') THEN
   RAISE EXCEPTION 'post_entry_rule_inserted';
 END IF;
END $$;
SELECT 'multiday_distinct_itm_day2_v1 PASS' AS result;
