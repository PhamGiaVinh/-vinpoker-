-- Disposable PG17, real canonical + Cashier functions already loaded.
-- This transaction rolls back; it is not production or full Supabase E2E.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.sat_lock_assert(ok boolean,label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'satellite lock: %',label; END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('f1000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id)
VALUES ('f2000000-0000-4000-8000-000000000001',
        'f1000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
  'Lock source','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001',
  'Lock target','live','registering',now()+interval '3 day',900000,10000,100000,0,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('f5000000-0000-4000-8000-000000000001',
        'f2000000-0000-4000-8000-000000000001',0,
        'f1000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES ('f4000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001',
        'f1000000-0000-4000-8000-000000000101',
        'f2000000-0000-4000-8000-000000000001',1000000,1200000,'SAT-LOCK-PAID','pending',
        '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}');
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES ('f2000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001',
        'f4000000-0000-4000-8000-000000000001',
        'f5000000-0000-4000-8000-000000000001',
        'in','cash','buyin',1200000,1200000,
        'f1000000-0000-4000-8000-000000000001','sat-lock:paid');
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='f1000000-0000-4000-8000-000000000001'
WHERE id='f4000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_entries
 (id,tournament_id,registration_id,player_id,entry_no,source,status)
VALUES ('f7000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001',
        'f4000000-0000-4000-8000-000000000001',
        'f1000000-0000-4000-8000-000000000101',1,'online','registered');
INSERT INTO public.tournament_seats
 (id,tournament_id,player_id,entry_number,table_id,seat_number,chip_count,is_active,entry_id)
VALUES ('f8000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001',
        'f1000000-0000-4000-8000-000000000101',1,
        'f9000000-0000-4000-8000-000000000001',1,10000,true,
        'f7000000-0000-4000-8000-000000000001');
CREATE TEMP TABLE sat_lock_before_refund(revision text);
INSERT INTO sat_lock_before_refund
SELECT public.satellite_source_funding_preview_v2(
  'f3000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000002',
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]')->>'previewRevision';
SAVEPOINT before_real_refund;
UPDATE public.tournament_entries SET status='busted',current_stack=0
WHERE id='f7000000-0000-4000-8000-000000000001';
UPDATE public.tournament_seats SET is_active=false,chip_count=0
WHERE id='f8000000-0000-4000-8000-000000000001';
DO $$ DECLARE v jsonb; v_id uuid; p jsonb; BEGIN
  v:=public.cashier_request_refund_v1(
    'f4000000-0000-4000-8000-000000000001','Verified refund before Lock');
  PERFORM pg_temp.sat_lock_assert(v->>'status'='requested','real refund request');
  v_id:=(v->>'refund_id')::uuid;
  v:=public.cashier_floor_clear_refund_v1(v_id);
  PERFORM pg_temp.sat_lock_assert(v->>'status'='floor_cleared','real Floor clearance');
  v:=public.cashier_complete_refund_v1(v_id,1200000,0,NULL,'Verified payout evidence');
  PERFORM pg_temp.sat_lock_assert(v->>'ok'='true','real refund payout');
  p:=public.satellite_source_funding_preview_v2(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
  PERFORM pg_temp.sat_lock_assert(p->>'previewRevision'<>(SELECT revision FROM sat_lock_before_refund)
    AND p->>'state'='NOT_READY' AND p->>'sourcePoolVnd' IS NULL
    AND p->'issues'->0->>'reason'='refund_entry_evidence_missing',
    'played-entry refund invalidates preview without inventing zero pool');
  PERFORM pg_temp.sat_lock_assert((SELECT coalesce(sum(applied_amount),0)
    FROM public.cashier_buyin_movements WHERE registration_id='f4000000-0000-4000-8000-000000000001'
      AND direction='out')=1200000,'refund outflow equals receipt');
END $$;
ROLLBACK TO SAVEPOINT before_real_refund;
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id='f3000000-0000-4000-8000-000000000001';
DO $$ DECLARE v jsonb; BEGIN
  v:=public.satellite_source_funding_preview_v2(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
  PERFORM pg_temp.sat_lock_assert(v->>'state'='READY'
    AND v->>'sourcePoolVnd'='1000000' AND v->>'feeVnd'='200000'
    AND v->>'obligationShortfallVnd'='0','reconciled preview');
  BEGIN
    PERFORM public.satellite_lock_award_plan_v1(
      'f3000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000002',
      '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',
      v->>'previewRevision','fa000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'default-off release admitted Lock';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED%' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.centerpoint_tournament_ops_release
SET enabled=true,allowed_club_ids=ARRAY['f2000000-0000-4000-8000-000000000001']::uuid[]
WHERE id=true;
DO $$ DECLARE v jsonb; locked jsonb; retry jsonb; stale jsonb; BEGIN
  v:=public.satellite_source_funding_preview_v2(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
  stale:=public.satellite_lock_award_plan_v1(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',
    'v2:00000000000000000000000000000000',
    'fa000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.sat_lock_assert(stale->>'error'='stale_preview'
    AND NOT EXISTS (SELECT 1 FROM public.satellite_award_plans
                    WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001'),
    'stale preview creates no Lock');
  locked:=public.satellite_lock_award_plan_v1(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',
    v->>'previewRevision','fa000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.sat_lock_assert(locked->>'locked'='true'
    AND locked->>'idempotent'='false','first lock');
  retry:=public.satellite_lock_award_plan_v1(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',
    v->>'previewRevision','fa000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.sat_lock_assert(retry->>'idempotent'='true','same request retry');
  BEGIN
    PERFORM public.satellite_lock_award_plan_v1(
      'f3000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000002',
      '[{"position":1,"ticketCount":1,"cashVnd":"1"}]',
      v->>'previewRevision','fa000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'changed request payload accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM NOT LIKE '%satellite_lock_request_conflict%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.sat_lock_assert((SELECT source_pool_vnd=1000000
    AND source_fee_vnd=200000 AND obligation_shortfall_vnd=0
    AND target_buy_in_vnd=900000 AND target_fee_vnd=100000
    AND source_snapshot->>'previewRevision'=source_preview_revision
    FROM public.satellite_award_plans
    WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001'),
    'immutable plan stores exact source and target components');
  PERFORM pg_temp.sat_lock_assert(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid='public.satellite_award_issues'::pg_catalog.regclass
      AND tgname='satellite_preview_write_hold_v1' AND NOT tgisinternal),
    'Issue hold remains installed');
  BEGIN
    UPDATE public.tournament_registrations
    SET cancellation_reason='forged after Lock'
    WHERE id='f4000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'locked funding evidence changed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_locked_registration_evidence_immutable%' THEN RAISE; END IF;
  END;
  UPDATE public.tournament_registrations
  SET cashier_seating_error='Floor follow-up'
  WHERE id='f4000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.cashier_request_refund_v1(
      'f4000000-0000-4000-8000-000000000001','Refund after locked plan');
    RAISE EXCEPTION 'Cashier refund request crossed Lock';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_refund_after_lock_requires_adjustment%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
