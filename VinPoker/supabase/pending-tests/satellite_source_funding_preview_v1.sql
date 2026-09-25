-- Disposable PG17 integration contract: synthetic base tables, real Cashier
-- migration/refund guards, #1332 classifier and pending Satellite RPCs.
-- No Supabase/production connection. All fixture writes roll back.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.sat_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Satellite preview: %', label; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.sat_awards(n integer)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('position',g,'ticketCount',1,'cashVnd','0') ORDER BY g)
  FROM generate_series(1,n) g;
$$;
CREATE OR REPLACE FUNCTION pg_temp.sat_awards_with_cash()
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.sat_awards(5) || '[{"position":6,"ticketCount":0,"cashVnd":"1000000"}]'::jsonb;
$$;

INSERT INTO auth.users(id) VALUES ('b1000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id)
VALUES ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001');
SELECT set_config('test.actor','b1000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,rake_amount,service_fee_amount,operations_mode)
VALUES
 ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
  'Source SAT','registering','registering',now()+interval '1 day',1000000,10000,0,0,'satellite'),
 ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
  'Target','scheduled','registering',now()+interval '3 day',6000000,10000,500000,100000,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',0,
        'b1000000-0000-4000-8000-000000000001');

-- Paid movement precedes pending->confirmed, matching Cashier guard order.
INSERT INTO public.tournament_registrations
  (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
SELECT ('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       'b3000000-0000-4000-8000-000000000001',
       ('b1000000-0000-4000-8000-'||lpad((g+100)::text,12,'0'))::uuid,
       'b2000000-0000-4000-8000-000000000001',1000000,1200000,
       'SAT-PREVIEW-'||g,'pending',
       '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}'::jsonb
FROM generate_series(1,33) g;
INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
SELECT 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',r.id,
       'b5000000-0000-4000-8000-000000000001','in','cash','buyin',1200000,1200000,
       'b1000000-0000-4000-8000-000000000001','sat-preview:in:'||r.id
FROM public.tournament_registrations r WHERE r.reference_code LIKE 'SAT-PREVIEW-%';
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='b1000000-0000-4000-8000-000000000001'
WHERE reference_code LIKE 'SAT-PREVIEW-%';
INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,source,status)
SELECT ('b7000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       r.tournament_id,r.id,r.player_id,1,'online','registered'
FROM generate_series(1,33) g JOIN public.tournament_registrations r
ON r.id=('b4000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid;

DO $$ DECLARE v jsonb; BEGIN
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5));
  PERFORM pg_temp.sat_assert(v->>'state'='READY' AND v->>'sourcePoolVnd'='33000000'
    AND v->>'feeVnd'='6600000' AND v->>'computedTicketCount'='5'
    AND v->>'cashRemainderVnd'='0' AND v->>'ticketShortfallVnd'='0'
    AND v->>'targetEntryPriceVnd'='6600000' AND v->>'confirmedCount'='33', '33m ledger golden');
  PERFORM pg_temp.sat_assert(v->>'previewRevision' ~ '^v1:[0-9a-f]{32}$', 'revision format');
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(6));
  PERFORM pg_temp.sat_assert(v->>'sourcePoolVnd'='33000000'
    AND v->>'computedTicketCount'='6' AND v->>'ticketShortfallVnd'='6600000'
    AND v->>'obligationShortfallVnd'='6600000', 'GTD6 shortfall is not funded overlay');
END $$;

-- A 34th real ledger-backed entry adds 1m without changing ticket count.
INSERT INTO public.tournament_registrations
  (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES ('b4000000-0000-4000-8000-000000000034','b3000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000134','b2000000-0000-4000-8000-000000000001',
        1000000,1200000,'SAT-34','pending',
        '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}');
INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
VALUES ('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
        'b4000000-0000-4000-8000-000000000034','b5000000-0000-4000-8000-000000000001',
        'in','cash','buyin',1200000,1200000,'b1000000-0000-4000-8000-000000000001','sat-preview:in:34');
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='b1000000-0000-4000-8000-000000000001'
WHERE reference_code='SAT-34';
INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,source,status)
VALUES ('b7000000-0000-4000-8000-000000000034','b3000000-0000-4000-8000-000000000001',
        'b4000000-0000-4000-8000-000000000034','b1000000-0000-4000-8000-000000000134',1,'online','registered');

DO $$ DECLARE v jsonb; BEGIN
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5));
  PERFORM pg_temp.sat_assert(v->>'sourcePoolVnd'='34000000'
    AND v->>'feeVnd'='6800000' AND v->>'computedTicketCount'='5' AND v->>'cashRemainderVnd'='1000000'
    AND v->>'obligationShortfallVnd'='0', '34m ledger golden');
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards_with_cash());
  PERFORM pg_temp.sat_assert(v->'awardPlan'->>'cashTotalVnd'='1000000'
    AND v->'awardPlan'->>'totalLiabilityVnd'='34000000'
    AND v->>'obligationShortfallVnd'='0', '34m five tickets plus rank-six cash');
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(6));
  PERFORM pg_temp.sat_assert(v->>'ticketShortfallVnd'='5600000'
    AND v->>'obligationShortfallVnd'='5600000', '34m GTD6');
END $$;

-- Clean unpaid reservation is zero contribution, not inconsistency.
INSERT INTO public.tournament_registrations
  (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES ('b4000000-0000-4000-8000-000000000035','b3000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000135','b2000000-0000-4000-8000-000000000001',
        1000000,1000000,'SAT-UNPAID','pending',
        '{"buy_in":1000000,"rake":0,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1000000}');
DO $$ DECLARE v jsonb; BEGIN
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5));
  PERFORM pg_temp.sat_assert(v->>'state'='READY' AND v->>'sourcePoolVnd'='34000000'
    AND v->>'unpaidCount'='1', 'unpaid reservation zero contribution');
END $$;

-- Paid waiting refund: append-only receipt and refund movements before cancel.
INSERT INTO public.tournament_registrations
  (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES ('b4000000-0000-4000-8000-000000000036','b3000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000136','b2000000-0000-4000-8000-000000000001',
        1000000,1000000,'SAT-REFUND','pending',
        '{"buy_in":1000000,"rake":0,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1000000}');
INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
VALUES ('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
        'b4000000-0000-4000-8000-000000000036','b5000000-0000-4000-8000-000000000001',
        'in','cash','buyin',1000000,1000000,'b1000000-0000-4000-8000-000000000001','sat-preview:in:refund');
UPDATE public.tournament_registrations SET cashier_paid_at=now() WHERE reference_code='SAT-REFUND';
INSERT INTO public.cashier_refund_requests
  (id,club_id,tournament_id,registration_id,amount,status,reason,requested_by,paid_at)
VALUES ('b6000000-0000-4000-8000-000000000036','b2000000-0000-4000-8000-000000000001',
        'b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000036',
        1000000,'paid','Test full refund','b1000000-0000-4000-8000-000000000001',now());
INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,refund_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
VALUES ('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
        'b4000000-0000-4000-8000-000000000036','b6000000-0000-4000-8000-000000000036',
        'b5000000-0000-4000-8000-000000000001','out','cash','refund',1000000,1000000,
        'b1000000-0000-4000-8000-000000000001','sat-preview:out:refund');
UPDATE public.tournament_registrations
SET status='cancelled',cancelled_at=now(),cancelled_by='b1000000-0000-4000-8000-000000000001',
    cancellation_reason='cashier_refund:b6000000-0000-4000-8000-000000000036'
WHERE reference_code='SAT-REFUND';
DO $$ DECLARE v jsonb; BEGIN
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5));
  PERFORM pg_temp.sat_assert(v->>'state'='READY' AND v->>'sourcePoolVnd'='34000000'
    AND v->>'reversedCount'='1', 'paid waiting refund contributes zero');
END $$;

SAVEPOINT inconsistent_source;
INSERT INTO public.tournament_registrations
  (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES ('b4000000-0000-4000-8000-000000000037','b3000000-0000-4000-8000-000000000001',
        'b1000000-0000-4000-8000-000000000137','b2000000-0000-4000-8000-000000000001',
        1000000,1000000,'SAT-LEGACY','pending',NULL);
DO $$ DECLARE v jsonb; BEGIN
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5));
  PERFORM pg_temp.sat_assert(v->>'state'='NOT_READY' AND v->>'reason'='SOURCE_INCONSISTENT'
    AND v->>'sourcePoolVnd' IS NULL AND v->>'feeVnd' IS NULL
    AND v->'issues'->0->>'reason'='legacy_price_snapshot_missing',
    'inconsistent source never shown as zero');
END $$;
ROLLBACK TO SAVEPOINT inconsistent_source;

DO $$ DECLARE v jsonb; BEGIN
  v := public.satellite_source_funding_preview_v1(
    'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(35));
  PERFORM pg_temp.sat_assert(v->>'state'='OWNER_EXCEPTION_REQUIRED'
    AND v->>'eligibleWinnerCount'='34' AND v->>'ownerExceptionRequired'='true',
    'too few eligible winners requires owner exception');
  PERFORM pg_temp.sat_assert(NOT has_function_privilege('anon',
    'public.satellite_source_funding_preview_v1(uuid,uuid,jsonb)','EXECUTE'), 'anon denied');
END $$;

-- Even an allowed release flag cannot make Lock/Issue safe without atomic
-- Cashier-source freshness. These assertions exercise server gates only.
DO $$ BEGIN
  BEGIN
    PERFORM public.satellite_award_plan_v2(
      'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5),true);
    RAISE EXCEPTION 'Lock unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED%' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.centerpoint_tournament_ops_release
SET enabled=true, allowed_club_ids=ARRAY['b2000000-0000-4000-8000-000000000001'::uuid]
WHERE id;
DO $$ BEGIN
  BEGIN
    PERFORM public.satellite_award_plan_v2(
      'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',pg_temp.sat_awards(5),true);
    RAISE EXCEPTION 'Lock unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%satellite_verified_funding_lock_required%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.satellite_award_issues
      (source_tournament_id,club_id,locked_results,ticket_total,cash_total_vnd,issued_by)
    VALUES ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
            '[]',5,0,'b1000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Issue unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%satellite_verified_funding_lock_required%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.sat_assert(NOT EXISTS (SELECT 1 FROM public.satellite_award_plans
    WHERE source_tournament_id='b3000000-0000-4000-8000-000000000001'), 'no lock row');
END $$;
ROLLBACK;
